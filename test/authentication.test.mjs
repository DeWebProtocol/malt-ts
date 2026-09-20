import { describe, it, expect } from 'vitest'
import { createAuthenticationVerification, verifyAuthenticationLocally } from '../src/index.mjs'

const profile = 'malt.authentication/1'
const request = { profile, root: 'caller-root', operation: 'binding', steps: [],
  input: { kind: 'index', number: '18446744073709551615' } }
const result = { profile, resolved: 'caller-root', traversal: { steps: [] } }

describe('typed authentication bridge', () => {
  it('preserves caller steps, opaque bytes and uint64 strings', async () => {
    const source = { request: { ...request, steps: [{ kind: 'label', data: 'YS9iAA==' }] }, result }
    let received
    const provider = { authentication: async (json) => {
      received = JSON.parse(json)
      return JSON.stringify({ profile, valid: true })
    } }
    const checked = await verifyAuthenticationLocally({ ...source, provider })
    expect(received).toEqual(source)
    expect(checked.valid).toBe(true)
    const copy = createAuthenticationVerification(source)
    copy.request.root = 'changed'
    expect(source.request.root).toBe('caller-root')
  })
  it('fails closed for the locked release without the new ABI', async () => {
    const checked = await verifyAuthenticationLocally({ request, result, provider: {} })
    expect(checked.valid).toBe(false)
    expect(checked.error).toContain('authentication')
  })
  it('rejects a different provider profile and preserves negative verification', async () => {
    for (const response of [{ profile: 'other', valid: true }, { profile, valid: false }]) {
      expect((await verifyAuthenticationLocally({ request, result,
        provider: { authentication: async () => JSON.stringify(response) }
      })).valid).toBe(false)
    }
  })
})

it('binds path absence to the new request profile without reinterpreting steps', async () => {
  const profile = 'malt.authentication/1'
  const q = { ...request, profile, operation: 'resolve', input: undefined,
    steps: [{ kind: 'label', data: 'bWlzc2luZw==' }] }
  const proof = { profile, resolved: '', absent_step: '0', traversal: { results: [] } }
  const provider = { authentication: async (json) => {
    expect(JSON.parse(json).request.profile).toBe(profile)
    return JSON.stringify({ profile, valid: true })
  } }
  expect((await verifyAuthenticationLocally({ request: q, result: proof, provider })).valid).toBe(true)
  expect((await verifyAuthenticationLocally({ request: q, result: { ...result, profile: 'malt.authentication/0' }, provider })).valid).toBe(false)
})

it('rejects the retired query profile before calling WASM', async () => {
  let called = false
  const checked = await verifyAuthenticationLocally({
    request: { ...request, profile: 'malt.authentication/0' },
    result: { ...result, profile: 'malt.authentication/0' },
    provider: { authentication() { called = true; throw new Error('unexpected call') } }
  })
  expect(checked.valid).toBe(false)
  expect(called).toBe(false)
})
