import { describe, it, expect } from 'vitest'
import { createAuthenticationVerification, verifyAuthenticationLocally } from '../src/index.mjs'

const profile = 'malt.authentication/0'
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
