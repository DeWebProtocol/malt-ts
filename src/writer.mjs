export const defaultIPAWriterPreference = 'auto'

const backends = new Set(['kzg', 'ipa'])
const ipaProfiles = new Set(['direct', 'compact', 'fast'])
const ipaPreferences = new Set(['auto', ...ipaProfiles])

function requireBackend(backend) {
  if (!backends.has(backend)) throw new Error(`unsupported MALT writer backend ${JSON.stringify(backend)}`)
  return backend
}

function nowMilliseconds() {
  return globalThis.performance?.now?.() ?? Date.now()
}

function normalizedPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

export function browserWriterCapabilities(navigatorLike = globalThis.navigator) {
  const hardwareConcurrency = normalizedPositiveNumber(navigatorLike?.hardwareConcurrency)
  const deviceMemory = normalizedPositiveNumber(navigatorLike?.deviceMemory)
  const lowMemory = deviceMemory > 0 && deviceMemory <= 4
  const lowCPU = hardwareConcurrency > 0 && hardwareConcurrency <= 4
  const highMemory = deviceMemory >= 8
  const highCPU = hardwareConcurrency >= 8
  return Object.freeze({
    hardwareConcurrency,
    deviceMemory,
    low: lowMemory || lowCPU,
    high: highMemory && highCPU
  })
}

export function selectIPAWriterProfile({
  preference = defaultIPAWriterPreference,
  navigator: navigatorLike = globalThis.navigator
} = {}) {
  if (!ipaPreferences.has(preference)) {
    throw new Error(`unsupported IPA writer preference ${JSON.stringify(preference)}`)
  }
  const capabilities = browserWriterCapabilities(navigatorLike)
  if (preference === 'direct') return 'direct'
  if (preference === 'compact') return capabilities.low ? 'direct' : 'compact'
  if (preference === 'fast') return capabilities.high ? 'fast' : (capabilities.low ? 'direct' : 'compact')
  return capabilities.low ? 'direct' : 'compact'
}

export function browserWriterAssetURLs(baseURL, browserOrigin = globalThis.location?.origin) {
  const origin = String(browserOrigin || '').trim()
  if (!origin) throw new Error('browser origin is required for MALT writer assets')
  const base = new URL(String(baseURL || '/writer/'), origin)
  if (!base.pathname.endsWith('/')) base.pathname += '/'
  return Object.freeze({
    controller: new URL('malt-writer-workers.mjs', base).toString(),
    wasm: Object.freeze({
      kzg: new URL('malt-writer-kzg.wasm', base).toString(),
      ipa: Object.freeze({
        direct: new URL('malt-writer-ipa-direct.wasm', base).toString(),
        compact: new URL('malt-writer-ipa-compact.wasm', base).toString(),
        fast: new URL('malt-writer-ipa-fast.wasm', base).toString()
      })
    }),
    wasmExec: new URL('wasm_exec.js', base).toString(),
    worker: new URL('malt-writer-worker.mjs', base).toString()
  })
}

function fallbackProfiles(selected) {
  if (selected === 'fast') return ['fast', 'compact', 'direct']
  if (selected === 'compact') return ['compact', 'direct']
  return ['direct']
}

function validateRuntime(runtime) {
  if (
    !runtime ||
    typeof runtime.prepareAuthentication !== 'function' ||
    typeof runtime.updateAuthentication !== 'function' ||
    typeof runtime.createAuthentication !== 'function' ||
    typeof runtime.importAuthentication !== 'function' ||
    typeof runtime.applyAuthentication !== 'function' ||
    typeof runtime.exportAuthentication !== 'function' ||
    typeof runtime.discardAuthentication !== 'function' ||
    typeof runtime.closeAuthentication !== 'function' ||
    typeof runtime.compute !== 'function' ||
    typeof runtime.load !== 'function' ||
    typeof runtime.snapshot !== 'function' ||
    typeof runtime.restore !== 'function' ||
    typeof runtime.bootstrap !== 'function' ||
    typeof runtime.prepare !== 'function' ||
    typeof runtime.getPreparedResult !== 'function' ||
    typeof runtime.validateReceipt !== 'function' ||
    typeof runtime.acceptReceipt !== 'function' ||
    typeof runtime.discard !== 'function' ||
    typeof runtime.closeSession !== 'function' ||
    typeof runtime.status !== 'function' ||
    typeof runtime.fatal?.then !== 'function' ||
    typeof runtime.terminate !== 'function'
  ) {
    runtime?.terminate?.()
    throw new Error('MALT writer controller returned an invalid single-Worker runtime')
  }
  return runtime
}

export class BrowserMaltWriterRouter {
  #controller
  #assets
  #navigator
  #preference
  #beforeWorkerStart
  #onStatus
  #active = null
  #loading = null
  #sessionBackend = ''
  #authenticationBackend = ''
  #authenticationRetained = false
  #authenticationPending = 0
  #authenticationQueue = Promise.resolve()
  #authenticationEpoch = {}
  #authenticationHandles = new Map()
  #terminated = false
  #states = new Map([
    ['kzg', Object.freeze({ backend: 'kzg', state: 'idle', profile: '' })],
    ['ipa', Object.freeze({ backend: 'ipa', state: 'idle', profile: '' })]
  ])

  constructor({ controller, assets, navigator: navigatorLike, ipaPreference, beforeWorkerStart, onStatus }) {
    if (typeof controller?.createMaltWriterWorker !== 'function') {
      throw new Error('MALT writer controller did not export createMaltWriterWorker')
    }
    this.#controller = controller
    this.#assets = assets
    this.#navigator = navigatorLike
    this.#preference = ipaPreference
    this.#beforeWorkerStart = beforeWorkerStart
    this.#onStatus = onStatus
  }

  status(backend) {
    return this.#states.get(requireBackend(backend))
  }

  #setStatus(backend, state, profile = '', error, detail = {}) {
    const value = Object.freeze({
      backend,
      state,
      profile,
      ...detail,
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
    })
    this.#states.set(backend, value)
    this.#onStatus?.(value)
  }

  #retireActive(active, error) {
    if (this.#active?.runtime !== active.runtime) return false
    const failure = error instanceof Error
      ? error
      : new Error(String(error || `${active.backend} writer runtime failed`))
    this.#active = null
    if (this.#sessionBackend === active.backend) this.#sessionBackend = ''
    this.#resetAuthentication(active.backend)
    try {
      active.runtime.terminate()
    } catch {
      // The failed runtime is already detached; preserve the fatal status and
      // original failure even if a custom adapter cannot release it.
    }
    this.#setStatus(active.backend, 'failed', active.profile, failure)
    return true
  }

  #observeFatal(active) {
    const retire = (error) => {
      if (this.#active?.runtime !== active.runtime) return
      try {
        this.#retireActive(active, error)
      } catch {
        // Active state is detached before status listeners are notified. A
        // consumer callback must not turn fatal observation into an unhandled
        // Promise rejection.
      }
    }
    void Promise.resolve(active.runtime.fatal).then(retire, retire)
  }

  #retireFatalActive(active, requestError) {
    if (this.#active?.runtime !== active.runtime) return false
    let runtimeState
    let statusError
    try {
      runtimeState = active.runtime.status(active.backend)
    } catch (error) {
      statusError = error instanceof Error ? error : new Error(String(error))
    }
    if (!statusError && (!runtimeState || typeof runtimeState !== 'object')) {
      statusError = new Error(`${active.backend} writer runtime returned an invalid status`)
    }
    if (
      !statusError &&
      (runtimeState.backend !== active.backend || runtimeState.profile !== active.profile)
    ) {
      statusError = new Error(
        `${active.backend} writer runtime status target does not match ${active.backend}/${active.profile}`
      )
    }
    if (!statusError && runtimeState.state === 'ready') return false
    if (!statusError && runtimeState.state !== 'failed' && runtimeState.state !== 'terminated') {
      statusError = new Error(
        `${active.backend} writer runtime reported unexpected state ${JSON.stringify(runtimeState.state)}`
      )
    }

    const failure = new Error(
      runtimeState?.error ||
      statusError?.message ||
      (requestError instanceof Error ? requestError.message : String(requestError || '')) ||
      `${active.backend} writer runtime ${runtimeState?.state || 'failed'}`
    )
    return this.#retireActive(active, failure)
  }

  async #start(backend) {
    if (this.#terminated) throw new Error('MALT writer router is terminated')
    if (this.#active) {
      const active = this.#active
      const retired = this.#retireFatalActive(active)
      if (!retired && active.backend === backend) return active.runtime
    }
    if (this.#sessionBackend && this.#sessionBackend !== backend) {
      throw new Error(`cannot switch from ${this.#sessionBackend} while its writer session is active`)
    }
    if (this.#authenticationBackend && this.#authenticationBackend !== backend) {
      throw new Error(`cannot switch from ${this.#authenticationBackend} while its authentication session is active`)
    }
    if (this.#loading?.backend === backend) return this.#loading.promise
    if (this.#loading) {
      throw new Error(`cannot load ${backend} while ${this.#loading.backend} writer initialization is active`)
    }

    const selectedProfile = backend === 'ipa'
      ? selectIPAWriterProfile({ preference: this.#preference, navigator: this.#navigator })
      : ''
    const profiles = backend === 'ipa' ? fallbackProfiles(selectedProfile) : ['']
    const startedAt = nowMilliseconds()
    const timing = (phase) => ({ phase, elapsedMs: Math.max(0, nowMilliseconds() - startedAt) })
    const abortController = new AbortController()
    const loading = { backend, promise: null, abortController, runtime: null }
    const cancellationFailure = () => {
      if (abortController.signal.reason instanceof Error) return abortController.signal.reason
      return new Error('MALT writer router was terminated during initialization')
    }
    const throwIfCancelled = () => {
      if (this.#terminated || abortController.signal.aborted) throw cancellationFailure()
    }
    const awaitWithCancellation = async (value) => {
      throwIfCancelled()
      let abortListener
      const aborted = new Promise((_resolve, reject) => {
        abortListener = () => reject(cancellationFailure())
        abortController.signal.addEventListener('abort', abortListener, { once: true })
      })
      try {
        return await Promise.race([Promise.resolve(value), aborted])
      } finally {
        abortController.signal.removeEventListener('abort', abortListener)
      }
    }
    const promise = (async () => {
      const previous = this.#active
      previous?.runtime.terminate()
      this.#active = null
      if (previous) this.#setStatus(previous.backend, 'idle')
      let lastError
      for (const profile of profiles) {
        throwIfCancelled()
        this.#setStatus(backend, 'loading', profile, undefined, timing('checking-release'))
        try {
          await awaitWithCancellation(this.#beforeWorkerStart?.({
            backend,
            profile,
            signal: abortController.signal
          }))
        } catch (error) {
          throwIfCancelled()
          const failure = error instanceof Error ? error : new Error(String(error))
          this.#setStatus(backend, 'failed', profile, failure)
          throw failure
        }
        throwIfCancelled()
        let runtime
        try {
          let creationAccepted = false
          const creating = Promise.resolve().then(() => {
            throwIfCancelled()
            return this.#controller.createMaltWriterWorker({
              backend,
              profile,
              wasmURL: backend === 'kzg' ? this.#assets.wasm.kzg : this.#assets.wasm.ipa[profile],
              wasmExecURL: this.#assets.wasmExec,
              workerURL: this.#assets.worker,
              signal: abortController.signal,
              onPhase: ({ phase } = {}) => {
                if (typeof phase !== 'string' || this.#terminated || abortController.signal.aborted) return
                this.#setStatus(backend, 'loading', profile, undefined, timing(phase))
              }
            })
          })
          void creating.then(
            (lateRuntime) => {
              if (!creationAccepted && (this.#terminated || abortController.signal.aborted)) {
                try {
                  lateRuntime?.terminate?.()
                } catch {
                  // Cancellation has already detached this late runtime.
                }
              }
            },
            () => {}
          )
          runtime = validateRuntime(await awaitWithCancellation(creating))
          creationAccepted = true
          loading.runtime = runtime
          throwIfCancelled()
          this.#setStatus(backend, 'loading', profile, undefined, timing('initializing-scheme'))
          await runtime.ready
          throwIfCancelled()
          const active = { backend, profile, runtime }
          this.#active = active
          this.#observeFatal(active)
          loading.runtime = null
          this.#setStatus(backend, 'ready', profile, undefined, timing('ready'))
          return runtime
        } catch (error) {
          const cancelled = this.#terminated || abortController.signal.aborted
          if (loading.runtime === runtime) {
            runtime?.terminate?.()
            loading.runtime = null
          } else if (!cancelled) {
            runtime?.terminate?.()
          }
          throwIfCancelled()
          lastError = error instanceof Error ? error : new Error(String(error))
          this.#setStatus(backend, 'fallback', profile, lastError)
        }
      }
      this.#setStatus(backend, 'failed', selectedProfile, lastError)
      throw lastError || new Error(`failed to initialize ${backend} writer`)
    })()
    loading.promise = promise
    this.#loading = loading
    try {
      return await promise
    } finally {
      if (this.#loading?.promise === promise) this.#loading = null
    }
  }

  async whenReady(backend) { return this.#start(requireBackend(backend)) }

  async #call(backend, method, args, current) {
    const selected = requireBackend(backend)
    const runtime = await this.#start(selected)
    if (current && !current(runtime)) throw new Error('authentication Worker session was lost')
    try {
      if (typeof runtime[method] !== 'function') throw new Error(`installed MALT writer release does not support ${method}`)
      return await runtime[method](selected, ...args)
    } catch (error) {
      const active = this.#active
      if (active?.runtime === runtime) this.#retireFatalActive(active, error)
      throw error
    }
  }

  prepareAuthentication(backend, stateJSON) {
    return this.#call(backend, 'prepareAuthentication', [stateJSON])
  }
  updateAuthentication(backend, candidateJSON, stateJSON) {
    return this.#call(backend, 'updateAuthentication', [candidateJSON, stateJSON])
  }
  #resetAuthentication(backend) {
    if (this.#authenticationBackend !== backend) return
    this.#authenticationEpoch = {}
    this.#authenticationHandles.clear()
    this.#authenticationRetained = false
    if (this.#authenticationPending === 0) this.#authenticationBackend = ''
  }

  async #callAuthentication(backend, method, args, creates = false, closes = false) {
    const selected = requireBackend(backend)
    if (this.#authenticationBackend && this.#authenticationBackend !== selected) {
      throw new Error(`cannot switch from ${this.#authenticationBackend} while its authentication session is active`)
    }
    // Reserve the backend before awaiting startup or an earlier operation. A
    // concurrent backend request must not terminate the Worker owning handles.
    this.#authenticationBackend = selected
    this.#authenticationPending++
    const epoch = this.#authenticationEpoch
    const task = this.#authenticationQueue.then(async () => {
      if (epoch !== this.#authenticationEpoch || this.#terminated) {
        throw new Error('authentication request was cancelled')
      }
      if (!creates && !this.#authenticationRetained) {
        if (closes) return ''
        throw new Error('authentication session has no retained state')
      }
      let token, ownedHandle
      const forwarded = [...args]
      if (!creates && !closes) {
        if (!(args[0] instanceof Uint8Array) || args[0].byteLength > 128) {
          throw new Error('authentication handle must be bounded UTF-8 Uint8Array bytes')
        }
        token = new TextDecoder('utf-8', { fatal: true }).decode(args[0])
        ownedHandle = this.#authenticationHandles.get(token)
        if (!ownedHandle || ownedHandle.runtime !== this.#active?.runtime) {
          throw new Error('authentication handle belongs to an expired or different Worker')
        }
        forwarded[0] = new TextEncoder().encode(ownedHandle.id)
      }
      const result = await this.#call(selected, method, forwarded, runtime =>
        epoch === this.#authenticationEpoch && (!ownedHandle || ownedHandle.runtime === runtime)
      )
      if (epoch !== this.#authenticationEpoch || this.#terminated || this.#active?.backend !== selected) {
        throw new Error('authentication Worker session was lost')
      }
      if (creates) this.#authenticationRetained = true
      if (closes) {
        this.#authenticationRetained = false
        this.#authenticationHandles.clear()
      }
      if (method === 'discardAuthentication') this.#authenticationHandles.delete(token)
      if (creates || method === 'applyAuthentication') {
        const value = JSON.parse(result)
        if (!value || typeof value.handle !== 'string' || !/^[1-9][0-9]{0,19}$/.test(value.handle) || typeof value.root !== 'string') {
          throw new Error('invalid authentication handle response')
        }
        // Public handles are opaque browser identities. Never expose reusable
        // per-WASM numeric IDs across Worker or router lifetimes.
        const handle = globalThis.crypto.randomUUID()
        this.#authenticationHandles.set(handle, { runtime: this.#active.runtime, id: value.handle })
        return JSON.stringify({ ...value, handle })
      }
      return result
    })
    this.#authenticationQueue = task.then(() => undefined, () => undefined)
    try {
      return await task
    } finally {
      this.#authenticationPending--
      if (this.#authenticationPending === 0 && !this.#authenticationRetained) this.#authenticationBackend = ''
    }
  }

  createAuthentication(backend, stateJSON) {
    return this.#callAuthentication(backend, 'createAuthentication', [stateJSON], true)
  }
  importAuthentication(backend, candidateJSON) {
    return this.#callAuthentication(backend, 'importAuthentication', [candidateJSON], true)
  }
  applyAuthentication(backend, handle, deltaJSON) {
    return this.#callAuthentication(backend, 'applyAuthentication', [handle, deltaJSON])
  }
  exportAuthentication(backend, handle) {
    return this.#callAuthentication(backend, 'exportAuthentication', [handle])
  }
  discardAuthentication(backend, handle) {
    return this.#callAuthentication(backend, 'discardAuthentication', [handle])
  }
  closeAuthentication(backend) {
    return this.#callAuthentication(backend, 'closeAuthentication', [], false, true)
  }
  compute(backend, transactionID, updateViewJSON, semanticIntentJSON) {
    return this.#call(backend, 'compute', [transactionID, updateViewJSON, semanticIntentJSON])
  }
  async bootstrap(backend) {
    const result = await this.#call(backend, 'bootstrap', [])
    this.#sessionBackend = backend
    return result
  }
  async load(backend, updateViewJSON) {
    const result = await this.#call(backend, 'load', [updateViewJSON])
    this.#sessionBackend = backend
    return result
  }
  snapshot(backend, checkpointKey) {
    return this.#call(backend, 'snapshot', [checkpointKey])
  }
  async restore(backend, snapshotJSON, checkpointKey) {
    const result = await this.#call(backend, 'restore', [snapshotJSON, checkpointKey])
    this.#sessionBackend = backend
    return result
  }
  prepare(backend, transactionID, semanticIntentJSON) {
    return this.#call(backend, 'prepare', [transactionID, semanticIntentJSON])
  }
  getPreparedResult(backend, transactionID) {
    return this.#call(backend, 'getPreparedResult', [transactionID])
  }
  validateReceipt(backend, writerResultJSON, materializationReceiptJSON) {
    return this.#call(backend, 'validateReceipt', [writerResultJSON, materializationReceiptJSON])
  }
  acceptReceipt(backend, transactionID, materializationReceiptJSON) {
    return this.#call(backend, 'acceptReceipt', [transactionID, materializationReceiptJSON])
  }
  discard(backend, transactionID) { return this.#call(backend, 'discard', [transactionID]) }
  async closeSession(backend) {
    const selected = requireBackend(backend)
    const active = this.#active?.backend === selected ? this.#active : null
    try {
      if (active) await active.runtime.closeSession(selected)
    } catch (error) {
      if (active && this.#active?.runtime === active.runtime) {
        this.#retireFatalActive(active, error)
      }
      throw error
    } finally {
      if (this.#sessionBackend === selected) this.#sessionBackend = ''
    }
  }

  terminateBackend(backend) {
    const selected = requireBackend(backend)
    if (this.#loading?.backend === selected) {
      this.#loading.abortController.abort(new Error(`${selected} writer initialization was cancelled`))
      this.#loading.runtime?.terminate?.()
      this.#loading.runtime = null
    }
    if (this.#active?.backend === selected) {
      this.#active.runtime.terminate()
      this.#active = null
    }
    if (this.#sessionBackend === selected) this.#sessionBackend = ''
    this.#resetAuthentication(selected)
    this.#setStatus(selected, 'idle')
  }

  terminateAll() { this.terminate() }

  terminate() {
    if (this.#terminated) return
    this.#terminated = true
    this.#loading?.abortController.abort(new Error('MALT writer router was terminated during initialization'))
    this.#loading?.runtime?.terminate?.()
    if (this.#loading) this.#loading.runtime = null
    this.#active?.runtime.terminate()
    this.#active = null
    this.#sessionBackend = ''
    this.#resetAuthentication(this.#authenticationBackend)
    this.#setStatus('kzg', 'terminated')
    this.#setStatus('ipa', 'terminated')
  }
}

export async function createBrowserMaltWriter({
  baseURL = '/writer/',
  browserOrigin,
  navigator: navigatorLike = globalThis.navigator,
  ipaPreference = defaultIPAWriterPreference,
  beforeWorkerStart,
  onStatus,
  importController = (url) => import(/* @vite-ignore */ url)
} = {}) {
  if (typeof importController !== 'function') throw new Error('MALT writer controller importer is required')
  const assets = browserWriterAssetURLs(baseURL, browserOrigin)
  const controller = await importController(assets.controller)
  return new BrowserMaltWriterRouter({
    controller,
    assets,
    navigator: navigatorLike,
    ipaPreference,
    beforeWorkerStart,
    onStatus
  })
}
