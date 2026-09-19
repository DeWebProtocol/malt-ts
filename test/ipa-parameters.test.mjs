// @vitest-environment node
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'

const script = path.resolve('scripts/read-core-ipa-parameters.sh')

it('runs the IPA parameter exporter with a native, isolated Go environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'malt-ipa-environment-'))
  try {
    fs.writeFileSync(path.join(root, 'go.mod'), 'module test-parameters\n\ngo 1.26.0\n')
    const go = path.join(root, 'fake-go')
    fs.writeFileSync(go, `#!/usr/bin/env node
for (const name of ['GOROOT', 'GOOS', 'GOARCH']) {
  if (process.env[name]) process.exit(31)
}
if (process.env.GOEXPERIMENT !== 'none' || process.env.GOWASM !== '' ||
    process.env.GOFIPS140 !== 'off' || process.env.CGO_ENABLED !== '0' ||
    process.env.GOTOOLCHAIN !== 'local') process.exit(32)
process.stdout.write(JSON.stringify({id: 'test-parameters', sha256: 'a'.repeat(64)}))
`, { mode: 0o755 })
    const result = spawnSync('bash', [script, root, go, 'local'], {
      encoding: 'utf8',
      env: { ...process.env, GOROOT: '/invalid', GOOS: 'windows', GOARCH: '386',
        GOEXPERIMENT: 'invalid', GOWASM: 'invalid', GOFIPS140: 'invalid', CGO_ENABLED: '1' }
    })
    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ id: 'test-parameters', sha256: 'a'.repeat(64) })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
