import { loadBrowserVerifier } from './verifier.mjs'
// Label serialization helpers. Coordinate derivation itself executes in Core/WASM.
const base64 = (bytes) => btoa(String.fromCharCode(...bytes))

/** Encode a uint64 as the canonical eight-byte big-endian Direct label. */
export function encodeIndexLabel(index) {
 if (typeof index === 'number' && !Number.isSafeInteger(index)) throw new TypeError('index number must be a safe integer; use bigint or a decimal string')
 if (typeof index !== 'number' && typeof index !== 'bigint' && !(typeof index === 'string' && /^(0|[1-9][0-9]*)$/.test(index))) throw new TypeError('index must be an unsigned integer')
 const value = BigInt(index)
 if (value < 0n || value > 0xffffffffffffffffn) throw new RangeError('index exceeds uint64')
 const bytes = new Uint8Array(8)
 new DataView(bytes.buffer).setBigUint64(0, value, false)
 return base64(bytes)
}

/** Encode a precomputed 32-byte key as a Direct label. */
export function encodeKeyLabel(key) {
 if (!(key instanceof Uint8Array) || key.byteLength !== 32) throw new TypeError('key must contain exactly 32 bytes')
 return base64(key)
}

/** Execute the selected public derivation profile in the locked Core/WASM. */
export async function deriveCoordinate({ profile, label, provider, signal, ...loadOptions }) {
 if (!(label instanceof Uint8Array)) throw new TypeError('label must be Uint8Array')
 if (!Number.isInteger(profile) || profile < 0 || profile > 255) throw new TypeError('invalid derivation profile ID')
 let encoded = ''
 for (let i=0;i<label.length;i+=8192) encoded += String.fromCharCode(...label.subarray(i,i+8192))
 const request = JSON.stringify({profile,label:btoa(encoded)})
 const verifier = provider || await loadBrowserVerifier({ ...loadOptions, signal })
 const result = JSON.parse(await verifier.derive(request,signal))
 if (result?.error) throw new Error(result.error)
 if (result?.kind === 'index' && typeof result.index === 'string' && /^(0|[1-9][0-9]*)$/.test(result.index) && BigInt(result.index) <= 0xffffffffffffffffn) return {kind:'index', index:BigInt(result.index)}
 if (result?.kind === 'key' && typeof result.key === 'string') {
  const key = Uint8Array.from(atob(result.key), (c)=>c.charCodeAt(0))
  if (key.length === 32 && btoa(String.fromCharCode(...key)) === result.key) return {kind:'key',key}
 }
 throw new Error('invalid coordinate returned by Core/WASM')
}
