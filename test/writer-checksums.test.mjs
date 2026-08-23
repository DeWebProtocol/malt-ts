import { describe, expect, it } from 'vitest'

import {
  validateWriterChecksums,
  writerChecksumFiles
} from '../scripts/check-writer-checksums.mjs'

const hashes = Object.fromEntries(
  writerChecksumFiles.map((filename, index) => [filename, String(index + 1).padStart(64, '0')])
)

function manifest(files = writerChecksumFiles) {
  return `${files.map((filename) => `${hashes[filename] ?? 'f'.repeat(64)}  ${filename}`).join('\n')}\n`
}

describe('writer SHA256SUMS release coverage', () => {
  it('accepts each of the eight release assets exactly once', () => {
    expect(() => validateWriterChecksums(manifest())).not.toThrow()
  })

  it('rejects a deleted asset record', () => {
    expect(() => validateWriterChecksums(manifest(writerChecksumFiles.slice(1))))
      .toThrow(/exactly 8 records/)
  })

  it('rejects a duplicate record even when the record count remains eight', () => {
    const files = [...writerChecksumFiles]
    files[files.length - 1] = files[0]
    expect(() => validateWriterChecksums(manifest(files))).toThrow(/duplicate filename/)
  })

  it('rejects an extra filename even when the record count remains eight', () => {
    const files = [...writerChecksumFiles]
    files[files.length - 1] = 'unexpected.js'
    expect(() => validateWriterChecksums(manifest(files))).toThrow(/unexpected filename/)
  })

  it('rejects an additional ninth record', () => {
    expect(() => validateWriterChecksums(`${manifest()}${'f'.repeat(64)}  unexpected.js\n`))
      .toThrow(/exactly 8 records/)
  })

  it.each([
    ['path entry', `${'a'.repeat(64)}  ./malt-writer-kzg.wasm\n`],
    ['uppercase digest', `${'A'.repeat(64)}  malt-writer-kzg.wasm\n`],
    ['binary marker', `${'a'.repeat(64)} *malt-writer-kzg.wasm\n`],
    ['CRLF record', `${'a'.repeat(64)}  malt-writer-kzg.wasm\r\n`]
  ])('rejects an invalid %s', (_name, firstRecord) => {
    const validTail = manifest(writerChecksumFiles.slice(1))
    expect(() => validateWriterChecksums(`${firstRecord}${validTail}`)).toThrow()
  })
})
