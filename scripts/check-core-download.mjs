#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const canonicalRepository = 'https://github.com/dewebprotocol/malt-core'
const allowedOriginFields = new Set([
  'VCS',
  'URL',
  'Subdir',
  'Hash',
  'Ref',
  'TagPrefix',
  'TagSum',
  'RepoSum'
])
const emptyOriginFields = ['TagPrefix', 'TagSum', 'RepoSum']

function normalizeRepositoryURL(value) {
  return value.toLowerCase().replace(/\.git$/, '')
}

function validateClaimedOrigin(origin, expected) {
  if (origin === undefined) return
  if (origin === null || typeof origin !== 'object' || Array.isArray(origin)) {
    throw new Error('downloaded module has an unexpected source origin')
  }
  for (const field of Object.keys(origin)) {
    if (!allowedOriginFields.has(field)) {
      throw new Error('downloaded module has an unexpected source origin')
    }
  }
  for (const field of emptyOriginFields) {
    if (field in origin && origin[field] !== '') {
      throw new Error('downloaded module has an unexpected source origin')
    }
  }

  if ('VCS' in origin && origin.VCS !== 'git') {
    throw new Error('downloaded module has an unexpected source origin')
  }
  if (
    'URL' in origin &&
    (typeof origin.URL !== 'string' ||
      normalizeRepositoryURL(origin.URL) !== canonicalRepository)
  ) {
    throw new Error('downloaded module has an unexpected source origin')
  }
  if ('Subdir' in origin && origin.Subdir !== '') {
    throw new Error('downloaded module has an unexpected source origin')
  }
  if ('Hash' in origin && origin.Hash !== expected.sourceCommit) {
    throw new Error('downloaded module has an unexpected source origin')
  }
  if ('Ref' in origin && origin.Ref !== `refs/tags/${expected.moduleVersion}`) {
    throw new Error('downloaded module has an unexpected source origin')
  }
}

export function validateCoreDownload(downloaded, expected) {
  if (
    downloaded === null ||
    typeof downloaded !== 'object' ||
    Array.isArray(downloaded) ||
    downloaded.Path !== expected.modulePath ||
    downloaded.Version !== expected.moduleVersion ||
    downloaded.Error ||
    downloaded.Sum !== expected.moduleSum ||
    downloaded.GoModSum !== expected.goModSum
  ) {
    throw new Error(
      `downloaded module does not match the malt-ts release lock for ${expected.modulePath}@${expected.moduleVersion}`
    )
  }

  // Some module proxies omit Origin entirely. Exact module and go.mod sums
  // remain mandatory; any origin metadata that is supplied is additional
  // evidence and must agree with the locked public release.
  validateClaimedOrigin(downloaded.Origin, expected)

  const moduleDirectory = downloaded.Dir
  if (
    typeof moduleDirectory !== 'string' ||
    !path.isAbsolute(moduleDirectory) ||
    !fs.statSync(moduleDirectory).isDirectory() ||
    /[\t\r\n]/.test(moduleDirectory)
  ) {
    throw new Error(
      `module download does not provide a usable source directory: ${JSON.stringify(moduleDirectory)}`
    )
  }
  return moduleDirectory
}

function validateCanonicalTag(tagRefs, expected) {
  const tagRef = `refs/tags/${expected.moduleVersion}`
  const peeledRef = `${tagRef}^{}`
  const allowedRefs = new Set([tagRef, peeledRef])
  const refs = new Map()
  for (const line of tagRefs.split(/\r?\n/).filter((entry) => entry !== '')) {
    const match = /^([0-9a-f]{40})\t(.+)$/.exec(line)
    if (!match || !allowedRefs.has(match[2]) || refs.has(match[2])) {
      throw new Error('canonical MALT tag lookup returned unexpected refs')
    }
    refs.set(match[2], match[1])
  }
  if (!refs.has(tagRef)) {
    throw new Error(`canonical MALT tag ${tagRef} was not found`)
  }
  const resolvedCommit = refs.get(peeledRef) || refs.get(tagRef)
  if (resolvedCommit !== expected.sourceCommit) {
    throw new Error(
      `canonical MALT tag ${tagRef} resolves to ${resolvedCommit}, not locked commit ${expected.sourceCommit}`
    )
  }
}

export function validateCoreRelease(downloaded, tagRefs, expected) {
  const moduleDirectory = validateCoreDownload(downloaded, expected)
  validateCanonicalTag(tagRefs, expected)
  return moduleDirectory
}

function requiredEnvironment(name, pattern) {
  const value = process.env[name] || ''
  if (!pattern.test(value)) {
    throw new Error(`invalid ${name}`)
  }
  return value
}

function main() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    const expected = {
      modulePath: requiredEnvironment('MALT_MODULE', /^github\.com\/[A-Za-z0-9._/-]+$/),
      moduleVersion: requiredEnvironment(
        'MALT_VERSION',
        /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/
      ),
      sourceCommit: requiredEnvironment('MALT_COMMIT', /^[0-9a-f]{40}$/),
      moduleSum: requiredEnvironment('MALT_SUM', /^h1:[A-Za-z0-9+/]+={0,2}$/),
      goModSum: requiredEnvironment('MALT_GO_MOD_SUM', /^h1:[A-Za-z0-9+/]+={0,2}$/)
    }
    const downloaded = JSON.parse(input)
    const moduleDirectory = Object.prototype.hasOwnProperty.call(process.env, 'MALT_TAG_REFS')
      ? validateCoreRelease(downloaded, process.env.MALT_TAG_REFS, expected)
      : validateCoreDownload(downloaded, expected)
    process.stdout.write(
      `${expected.moduleVersion}\t${expected.sourceCommit}\t${moduleDirectory}\t${expected.moduleSum}\t${expected.goModSum}\n`
    )
  })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main()
}
