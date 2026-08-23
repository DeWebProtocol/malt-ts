#!/usr/bin/env node

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const [lockPath, releasePath, manifestPath, checksumsPath] = process.argv.slice(2)
if (!lockPath || !releasePath || !manifestPath || !checksumsPath) {
  throw new Error(
    'usage: check-core-release.mjs LOCK RELEASE_JSON MANIFEST SHA256SUMS'
  )
}

const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'))
const manifestBytes = fs.readFileSync(manifestPath)
const manifest = JSON.parse(manifestBytes)
const checksums = fs.readFileSync(checksumsPath, 'utf8')
const manifestName = path.basename(manifestPath)
const manifestSHA256 = createHash('sha256').update(manifestBytes).digest('hex')

if (
  release.tagName !== lock.release.tag ||
  release.isDraft !== false ||
  !Array.isArray(release.assets) ||
  !release.assets.some((asset) => asset?.name === manifestName) ||
  !release.assets.some((asset) => asset?.name === 'SHA256SUMS')
) {
  throw new Error('GitHub release does not expose the locked Core release assets')
}
if (
  manifestName !== lock.release.manifest ||
  manifestSHA256 !== lock.release.manifest_sha256
) {
  throw new Error('Core release manifest does not match the lock')
}

const checksumRecords = checksums.trimEnd().split('\n')
const manifestRecords = checksumRecords.filter((line) => line.endsWith(`  ${manifestName}`))
if (
  manifestRecords.length !== 1 ||
  manifestRecords[0] !== `${manifestSHA256}  ${manifestName}`
) {
  throw new Error('Core release SHA256SUMS does not bind the locked manifest')
}

if (
  manifest.schema !== 'malt.wasm-release/v1' ||
  manifest.source_repository !== lock.source_repository ||
  manifest.source_module !== lock.module_path ||
  manifest.source_version !== lock.module_version ||
  manifest.source_commit !== lock.source_commit ||
  manifest.components?.verifier?.asset_set_sha256 !==
    lock.release.verifier_asset_set_sha256 ||
  manifest.components?.writer?.asset_set_sha256 !==
    lock.release.writer_asset_set_sha256
) {
  throw new Error('Core release manifest semantics do not match the lock')
}

for (const component of ['verifier', 'writer']) {
  const archive = manifest.components?.[component]?.archive
  if (
    typeof archive !== 'string' ||
    !release.assets.some((asset) => asset?.name === archive)
  ) {
    throw new Error(`GitHub release is missing the locked Core ${component} archive`)
  }
}

process.stdout.write(
  `MALT Core ${lock.module_version} release ${lock.source_commit} is locked and published.\n`
)
