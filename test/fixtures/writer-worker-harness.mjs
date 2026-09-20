import { parentPort, workerData } from 'node:worker_threads'

globalThis.self = globalThis
globalThis.writerFixtureMissingExport = workerData?.missingExport
globalThis.addEventListener = (type, handler) => {
  if (type === 'message') parentPort.on('message', (data) => handler({ data }))
}
globalThis.postMessage = (data) => parentPort.postMessage(data)
await import('../../assets/writer/malt-writer-worker.mjs')
parentPort.postMessage({ type: 'harness-ready' })
