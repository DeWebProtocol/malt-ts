import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveWasmAssetVersions,
  versionWasmAssetSets,
  versionedWasmAssetsPlugin,
  wasmAssetSetFiles
} from '../vite/index.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  )
})

async function createAssetSets() {
  const root = await mkdtemp(join(tmpdir(), 'malt-versioned-wasm-assets.'))
  temporaryDirectories.push(root)
  for (const [kind, filenames] of Object.entries(wasmAssetSetFiles)) {
    const directory = join(root, kind)
    await mkdir(directory)
    const artifacts = filenames.filter((filename) => filename !== 'SHA256SUMS')
    for (const filename of artifacts) {
      await writeFile(join(directory, filename), `${kind}:${filename}\n`)
    }
    await writeChecksumManifest(directory, artifacts)
  }
  return root
}

async function writeChecksumManifest(directory, filenames) {
  const lines = []
  for (const filename of filenames) {
    lines.push(
      `${createHash('sha256')
        .update(await readFile(join(directory, filename)))
        .digest('hex')}  ${filename}`
    )
  }
  await writeFile(join(directory, 'SHA256SUMS'), `${lines.join('\n')}\n`)
}

describe('checksum-versioned WASM assets', () => {
  it('derives full asset-set digests and removes unversioned build outputs', async () => {
    const root = await createAssetSets()
    const versions = resolveWasmAssetVersions(root)

    expect(versions.verifier).toMatch(/^[0-9a-f]{64}$/)
    expect(versions.writer).toMatch(/^[0-9a-f]{64}$/)

    versionWasmAssetSets(root, versions)

    for (const [kind, filenames] of Object.entries(wasmAssetSetFiles)) {
      expect(await readdir(join(root, kind))).toEqual([versions[kind]])
      expect((await readdir(join(root, kind, versions[kind]))).sort()).toEqual(
        [...filenames].sort()
      )
    }
  })

  it('changes the URL identity when one bound asset changes', async () => {
    const root = await createAssetSets()
    const before = resolveWasmAssetVersions(root)
    const verifierDirectory = join(root, 'verifier')
    await writeFile(join(verifierDirectory, 'malt-verifier.wasm'), 'updated wasm\n')
    await writeChecksumManifest(
      verifierDirectory,
      wasmAssetSetFiles.verifier.filter((filename) => filename !== 'SHA256SUMS')
    )
    const after = resolveWasmAssetVersions(root)

    expect(after.writer).toBe(before.writer)
    expect(after.verifier).not.toBe(before.verifier)
    expect(after.verifier).toBe(
      createHash('sha256')
        .update(await readFile(join(root, 'verifier', 'SHA256SUMS')))
        .digest('hex')
    )
  })

  it('rejects changed bytes when the checksum manifest was not updated', async () => {
    const root = await createAssetSets()
    await writeFile(join(root, 'verifier', 'malt-verifier.wasm'), 'stale identity\n')

    expect(() => resolveWasmAssetVersions(root)).toThrow(
      /checksum does not match malt-verifier\.wasm/
    )
  })

  it('rejects output bytes changed after version resolution', async () => {
    const root = await createAssetSets()
    const versions = resolveWasmAssetVersions(root)
    await writeFile(join(root, 'verifier', 'malt-verifier.wasm'), 'changed later\n')

    expect(() => versionWasmAssetSets(root, versions)).toThrow(
      /built verifier SHA256SUMS checksum does not match malt-verifier\.wasm/
    )
  })

  it('rejects a regenerated manifest after version resolution', async () => {
    const root = await createAssetSets()
    const versions = resolveWasmAssetVersions(root)
    const verifierDirectory = join(root, 'verifier')
    await writeFile(join(verifierDirectory, 'malt-verifier.wasm'), 'changed set\n')
    await writeChecksumManifest(
      verifierDirectory,
      wasmAssetSetFiles.verifier.filter((filename) => filename !== 'SHA256SUMS')
    )

    expect(() => versionWasmAssetSets(root, versions)).toThrow(
      /changed after version resolution/
    )
  })

  it('rejects extra files instead of blessing a mixed asset directory', async () => {
    const root = await createAssetSets()
    await writeFile(join(root, 'writer', 'stale.wasm'), 'stale')

    expect(() => resolveWasmAssetVersions(root)).toThrow(
      /must contain exactly these regular files/
    )
  })

  it('rejects a supplied release version that does not match the asset set', async () => {
    const root = await createAssetSets()
    const previous = process.env.VITE_MALT_VERIFIER_VERSION
    process.env.VITE_MALT_VERIFIER_VERSION = '0'.repeat(64)
    try {
      const plugin = versionedWasmAssetsPlugin({ publicDirectory: root })
      expect(() => plugin.config()).toThrow(/does not match verifier SHA256SUMS digest/)
    } finally {
      if (previous === undefined) delete process.env.VITE_MALT_VERIFIER_VERSION
      else process.env.VITE_MALT_VERIFIER_VERSION = previous
    }
  })
})
