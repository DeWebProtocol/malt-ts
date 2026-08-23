import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { expect, it } from 'vitest'

const resolver = path.resolve(process.cwd(), 'scripts/resolve-core-tag.sh')
const moduleVersion = 'v0.0.7-rc.2'
const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim()

function cleanGitEnvironment(extra = {}) {
  const environment = { ...process.env }
  for (const name of [
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_DIR',
    'GIT_WORK_TREE'
  ]) {
    delete environment[name]
  }
  return {
    ...environment,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    ...extra
  }
}

function git(repository, ...arguments_) {
  return execFileSync('git', ['-C', repository, ...arguments_], {
    encoding: 'utf8',
    env: cleanGitEnvironment()
  }).trim()
}

function createTaggedRepository(root, name, contents) {
  const repository = path.join(root, name)
  mkdirSync(repository)
  git(repository, 'init', '--quiet')
  git(repository, 'config', 'user.name', 'MALT Test')
  git(repository, 'config', 'user.email', 'malt-test@example.invalid')
  writeFileSync(path.join(repository, 'source.txt'), `${contents}\n`)
  git(repository, 'add', 'source.txt')
  git(repository, 'commit', '--quiet', '-m', contents)
  git(repository, 'tag', moduleVersion)
  return {
    commit: git(repository, 'rev-parse', 'HEAD'),
    url: pathToFileURL(repository).href
  }
}

function retryEnvironment(root, gitScript) {
  const bin = path.join(root, 'bin')
  const attempts = path.join(root, 'attempts')
  const sleeps = path.join(root, 'sleeps')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'git'), gitScript)
  writeFileSync(path.join(bin, 'sleep'), `#!/usr/bin/env bash\nprintf '%s\\n' "$1" >>"${sleeps}"\n`)
  chmodSync(path.join(bin, 'git'), 0o755)
  chmodSync(path.join(bin, 'sleep'), 0o755)
  return {
    attempts,
    sleeps,
    environment: cleanGitEnvironment({
      PATH: `${bin}:${process.env.PATH}`,
      REAL_GIT: realGit,
      RETRY_ATTEMPTS_FILE: attempts
    })
  }
}

const retryingGit = `#!/usr/bin/env bash
set -eu
attempt=0
if [[ -f "\${RETRY_ATTEMPTS_FILE}" ]]; then
  read -r attempt <"\${RETRY_ATTEMPTS_FILE}"
fi
attempt=$((attempt + 1))
printf '%s\\n' "\${attempt}" >"\${RETRY_ATTEMPTS_FILE}"
if [[ "\${attempt}" -lt 3 ]]; then
  printf 'fatal: simulated transient TLS failure\\n' >&2
  exit 128
fi
exec "\${REAL_GIT}" "$@"
`

const failingGit = `#!/usr/bin/env bash
set -eu
attempt=0
if [[ -f "\${RETRY_ATTEMPTS_FILE}" ]]; then
  read -r attempt <"\${RETRY_ATTEMPTS_FILE}"
fi
attempt=$((attempt + 1))
printf '%s\\n' "\${attempt}" >"\${RETRY_ATTEMPTS_FILE}"
printf 'fatal: simulated permanent TLS failure\\n' >&2
exit 128
`

it('ignores inherited Git command config that redirects the canonical remote', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'malt-ts-core-tag-test.'))
  try {
    const canonical = createTaggedRepository(root, 'canonical', 'canonical')
    const redirected = createTaggedRepository(root, 'redirected', 'redirected')
    expect(redirected.commit).not.toBe(canonical.commit)

    const output = execFileSync(resolver, [canonical.url, moduleVersion], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${redirected.url}.insteadOf`,
        GIT_CONFIG_VALUE_0: canonical.url,
        GIT_CONFIG_PARAMETERS: 'malformed-command-config'
      }
    }).trim()

    expect(output).toBe(
      `${canonical.commit}\trefs/tags/${moduleVersion}`
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('retries transient canonical tag lookup failures with bounded backoff', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'malt-ts-core-tag-retry-test.'))
  try {
    const canonical = createTaggedRepository(root, 'canonical', 'canonical')
    const retry = retryEnvironment(root, retryingGit)
    const output = execFileSync(resolver, [canonical.url, moduleVersion], {
      encoding: 'utf8',
      env: retry.environment
    }).trim()

    expect(output).toBe(`${canonical.commit}\trefs/tags/${moduleVersion}`)
    expect(readFileSync(retry.attempts, 'utf8')).toBe('3\n')
    expect(readFileSync(retry.sleeps, 'utf8')).toBe('1\n2\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('stops after three canonical tag lookup failures and preserves the error', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'malt-ts-core-tag-failure-test.'))
  try {
    const retry = retryEnvironment(root, failingGit)
    expect(() => execFileSync(
      resolver,
      ['https://github.com/DeWebProtocol/malt-core.git', moduleVersion],
      { encoding: 'utf8', env: retry.environment, stdio: 'pipe' }
    )).toThrow(/simulated permanent TLS failure/)
    expect(readFileSync(retry.attempts, 'utf8')).toBe('3\n')
    expect(readFileSync(retry.sleeps, 'utf8')).toBe('1\n2\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
