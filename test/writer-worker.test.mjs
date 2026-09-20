// @vitest-environment node
import { once } from 'node:events'
import { Worker } from 'node:worker_threads'
import { expect, it } from 'vitest'

it.each([undefined, 'maltPrepareAuthentication', 'maltUpdateAuthentication', 'maltApplyAuthentication'])(
  'requires the complete current writer ABI before ready (missing: %s)', async missingExport => {
    const worker = new Worker(new URL('./fixtures/writer-worker-harness.mjs', import.meta.url), {
      workerData: { missingExport }
    })
    try {
      await once(worker, 'message')
      const response = once(worker, 'message')
      worker.postMessage({
        type: 'initialize', backend: 'kzg', profile: '',
        wasmExecURL: new URL('./fixtures/portable-writer-runtime.mjs', import.meta.url).href,
        module: new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
      })
      expect((await response)[0]).toEqual(missingExport ? {
        type: 'failed', backend: 'kzg', profile: '',
        error: `MALT writer did not register ${missingExport}`
      } : { type: 'ready', backend: 'kzg', profile: '' })
    } finally { await worker.terminate() }
  }
)
