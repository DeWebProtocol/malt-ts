// @vitest-environment node
import { once } from 'node:events'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'

it('starts with operation-specific exports and rejects the retired artifact operation', async () => {
  const worker = new Worker(new URL('./fixtures/verifier-worker-harness.mjs', import.meta.url))
  try {
    await once(worker, 'message')
    const ready = once(worker, 'message')
    worker.postMessage({
      type: 'init',
      backend: 'all',
      runtimeURL: new URL('./fixtures/portable-verifier-runtime.mjs', import.meta.url).href,
      wasmBytes: new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]).buffer
    })
    expect((await ready)[0]).toEqual({ type: 'ready', backend: 'all' })

    const rejected = once(worker, 'message')
    worker.postMessage({ type: 'verify', id: 1, kind: 'artifact', json: '{}' })
    expect((await rejected)[0]).toMatchObject({
      type: 'result', id: 1, error: 'unsupported local verifier operation "artifact"'
    })

    const current = once(worker, 'message')
    worker.postMessage({ type: 'verify', id: 2, kind: 'read', json: '{}' })
    expect((await current)[0]).toEqual({
      type: 'result', id: 2,
      result: '{"profile":"malt.read/v0alpha1","valid":true}'
    })
  } finally {
    await worker.terminate()
  }
})
