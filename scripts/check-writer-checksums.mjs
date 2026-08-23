#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const writerChecksumFiles = Object.freeze([
  'malt-writer-kzg.wasm',
  'malt-writer-ipa-direct.wasm',
  'malt-writer-ipa-compact.wasm',
  'malt-writer-ipa-fast.wasm',
  'malt-writer-worker.mjs',
  'malt-writer-workers.mjs',
  'wasm_exec.js',
  'PROVENANCE.json'
])

const checksumLinePattern = /^([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function validateWriterChecksums(contents) {
  if (typeof contents !== 'string' || contents.length === 0) {
    throw new Error('writer SHA256SUMS must be non-empty text')
  }
  if (contents.includes('\r') || !contents.endsWith('\n')) {
    throw new Error('writer SHA256SUMS must use newline-terminated LF records')
  }

  const lines = contents.slice(0, -1).split('\n')
  if (lines.length !== writerChecksumFiles.length) {
    throw new Error(
      `writer SHA256SUMS must contain exactly ${writerChecksumFiles.length} records; found ${lines.length}`
    )
  }

  const required = new Set(writerChecksumFiles)
  const seen = new Set()
  for (const [index, line] of lines.entries()) {
    const match = checksumLinePattern.exec(line)
    if (!match) {
      throw new Error(`writer SHA256SUMS record ${index + 1} has invalid format`)
    }
    const filename = match[2]
    if (!required.has(filename)) {
      throw new Error(`writer SHA256SUMS contains unexpected filename ${JSON.stringify(filename)}`)
    }
    if (seen.has(filename)) {
      throw new Error(`writer SHA256SUMS contains duplicate filename ${JSON.stringify(filename)}`)
    }
    seen.add(filename)
  }

  const missing = writerChecksumFiles.filter((filename) => !seen.has(filename))
  if (missing.length !== 0) {
    throw new Error(`writer SHA256SUMS is missing: ${missing.join(', ')}`)
  }
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error('usage: check-writer-checksums.mjs WRITER_DIRECTORY')
  }
  const directory = path.resolve(process.argv[2])
  validateWriterChecksums(fs.readFileSync(path.join(directory, 'SHA256SUMS'), 'utf8'))
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
