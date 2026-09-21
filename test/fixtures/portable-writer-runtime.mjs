// Startup-only fixture; real Core conformance checks cryptographic behavior.
const exports = [
  'maltValidateAuthenticationBatch', 'maltValidateAuthenticationReceipt',
  'maltPrepareAuthentication', 'maltUpdateAuthentication',
  'maltCreateAuthentication', 'maltImportAuthentication', 'maltApplyAuthentication',
  'maltExportAuthentication', 'maltDiscardAuthentication', 'maltCloseAuthentication'
]
globalThis.Go = class {
  importObject = {}
  run() {
    globalThis.maltWriterLoadedBackend = 'kzg'
    globalThis.maltWriterLoadedProfile = ''
    for (const name of exports) {
      if (name !== globalThis.writerFixtureMissingExport) globalThis[name] = async () => '{}'
    }
    globalThis.maltWriterReady = true
    return new Promise(() => {})
  }
}
