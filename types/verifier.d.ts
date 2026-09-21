export type JSONRecord = Record<string, unknown>

export interface VerificationResult extends JSONRecord {
  profile: string
  valid: boolean
  source: 'local-wasm'
  error?: string
}

export interface BrowserVerifierProvider {
  authentication(json: string, signal?: AbortSignal): Promise<string>
  terminate(): void
}

export interface VerifierLease {}

export interface VerifierLoadOptions {
  runtimeURL?: string | URL
  wasmURL?: string | URL
  signal?: AbortSignal
  beforeWorkerStart?: () => void | Promise<void>
  channel?: string
  lease?: VerifierLease
}

export interface LocalVerificationOptions {
  request: JSONRecord
  result: JSONRecord
  runtimeURL?: string | URL
  wasmURL?: string | URL
  signal?: AbortSignal
  provider?: BrowserVerifierProvider
}

export declare const defaultVerifierRuntimeURL: string
export declare const defaultVerifierWASMURL: string

export declare function createBrowserVerifierLease(): VerifierLease
export declare function loadBrowserVerifier(options?: VerifierLoadOptions): Promise<BrowserVerifierProvider>
export declare function releaseBrowserVerifier(lease: VerifierLease): void

/** uint64 decimal strings and base64 bytes follow the normative Core schema. */
export type AuthenticationInput =
  | { kind: 'index'; number: string }
  | { kind: 'system'; number: string }
  | { kind: 'key'; data: string }
  | { kind: 'label'; data: string }
export interface AuthenticationRequest extends JSONRecord {
  profile: 'malt.authentication/1'
  root: string
  steps?: AuthenticationInput[] | null
  operation: 'resolve' | 'binding' | 'range'
  input?: AuthenticationInput
  start?: string
  end?: string
}
export declare const authenticationPathVerifierProfile: 'malt.authentication/1'
export declare function createAuthenticationVerification(options: {
  request: AuthenticationRequest; result: JSONRecord
}): JSONRecord
export declare function verifyAuthenticationLocally(options: Omit<LocalVerificationOptions, 'request'> & {
  request: AuthenticationRequest
}): Promise<VerificationResult>
