import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const wasmAssetSetFiles = Object.freeze({
  verifier: Object.freeze([
    'PROVENANCE.json',
    'SHA256SUMS',
    'malt-verifier.wasm',
    'wasm_exec.js'
  ]),
  writer: Object.freeze([
    'PROVENANCE.json',
    'SHA256SUMS',
    'malt-writer-ipa-compact.wasm',
    'malt-writer-ipa-direct.wasm',
    'malt-writer-ipa-fast.wasm',
    'malt-writer-kzg.wasm',
    'malt-writer-worker.mjs',
    'malt-writer-workers.mjs',
    'wasm_exec.js'
  ])
})

function assertExactRegularFiles(directory, expectedFiles, label) {
  const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
    left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  )
  if (
    entries.length !== expectedFiles.length ||
    entries.some(
      (entry, index) => entry.name !== expectedFiles[index] || !entry.isFile()
    )
  ) {
    throw new Error(
      `${label} must contain exactly these regular files: ${expectedFiles.join(', ')}`
    )
  }
}

function checksumManifestDigest(directory) {
  return createHash('sha256')
    .update(readFileSync(join(directory, 'SHA256SUMS')))
    .digest('hex')
}

function fileDigest(directory, filename) {
  return createHash('sha256')
    .update(readFileSync(join(directory, filename)))
    .digest('hex')
}

function assertChecksumManifest(directory, expectedFiles, label) {
  const requiredArtifacts = new Set(
    expectedFiles.filter((filename) => filename !== 'SHA256SUMS')
  )
  const coveredArtifacts = new Set()
  const lines = readFileSync(join(directory, 'SHA256SUMS'), 'utf8')
    .trimEnd()
    .split('\n')

  for (const line of lines) {
    const match = /^([0-9a-f]{64}) ([ *])([^/\r\n]+)$/.exec(line)
    const artifact = match?.[3]
    if (!artifact || !requiredArtifacts.has(artifact)) {
      throw new Error(`${label} has an unexpected checksum entry ${JSON.stringify(line)}`)
    }
    if (coveredArtifacts.has(artifact)) {
      throw new Error(`${label} has a duplicate checksum entry for ${artifact}`)
    }
    if (fileDigest(directory, artifact) !== match[1]) {
      throw new Error(`${label} checksum does not match ${artifact}`)
    }
    coveredArtifacts.add(artifact)
  }

  for (const artifact of requiredArtifacts) {
    if (!coveredArtifacts.has(artifact)) {
      throw new Error(`${label} does not cover ${artifact}`)
    }
  }
}

export function maltWasmAssetsDirectory() {
  return fileURLToPath(new URL('../assets/', import.meta.url))
}

export function resolveWasmAssetVersions(publicDirectory = maltWasmAssetsDirectory()) {
  const versions = {}
  for (const [kind, expectedFiles] of Object.entries(wasmAssetSetFiles)) {
    const directory = join(publicDirectory, kind)
    assertExactRegularFiles(directory, expectedFiles, `public ${kind} asset set`)
    assertChecksumManifest(directory, expectedFiles, `public ${kind} SHA256SUMS`)
    versions[kind] = checksumManifestDigest(directory)
  }
  return Object.freeze(versions)
}

export function versionWasmAssetSets(outputDirectory, versions) {
  const preparedSets = []
  for (const [kind, expectedFiles] of Object.entries(wasmAssetSetFiles)) {
    const digest = versions?.[kind]
    if (!/^[0-9a-f]{64}$/.test(digest || '')) {
      throw new Error(`invalid ${kind} asset-set digest`)
    }
    const sourceDirectory = join(outputDirectory, kind)
    assertExactRegularFiles(sourceDirectory, expectedFiles, `built ${kind} asset set`)
    assertChecksumManifest(
      sourceDirectory,
      expectedFiles,
      `built ${kind} SHA256SUMS`
    )
    const outputDigest = checksumManifestDigest(sourceDirectory)
    if (outputDigest !== digest) {
      throw new Error(
        `built ${kind} SHA256SUMS digest ${outputDigest} changed after version resolution ${digest}`
      )
    }
    preparedSets.push({ digest, expectedFiles, kind, sourceDirectory })
  }

  for (const { digest, expectedFiles, kind, sourceDirectory } of preparedSets) {
    const targetDirectory = join(sourceDirectory, digest)
    mkdirSync(targetDirectory)
    for (const filename of expectedFiles) {
      renameSync(join(sourceDirectory, filename), join(targetDirectory, filename))
    }
    const remaining = readdirSync(sourceDirectory)
    if (remaining.length !== 1 || remaining[0] !== digest) {
      throw new Error(`unversioned ${kind} assets remain after versioning`)
    }
  }
}

export function versionedWasmAssetsPlugin({ publicDirectory = maltWasmAssetsDirectory() } = {}) {
  let outputDirectory
  let versions
  return {
    name: 'malt-versioned-wasm-assets',
    apply: 'build',
    config() {
      versions = resolveWasmAssetVersions(publicDirectory)
      for (const [kind, variable] of [
        ['verifier', 'VITE_MALT_VERIFIER_VERSION'],
        ['writer', 'VITE_MALT_WRITER_VERSION']
      ]) {
        const supplied = String(process.env[variable] || '').trim()
        if (supplied && supplied !== versions[kind]) {
          throw new Error(
            `${variable} ${JSON.stringify(supplied)} does not match ${kind} SHA256SUMS digest ${versions[kind]}`
          )
        }
      }
      return {
        define: {
          'import.meta.env.VITE_MALT_VERIFIER_VERSION': JSON.stringify(
            versions.verifier
          ),
          'import.meta.env.VITE_MALT_WRITER_VERSION': JSON.stringify(versions.writer)
        }
      }
    },
    configResolved(config) {
      outputDirectory = config.build.outDir
    },
    closeBundle() {
      versionWasmAssetSets(outputDirectory, versions)
    }
  }
}
