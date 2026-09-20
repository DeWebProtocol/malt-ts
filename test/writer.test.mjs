import { describe, expect, it, vi } from 'vitest'

import {
  browserWriterAssetURLs,
  browserWriterCapabilities,
  createBrowserMaltWriter,
  selectIPAWriterProfile
} from '../src/writer.mjs'
import {
  MaltWriterWorker,
  createMaltWriterWorker
} from '../assets/writer/malt-writer-workers.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fakeRuntime(target, {
  ready = Promise.resolve(target),
  fatal = new Promise(() => {}),
  runtimeState = { state: 'ready' }
} = {}) {
  let nextHandle = 0
  const newHandle = async () => JSON.stringify({ handle: String(++nextHandle), root: 'root' })
  return {
    ...target,
    ready,
    fatal,
    status: vi.fn(() => ({ ...target, ...runtimeState })),
    bootstrap: vi.fn(async () => '{}'),
    load: vi.fn(async () => 'root'),
    snapshot: vi.fn(async () => '{"profile":"malt.ts.writer-session-snapshot/v1"}'),
    restore: vi.fn(async () => '{"profile":"malt.update-view/v1"}'),
    prepare: vi.fn(async () => 'candidate'),
    getPreparedResult: vi.fn(async () => '{}'),
    validateReceipt: vi.fn(async () => 'candidate'),
    acceptReceipt: vi.fn(async () => 'candidate'),
    discard: vi.fn(async () => 'operation'),
    closeSession: vi.fn(async () => {}),
    prepareAuthentication: vi.fn(async () => '{}'),
    updateAuthentication: vi.fn(async () => '{}'),
    createAuthentication: vi.fn(newHandle),
    importAuthentication: vi.fn(newHandle),
    applyAuthentication: vi.fn(newHandle),
    exportAuthentication: vi.fn(async () => '{}'),
    discardAuthentication: vi.fn(async () => '{}'),
    closeAuthentication: vi.fn(async () => '{}'),
    compute: vi.fn(async () => '{}'),
    terminate: vi.fn()
  }
}

function loaderHarness({ fail = new Set(), ipaPreference = 'auto', navigator = {} } = {}) {
  const attempts = []
  const runtimes = []
  const controller = {
    createMaltWriterWorker: vi.fn(async (target) => {
      attempts.push(target)
      const key = `${target.backend}/${target.profile}`
      const runtime = fakeRuntime(target, {
        ready: fail.has(key) ? Promise.reject(new Error(`${key} unavailable`)) : Promise.resolve(target)
      })
      runtimes.push(runtime)
      return runtime
    })
  }
  return {
    attempts,
    runtimes,
    controller,
    writer: createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      ipaPreference,
      navigator,
      importController: vi.fn(async () => controller)
    })
  }
}

describe('browser MALT writer profile selection', () => {
  it('uses only coarse browser hints and defaults unknown devices to compact', () => {
    expect(browserWriterCapabilities({ hardwareConcurrency: 2, deviceMemory: 4 })).toMatchObject({
      low: true,
      high: false
    })
    expect(selectIPAWriterProfile({ navigator: {} })).toBe('compact')
    expect(selectIPAWriterProfile({ navigator: { hardwareConcurrency: 4, deviceMemory: 8 } })).toBe('direct')
    expect(selectIPAWriterProfile({ preference: 'fast', navigator: { hardwareConcurrency: 8, deviceMemory: 8 } })).toBe('fast')
    expect(selectIPAWriterProfile({ preference: 'fast', navigator: { hardwareConcurrency: 8, deviceMemory: 4 } })).toBe('direct')
  })

  it('maps one coordinated release directory to four immutable WASM assets', () => {
    expect(browserWriterAssetURLs('/writer/version/', 'https://gateway.test').wasm).toEqual({
      kzg: 'https://gateway.test/writer/version/malt-writer-kzg.wasm',
      ipa: {
        direct: 'https://gateway.test/writer/version/malt-writer-ipa-direct.wasm',
        compact: 'https://gateway.test/writer/version/malt-writer-ipa-compact.wasm',
        fast: 'https://gateway.test/writer/version/malt-writer-ipa-fast.wasm'
      }
    })
  })
})

describe('browser MALT writer initialization phases', () => {
  it('reports download, compile, and Worker startup separately', async () => {
    const phases = []
    const wasm = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
    const worker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      terminate: vi.fn()
    }
    const runtime = await createMaltWriterWorker({
      backend: 'kzg',
      wasmURL: 'https://gateway.test/writer/malt-writer-kzg.wasm',
      fetch: vi.fn(async () => new Response(wasm)),
      compileStreaming: null,
      compile: vi.fn(async (bytes) => new WebAssembly.Module(bytes)),
      workerFactory: () => worker,
      onPhase: ({ phase }) => phases.push(phase)
    })

    expect(phases).toEqual(['fetching-wasm', 'compiling-wasm', 'starting-worker'])
    runtime.terminate()
    expect(worker.terminate).toHaveBeenCalledOnce()
  })

  it('transfers an exact update-view buffer into the stateful Worker load request', async () => {
    const listeners = new Map()
    const worker = {
      postMessage: vi.fn(),
      addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
      terminate: vi.fn()
    }
    const module = new WebAssembly.Module(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
    )
    const runtime = new MaltWriterWorker({
      backend: 'kzg',
      module,
      wasmExecURL: 'https://gateway.test/writer/wasm_exec.js',
      workerURL: 'https://gateway.test/writer/malt-writer-worker.mjs',
      workerFactory: () => worker
    })
    listeners.get('message')({
      data: { type: 'ready', backend: 'kzg', profile: '' }
    })
    await runtime.ready

    const bytes = new Uint8Array([1, 2, 3])
    const loading = runtime.load('kzg', bytes)
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledTimes(2))
    const [request, transfer] = worker.postMessage.mock.calls.at(-1)
    expect(request).toMatchObject({
      type: 'request',
      backend: 'kzg',
      profile: '',
      method: 'load',
      args: [bytes]
    })
    expect(transfer).toEqual([bytes.buffer])
    listeners.get('message')({
      data: {
        type: 'response',
        backend: 'kzg',
        profile: '',
        id: request.id,
        result: 'root'
      }
    })
    await expect(loading).resolves.toBe('root')
    runtime.terminate()
  })

  it('reports release, controller, scheme, and ready timings through the router', async () => {
    const statuses = []
    const runtime = fakeRuntime({ backend: 'kzg', profile: '' })
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      beforeWorkerStart: vi.fn(async () => {}),
      onStatus: (status) => statuses.push(status),
      importController: async () => ({
        createMaltWriterWorker: async (target) => {
          target.onPhase({ phase: 'fetching-wasm' })
          target.onPhase({ phase: 'compiling-wasm' })
          target.onPhase({ phase: 'starting-worker' })
          return runtime
        }
      })
    })

    await writer.bootstrap('kzg')
    expect(statuses.map(({ phase }) => phase).filter(Boolean)).toEqual([
      'checking-release',
      'fetching-wasm',
      'compiling-wasm',
      'starting-worker',
      'initializing-scheme',
      'ready'
    ])
    for (const status of statuses.filter(({ phase }) => phase)) {
      expect(status.elapsedMs).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('browser MALT writer lazy router', () => {
  it('loads no committer until the first backend-routed operation and keeps one active Worker', async () => {
    const harness = loaderHarness()
    const writer = await harness.writer
    expect(harness.attempts).toHaveLength(0)
    expect(writer.status('kzg').state).toBe('idle')

    await writer.bootstrap('kzg')
    expect(harness.attempts).toHaveLength(1)
    expect(harness.attempts[0]).toMatchObject({ backend: 'kzg', profile: '' })
    await writer.closeSession('kzg')

    await writer.load('ipa', new Uint8Array())
    expect(harness.attempts).toHaveLength(2)
    expect(harness.attempts[1]).toMatchObject({ backend: 'ipa', profile: 'compact' })
    expect(harness.runtimes[0].terminate).toHaveBeenCalledOnce()
    expect(harness.runtimes[1].terminate).not.toHaveBeenCalled()
    expect(writer.status('kzg').state).toBe('idle')
  })

	it('routes authenticated snapshot restore and export through the active stateful Worker', async () => {
		const harness = loaderHarness()
		const writer = await harness.writer
		const snapshot = new Uint8Array([1, 2, 3])
		const secret = new Uint8Array(32).fill(9)

		await writer.restore('kzg', snapshot, secret)
		expect(harness.attempts).toEqual([
			expect.objectContaining({ backend: 'kzg', profile: '' })
		])
		expect(harness.runtimes[0].restore).toHaveBeenCalledWith(
			'kzg',
			snapshot,
			secret
		)

		await writer.snapshot('kzg', secret)
		expect(harness.runtimes[0].snapshot).toHaveBeenCalledWith('kzg', secret)
		expect(harness.attempts).toHaveLength(1)
	})

  it('falls back only within IPA and never constructs KZG for an IPA request', async () => {
    const harness = loaderHarness({
      ipaPreference: 'fast',
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      fail: new Set(['ipa/fast', 'ipa/compact'])
    })
    const writer = await harness.writer
    await writer.load('ipa', new Uint8Array())
    expect(harness.attempts.map(({ backend, profile }) => `${backend}/${profile}`)).toEqual([
      'ipa/fast',
      'ipa/compact',
      'ipa/direct'
    ])
    expect(writer.status('ipa')).toMatchObject({ state: 'ready', profile: 'direct' })
  })

  it('fails closed after all IPA profiles fail without a cross-backend fallback', async () => {
    const harness = loaderHarness({
      ipaPreference: 'fast',
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      fail: new Set(['ipa/fast', 'ipa/compact', 'ipa/direct'])
    })
    const writer = await harness.writer
    await expect(writer.load('ipa', new Uint8Array())).rejects.toThrow('ipa/direct unavailable')
    expect(harness.attempts.every(({ backend }) => backend === 'ipa')).toBe(true)
    expect(writer.status('ipa').state).toBe('failed')
  })

  it('does not switch backend while a writer session is active', async () => {
    const harness = loaderHarness()
    const writer = await harness.writer
    await writer.bootstrap('kzg')
    await expect(writer.load('ipa', new Uint8Array())).rejects.toThrow('session is active')
    expect(harness.attempts).toHaveLength(1)
  })

  it.each(['error', 'messageerror', 'failed'])(
    'retires an active Worker after a fatal %s and rebuilds only on the next explicit operation',
    async (failureSource) => {
      const attempts = []
      const statuses = []
      const failedState = { state: 'ready' }
      const failedRuntime = fakeRuntime(
        { backend: 'ipa', profile: 'compact' },
        { runtimeState: failedState }
      )
      failedRuntime.prepare.mockImplementationOnce(async () => {
        failedState.state = 'failed'
        failedState.error = `simulated Worker ${failureSource}`
        throw new Error(`pending RPC rejected after ${failureSource}`)
      })
      const replacementRuntime = fakeRuntime({ backend: 'kzg', profile: '' })
      const writer = await createBrowserMaltWriter({
        baseURL: '/writer/version/',
        browserOrigin: 'https://gateway.test',
        onStatus: (status) => statuses.push(status),
        importController: async () => ({
          createMaltWriterWorker: vi.fn(async (target) => {
            attempts.push(target)
            return attempts.length === 1 ? failedRuntime : replacementRuntime
          })
        })
      })

      await writer.load('ipa', new Uint8Array())
      await expect(writer.prepare('ipa', 'operation', new Uint8Array())).rejects.toThrow(
        `pending RPC rejected after ${failureSource}`
      )

      expect(failedRuntime.prepare).toHaveBeenCalledOnce()
      expect(replacementRuntime.prepare).not.toHaveBeenCalled()
      expect(attempts).toHaveLength(1)
      expect(failedRuntime.terminate).toHaveBeenCalledOnce()
      expect(writer.status('ipa')).toMatchObject({
        state: 'failed',
        profile: 'compact',
        error: `simulated Worker ${failureSource}`
      })
      expect(statuses).toContainEqual(expect.objectContaining({
        backend: 'ipa',
        state: 'failed',
        error: `simulated Worker ${failureSource}`
      }))

      // The fatal Worker lost its in-memory session. The next explicit call may
      // select another backend, and only that call creates a replacement.
      await writer.bootstrap('kzg')
      expect(attempts).toHaveLength(2)
      expect(attempts[1]).toMatchObject({ backend: 'kzg', profile: '' })
      expect(replacementRuntime.bootstrap).toHaveBeenCalledOnce()
    }
  )

  it('keeps a ready Worker after an ordinary request error', async () => {
    const harness = loaderHarness()
    const writer = await harness.writer
    await writer.load('ipa', new Uint8Array())
    harness.runtimes[0].prepare
      .mockRejectedValueOnce(new Error('invalid operation'))
      .mockResolvedValueOnce('candidate')

    await expect(writer.prepare('ipa', 'bad', new Uint8Array())).rejects.toThrow('invalid operation')
    await expect(writer.prepare('ipa', 'good', new Uint8Array())).resolves.toBe('candidate')

    expect(harness.attempts).toHaveLength(1)
    expect(harness.runtimes[0].terminate).not.toHaveBeenCalled()
    expect(writer.status('ipa').state).toBe('ready')
  })

  it('immediately reports and retires an idle Worker fatal without another operation', async () => {
    const attempts = []
    const statuses = []
    const fatal = deferred()
    const runtimeState = { state: 'ready' }
    const failedRuntime = fakeRuntime(
      { backend: 'ipa', profile: 'compact' },
      { fatal: fatal.promise, runtimeState }
    )
    const replacementRuntime = fakeRuntime({ backend: 'kzg', profile: '' })
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      onStatus: (status) => statuses.push(status),
      importController: async () => ({
        createMaltWriterWorker: vi.fn(async (target) => {
          attempts.push(target)
          return attempts.length === 1 ? failedRuntime : replacementRuntime
        })
      })
    })

    await writer.load('ipa', new Uint8Array())
    runtimeState.state = 'failed'
    runtimeState.error = 'idle Worker crashed'
    fatal.resolve(new Error('idle Worker crashed'))

    await vi.waitFor(() => expect(writer.status('ipa')).toMatchObject({
      state: 'failed',
      profile: 'compact',
      error: 'idle Worker crashed'
    }))
    expect(attempts).toHaveLength(1)
    expect(failedRuntime.terminate).toHaveBeenCalledOnce()
    expect(statuses).toContainEqual(expect.objectContaining({
      backend: 'ipa',
      state: 'failed',
      error: 'idle Worker crashed'
    }))

    await writer.bootstrap('kzg')
    expect(attempts).toHaveLength(2)
    expect(replacementRuntime.bootstrap).toHaveBeenCalledOnce()
  })

  it('ignores a fatal signal from a runtime that has already been replaced', async () => {
    const fatal = deferred()
    const first = fakeRuntime(
      { backend: 'ipa', profile: 'compact' },
      { fatal: fatal.promise }
    )
    const second = fakeRuntime({ backend: 'kzg', profile: '' })
    const attempts = []
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      importController: async () => ({
        createMaltWriterWorker: vi.fn(async (target) => {
          attempts.push(target)
          return attempts.length === 1 ? first : second
        })
      })
    })

    await writer.load('ipa', new Uint8Array())
    await writer.closeSession('ipa')
    await writer.bootstrap('kzg')
    fatal.resolve(new Error('stale fatal'))
    await new Promise((resolve) => setImmediate(resolve))

    expect(first.terminate).toHaveBeenCalledOnce()
    expect(second.terminate).not.toHaveBeenCalled()
    expect(writer.status('ipa').state).toBe('idle')
    expect(writer.status('kzg').state).toBe('ready')
  })

  it('retires a Worker that fatally fails while closing its session', async () => {
    const attempts = []
    const statuses = []
    const runtimeState = { state: 'ready' }
    const failedRuntime = fakeRuntime(
      { backend: 'ipa', profile: 'compact' },
      { runtimeState }
    )
    failedRuntime.closeSession.mockImplementationOnce(async () => {
      runtimeState.state = 'failed'
      runtimeState.error = 'Worker crashed during close'
      throw new Error('close request rejected')
    })
    const replacementRuntime = fakeRuntime({ backend: 'kzg', profile: '' })
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      onStatus: (status) => statuses.push(status),
      importController: async () => ({
        createMaltWriterWorker: vi.fn(async (target) => {
          attempts.push(target)
          return attempts.length === 1 ? failedRuntime : replacementRuntime
        })
      })
    })

    await writer.load('ipa', new Uint8Array())
    await expect(writer.closeSession('ipa')).rejects.toThrow('close request rejected')

    expect(failedRuntime.terminate).toHaveBeenCalledOnce()
    expect(writer.status('ipa')).toMatchObject({
      state: 'failed',
      profile: 'compact',
      error: 'Worker crashed during close'
    })
    expect(statuses).toContainEqual(expect.objectContaining({
      backend: 'ipa',
      state: 'failed',
      error: 'Worker crashed during close'
    }))

    // No stateful close is replayed. A later explicit operation may rebuild.
    await writer.bootstrap('kzg')
    expect(attempts).toHaveLength(2)
    expect(replacementRuntime.bootstrap).toHaveBeenCalledOnce()
  })

  it('keeps a ready Worker after an ordinary close-session error', async () => {
    const harness = loaderHarness()
    const writer = await harness.writer
    await writer.load('ipa', new Uint8Array())
    harness.runtimes[0].closeSession.mockRejectedValueOnce(new Error('session already closed'))

    await expect(writer.closeSession('ipa')).rejects.toThrow('session already closed')
    await expect(writer.prepare('ipa', 'operation', new Uint8Array())).resolves.toBe('candidate')

    expect(harness.attempts).toHaveLength(1)
    expect(harness.runtimes[0].terminate).not.toHaveBeenCalled()
    expect(writer.status('ipa').state).toBe('ready')
  })

  it.each([
    ['terminated', () => ({ backend: 'ipa', profile: 'compact', state: 'terminated' })],
    ['malformed status', () => ({ backend: 'ipa', profile: 'compact', state: 'unknown' })],
    ['mismatched ready status', () => ({ backend: 'ipa', profile: 'fast', state: 'ready' })],
    ['throwing status', () => { throw new Error('status unavailable') }]
  ])(
    'retires an asynchronously unhealthy active Worker before a cross-backend operation: %s',
    async (_case, unhealthyStatus) => {
      const attempts = []
      const first = fakeRuntime({ backend: 'ipa', profile: 'compact' })
      const second = fakeRuntime({ backend: 'kzg', profile: '' })
      const writer = await createBrowserMaltWriter({
        baseURL: '/writer/version/',
        browserOrigin: 'https://gateway.test',
        importController: async () => ({
          createMaltWriterWorker: vi.fn(async (target) => {
            attempts.push(target)
            return attempts.length === 1 ? first : second
          })
        })
      })
      await writer.load('ipa', new Uint8Array([1]))
      first.status.mockImplementation(unhealthyStatus)

      // The health check must run before the stale IPA session can block KZG.
      await writer.bootstrap('kzg')

      expect(attempts).toHaveLength(2)
      expect(attempts[1]).toMatchObject({ backend: 'kzg', profile: '' })
      expect(first.load).toHaveBeenCalledOnce()
      expect(first.bootstrap).not.toHaveBeenCalled()
      expect(second.bootstrap).toHaveBeenCalledOnce()
      expect(first.terminate).toHaveBeenCalledOnce()
    }
  )

  it.each(['status', 'fatal'])(
    'rejects a controller runtime that does not expose %s',
    async (capability) => {
      const runtime = fakeRuntime({ backend: 'kzg', profile: '' })
      runtime[capability] = undefined
      const writer = await createBrowserMaltWriter({
        baseURL: '/writer/version/',
        browserOrigin: 'https://gateway.test',
        importController: async () => ({ createMaltWriterWorker: async () => runtime })
      })

      await expect(writer.bootstrap('kzg')).rejects.toThrow('invalid single-Worker runtime')
      expect(runtime.terminate).toHaveBeenCalledOnce()
    }
  )

  it('immediately terminates an initializing Worker and does not start fallbacks', async () => {
    const ready = deferred()
    const attempts = []
    const runtime = fakeRuntime({ backend: 'ipa', profile: 'fast' }, { ready: ready.promise })
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      ipaPreference: 'fast',
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      importController: async () => ({
        createMaltWriterWorker: async (target) => {
          attempts.push(target)
          return runtime
        }
      })
    })
    const loading = writer.load('ipa', new Uint8Array())
    await vi.waitFor(() => expect(attempts).toHaveLength(1))
    await Promise.resolve()
    writer.terminate()
    expect(runtime.terminate).toHaveBeenCalledOnce()
    ready.resolve({ backend: 'ipa', profile: 'fast' })
    await expect(loading).rejects.toThrow('terminated during initialization')
    expect(attempts).toHaveLength(1)
    expect(runtime.terminate).toHaveBeenCalledOnce()
    expect(writer.status('ipa').state).toBe('terminated')
  })

  it('aborts an in-flight WASM fetch during termination', async () => {
    let signal
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      importController: async () => ({
        createMaltWriterWorker: async (target) => {
          signal = target.signal
          return new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
      })
    })
    const loading = writer.load('ipa', new Uint8Array())
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    writer.terminate()
    expect(signal.aborted).toBe(true)
    await expect(loading).rejects.toThrow('terminated during initialization')
    expect(writer.status('ipa').state).toBe('terminated')
  })

  it('immediately cancels controller creation and terminates a late runtime without fallback', async () => {
    const creation = deferred()
    const attempts = []
    const lateRuntime = fakeRuntime({ backend: 'ipa', profile: 'fast' })
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      ipaPreference: 'fast',
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      importController: async () => ({
        createMaltWriterWorker: (target) => {
          attempts.push(target)
          return creation.promise
        }
      })
    })
    const loading = writer.load('ipa', new Uint8Array())
    await vi.waitFor(() => expect(attempts).toHaveLength(1))

    writer.terminate()
    await expect(Promise.race([
      loading,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('controller creation cancellation timed out')), 100)
      })
    ])).rejects.toThrow('terminated during initialization')
    expect(attempts).toHaveLength(1)

    creation.resolve(lateRuntime)
    await vi.waitFor(() => expect(lateRuntime.terminate).toHaveBeenCalledOnce())
    expect(attempts).toHaveLength(1)
    expect(writer.status('ipa').state).toBe('terminated')
  })

  it('immediately cancels the release guard without creating a Worker', async () => {
    const guard = deferred()
    const create = vi.fn()
    let guardSignal
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      beforeWorkerStart: ({ signal }) => {
        guardSignal = signal
        return guard.promise
      },
      importController: async () => ({ createMaltWriterWorker: create })
    })
    const loading = writer.load('ipa', new Uint8Array())
    await vi.waitFor(() => expect(writer.status('ipa').state).toBe('loading'))
    writer.terminate()
    expect(guardSignal.aborted).toBe(true)
    await expect(Promise.race([
      loading,
      new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error('guard cancellation timed out')), 100)
      })
    ])).rejects.toThrow('terminated during initialization')
    expect(create).not.toHaveBeenCalled()
    guard.resolve()
  })

  it('treats the release-coherence guard as fatal instead of profile fallback', async () => {
    const create = vi.fn()
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/',
      browserOrigin: 'https://gateway.test',
      ipaPreference: 'fast',
      navigator: { hardwareConcurrency: 8, deviceMemory: 8 },
      beforeWorkerStart: async () => { throw new Error('Console release changed') },
      importController: async () => ({ createMaltWriterWorker: create })
    })
    await expect(writer.load('ipa', new Uint8Array())).rejects.toThrow('Console release changed')
    expect(create).not.toHaveBeenCalled()
    expect(writer.status('ipa')).toMatchObject({ state: 'failed', profile: 'fast' })
  })
})

it('routes typed candidates through the selected Worker without changing byte inputs', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  await writer.whenReady('kzg')
  const runtime = harness.runtimes[0]
  runtime.prepareAuthentication = vi.fn(async () => '{"root":"candidate"}')
  runtime.updateAuthentication = vi.fn(async () => '{"root":"next"}')
  const state = new Uint8Array([1, 2]), base = new Uint8Array([3, 4])
  await writer.prepareAuthentication('kzg', state)
  await writer.updateAuthentication('kzg', base, state)
  expect(runtime.prepareAuthentication).toHaveBeenCalledWith('kzg', state)
  expect(runtime.updateAuthentication).toHaveBeenCalledWith('kzg', base, state)
  writer.terminate()
})

it.each(['prepareAuthentication', 'updateAuthentication', 'applyAuthentication', 'exportAuthentication'])(
  'rejects a controller missing the current %s method before ready', async (method) => {
    const runtime = fakeRuntime({ backend: 'kzg', profile: '' })
    delete runtime[method]
    const writer = await createBrowserMaltWriter({
      baseURL: '/writer/version/', browserOrigin: 'https://gateway.test',
      importController: async () => ({ createMaltWriterWorker: async () => runtime })
    })
    await expect(writer.whenReady('kzg')).rejects.toThrow('invalid single-Worker runtime')
    expect(runtime.terminate).toHaveBeenCalled()
    writer.terminate()
  }
)

it('routes retained authentication operations without sending a complete base again', async () => {
  const runtime = fakeRuntime({ backend: 'kzg', profile: '' })
  const writer = await createBrowserMaltWriter({
    baseURL: '/writer/version/', browserOrigin: 'https://gateway.test',
    importController: async () => ({ createMaltWriterWorker: async () => runtime })
  })
  const state = new TextEncoder().encode('{}')
  const internalHandle = new TextEncoder().encode('1')
  const delta = new TextEncoder().encode('{"profile":"malt.authentication-delta/0","changes":[]}')
  const created = JSON.parse(await writer.createAuthentication('kzg', state))
  const handle = new TextEncoder().encode(created.handle)
  await writer.applyAuthentication('kzg', handle, delta)
  await writer.exportAuthentication('kzg', handle)
  await writer.discardAuthentication('kzg', handle)
  await writer.closeAuthentication('kzg')
  expect(runtime.applyAuthentication).toHaveBeenCalledWith('kzg', internalHandle, delta)
  expect(runtime.exportAuthentication).toHaveBeenCalledWith('kzg', internalHandle)
  expect(runtime.updateAuthentication).not.toHaveBeenCalled()
  writer.terminate()
})


it('pins the authentication backend during pending create and until explicit close', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  await writer.whenReady('kzg')
  const created = deferred()
  harness.runtimes[0].createAuthentication.mockReturnValueOnce(created.promise)
  const creating = writer.createAuthentication('kzg', new Uint8Array([1]))
  await expect(writer.whenReady('ipa')).rejects.toThrow('authentication session is active')
  expect(harness.runtimes[0].terminate).not.toHaveBeenCalled()
  created.resolve('{"handle":"1","root":"root"}')
  await creating
  await writer.closeSession('kzg')
  await expect(writer.whenReady('ipa')).rejects.toThrow('authentication session is active')
  await writer.closeAuthentication('kzg')
  await writer.whenReady('ipa')
  expect(harness.runtimes[0].terminate).toHaveBeenCalledOnce()
  writer.terminate()
})

it('serializes authentication close/create and preserves the independent semantic session pin', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  await writer.bootstrap('kzg')
  await writer.createAuthentication('kzg', new Uint8Array([1]))
  const closing = writer.closeAuthentication('kzg')
  const creating = writer.createAuthentication('kzg', new Uint8Array([1]))
  await Promise.all([closing, creating])
  await writer.closeSession('kzg')
  await expect(writer.whenReady('ipa')).rejects.toThrow('authentication session is active')
  await writer.bootstrap('kzg')
  await writer.closeAuthentication('kzg')
  await expect(writer.whenReady('ipa')).rejects.toThrow('writer session is active')
  writer.terminate()
})

it('releases a failed initial authentication reservation and rejects handles after termination', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  await writer.whenReady('kzg')
  harness.runtimes[0].createAuthentication.mockRejectedValueOnce(new Error('invalid state'))
  await expect(writer.createAuthentication('kzg', new Uint8Array([1]))).rejects.toThrow('invalid state')
  await writer.whenReady('ipa')
  await writer.createAuthentication('ipa', new Uint8Array([1]))
  writer.terminateBackend('ipa')
  await expect(writer.exportAuthentication('ipa', new Uint8Array([1]))).rejects.toThrow('no retained state')
  await writer.whenReady('kzg')
  writer.terminate()
})


it('rejects old handles after Worker recreation even when Core reuses its numeric ID', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  const state = new TextEncoder().encode('{}')
  const old = JSON.parse(await writer.createAuthentication('kzg', state))
  writer.terminateBackend('kzg')
  const current = JSON.parse(await writer.createAuthentication('kzg', state))
  expect(current.handle).not.toBe(old.handle)
  const stale = new TextEncoder().encode(old.handle)
  for (const method of ['exportAuthentication', 'discardAuthentication', 'applyAuthentication']) {
    await expect(writer[method]('kzg', stale, state)).rejects.toThrow('expired or different Worker')
    expect(harness.runtimes[1][method]).not.toHaveBeenCalled()
  }
  await writer.exportAuthentication('kzg', new TextEncoder().encode(current.handle))
  writer.terminate()
})

it('does not let another router reuse an authentication handle', async () => {
  const a = loaderHarness(), b = loaderHarness()
  const first = await a.writer, second = await b.writer
  const state = new TextEncoder().encode('{}')
  const old = JSON.parse(await first.createAuthentication('kzg', state))
  await second.createAuthentication('kzg', state)
  await expect(second.exportAuthentication('kzg', new TextEncoder().encode(old.handle))).rejects.toThrow('expired or different Worker')
  expect(b.runtimes[0].exportAuthentication).not.toHaveBeenCalled()
  first.terminate()
  second.terminate()
})

it('cancels queued authentication creation before terminateBackend can be undone by a microtask', async () => {
  const harness = loaderHarness()
  const writer = await harness.writer
  const pending = writer.createAuthentication('kzg', new TextEncoder().encode('{}'))
  writer.terminateBackend('kzg')
  await expect(pending).rejects.toThrow('cancelled')
  expect(harness.controller.createMaltWriterWorker).not.toHaveBeenCalled()
  expect(writer.status('kzg').state).toBe('idle')
  await writer.createAuthentication('kzg', new TextEncoder().encode('{}'))
  expect(harness.controller.createMaltWriterWorker).toHaveBeenCalledOnce()
  writer.terminate()
})

it('cancels queued creation after a fatal runtime loss', async () => {
  const fatal = deferred()
  const runtime = fakeRuntime({ backend: 'kzg', profile: '' }, { fatal: fatal.promise })
  const factory = vi.fn(async () => runtime)
  const writer = await createBrowserMaltWriter({ importController: async () => ({ createMaltWriterWorker: factory }) })
  await writer.whenReady('kzg')
  const first = deferred()
  runtime.createAuthentication.mockReturnValueOnce(first.promise)
  const pending = writer.createAuthentication('kzg', new Uint8Array([1]))
  const queued = writer.createAuthentication('kzg', new Uint8Array([2]))
  const checkedPending = expect(pending).rejects.toThrow('session was lost')
  const checkedQueued = expect(queued).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(runtime.createAuthentication).toHaveBeenCalledOnce())
  fatal.resolve(new Error('runtime stopped'))
  await vi.waitFor(() => expect(runtime.terminate).toHaveBeenCalledOnce())
  first.resolve('{"handle":"1","root":"root"}')
  await Promise.all([checkedPending, checkedQueued])
  expect(factory).toHaveBeenCalledOnce()
  writer.terminate()
})
