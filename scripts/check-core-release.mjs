#!/usr/bin/env node
import fs from 'node:fs'

const [lockPath, releasePath] = process.argv.slice(2)
if (!lockPath || !releasePath || process.argv.length !== 4) {
  throw new Error('usage: check-core-release.mjs LOCK RELEASE_JSON')
}
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'))
const version = lock.module_version
if (
  !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version || '') ||
  lock.module_path !== 'github.com/dewebprotocol/malt-core' ||
  lock.source_repository !== 'https://github.com/DeWebProtocol/malt-core.git' ||
  !/^[0-9a-f]{40}$/.test(lock.source_commit || '') ||
  !/^h1:[A-Za-z0-9+/]+={0,2}$/.test(lock.module_sum || '') ||
  !/^h1:[A-Za-z0-9+/]+={0,2}$/.test(lock.go_mod_sum || '')
) {
  throw new Error('invalid locked Core source provenance')
}
if (
  release.tagName !== version ||
  release.isDraft !== false ||
  release.isPrerelease !== version.includes('-') ||
  release.url !== `https://github.com/DeWebProtocol/malt-core/releases/tag/${version}`
) {
  throw new Error('GitHub release does not match the locked published Core source')
}
process.stdout.write(`MALT Core ${version} release ${lock.source_commit} is locked and published.\n`)
