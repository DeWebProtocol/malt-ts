// Simulate only runtime startup and routing. Cryptographic acceptance is
// exercised separately by the release-bound WASM conformance suite.
globalThis.Go = class {
  importObject = {}
  run() {
    globalThis.maltVerifierLoadedBackend = 'all'
    globalThis.maltVerifyResolve = () => '{"profile":"malt.resolve/v0alpha1","valid":true}'
    globalThis.maltVerifyRead = () => '{"profile":"malt.read/v0alpha1","valid":true}'
    globalThis.maltVerifyMapProof = () => '{"profile":"malt.map-proof/v0alpha1","valid":true}'
    globalThis.maltVerifyAuthentication = () => '{"profile":"malt.authentication/0","valid":true}'
    return new Promise(() => {})
  }
}
