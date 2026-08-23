import { describe, expect, it } from 'vitest'

import {
  validateCoreDownload,
  validateCoreRelease
} from '../scripts/check-core-download.mjs'

const expected = Object.freeze({
  modulePath: 'github.com/dewebprotocol/malt-core',
  moduleVersion: 'v0.0.7-rc.2',
  sourceCommit: '80a6dc86e35815e3d4201adfbecf949caca21c42',
  moduleSum: 'h1:HbXaa4HsVVzcL8kiGqYYBwnLKwoOgfZSAM9FTU92doM=',
  goModSum: 'h1:eIYur4oUn81cOL4fwh/fSBPNxIoyiDIcOjjjRWB7Qnc='
})

function coreDownload(origin) {
  const downloaded = {
    Path: expected.modulePath,
    Version: expected.moduleVersion,
    Sum: expected.moduleSum,
    GoModSum: expected.goModSum,
    Dir: process.cwd()
  }
  if (origin !== undefined) downloaded.Origin = origin
  return downloaded
}

function canonicalTagRefs(commit = expected.sourceCommit) {
  return [
    `92b2454fafdcd6f7820c029d3d1294e2717de9ca\trefs/tags/${expected.moduleVersion}`,
    `${commit}\trefs/tags/${expected.moduleVersion}^{}`
  ].join('\n')
}

function validate(downloaded, expectedRelease = expected, tagRefs = canonicalTagRefs()) {
  return validateCoreRelease(downloaded, tagRefs, expectedRelease)
}

describe('malt-ts Core module download provenance', () => {
  it('resolves checksum-locked module bytes without a live canonical tag lookup', () => {
    expect(validateCoreDownload(coreDownload(), expected)).toBe(process.cwd())
  })

  it('accepts checksum-locked bytes when a module proxy omits Origin', () => {
    expect(validate(coreDownload(), expected)).toBe(process.cwd())
  })

  it('accepts complete canonical origin evidence', () => {
    expect(
      validate(
        coreDownload({
          VCS: 'git',
          URL: 'https://github.com/DeWebProtocol/malt-core.git',
          Hash: expected.sourceCommit,
          Ref: `refs/tags/${expected.moduleVersion}`,
          TagPrefix: '',
          TagSum: '',
          RepoSum: ''
        }),
        expected
      )
    ).toBe(process.cwd())
  })

  it('accepts partial origin evidence when every supplied field agrees', () => {
    expect(
      validate(coreDownload({ Hash: expected.sourceCommit }), expected)
    ).toBe(process.cwd())
  })

  it.each([
    ['VCS', { VCS: 'hg' }],
    ['repository', { URL: 'https://github.com/example/malt.git' }],
    ['repository URL type', { URL: ['https://github.com/DeWebProtocol/malt-core.git'] }],
    ['subdirectory', { Subdir: 'fork' }],
    ['commit', { Hash: '0'.repeat(40) }],
    ['tag', { Ref: 'refs/tags/v0.0.7-rc.1' }],
    ['tag prefix', { TagPrefix: 'nested/' }],
    ['tag sum', { TagSum: 't1:unexpected' }],
    ['repository sum', { RepoSum: 'r1:unexpected' }],
    ['unknown field', { Mirror: 'https://example.com/malt' }]
  ])('rejects conflicting %s origin evidence', (_name, origin) => {
    expect(() => validate(coreDownload(origin), expected)).toThrow(
      /unexpected source origin/
    )
  })

  it.each([
    ['null', null],
    ['array', []]
  ])('rejects malformed %s Origin', (_name, origin) => {
    expect(() => validate(coreDownload(origin), expected)).toThrow(
      /unexpected source origin/
    )
  })

  it.each([
    ['module sum', { Sum: 'h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
    ['go.mod sum', { GoModSum: 'h1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }],
    ['module version', { Version: 'v0.0.7-rc.1' }]
  ])('still rejects a mismatched %s without Origin', (_name, change) => {
    expect(() =>
      validate(Object.assign(coreDownload(), change), expected)
    ).toThrow(/does not match the malt-ts release lock/)
  })

  it('accepts a lightweight canonical tag that resolves directly to the commit', () => {
    const tagRefs = `${expected.sourceCommit}\trefs/tags/${expected.moduleVersion}`
    expect(validate(coreDownload(), expected, tagRefs)).toBe(process.cwd())
  })

  it('rejects a wrong locked commit when the proxy omits Origin', () => {
    const wrongCommit = Object.freeze({
      ...expected,
      sourceCommit: '0'.repeat(40)
    })
    expect(() => validate(coreDownload(), wrongCommit)).toThrow(
      /canonical MALT tag .* not locked commit/
    )
  })

  it.each([
    ['missing tag', ''],
    ['unexpected ref', `${expected.sourceCommit}\trefs/heads/main`],
    [
      'duplicate tag',
      `${expected.sourceCommit}\trefs/tags/${expected.moduleVersion}\n${expected.sourceCommit}\trefs/tags/${expected.moduleVersion}`
    ]
  ])('rejects %s output from the canonical tag lookup', (_name, tagRefs) => {
    expect(() => validate(coreDownload(), expected, tagRefs)).toThrow(
      /canonical MALT tag/
    )
  })
})
