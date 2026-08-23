export interface MaltWasmAssetVersions {
  readonly verifier: string
  readonly writer: string
}

export declare const wasmAssetSetFiles: Readonly<Record<'verifier' | 'writer', readonly string[]>>
export declare function maltWasmAssetsDirectory(): string
export declare function resolveWasmAssetVersions(publicDirectory?: string): Readonly<MaltWasmAssetVersions>
export declare function versionWasmAssetSets(outputDirectory: string, versions: MaltWasmAssetVersions): void
export declare function versionedWasmAssetsPlugin(options?: { publicDirectory?: string }): object
