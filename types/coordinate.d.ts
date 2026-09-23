/** Canonical base64 label for a Direct uint64 coordinate. */
export declare function encodeIndexLabel(index: bigint | number | string): string
/** Canonical base64 label for a Direct 32-byte coordinate. */
export declare function encodeKeyLabel(key: Uint8Array): string

export type Coordinate = { kind: 'key'; key: Uint8Array } | { kind: 'index'; index: bigint }
export declare function deriveCoordinate(options: import('./verifier.js').VerifierLoadOptions & {
 profile: number; label: Uint8Array; provider?: import('./verifier.js').BrowserVerifierProvider
}): Promise<Coordinate>
