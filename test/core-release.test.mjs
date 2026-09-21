// @vitest-environment node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function audit({ version = 'v0.0.9-RC.1', draft = false, tag = version,
  url = `https://github.com/DeWebProtocol/malt-core/releases/tag/${version}`,
  prerelease = version.includes('-'), resolveStatus = 0 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malt-ts-release-audit.'))
  try {
    const scripts = path.join(root, 'scripts'), bin = path.join(root, 'bin')
    fs.mkdirSync(scripts); fs.mkdirSync(bin)
    for (const name of ['audit-core-release.sh', 'check-core-release.mjs']) {
      fs.copyFileSync(path.resolve('scripts', name), path.join(scripts, name))
    }
    // Canonical tag and module digest rejection have separate behavioral tests.
    // Assert this audit invokes that gate and stops if it rejects the source.
    fs.writeFileSync(path.join(scripts, 'resolve-core.sh'), `#!/bin/sh
[ "$1" = --audit-source-tag ] || exit 98
[ ${resolveStatus} = 0 ] || exit ${resolveStatus}
printf '%s\\t%s\\t/tmp/core\\th1:YWJj\\th1:ZGVm\\n' '${version}' '${'1'.repeat(40)}'
`, { mode: 0o755 })
    fs.writeFileSync(path.join(root, 'malt-core.lock.json'), JSON.stringify({
      schema: 'malt.ts-core-lock/v2', module_path: 'github.com/dewebprotocol/malt-core',
      module_version: version, source_repository: 'https://github.com/DeWebProtocol/malt-core.git',
      source_commit: '1'.repeat(40), module_sum: 'h1:YWJj', go_mod_sum: 'h1:ZGVm'
    }))
    fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify({
      tagName: tag, isDraft: draft, isPrerelease: prerelease, url
    }))
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] !== 'release' || args[1] !== 'view' || args[2] !== '${version}') process.exit(99)
process.stdout.write(fs.readFileSync(process.env.AUDIT_FIXTURE + '/release.json'))
`, { mode: 0o755 })
    return spawnSync('bash', [path.join(scripts, 'audit-core-release.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AUDIT_FIXTURE: root }
    })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

describe('published Core source release audit', () => {
  for (const version of ['v0.0.8', 'v0.0.9-RC.1']) {
    it(`accepts published source ${version} without WASM release assets`, () => {
      const result = audit({ version })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`MALT Core ${version} release`)
    })
  }
  for (const [name, options] of [
    ['a draft release', { draft: true }],
    ['a different published tag', { tag: 'v0.0.9-rc.1' }],
    ['another source repository', { url: 'https://github.com/another/core/releases/tag/v0.0.9-RC.1' }],
    ['a mismatched prerelease declaration', { prerelease: false }]
  ]) {
    it(`rejects ${name}`, () => {
      const result = audit(options)
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(/does not match the locked published Core source/)
    })
  }
  it('stops on failed source tag or module checksum validation', () => {
    const result = audit({ resolveStatus: 42 })
    expect(result.status).toBe(42)
    expect(result.stdout).toBe('')
  })
})
