export const authenticationPathVerifierProfile = "malt.authentication/3"
export const defaultVerifierRuntimeURL = '/verifier/wasm_exec.js'
export const defaultVerifierWASMURL = '/verifier/malt-verifier.wasm'

const providerEntries = new Map()
const providerLeaseEntries = new WeakMap()
const workerStartHookIDs = new WeakMap()
const browserVerifierLeaseBrand = Symbol('browser-verifier-lease')
let nextWorkerStartHookID = 1

export function createBrowserVerifierLease() {
  return Object.freeze({ [browserVerifierLeaseBrand]: true })
}

// A lifecycle-bound caller may supply a unique lease and later release that
// exact provider generation. Calls without a lease retain process-lifetime
// cache semantics for the standalone verification helpers.
export async function loadBrowserVerifier({
  runtimeURL = defaultVerifierRuntimeURL,
  wasmURL = defaultVerifierWASMURL,
  signal,
  beforeWorkerStart,
  channel = 'default',
  lease
} = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('the local MALT verifier is only available in a browser')
  }
  if (lease != null && lease?.[browserVerifierLeaseBrand] !== true) {
    throw new Error('local verifier lease is invalid')
  }
  if (lease != null && providerLeaseEntries.has(lease)) {
    throw new Error('local verifier lease is already in use')
  }
  const selectedChannel = String(channel || 'default').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(selectedChannel)) {
    throw new Error('local verifier channel is invalid')
  }
  const hook =
    typeof beforeWorkerStart === 'function'
      ? beforeWorkerStart
      : null
  const key = [
    absoluteURL(runtimeURL),
    absoluteURL(wasmURL),
    workerStartHookKey(hook),
    selectedChannel
  ].join('\n')
  if (!providerEntries.has(key)) {
    const provider = new BrowserVerifierProvider({
      runtimeURL: absoluteURL(runtimeURL),
      wasmURL: absoluteURL(wasmURL),
      beforeWorkerStart: hook,
      channel: selectedChannel
    })
    const initializing = initializeBrowserVerifier(provider)
    const entry = {
      provider,
      promise: initializing,
      references: 0,
      persistent: false
    }
    providerEntries.set(key, entry)
    void initializing.catch(() => {
      if (providerEntries.get(key) === entry) {
        providerEntries.delete(key)
      }
    })
  }
  const entry = providerEntries.get(key)
  if (lease != null) {
    entry.references += 1
    providerLeaseEntries.set(lease, { key, entry })
  } else {
    entry.persistent = true
  }
  return waitWithSignal(entry.promise, signal)
}

// Release one lifecycle lease from the exact provider generation it acquired.
export function releaseBrowserVerifier(lease) {
  if (lease?.[browserVerifierLeaseBrand] !== true) {
    return
  }
  const record = providerLeaseEntries.get(lease)
  if (!record) return
  providerLeaseEntries.delete(lease)
  const { key, entry } = record
  if (entry.references < 1) return
  entry.references -= 1
  if (entry.references > 0 || entry.persistent) {
    return
  }
  if (providerEntries.get(key) === entry) {
    providerEntries.delete(key)
  }
  entry.provider.terminate()
}

function workerStartHookKey(hook) {
  if (!hook) return ''
  if (!workerStartHookIDs.has(hook)) {
    workerStartHookIDs.set(hook, nextWorkerStartHookID)
    nextWorkerStartHookID += 1
  }
  return String(workerStartHookIDs.get(hook))
}

async function verifyLocally({ kind, profile, value, runtimeURL, wasmURL, signal, provider }) {
  try {
    throwIfAborted(signal)
    const verifier = provider ?? (await loadBrowserVerifier({ runtimeURL, wasmURL, signal }))
    const fn = typeof verifier === 'function' ? verifier : verifier?.[kind]
    if (typeof fn !== 'function') {
      throw new Error(`local verifier does not provide ${kind}`)
    }
    throwIfAborted(signal)
    const receiver = typeof verifier === 'function' ? undefined : verifier
    const result = parseProviderResult(
      await fn.call(receiver, JSON.stringify(value), signal),
      profile
    )
    return { ...result, source: 'local-wasm' }
  } catch (err) {
    return invalidResult(profile, err)
  }
}

async function initializeBrowserVerifier(provider) {
  try {
    await provider.ready()
    return provider
  } catch (err) {
    provider.terminate()
    throw err
  }
}

class WorkerStartGuardError extends Error {
  constructor(cause) {
    super(errorMessage(cause))
    this.name = 'WorkerStartGuardError'
    this.cause = cause
  }
}

class BrowserVerifierProvider {
  constructor({ runtimeURL, wasmURL, beforeWorkerStart, channel }) {
    this.runtimeURL = runtimeURL
    this.wasmURL = wasmURL
    this.beforeWorkerStart = beforeWorkerStart
    this.channel = channel
    // Core's portable verifier registers both typed KZG and IPA schemes.
    // Keep them in one Worker so KZG setup is initialized only once per page.
    this.workerSlot = verifierWorkerSlot('all', 120_000)
    this.terminated = false
  }

  async ready() {
    await this.waitForWorker(this.workerSlot)
  }

  derive(json, signal) {
    return this.verify("derive", json, signal)
  }

  authentication(json, signal) {
    return this.verify("authentication", json, signal)
  }

  verify(kind, json, signal) {
    return this.callWorker(this.workerSlot, kind, json, signal)
  }

  async waitForWorker(slot, signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const initializing = this.ensureWorker(slot)
      try {
        return await waitWithSignal(initializing, signal)
      } catch (err) {
        throwIfAborted(signal)
        if (err instanceof WorkerStartGuardError) throw err.cause
        if (attempt > 0 || slot.promise === initializing) throw err
      }
    }
    throw new Error(`${slot.backend} local verifier recovery failed`)
  }

  async callWorker(slot, kind, json, signal) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const initializing = this.ensureWorker(slot)
      try {
        const worker = await waitWithSignal(initializing, signal)
        return await worker.call(kind, json, signal)
      } catch (err) {
        throwIfAborted(signal)
        if (err instanceof WorkerStartGuardError) throw err.cause
        if (attempt > 0 || slot.promise === initializing) throw err
      }
    }
    throw new Error(`${slot.backend} local verifier recovery failed`)
  }

  ensureWorker(slot) {
    if (this.terminated) {
      return Promise.reject(new Error('local verifier provider was released'))
    }
    if (slot.promise) return slot.promise
    let worker
    let startAttempted = false
    const starting = (async () => {
      try {
        await this.checkBeforeWorkerStart()
      } catch (err) {
        throw new WorkerStartGuardError(err)
      }
      if (this.terminated) {
        throw new Error('local verifier provider was released')
      }
      startAttempted = true
      worker = new VerifierWorkerClient({
        backend: slot.backend,
        channel: this.channel,
        runtimeURL: this.runtimeURL,
        wasmURL: this.wasmURL,
        timeoutMs: slot.timeoutMs,
        onFailure: (failed) => {
          if (slot.worker !== failed) return
          slot.worker = null
          slot.promise = null
          if (!this.terminated) {
            this.checkReleaseAfterWorkerFailure()
          }
        }
      })
      slot.worker = worker
      await worker.ready()
      return worker
    })()
    const initializing = starting
      .catch((err) => {
        if (slot.worker === worker) {
          slot.worker = null
        }
        if (slot.promise === initializing) {
          slot.promise = null
        }
        if (worker) {
          worker.terminate()
        } else if (startAttempted && !this.terminated) {
          this.checkReleaseAfterWorkerFailure()
        }
        throw err
      })
    slot.promise = initializing
    return initializing
  }

  async checkBeforeWorkerStart() {
    await this.beforeWorkerStart?.()
  }

  checkReleaseAfterWorkerFailure() {
    if (!this.beforeWorkerStart) return
    void Promise.resolve()
      .then(() => this.beforeWorkerStart())
      .catch(() => {
        // A release mismatch triggers its own reload. Keep the worker error as
        // the verification result if the active release is otherwise current.
      })
  }

  terminate() {
    if (this.terminated) return
    this.terminated = true
    this.workerSlot.worker?.terminate()
  }
}

function verifierWorkerSlot(backend, timeoutMs) {
  return {
    backend,
    timeoutMs,
    worker: null,
    promise: null
  }
}

class VerifierWorkerClient {
  constructor({ backend, channel, runtimeURL, wasmURL, timeoutMs, onFailure }) {
    this.backend = backend
    this.nextID = 1
    this.pending = new Map()
    this.failure = null
    this.onFailure = onFailure
    this.worker = new Worker(new URL('./malt-verifier.worker.mjs', import.meta.url), {
      type: 'module',
      name: channel === 'default'
        ? `malt-verifier-${backend}`
        : `malt-verifier-${channel}-${backend}`
    })
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyTimer = setTimeout(() => {
      this.fail(new Error(`${backend} local verifier initialization timed out`))
    }, timeoutMs)
    this.worker.onmessage = (event) => this.handleMessage(event.data)
    this.worker.onerror = (event) => {
      this.fail(new Error(event?.message || `${backend} local verifier worker failed`))
    }
    this.worker.onmessageerror = () => {
      this.fail(new Error(`${backend} local verifier worker returned an unreadable message`))
    }
    const initialization = { type: 'init', backend, runtimeURL }
    this.worker.postMessage({ ...initialization, wasmURL })
  }

  ready() {
    return this.readyPromise
  }

  async call(kind, json, signal) {
    await waitWithSignal(this.readyPromise, signal)
    if (this.failure) throw this.failure
    throwIfAborted(signal)
    const id = this.nextID++
    return new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => {
        this.pending.delete(id)
        cleanup()
        reject(abortError())
      }
      this.pending.set(id, {
        resolve: (value) => {
          cleanup()
          resolve(value)
        },
        reject: (err) => {
          cleanup()
          reject(err)
        }
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      try {
        this.worker.postMessage({ type: 'verify', id, kind, json })
      } catch (err) {
        this.pending.delete(id)
        cleanup()
        reject(err)
      }
    })
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return
    if (message.type === 'ready') {
      if (message.backend !== this.backend) {
        this.fail(new Error(
          `local verifier worker loaded backend ${JSON.stringify(message.backend)}, expected ${JSON.stringify(this.backend)}`
        ))
        return
      }
      clearTimeout(this.readyTimer)
      this.resolveReady()
      return
    }
    if (message.type === 'init-error' || message.type === 'runtime-error') {
      this.fail(new Error(message.error || `${this.backend} local verifier worker failed`))
      return
    }
    if (message.type !== 'result') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.error) {
      pending.reject(new Error(message.error))
    } else {
      pending.resolve(message.result)
    }
  }

  fail(err) {
    if (this.failure) return
    this.failure = err instanceof Error ? err : new Error(String(err))
    clearTimeout(this.readyTimer)
    this.worker.terminate()
    this.onFailure?.(this, this.failure)
    this.rejectReady(this.failure)
    for (const pending of this.pending.values()) {
      pending.reject(this.failure)
    }
    this.pending.clear()
  }

  terminate() {
    this.fail(new Error(`${this.backend} local verifier worker terminated`))
  }
}

function parseProviderResult(raw, expectedProfile) {
  if (typeof raw !== 'string') throw new Error('local verifier returned a non-JSON result')
  let result
  try {
    result = JSON.parse(raw)
  } catch (err) {
    throw new Error(`local verifier returned invalid JSON: ${errorMessage(err)}`)
  }
  if (!result || result.profile !== expectedProfile || typeof result.valid !== 'boolean') {
    throw new Error('local verifier returned an invalid result envelope')
  }
  return {
    profile: result.profile,
    valid: result.valid,
    ...(result.error ? { error: String(result.error) } : {})
  }
}

function invalidResult(profile, err) {
  return { profile, valid: false, source: 'local-wasm', error: errorMessage(err) }
}

function absoluteURL(raw) {
  return new URL(raw, globalThis.location?.href || 'http://localhost/').toString()
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError()
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (err) => {
        cleanup()
        reject(err)
      }
    )
  })
}

function abortError() {
  return new DOMException('operation aborted', 'AbortError')
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}

// Typed coordinates and derivation rules are decoded only by Core/WASM.
// Forward the caller's explicit steps and uint64 strings without normalization.
export function createAuthenticationVerification({ request, result }) {
  if (!request || request.profile !== authenticationPathVerifierProfile ||
      typeof request.root !== 'string' || !request.root ||
      !result || result.profile !== request.profile) {
    throw new Error('unsupported authentication request or result profile')
  }
  return structuredClone({ request, result })
}

export async function verifyAuthenticationLocally({ request, result,
  runtimeURL = defaultVerifierRuntimeURL, wasmURL = defaultVerifierWASMURL,
  signal, provider }) {
  try {
    return await verifyLocally({ kind: 'authentication', profile: request.profile,
      value: createAuthenticationVerification({ request, result }),
      runtimeURL, wasmURL, signal, provider })
  } catch (error) {
    return invalidResult(request?.profile || authenticationPathVerifierProfile, error)
  }
}
