export type MaltBackend = 'kzg' | 'ipa'
export type IPAWriterProfile = 'direct' | 'compact' | 'fast'
export type IPAWriterPreference = 'auto' | IPAWriterProfile

export interface BrowserWriterCapabilities {
  readonly hardwareConcurrency: number
  readonly deviceMemory: number
  readonly low: boolean
  readonly high: boolean
}

export interface WriterStatus {
  readonly backend: MaltBackend
  readonly state: string
  readonly profile: '' | IPAWriterProfile
  readonly error?: string
  readonly phase?: string
  readonly elapsedMs?: number
}

export interface BrowserMaltWriterOptions {
  baseURL?: string | URL
  browserOrigin?: string
  navigator?: Pick<Navigator, 'hardwareConcurrency'> & { deviceMemory?: number }
  ipaPreference?: IPAWriterPreference
  beforeWorkerStart?: (target: { backend: MaltBackend; profile: string; signal: AbortSignal }) => void | Promise<void>
  onStatus?: (status: WriterStatus) => void
  importController?: (url: string) => Promise<unknown>
}

export declare const defaultIPAWriterPreference: 'auto'
export declare function browserWriterCapabilities(navigator?: BrowserMaltWriterOptions['navigator']): Readonly<BrowserWriterCapabilities>
export declare function selectIPAWriterProfile(options?: {
  preference?: IPAWriterPreference
  navigator?: BrowserMaltWriterOptions['navigator']
}): IPAWriterProfile
export declare function browserWriterAssetURLs(baseURL?: string | URL, browserOrigin?: string): Readonly<{
  controller: string
  wasm: Readonly<{ kzg: string; ipa: Readonly<Record<IPAWriterProfile, string>> }>
  wasmExec: string
  worker: string
}>

export declare class BrowserMaltWriterRouter {
  constructor(options: Record<string, unknown>)
  status(backend: MaltBackend): WriterStatus
  whenReady(backend: MaltBackend): Promise<unknown>
  /** Compute a complete typed ArcSet candidate; never publishes or accepts it. */
  prepareAuthentication(backend: MaltBackend, stateJSON: Uint8Array): Promise<string>
  /** Verify the complete base and reuse unaffected authentication paths. */
  updateAuthentication(backend: MaltBackend, candidateJSON: Uint8Array, stateJSON: Uint8Array): Promise<string>
  compute(backend: MaltBackend, operationID: Uint8Array, updateViewJSON: Uint8Array, semanticIntentJSON: Uint8Array): Promise<string>
  bootstrap(backend: MaltBackend): Promise<string>
  load(backend: MaltBackend, updateViewJSON: Uint8Array): Promise<string>
  snapshot(backend: MaltBackend, checkpointKey: Uint8Array): Promise<string>
  restore(backend: MaltBackend, snapshotJSON: Uint8Array, checkpointKey: Uint8Array): Promise<string>
  prepare(backend: MaltBackend, operationID: Uint8Array, semanticIntentJSON: Uint8Array): Promise<string>
  getPreparedResult(backend: MaltBackend, operationID: Uint8Array): Promise<string>
  validateReceipt(backend: MaltBackend, writerResultJSON: Uint8Array, materializationReceiptJSON: Uint8Array): Promise<string>
  acceptReceipt(backend: MaltBackend, operationID: Uint8Array, materializationReceiptJSON: Uint8Array): Promise<string>
  discard(backend: MaltBackend, operationID: Uint8Array): Promise<string>
  closeSession(backend: MaltBackend): Promise<void>
  terminateBackend(backend: MaltBackend): void
  terminateAll(): void
  terminate(): void
}

export declare function createBrowserMaltWriter(options?: BrowserMaltWriterOptions): Promise<BrowserMaltWriterRouter>
