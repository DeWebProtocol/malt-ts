import './portable-verifier-runtime.mjs'
const CompleteRuntime = globalThis.Go
globalThis.Go = class extends CompleteRuntime {
  run(...args) {
    const running = super.run(...args)
    delete globalThis.maltVerifyAuthentication
    return running
  }
}
