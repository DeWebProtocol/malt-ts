export type JSONRecord = Record<string, unknown>

export interface VerificationResult extends JSONRecord {
  profile: string
  valid: boolean
  source: 'local-wasm'
  error?: string
}

export interface BrowserVerifierProvider {
  resolve(json: string, signal?: AbortSignal): Promise<string>
  read(json: string, signal?: AbortSignal): Promise<string>
  mapProof(json: string, signal?: AbortSignal): Promise<string>
  artifact(json: string, signal?: AbortSignal): Promise<string>
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

export declare const resolveVerifierProfile: 'malt.resolve/v0alpha1'
export declare const readVerifierProfile: 'malt.read/v0alpha1'
export declare const mapProofVerifierProfile: 'malt.map-proof/v0alpha1'
export declare const defaultVerifierRuntimeURL: string
export declare const defaultVerifierWASMURL: string

export declare function verifyResolveLocally(options: LocalVerificationOptions): Promise<VerificationResult>
export declare function verifyReadLocally(options: LocalVerificationOptions): Promise<VerificationResult>
export declare function verifyMapProofLocally(options: LocalVerificationOptions): Promise<VerificationResult>
export declare function verifyContentProofLocally(options: {
  proofList: JSONRecord
  expectedRoot: string
  expectedPath?: string
  runtimeURL?: string | URL
  wasmURL?: string | URL
  signal?: AbortSignal
  provider?: BrowserVerifierProvider
}): Promise<VerificationResult & { resolve?: VerificationResult; reads?: VerificationResult[] }>
export declare function createResolveVerification(options: Pick<LocalVerificationOptions, 'request' | 'result'>): JSONRecord
export declare function createReadVerification(options: Pick<LocalVerificationOptions, 'request' | 'result'>): JSONRecord
export declare function createMapProofVerification(options: Pick<LocalVerificationOptions, 'request' | 'result'>): JSONRecord
export declare function resolveVerificationFromProofList(options: {
  proofList: JSONRecord
  root: string
  path?: string
  payload?: boolean | 'auto'
}): { request: JSONRecord; result: JSONRecord }
export declare function readVerificationsFromProofList(proofList: JSONRecord): Array<{ request: JSONRecord; result: JSONRecord }>
export declare function createBrowserVerifierLease(): VerifierLease
export declare function loadBrowserVerifier(options?: VerifierLoadOptions): Promise<BrowserVerifierProvider>
export declare function releaseBrowserVerifier(lease: VerifierLease): void
