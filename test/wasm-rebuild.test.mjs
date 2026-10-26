import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { validateWasmRebuild } from '../scripts/check-wasm-rebuild.mjs'

const temporary = []
afterEach(() => temporary.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })))

function writeSet(directory, host, changes = {}) {
  fs.mkdirSync(directory, { recursive: true })
  const provenance = {
    go_version: 'go1.26.8', go_toolchain: `go version go1.26.8 ${host}`,
    target: 'js/wasm', core: { module_version: 'v0.0.11-rc.4' }, ...changes
  }
  fs.writeFileSync(path.join(directory, 'PROVENANCE.json'), JSON.stringify(provenance))
  fs.writeFileSync(path.join(directory, 'module.wasm'), 'wasm fixture')
  checksums(directory)
}

function checksums(directory) {
  const lines = fs.readdirSync(directory).filter((name) => name !== 'SHA256SUMS').map((name) =>
    createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') + '  ' + name
  )
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), lines.join('\n') + '\n')
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-rebuild-'))
  temporary.push(root)
  const roots = ['published', 'rebuilt'].map((name) => path.join(root, name))
  for (const kind of ['verifier', 'writer']) {
    writeSet(path.join(roots[0], kind), 'windows/amd64')
    writeSet(path.join(roots[1], kind), 'linux/amd64')
  }
  return roots
}

it('accepts a different build host with identical payload and portable metadata', () => {
  expect(() => validateWasmRebuild(...fixture())).not.toThrow()
})

it('rejects payload changes even with valid replacement checksums', () => {
  const roots = fixture()
  const directory = path.join(roots[1], 'writer')
  fs.writeFileSync(path.join(directory, 'module.wasm'), 'different binary')
  checksums(directory)
  expect(() => validateWasmRebuild(...roots)).toThrow('module.wasm differs')
})

it('rejects stale checksums and incomplete checksum coverage', () => {
  const roots = fixture()
  const directory = path.join(roots[1], 'writer')
  fs.writeFileSync(path.join(directory, 'module.wasm'), 'tampered binary')
  expect(() => validateWasmRebuild(...roots)).toThrow('checksum mismatch')
  checksums(directory)
  fs.writeFileSync(path.join(directory, 'extra.wasm'), 'unlisted')
  expect(() => validateWasmRebuild(...roots)).toThrow('incomplete checksum coverage')
})

it.each([
  { core: { module_version: 'v0.0.11-rc.2' } },
  { target: 'linux/amd64' },
  { go_version: 'go1.26.9', go_toolchain: 'go version go1.26.9 linux/amd64' },
  { go_toolchain: 'go version go1.26.9 linux/amd64' }
])('rejects changed or inconsistent provenance %j', (changes) => {
  const roots = fixture()
  writeSet(path.join(roots[1], 'verifier'), 'linux/amd64', changes)
  expect(() => validateWasmRebuild(...roots)).toThrow()
})
