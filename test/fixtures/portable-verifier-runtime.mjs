// Simulate only runtime startup and routing. Cryptographic acceptance is
// exercised separately by the release-bound WASM conformance suite.
globalThis.Go = class {
  importObject = {}
  run() {
    globalThis.maltVerifierLoadedBackend = 'all'
    globalThis.maltVerifyAuthentication = () => '{"profile":"malt.authentication/1","valid":true}'
    globalThis.maltVerifierReady = true
    return new Promise(() => {})
  }
}
