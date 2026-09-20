import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  validateWriterChecksums,
  writerChecksumFiles
} from '../scripts/check-writer-checksums.mjs'
import { validateWriterProvenance } from '../scripts/check-writer-provenance.mjs'

const releasedProvenance = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'assets/writer/PROVENANCE.json'), 'utf8')
)
const expectedParameters = Object.freeze(structuredClone(releasedProvenance.parameters))
const expectedCore = Object.freeze(structuredClone(releasedProvenance.core))
const expectedBuildInputs = releasedProvenance.build_inputs_sha256

// Preserve the published metadata as a fixture, but test the new source ABI.
// This synthetic fixture is not written into distributed asset provenance.
function cloneProvenance() {
  return { ...structuredClone(releasedProvenance), exports: [
    'maltApplyAuthentication',
    'maltCloseAuthentication',
    'maltComputeClientRootV1',
    'maltCreateAuthentication',
    'maltDiscardAuthentication',
    'maltExportAuthentication',
    'maltImportAuthentication',
    'maltPrepareAuthentication',
    'maltUpdateAuthentication',
    'maltWriterAcceptSessionReceiptV1',
    'maltWriterBootstrapSessionV1',
    'maltWriterCloseSessionV1',
    'maltWriterDiscardSessionCandidateV1',
    'maltWriterGetPreparedResultV1',
    'maltWriterLoadSessionV1',
    'maltWriterPrepareSessionV1',
    'maltWriterRestoreSessionV1',
    'maltWriterSnapshotSessionV1',
    'maltWriterValidateReceiptV1'
  ] }
}

function checksumManifestFor(provenanceContents) {
  const provenanceDigest = createHash('sha256').update(provenanceContents).digest('hex')
  const lines = writerChecksumFiles.map((filename, index) => {
    const digest =
      filename === 'PROVENANCE.json'
        ? provenanceDigest
        : String(index + 1).padStart(64, '0')
    return digest + '  ' + filename
  })
  return {
    contents: lines.join('\n') + '\n',
    provenanceDigest
  }
}

function expectRehashedTamperRejected(mutate, messagePattern) {
  const provenance = cloneProvenance()
  mutate(provenance)
  const provenanceContents = JSON.stringify(provenance, null, 2) + '\n'
  const { contents, provenanceDigest } = checksumManifestFor(provenanceContents)

  expect(createHash('sha256').update(provenanceContents).digest('hex')).toBe(provenanceDigest)
  expect(contents).toContain(provenanceDigest + '  PROVENANCE.json')
  expect(() => validateWriterChecksums(contents)).not.toThrow()
  expect(() =>
    validateWriterProvenance(
      provenance,
      expectedParameters,
      expectedCore,
      expectedBuildInputs
    )
  ).toThrow(messagePattern)
}

describe('writer build provenance release gate', () => {
  it('accepts the current writer build contract', () => {
    expect(() =>
      validateWriterProvenance(
        cloneProvenance(),
        expectedParameters,
        expectedCore,
        expectedBuildInputs
      )
    ).not.toThrow()
  })

  it.each(['maltPrepareAuthentication', 'maltUpdateAuthentication', 'maltApplyAuthentication'])(
    'rejects a rehashed manifest missing the current %s export', name => {
      expectRehashedTamperRejected(provenance => {
        provenance.exports = provenance.exports.filter(value => value !== name)
      }, /writer exports/)
    }
  )

  it.each([
    [
      'malt-ts build inputs',
      (provenance) => {
        provenance.build_inputs_sha256 = '0'.repeat(64)
      },
      /build-input digest/
    ],
    [
      'Core module sum',
      (provenance) => {
        provenance.core.module_sum = 'h1:tampered='
      },
      /Core dependency/
    ],
    [
      'WASM exports',
      (provenance) => provenance.exports.pop(),
      /writer exports/
    ],
    [
      'build flags',
      (provenance) => provenance.build_flags.push('-ldflags=-s'),
      /build flags/
    ],
    [
      'build environment',
      (provenance) => {
        provenance.build_environment.GOTOOLCHAIN = 'auto'
      },
      /build environment/
    ],
    [
      'codegen environment',
      (provenance) => {
        provenance.codegen_environment.CGO_ENABLED = '1'
      },
      /codegen environment/
    ],
    [
      'runtime invariants',
      (provenance) => {
        provenance.runtime_invariants.exact_backend_profile = false
      },
      /runtime invariants/
    ],
    [
      'KZG build tags',
      (provenance) => provenance.artifacts.kzg.build_tags.push('writer_ipa'),
      /KZG artifact build tags/
    ],
    [
      'IPA direct build tags',
      (provenance) => provenance.artifacts.ipa.direct.build_tags.reverse(),
      /IPA direct artifact build tags/
    ],
    [
      'IPA compact build tags',
      (provenance) => provenance.artifacts.ipa.compact.build_tags.pop(),
      /IPA compact artifact build tags/
    ],
    [
      'IPA fast build tags',
      (provenance) => {
        provenance.artifacts.ipa.fast.build_tags[0] = 'writer_kzg'
      },
      /IPA fast artifact build tags/
    ],
    [
      'Go version format',
      (provenance) => {
        provenance.go_version = '1.26.2'
      },
      /Go version/
    ],
    [
      'Go toolchain format',
      (provenance) => {
        provenance.go_toolchain = 'go1.26.2 linux/amd64'
      },
      /Go toolchain/
    ],
    [
      'Go version consistency',
      (provenance) => {
        provenance.go_version = 'go1.26.3'
      },
      /does not match/
    ]
  ])('rejects rehashed provenance with tampered %s', (_name, mutate, messagePattern) => {
    expectRehashedTamperRejected(mutate, messagePattern)
  })
})
