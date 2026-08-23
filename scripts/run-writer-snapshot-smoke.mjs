import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const [wasmPath, wasmExecPath, backend = 'kzg', profile = ''] = process.argv.slice(2)
if (!wasmPath || !wasmExecPath || !['kzg', 'ipa'].includes(backend)) {
  console.error(
    'usage: node run-writer-snapshot-smoke.mjs <writer.wasm> <wasm_exec.js> [kzg|ipa] [direct|compact|fast]'
  )
  process.exit(2)
}
if (backend === 'kzg' ? profile !== '' : !['direct', 'compact', 'fast'].includes(profile)) {
  throw new Error(`unsupported writer target ${backend}/${profile}`)
}
if (!globalThis.crypto) globalThis.crypto = webcrypto

await import(pathToFileURL(wasmExecPath).href)
if (typeof globalThis.Go !== 'function') {
  throw new Error(`${wasmExecPath} did not install the Go WASM runtime`)
}
const go = new globalThis.Go()
go.argv = ['malt-writer.wasm', `--backend=${backend}`]
const wasm = await readFile(wasmPath)
const { instance } = await WebAssembly.instantiate(wasm, go.importObject)
let runtimeFailure
void go.run(instance).catch((error) => { runtimeFailure = error })

const requiredGlobals = [
  'maltWriterBootstrapSessionV1',
  'maltWriterCloseSessionV1',
  'maltWriterRestoreSessionV1',
  'maltWriterSnapshotSessionV1'
]
const deadline = Date.now() + 120_000
while (Date.now() < deadline) {
  if (runtimeFailure) throw new Error(`Go WASM runtime failed: ${runtimeFailure}`)
  if (globalThis.maltWriterReady && requiredGlobals.every((name) => typeof globalThis[name] === 'function')) break
  await new Promise((resolve) => setTimeout(resolve, 10))
}
if (!globalThis.maltWriterReady || requiredGlobals.some((name) => typeof globalThis[name] !== 'function')) {
  throw new Error('timed out waiting for MALT writer snapshot globals')
}
if (globalThis.maltWriterInitError) {
  throw new Error(`MALT writer initialization failed: ${globalThis.maltWriterInitError}`)
}
assert.equal(globalThis.maltWriterLoadedBackend, backend)
assert.equal(globalThis.maltWriterLoadedProfile, profile)

const encoder = new TextEncoder()
const key = new Uint8Array(32).fill(17)
const wrongKey = new Uint8Array(32).fill(18)
const bootstrapJSON = await globalThis.maltWriterBootstrapSessionV1()
const snapshotJSON = await globalThis.maltWriterSnapshotSessionV1(key)
const snapshot = JSON.parse(snapshotJSON)
assert.equal(snapshot.profile, 'malt.ts.writer-session-snapshot/v1')
assert.equal(snapshot.backend, backend)
assert.equal(snapshot.base_root, JSON.parse(bootstrapJSON).base_root)
assert.equal(typeof snapshot.materialization_sha256, 'string')
assert.equal(Buffer.from(snapshot.checkpoint_mac, 'base64').byteLength, 32)
await globalThis.maltWriterCloseSessionV1()

await assert.rejects(
  globalThis.maltWriterRestoreSessionV1(encoder.encode(snapshotJSON), wrongKey),
  /authentication failed/
)
const restoredJSON = await globalThis.maltWriterRestoreSessionV1(encoder.encode(snapshotJSON), key)
assert.deepStrictEqual(JSON.parse(restoredJSON), JSON.parse(bootstrapJSON))
await globalThis.maltWriterCloseSessionV1()

snapshot.materialization.branching = false
await assert.rejects(
  globalThis.maltWriterRestoreSessionV1(encoder.encode(JSON.stringify(snapshot)), key),
  /materialization digest mismatch/
)

key.fill(0)
wrongKey.fill(0)
console.log(`WASM ${backend}${profile ? `/${profile}` : ''} authenticated snapshot smoke passed`)
process.exit(0)
