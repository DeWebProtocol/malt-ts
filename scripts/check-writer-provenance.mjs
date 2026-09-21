#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const expectedDirectoryEntries = Object.freeze([
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

const expectedBuildFlags = Object.freeze([
  '-p=6',
  '-mod=readonly',
  '-buildvcs=false',
  '-trimpath'
])

const expectedBuildEnvironment = Object.freeze({
  GO111MODULE: 'on',
  GOENV: 'off',
  GOWORK: 'off',
  GOFLAGS: '',
  GOTOOLCHAIN: 'local'
})

const expectedCodegenEnvironment = Object.freeze({
  CGO_ENABLED: '0',
  GOEXPERIMENT: 'none',
  GOWASM: '',
  GOFIPS140: 'off'
})

const expectedExports = Object.freeze([
  'maltApplyAuthentication',
  'maltCloseAuthentication',
  'maltCreateAuthentication',
  'maltDiscardAuthentication',
  'maltExportAuthentication',
  'maltImportAuthentication',
  'maltPrepareAuthentication',
  'maltUpdateAuthentication',
  'maltValidateAuthenticationBatch',
  'maltValidateAuthenticationReceipt'
])

const goVersionPattern = /^go[1-9][0-9]*\.[0-9]+(?:\.[0-9]+|(?:beta|rc)[1-9][0-9]*)?$/
const goToolchainPattern = /^go version (go[1-9][0-9]*\.[0-9]+(?:\.[0-9]+|(?:beta|rc)[1-9][0-9]*)?) ([a-z0-9]+)\/([a-z0-9]+)$/

function assertExactArray(actual, expected, label) {
  if (
    !Array.isArray(actual) ||
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error('unexpected ' + label + ' ' + JSON.stringify(actual))
  }
}

function assertExactRecord(actual, expected, label) {
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) {
    throw new Error('unexpected ' + label + ' ' + JSON.stringify(actual))
  }
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index]) ||
    expectedKeys.some((key) => actual[key] !== expected[key])
  ) {
    throw new Error('unexpected ' + label + ' ' + JSON.stringify(actual))
  }
}

function assertArtifact(artifact, expected, label) {
  if (artifact?.file !== expected.file) {
    throw new Error('unexpected ' + label + ' file ' + JSON.stringify(artifact?.file))
  }
  assertExactArray(artifact?.build_tags, expected.buildTags, label + ' build tags')
  if ('linkerProfile' in expected && artifact?.linker_profile !== expected.linkerProfile) {
    throw new Error(
      'unexpected ' + label + ' linker profile ' + JSON.stringify(artifact?.linker_profile)
    )
  }
  if (
    'retainedFixedBaseTableBytes' in expected &&
    artifact?.retained_fixed_base_table_bytes !== expected.retainedFixedBaseTableBytes
  ) {
    throw new Error(
      'unexpected ' +
        label +
        ' retained fixed-base table bytes ' +
        JSON.stringify(artifact?.retained_fixed_base_table_bytes)
    )
  }
}

export function validateWriterProvenance(
  provenance,
  expectedParameters,
  expectedCore,
  expectedBuildInputs
) {
  if (provenance === null || typeof provenance !== 'object' || Array.isArray(provenance)) {
    throw new Error('writer provenance must be a JSON object')
  }
  if (
    expectedParameters === null ||
    typeof expectedParameters !== 'object' ||
    Array.isArray(expectedParameters) ||
    typeof expectedParameters.id !== 'string' ||
    !/^[0-9a-f]{64}$/.test(expectedParameters.sha256 || '')
  ) {
    throw new Error('expected IPA parameters are invalid')
  }
  if (
    expectedCore === null ||
    typeof expectedCore !== 'object' ||
    Array.isArray(expectedCore)
  ) {
    throw new Error('expected Core provenance is invalid')
  }
  if (!/^[0-9a-f]{64}$/.test(expectedBuildInputs || '')) {
    throw new Error('expected malt-ts build-input digest is invalid')
  }
  if (provenance.schema !== 'malt.ts-writer.provenance/v1') {
    throw new Error(
      'unexpected writer provenance schema ' + JSON.stringify(provenance.schema)
    )
  }
  if (provenance.source_repository !== 'https://github.com/DeWebProtocol/malt-ts.git') {
    throw new Error(
      'unexpected writer source repository ' + JSON.stringify(provenance.source_repository)
    )
  }
  if (provenance.build_inputs_sha256 !== expectedBuildInputs) {
    throw new Error(
      'unexpected writer build-input digest ' +
        JSON.stringify(provenance.build_inputs_sha256)
    )
  }
  assertExactRecord(provenance.core, expectedCore, 'writer Core dependency')
  if (provenance.target !== 'js/wasm') {
    throw new Error('unexpected writer target ' + JSON.stringify(provenance.target))
  }
  assertExactArray(provenance.exports, expectedExports, 'writer exports')
  if (!goVersionPattern.test(provenance.go_version || '')) {
    throw new Error('unexpected writer Go version ' + JSON.stringify(provenance.go_version))
  }
  const toolchainMatch = goToolchainPattern.exec(provenance.go_toolchain || '')
  if (!toolchainMatch) {
    throw new Error(
      'unexpected writer Go toolchain ' + JSON.stringify(provenance.go_toolchain)
    )
  }
  if (toolchainMatch[1] !== provenance.go_version) {
    throw new Error(
      'writer Go toolchain version ' +
        JSON.stringify(toolchainMatch[1]) +
        ' does not match ' +
        JSON.stringify(provenance.go_version)
    )
  }
  assertExactArray(provenance.build_flags, expectedBuildFlags, 'writer build flags')
  assertExactRecord(
    provenance.build_environment,
    expectedBuildEnvironment,
    'writer build environment'
  )
  assertExactRecord(
    provenance.codegen_environment,
    expectedCodegenEnvironment,
    'writer codegen environment'
  )
  if (
    provenance.parameters?.id !== expectedParameters.id ||
    provenance.parameters?.sha256 !== expectedParameters.sha256
  ) {
    throw new Error(
      'unexpected writer IPA parameters ' + JSON.stringify(provenance.parameters)
    )
  }

  assertArtifact(
    provenance.artifacts?.kzg,
    {
      file: 'malt-writer-kzg.wasm',
      buildTags: ['writer_kzg']
    },
    'KZG artifact'
  )
  for (const [profile, retainedFixedBaseTableBytes] of [
    ['direct', 0],
    ['compact', 12582912],
    ['fast', 350355456]
  ]) {
    assertArtifact(
      provenance.artifacts?.ipa?.[profile],
      {
        file: 'malt-writer-ipa-' + profile + '.wasm',
        buildTags: ['writer_ipa', 'malt_no_default_kzg'],
        linkerProfile: profile,
        retainedFixedBaseTableBytes
      },
      'IPA ' + profile + ' artifact'
    )
  }

  assertExactRecord(
    provenance.runtime_invariants,
    { one_runtime_per_controller: true, exact_backend_profile: true },
    'writer runtime invariants'
  )

  return provenance.core.source_commit
}

export function validateWriterDirectory(
  directory,
  expectedParameters,
  expectedCore,
  expectedBuildInputs
) {
  const directoryEntries = fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
  if (
    directoryEntries.length !== expectedDirectoryEntries.length ||
    directoryEntries.some(
      (entry, index) => entry.name !== expectedDirectoryEntries[index] || !entry.isFile()
    )
  ) {
    throw new Error(
      'malt-ts writer directory must contain exactly nine regular files: ' +
        expectedDirectoryEntries.join(', ')
    )
  }

  for (const filename of [
    'malt-writer-kzg.wasm',
    'malt-writer-ipa-direct.wasm',
    'malt-writer-ipa-compact.wasm',
    'malt-writer-ipa-fast.wasm'
  ]) {
    const wasm = fs.readFileSync(path.join(directory, filename))
    if (wasm.length < 8 || wasm.subarray(0, 4).toString('hex') !== '0061736d') {
      throw new Error(filename + ' does not have a WebAssembly header')
    }
  }

  const provenance = JSON.parse(
    fs.readFileSync(path.join(directory, 'PROVENANCE.json'), 'utf8')
  )
  return validateWriterProvenance(
    provenance,
    expectedParameters,
    expectedCore,
    expectedBuildInputs
  )
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name] || ''
  if (!pattern.test(value)) {
    throw new Error('invalid ' + name)
  }
  return value
}

function main() {
  if (process.argv.length !== 3) {
    throw new Error('usage: check-writer-provenance.mjs WRITER_DIRECTORY')
  }
  const expectedParameters = JSON.parse(process.env.IPA_PARAMETERS_JSON || '')
  const expectedCore = {
    module_path: 'github.com/dewebprotocol/malt-core',
    module_version: requiredEnvironment(
      'MALT_VERSION',
      /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
    ),
    source_repository: 'https://github.com/DeWebProtocol/malt-core.git',
    source_commit: requiredEnvironment('MALT_COMMIT', /^[0-9a-f]{40}$/),
    module_sum: requiredEnvironment('MALT_SUM', /^h1:[A-Za-z0-9+/]+={0,2}$/),
    go_mod_sum: requiredEnvironment('MALT_GO_MOD_SUM', /^h1:[A-Za-z0-9+/]+={0,2}$/)
  }
  const expectedBuildInputs = requiredEnvironment(
    'MALT_TS_BUILD_INPUTS_SHA256',
    /^[0-9a-f]{64}$/
  )
  const sourceCommit = validateWriterDirectory(
    path.resolve(process.argv[2]),
    expectedParameters,
    expectedCore,
    expectedBuildInputs
  )
  process.stdout.write(sourceCommit)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
