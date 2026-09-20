import { parentPort } from 'node:worker_threads'

globalThis.addEventListener = (type, handler) => {
  if (type === 'message') parentPort.on('message', (data) => handler({ data }))
}
globalThis.postMessage = (data) => parentPort.postMessage(data)
await import('../../src/malt-verifier.worker.mjs')
parentPort.postMessage({ type: 'harness-ready' })
