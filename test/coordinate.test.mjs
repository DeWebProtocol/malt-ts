import { describe, it, expect, vi } from 'vitest'
import * as verifier from '../src/verifier.mjs'
import { deriveCoordinate, encodeIndexLabel, encodeKeyLabel } from '../src/index.mjs'

describe('client-facing coordinate derivation', () => {
  it('encodes Direct indices losslessly as eight big-endian bytes', () => {
    expect(encodeIndexLabel(42)).toBe('AAAAAAAAACo=')
    expect(encodeIndexLabel(0n)).toBe('AAAAAAAAAAA=')
    expect(encodeIndexLabel('18446744073709551615')).toBe('//////////8=')
    for (const value of [-1, 1.5, NaN, 9007199254740992, '01', '1.0', true, 18446744073709551616n]) {
      expect(() => encodeIndexLabel(value)).toThrow()
    }
  })
  it('accepts only exact Direct keys without mutating the input', () => {
    const key = new Uint8Array(32).fill(7), encoded = encodeKeyLabel(key)
    key[0] = 0
    expect(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))).toEqual(new Uint8Array(32).fill(7))
    expect(() => encodeKeyLabel(new Uint8Array(31))).toThrow()
  })
  it('delegates opaque labels to Core and preserves uint64 output', async () => {
    const label = Uint8Array.from([255, 0, 47]), signal = new AbortController().signal
    const provider = { derive: vi.fn(async () => '{"kind":"index","index":"18446744073709551615"}') }
    expect(await deriveCoordinate({profile:3,label,signal,provider})).toEqual({kind:'index',index:18446744073709551615n})
    expect(provider.derive).toHaveBeenCalledWith('{"profile":3,"label":"/wAv"}',signal)
  })
  it('captures each label before asynchronous verifier initialization', async () => {
    let ready
    const initialization = new Promise(resolve => { ready = resolve })
    const load = vi.spyOn(verifier, 'loadBrowserVerifier').mockReturnValue(initialization)
    try {
      const label = new Uint8Array(8)
      const zero = deriveCoordinate({ profile: 3, label })
      label[7] = 1
      const one = deriveCoordinate({ profile: 3, label })
      label[7] = 2
      ready({ derive: async request => {
        const bytes = Uint8Array.from(atob(JSON.parse(request).label), c => c.charCodeAt(0))
        return JSON.stringify({ kind: 'index', index: new DataView(bytes.buffer).getBigUint64(0, false).toString() })
      } })
      expect(await Promise.all([zero, one])).toEqual([{ kind: 'index', index: 0n }, { kind: 'index', index: 1n }])
    } finally { load.mockRestore() }
  })
  it('rejects malformed Core replies and unsupported profiles', async () => {
    for (const response of [{kind:'index',index:42},{kind:'index',index:'01'},{kind:'index',index:'18446744073709551616'},{kind:'key',key:'AA=='},{error:'unsupported profile'}]) {
      await expect(deriveCoordinate({profile:3,label:new Uint8Array(8),provider:{derive:async()=>JSON.stringify(response)}})).rejects.toThrow()
    }
  })
})
