import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { validateCoreRelease } from '../scripts/check-core-download.mjs'

const moduleDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'malt-core-pin-test-'))
afterAll(() => fs.rmSync(moduleDirectory, { recursive: true, force: true }))

const expected = Object.freeze({
  modulePath: 'github.com/dewebprotocol/malt-core',
  moduleVersion: 'v1.2.3-rc.4',
  sourceCommit: '1'.repeat(40),
  moduleSum: 'h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  goModSum: 'h1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='
})

function download(overrides = {}) {
  return {
    Path: expected.modulePath,
    Version: expected.moduleVersion,
    Sum: expected.moduleSum,
    GoModSum: expected.goModSum,
    Dir: moduleDirectory,
    Origin: {
      VCS: 'git',
      URL: 'https://github.com/DeWebProtocol/malt-core.git',
      Hash: expected.sourceCommit,
      Ref: `refs/tags/${expected.moduleVersion}`
    },
    ...overrides
  }
}

function tagRefs(commit = expected.sourceCommit) {
  return `${commit}\trefs/tags/${expected.moduleVersion}\n`
}

describe('malt-ts Core dependency pin', () => {
  it('accepts an exact module download and canonical public tag', () => {
    expect(validateCoreRelease(download(), tagRefs(), expected)).toBe(moduleDirectory)
  })

  it('rejects module checksum drift', () => {
    expect(() =>
      validateCoreRelease(download({ Sum: 'h1:tampered=' }), tagRefs(), expected)
    ).toThrow(/does not match/)
  })

  it('rejects source-origin drift even when module fields match', () => {
    expect(() =>
      validateCoreRelease(
        download({ Origin: { ...download().Origin, Hash: '2'.repeat(40) } }),
        tagRefs(),
        expected
      )
    ).toThrow(/unexpected source origin/)
  })

  it('rejects a canonical tag that resolves to another commit', () => {
    expect(() =>
      validateCoreRelease(download(), tagRefs('3'.repeat(40)), expected)
    ).toThrow(/not locked commit/)
  })
})
