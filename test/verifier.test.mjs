import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { afterEach, describe, expect, it, vi } from 'vitest'

function typedRoot(codec, size) {
  return CID.createV1(codec, Digest.create(0, new Uint8Array(size))).toString()
}

function verification(from) {
  return JSON.stringify({
    request: {
      profile: 'malt.resolve/v0alpha1',
      root: from,
      segments: ['docs']
    },
    result: {
      profile: 'malt.resolve/v0alpha1',
      target: from,
      prooflist: {
        root: from,
        query: 'docs',
        steps: [{ kind: 'map_lookup', from, target: from }]
      }
    }
  })
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

class FakeVerifierWorker {
  static instances = []
  static failNextInitializations = { all: 0 }
  static deferredInitializations = new Set()
  static throwNextConstructions = 0

  constructor(_url, options) {
    if (FakeVerifierWorker.throwNextConstructions > 0) {
      FakeVerifierWorker.throwNextConstructions -= 1
      throw new Error('simulated Worker construction failure')
    }
    this.options = options
    this.messages = []
    this.terminated = false
    FakeVerifierWorker.instances.push(this)
  }

  postMessage(message) {
    this.messages.push(message)
    if (message.type === 'init') {
      this.backend = message.backend
      if (FakeVerifierWorker.failNextInitializations[message.backend] > 0) {
        FakeVerifierWorker.failNextInitializations[message.backend] -= 1
        queueMicrotask(() => this.emit({
          type: 'init-error',
          error: `simulated ${message.backend} verifier initialization failure`
        }))
      } else if (!FakeVerifierWorker.deferredInitializations.has(message.backend)) {
        queueMicrotask(() => this.emit({ type: 'ready', backend: message.backend }))
      }
      return
    }
    if (message.type === 'verify') {
      if (message.json === 'simulate-result-error') {
        queueMicrotask(() => this.emit({
          type: 'result',
          id: message.id,
          error: 'simulated verification result error'
        }))
        return
      }
      const profile =
        message.kind === "read"
          ? "malt.read/v0alpha1"
          : message.kind === "mapProof"
            ? "malt.map-proof/v0alpha1"
            : "malt.resolve/v0alpha1"
      queueMicrotask(() => this.emit({
        type: 'result',
        id: message.id,
        result: JSON.stringify({ profile, valid: true })
      }))
    }
  }

  emit(data) {
    this.onmessage?.({ data })
  }

  terminate() {
    this.terminated = true
  }
}

describe('browser verifier workers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    FakeVerifierWorker.instances = []
    FakeVerifierWorker.failNextInitializations = { all: 0 }
    FakeVerifierWorker.deferredInitializations = new Set()
    FakeVerifierWorker.throwNextConstructions = 0
  })

  it('exposes one portable KZG+IPA worker only after it is ready', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    FakeVerifierWorker.deferredInitializations.add('all')
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')

    const providerPromise = loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-workers-a.js',
      wasmURL: '/verifier/verifier-workers-a.wasm'
    })
    let providerReady = false
    void providerPromise.then(() => {
      providerReady = true
    })

    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    await Promise.resolve()
    expect(providerReady).toBe(false)
    expect(FakeVerifierWorker.instances).toHaveLength(1)
    const [portableWorker] = FakeVerifierWorker.instances
    expect(portableWorker.backend).toBe('all')
    expect(portableWorker.messages[0]).toMatchObject({
      type: 'init',
      backend: 'all',
      wasmURL: 'https://gateway.deweb.world/verifier/verifier-workers-a.wasm'
    })
    expect(portableWorker.options.name).toBe('malt-verifier-all')

    portableWorker.emit({ type: 'ready', backend: 'all' })
    const provider = await providerPromise
    expect(providerReady).toBe(true)
    expect(provider).toBeDefined()
    expect(FakeVerifierWorker.instances).toHaveLength(1)
  })

  it('isolates named verifier channels in independent workers', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const options = {
      runtimeURL: '/verifier/runtime-worker-channels.js',
      wasmURL: '/verifier/verifier-worker-channels.wasm'
    }

    const primary = await loadBrowserVerifier(options)
    const firstExplorer = await loadBrowserVerifier({ ...options, channel: 'explorer' })
    const sharedExplorer = await loadBrowserVerifier({ ...options, channel: 'explorer' })

    expect(primary).not.toBe(firstExplorer)
    expect(sharedExplorer).toBe(firstExplorer)
    expect(FakeVerifierWorker.instances).toHaveLength(2)
    expect(FakeVerifierWorker.instances.map((worker) => worker.options.name)).toEqual([
      'malt-verifier-all',
      'malt-verifier-explorer-all'
    ])
    expect(FakeVerifierWorker.instances.map((worker) => worker.backend)).toEqual(['all', 'all'])
  })

  it('rejects invalid verifier channel names before starting a worker', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')

    await expect(loadBrowserVerifier({ channel: 'explorer\nshared' }))
      .rejects.toThrow('local verifier channel is invalid')
    expect(FakeVerifierWorker.instances).toHaveLength(0)
  })

  it('routes KZG, IPA, and mixed typed proofs through that one worker', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const { loadBrowserVerifier, verifyResolveLocally } =
      await import('../src/verifier.mjs')
    const provider = await loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-workers-b.js',
      wasmURL: '/verifier/verifier-workers-b.wasm'
    })
    const [portableWorker] = FakeVerifierWorker.instances
    const kzgRoot = typedRoot(0x303101, 48)
    const kzgResult = await verifyResolveLocally({
      ...JSON.parse(verification(kzgRoot)),
      provider
    })
    expect(kzgResult.valid).toBe(true)

    const ipaRoot = typedRoot(0x303102, 32)
    const mixed = JSON.stringify({
      request: {
        profile: 'malt.resolve/v0alpha1',
        root: kzgRoot,
        segments: ['child']
      },
      result: {
        profile: 'malt.resolve/v0alpha1',
        target: ipaRoot,
        prooflist: {
          root: kzgRoot,
          query: 'child',
          steps: [
            { kind: 'map_lookup', from: kzgRoot, target: ipaRoot },
            { kind: 'map_lookup', from: ipaRoot, target: ipaRoot }
          ]
        }
      }
    })

    await expect(provider.resolve(verification(ipaRoot))).resolves.toContain('"valid":true')
    await expect(provider.resolve(mixed)).resolves.toContain('"valid":true')
    await expect(provider.read(verification(kzgRoot))).resolves.toContain('"valid":true')
    expect(provider.artifact).toBeUndefined()

    expect(FakeVerifierWorker.instances).toHaveLength(1)
    expect(portableWorker.messages.filter((message) => message.type === 'verify'))
      .toHaveLength(4)
  })

  it('leases one worker and creates a fresh provider only after the final release', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const {
      createBrowserVerifierLease,
      loadBrowserVerifier,
      releaseBrowserVerifier
    } = await import('../src/verifier.mjs')
    const options = {
      runtimeURL: '/verifier/runtime-worker-release.js',
      wasmURL: '/verifier/verifier-worker-release.wasm'
    }

    const firstLease = createBrowserVerifierLease()
    const sharedLease = createBrowserVerifierLease()
    const firstProvider = await loadBrowserVerifier({ ...options, lease: firstLease })
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    const firstWorkers = [...FakeVerifierWorker.instances]
    const sharedProvider = await loadBrowserVerifier({ ...options, lease: sharedLease })
    expect(sharedProvider).toBe(firstProvider)

    releaseBrowserVerifier(firstLease)
    await Promise.resolve()
    expect(firstWorkers.every((worker) => !worker.terminated)).toBe(true)

    releaseBrowserVerifier(sharedLease)
    await Promise.resolve()
    expect(firstWorkers.every((worker) => worker.terminated)).toBe(true)

    const secondLease = createBrowserVerifierLease()
    const secondProvider = await loadBrowserVerifier({ ...options, lease: secondLease })
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(2))

    expect(secondProvider).not.toBe(firstProvider)
    expect(FakeVerifierWorker.instances.slice(1).map((worker) => worker.backend))
      .toEqual(['all'])
    expect(FakeVerifierWorker.instances.slice(1).every((worker) => !worker.terminated))
      .toBe(true)

    releaseBrowserVerifier(secondLease)
  })

  it('does not start a Worker after its owner releases a pending start guard', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const {
      createBrowserVerifierLease,
      loadBrowserVerifier,
      releaseBrowserVerifier
    } = await import('../src/verifier.mjs')
    const startGate = deferred()
    const beforeWorkerStart = vi.fn(async () => startGate.promise)
    const options = {
      runtimeURL: '/verifier/runtime-worker-pending-release.js',
      wasmURL: '/verifier/verifier-worker-pending-release.wasm',
      beforeWorkerStart
    }

    const lease = createBrowserVerifierLease()
    const provider = loadBrowserVerifier({ ...options, lease })
    await vi.waitFor(() => expect(beforeWorkerStart).toHaveBeenCalledOnce())
    expect(FakeVerifierWorker.instances).toHaveLength(0)

    releaseBrowserVerifier(lease)
    startGate.resolve()

    await expect(provider).rejects.toThrow('local verifier provider was released')
    expect(FakeVerifierWorker.instances).toHaveLength(0)
  })

  it('does not let a stale failed lease release a replacement provider', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const initializationFailure = new Error('simulated release guard failure')
    const beforeWorkerStart = vi.fn()
      .mockRejectedValueOnce(initializationFailure)
      .mockResolvedValue()
    const {
      createBrowserVerifierLease,
      loadBrowserVerifier,
      releaseBrowserVerifier
    } = await import('../src/verifier.mjs')
    const options = {
      runtimeURL: '/verifier/runtime-worker-stale-release.js',
      wasmURL: '/verifier/verifier-worker-stale-release.wasm',
      beforeWorkerStart
    }
    const firstOldLease = createBrowserVerifierLease()
    const secondOldLease = createBrowserVerifierLease()

    const firstOldProvider = loadBrowserVerifier({ ...options, lease: firstOldLease })
    const secondOldProvider = loadBrowserVerifier({ ...options, lease: secondOldLease })
    await expect(firstOldProvider).rejects.toBe(initializationFailure)
    await expect(secondOldProvider).rejects.toBe(initializationFailure)
    releaseBrowserVerifier(firstOldLease)

    const replacementLease = createBrowserVerifierLease()
    const replacement = await loadBrowserVerifier({ ...options, lease: replacementLease })
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    const replacementWorkers = [...FakeVerifierWorker.instances]

    releaseBrowserVerifier(secondOldLease)
    expect(replacementWorkers.every((worker) => !worker.terminated)).toBe(true)
    await expect(replacement.resolve(verification(typedRoot(0x303101, 48))))
      .resolves.toContain('"valid":true')

    releaseBrowserVerifier(replacementLease)
    expect(replacementWorkers.every((worker) => worker.terminated)).toBe(true)
  })

  it("binds an absent MapProof to the client-selected root and key", async () => {
    const { verifyMapProofLocally } = await import("../src/verifier.mjs")
    const root = typedRoot(0x303101, 48)
    let received
    const provider = {
      mapProof: vi.fn((raw) => {
        received = JSON.parse(raw)
        return JSON.stringify({ profile: "malt.map-proof/v0alpha1", valid: true })
      })
    }
    const request = {
      profile: "malt.map-proof/v0alpha1",
      root,
      key: ["missing"]
    }
    const result = {
      profile: "malt.map-proof/v0alpha1",
      present: false,
      prooflist: {
        root,
        query: "missing",
        steps: [{ kind: "map_absence", from: root, query: "missing" }]
      }
    }

    await expect(verifyMapProofLocally({ request, result, provider })).resolves.toMatchObject({
      valid: true,
      source: "local-wasm"
    })
    expect(received.result.present).toBe(false)
    expect(received.result.target).toBeUndefined()
    expect(received.result.prooflist.root).toEqual({ "/": root })
    await expect(verifyMapProofLocally({
      request: { ...request, key: ["other"] },
      result,
      provider
    })).rejects.toThrow("does not match the client-selected key")
    expect(provider.mapProof).toHaveBeenCalledTimes(1)
  })

  it('keeps function providers receiver-free', async () => {
    const { verifyResolveLocally } = await import('../src/verifier.mjs')
    const root = typedRoot(0x303101, 48)
    let receiver = 'not-called'
    function provider() {
      receiver = this
      return JSON.stringify({ profile: 'malt.resolve/v0alpha1', valid: true })
    }

    const result = await verifyResolveLocally({
      ...JSON.parse(verification(root)),
      provider
    })

    expect(result.valid).toBe(true)
    expect(receiver).toBeUndefined()
  })

  it('canonicalizes ProofList CID strings for the Go verifier wire format', async () => {
    const { verifyResolveLocally } = await import('../src/verifier.mjs')
    const root = typedRoot(0x303101, 48)
    let received
    const provider = (raw) => {
      received = JSON.parse(raw)
      return JSON.stringify({ profile: 'malt.resolve/v0alpha1', valid: true })
    }

    const result = await verifyResolveLocally({
      ...JSON.parse(verification(root)),
      provider
    })

    expect(result.valid).toBe(true)
    expect(received.result.target).toBe(root)
    expect(received.result.prooflist.root).toEqual({ '/': root })
    expect(received.result.prooflist.steps[0]).toMatchObject({
      from: { '/': root },
      target: { '/': root }
    })
  })

  it('shares one replacement when the first portable worker fails before ready', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    FakeVerifierWorker.failNextInitializations.all = 1
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const options = {
      runtimeURL: '/verifier/runtime-workers-init-recovery.js',
      wasmURL: '/verifier/verifier-workers-init-recovery.wasm'
    }

    const firstCall = loadBrowserVerifier(options)
    const concurrentCall = loadBrowserVerifier(options)
    const [firstProvider, concurrentProvider] = await Promise.all([firstCall, concurrentCall])

    expect(firstProvider).toBe(concurrentProvider)
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(2))
    const [failedWorker, replacementWorker] = FakeVerifierWorker.instances
    expect(failedWorker.backend).toBe('all')
    expect(failedWorker.terminated).toBe(true)
    expect(replacementWorker.backend).toBe('all')
    expect(replacementWorker.terminated).toBe(false)
  })

  it('recovers when Worker construction throws synchronously', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    FakeVerifierWorker.throwNextConstructions = 1
    const beforeWorkerStart = vi.fn(async () => {})
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')

    const provider = await loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-worker-construction.js',
      wasmURL: '/verifier/verifier-worker-construction.wasm',
      beforeWorkerStart
    })

    expect(provider).toBeDefined()
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    expect(FakeVerifierWorker.instances.map((worker) => worker.backend))
      .toEqual(['all'])
    await vi.waitFor(() => expect(beforeWorkerStart.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it('checks the active release before starting the portable worker', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const releaseChanged = new Error('release changed')
    const beforeWorkerStart = vi.fn().mockRejectedValueOnce(releaseChanged)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')

    await expect(loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-release-guard.js',
      wasmURL: '/verifier/verifier-release-guard.wasm',
      beforeWorkerStart
    })).rejects.toBe(releaseChanged)

    expect(beforeWorkerStart).toHaveBeenCalledOnce()
    expect(FakeVerifierWorker.instances).toHaveLength(0)
  })

  it('recovers the portable worker once for later KZG and IPA calls', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const beforeWorkerStart = vi.fn(async () => {})
    const provider = await loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-workers-recovery.js',
      wasmURL: '/verifier/verifier-workers-recovery.wasm',
      beforeWorkerStart
    })
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    const [firstPortable] = FakeVerifierWorker.instances
    expect(firstPortable.backend).toBe('all')

    firstPortable.emit({ type: 'runtime-error', error: 'simulated runtime failure' })
    expect(firstPortable.terminated).toBe(true)
    const kzgRoot = typedRoot(0x303101, 48)
    await expect(provider.resolve(verification(kzgRoot)))
      .resolves.toContain('"valid":true')
    expect(FakeVerifierWorker.instances[1].backend).toBe('all')

    const ipaRoot = typedRoot(0x303102, 32)
    await expect(provider.resolve(verification(ipaRoot)))
      .resolves.toContain('"valid":true')
    expect(FakeVerifierWorker.instances).toHaveLength(2)
    await vi.waitFor(() => expect(beforeWorkerStart.mock.calls.length).toBeGreaterThanOrEqual(3))
  })

  it('does not replace the worker for aborts or ordinary result errors', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const provider = await loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-call-errors.js',
      wasmURL: '/verifier/verifier-call-errors.wasm'
    })

    await expect(provider.resolve('simulate-result-error'))
      .rejects.toThrow('simulated verification result error')
    const controller = new AbortController()
    controller.abort()
    await expect(provider.resolve(verification(typedRoot(0x303101, 48)), controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })

    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))
    await expect(provider.resolve(verification(typedRoot(0x303102, 32))))
      .resolves.toContain('"valid":true')
    expect(FakeVerifierWorker.instances).toHaveLength(1)
  })

  it('fails closed after persistent initialization errors and retries on a later load', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    FakeVerifierWorker.failNextInitializations.all = 2
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const options = {
      runtimeURL: '/verifier/runtime-portable-retry.js',
      wasmURL: '/verifier/verifier-portable-retry.wasm'
    }
    await expect(loadBrowserVerifier(options))
      .rejects.toThrow('simulated all verifier initialization failure')
    expect(FakeVerifierWorker.instances).toHaveLength(2)
    expect(FakeVerifierWorker.instances.every((worker) => worker.terminated)).toBe(true)

    const provider = await loadBrowserVerifier(options)
    const kzgRoot = typedRoot(0x303101, 48)
    await expect(provider.resolve(verification(kzgRoot)))
      .resolves.toContain('"valid":true')
    const ipaRoot = typedRoot(0x303102, 32)
    await expect(provider.resolve(verification(ipaRoot)))
      .resolves.toContain('"valid":true')
    expect(FakeVerifierWorker.instances).toHaveLength(3)
    expect(FakeVerifierWorker.instances[2].backend).toBe('all')
  })

  it('does not start a replacement after a worker failure reveals a new release', async () => {
    vi.stubGlobal('Worker', FakeVerifierWorker)
    const releaseChanged = new Error('release changed')
    const beforeWorkerStart = vi.fn()
      .mockResolvedValueOnce()
      .mockResolvedValueOnce()
      .mockRejectedValue(releaseChanged)
    const { loadBrowserVerifier } = await import('../src/verifier.mjs')
    const provider = await loadBrowserVerifier({
      runtimeURL: '/verifier/runtime-recovery-release.js',
      wasmURL: '/verifier/verifier-recovery-release.wasm',
      beforeWorkerStart
    })
    await vi.waitFor(() => expect(FakeVerifierWorker.instances).toHaveLength(1))

    FakeVerifierWorker.instances[0].emit({
      type: 'runtime-error',
      error: 'simulated runtime failure'
    })
    await vi.waitFor(() => expect(beforeWorkerStart).toHaveBeenCalledTimes(2))
    await expect(provider.resolve(verification(typedRoot(0x303101, 48))))
      .rejects.toBe(releaseChanged)
    await Promise.resolve()

    expect(beforeWorkerStart).toHaveBeenCalledTimes(3)
    expect(FakeVerifierWorker.instances).toHaveLength(1)
  })
})
