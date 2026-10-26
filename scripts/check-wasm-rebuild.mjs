import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function readAssets(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true })
  assert(entries.every((entry) => entry.isFile()), `non-file asset in ${directory}`)
  const files = new Map(entries.map((entry) => [entry.name, fs.readFileSync(path.join(directory, entry.name))]))
  assert(files.has('SHA256SUMS') && files.has('PROVENANCE.json'), 'missing asset metadata')
  const checked = new Set()
  for (const line of files.get('SHA256SUMS').toString('utf8').trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/.exec(line)
    assert(match, `invalid checksum line: ${line}`)
    const [, expected, name] = match
    assert(name !== 'SHA256SUMS' && files.has(name) && !checked.has(name), `invalid checksum entry: ${name}`)
    assert.equal(createHash('sha256').update(files.get(name)).digest('hex'), expected, `checksum mismatch: ${name}`)
    checked.add(name)
  }
  assert.deepEqual([...checked].sort(), [...files.keys()].filter((name) => name !== 'SHA256SUMS').sort(), 'incomplete checksum coverage')
  return files
}

function portableProvenance(contents) {
  const provenance = JSON.parse(contents.toString('utf8'))
  const toolchain = /^go version (go[0-9]+\.[0-9]+\.[0-9]+) ([a-z0-9]+)\/([a-z0-9]+)$/.exec(provenance.go_toolchain || '')
  assert(toolchain && toolchain[1] === provenance.go_version, 'invalid provenance toolchain')
  // The compiler version and target must match; the machine running the
  // compiler may differ. Keep the actual build host in each published record.
  return { ...provenance, go_toolchain: toolchain[1] }
}

export function validateWasmRebuild(publishedRoot, rebuiltRoot) {
  for (const kind of ['verifier', 'writer']) {
    const published = readAssets(path.join(publishedRoot, kind))
    const rebuilt = readAssets(path.join(rebuiltRoot, kind))
    assert.deepEqual([...published.keys()].sort(), [...rebuilt.keys()].sort(), `different ${kind} asset sets`)
    for (const [name, bytes] of published) {
      if (name === 'SHA256SUMS') continue // Both complete manifests were checked above.
      if (name === 'PROVENANCE.json') {
        assert.deepEqual(portableProvenance(bytes), portableProvenance(rebuilt.get(name)), `${kind} provenance differs`)
      } else {
        assert(bytes.equals(rebuilt.get(name)), `${kind}/${name} differs`)
      }
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  assert.equal(process.argv.length, 4, 'usage: node scripts/check-wasm-rebuild.mjs PUBLISHED REBUILT')
  validateWasmRebuild(process.argv[2], process.argv[3])
  console.log('WASM rebuild matches all payload bytes and portable provenance.')
}
