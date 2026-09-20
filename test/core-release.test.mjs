import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function audit({ version = 'v0.0.9-RC.1', manifestVersion = version, draft = false, tag = version, checksum = true, schema = 'malt.wasm-release/v2' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malt-ts-release-audit.'))
  try {
    const scripts = path.join(root, 'scripts')
    const bin = path.join(root, 'bin')
    fs.mkdirSync(scripts)
    fs.mkdirSync(bin)
    for (const name of ['audit-core-release.sh', 'check-core-release.mjs']) {
      fs.copyFileSync(path.resolve(process.cwd(), 'scripts', name), path.join(scripts, name))
    }
    // Canonical tag resolution has its own tests. Isolate the release-asset
    // audit here so the prerelease cases never call the network.
    fs.writeFileSync(path.join(scripts, 'resolve-core.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const manifest = {
      schema,
      source_repository: 'https://github.com/DeWebProtocol/malt-core.git',
      source_module: 'github.com/dewebprotocol/malt-core',
      source_version: version,
      source_commit: '1'.repeat(40),
      components: {
        verifier: { asset_set_sha256: '2'.repeat(64), archive: 'verifier.tar.gz' },
        writer: { asset_set_sha256: '3'.repeat(64), archive: 'writer.tar.gz' }
      }
    }
    const bytes = `${JSON.stringify(manifest)}\n`
    const digest = createHash('sha256').update(bytes).digest('hex')
    const name = `malt-wasm-release-${manifestVersion}-${digest}.json`
    const lock = {
      module_path: manifest.source_module, module_version: version,
      source_repository: manifest.source_repository, source_commit: manifest.source_commit,
      release: {
        tag: version, manifest: name, manifest_sha256: digest,
        verifier_asset_set_sha256: manifest.components.verifier.asset_set_sha256,
        writer_asset_set_sha256: manifest.components.writer.asset_set_sha256
      }
    }
    const release = { tagName: tag, isDraft: draft, isPrerelease: version.includes('-'),
      assets: [name, 'SHA256SUMS', 'verifier.tar.gz', 'writer.tar.gz'].map(name => ({ name })) }
    fs.writeFileSync(path.join(root, 'malt-core.lock.json'), JSON.stringify(lock))
    fs.writeFileSync(path.join(root, 'release.json'), JSON.stringify(release))
    fs.writeFileSync(path.join(root, name), bytes)
    fs.writeFileSync(path.join(root, 'SHA256SUMS'), checksum ? `${digest}  ${name}\n` : '')
    fs.writeFileSync(path.join(bin, 'gh'), `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const root = process.env.AUDIT_FIXTURE
const lock = JSON.parse(fs.readFileSync(path.join(root, 'malt-core.lock.json'), 'utf8'))
const args = process.argv.slice(2)
if (args[0] !== 'release' || args[2] !== lock.module_version) process.exit(99)
if (args[1] === 'view') process.stdout.write(fs.readFileSync(path.join(root, 'release.json')))
else if (args[1] === 'download') {
  const dest = args[args.indexOf('--dir') + 1]
  for (const name of [lock.release.manifest, 'SHA256SUMS']) fs.copyFileSync(path.join(root, name), path.join(dest, name))
} else process.exit(99)
`, { mode: 0o755 })
    return spawnSync('bash', [path.join(scripts, 'audit-core-release.sh')], {
      encoding: 'utf8', timeout: 10000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, AUDIT_FIXTURE: root }
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

describe('published Core release audit', () => {
  for (const version of ['v0.0.8', 'v0.0.9-RC.1']) {
    it(`accepts the exact manifest for ${version}`, () => {
      const result = audit({ version })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`MALT Core ${version} release`)
    })
  }
  for (const [name, options, message] of [
    ['another version in the filename', { manifestVersion: 'v0.0.8' }, /invalid locked Core release manifest/],
    ['a draft release', { draft: true }, /does not expose/],
    ['a different published tag', { tag: 'v0.0.9-rc.1' }, /does not expose/],
    ['retired manifest schema', { schema: 'malt.wasm-release/v1' }, /semantics do not match/],
    ['missing checksum evidence', { checksum: false }, /does not bind/]
  ]) {
    it(`rejects ${name}`, () => {
      const result = audit(options)
      expect(result.error).toBeUndefined()
      expect(result.status).not.toBe(0)
      expect(result.stderr).toMatch(message)
    })
  }
})
