import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker as NodeWorker } from 'node:worker_threads'
import { pathToFileURL } from 'node:url'
import { createBrowserMaltWriter } from '../src/writer.mjs'
import { createMaltWriterWorker } from '../assets/writer/malt-writer-workers.mjs'

const [assetDirectory, nodeHarness] = process.argv.slice(2)
assert(assetDirectory && nodeHarness, 'usage: run-authentication-router-smoke.mjs ASSET_DIRECTORY CORE_NODE_HARNESS')
const module = await WebAssembly.compile(await readFile(`${assetDirectory}/malt-writer-ipa-compact.wasm`))
const threads = []
class WorkerAdapter {
  constructor(workerURL) {
    this.worker = new NodeWorker(pathToFileURL(nodeHarness), { workerData: { workerURL: String(workerURL) } })
    threads.push(this.worker)
  }
  addEventListener(type, listener) {
    this.worker.on(type, value => listener(type === 'message' ? { data: value } : { error: value, message: value.message }))
  }
  postMessage(message) { this.worker.postMessage(message) }
  terminate() { return this.worker.terminate() }
}
const writer = await createBrowserMaltWriter({
  baseURL: `${pathToFileURL(assetDirectory).href}/`, browserOrigin: 'https://malt.test',
  ipaPreference: 'compact', navigator: {},
  importController: async () => ({
    createMaltWriterWorker: options => createMaltWriterWorker({
      ...options, module, workerFactory: ({ workerURL }) => new WorkerAdapter(workerURL)
    })
  })
})
const bytes = value => new TextEncoder().encode(value)
const json = value => bytes(JSON.stringify(value))
const state = {
  descriptor: { layout: 2, input_rule: 0, vc_profile: 2 },
  entries: [{ input: { kind: 'index', number: '0' }, target: { '/': 'bafkqaaa' } }]
}
try {
  const base = JSON.parse(await writer.createAuthentication('ipa', json(state)))
  const next = JSON.parse(await writer.applyAuthentication('ipa', bytes(base.handle), json({
    profile: 'malt.authentication-delta/0',
    changes: [{ input: { kind: 'index', number: '0' }, before: 'bafkqaaa', after: 'bafkreigh2akiscaildcw4535x7k5vfhq56bqddhziq3p4mwfmlz4vfu2ta' }]
  })))
  assert.notEqual(next.root, base.root)
  const exported = JSON.parse(await writer.exportAuthentication('ipa', bytes(next.handle)))
  assert.equal(exported.root, next.root)
  const imported = JSON.parse(await writer.importAuthentication('ipa', json(exported)))
  assert.equal(imported.root, next.root)
  await assert.rejects(writer.whenReady('kzg'), /authentication session is active/)
  await writer.discardAuthentication('ipa', bytes(next.handle))
  await assert.rejects(writer.exportAuthentication('ipa', bytes(next.handle)), /expired or different Worker/)
  writer.terminateBackend('ipa')
  const rebuilt = JSON.parse(await writer.createAuthentication('ipa', json(state)))
  assert.notEqual(rebuilt.handle, base.handle)
  await assert.rejects(writer.exportAuthentication('ipa', bytes(base.handle)), /expired or different Worker/)
  assert.equal(JSON.parse(await writer.exportAuthentication('ipa', bytes(rebuilt.handle))).root, base.root)
  await writer.closeAuthentication('ipa')
  assert.equal(threads.length, 2)
  console.log('Real authentication router passed: delta, import/export, backend pin, discard and stale Worker handles')
} finally {
  writer.terminate()
  await Promise.all(threads.map(thread => thread.terminate()))
}
