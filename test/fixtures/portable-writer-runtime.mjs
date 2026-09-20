// Startup-only fixture; real Core conformance checks cryptographic behavior.
const exports = [
  'maltComputeClientRootV1', 'maltWriterBootstrapSessionV1', 'maltWriterLoadSessionV1',
  'maltWriterSnapshotSessionV1', 'maltWriterRestoreSessionV1', 'maltWriterPrepareSessionV1',
  'maltWriterGetPreparedResultV1', 'maltWriterValidateReceiptV1',
  'maltWriterAcceptSessionReceiptV1', 'maltWriterDiscardSessionCandidateV1',
  'maltWriterCloseSessionV1', 'maltPrepareAuthentication', 'maltUpdateAuthentication',
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
