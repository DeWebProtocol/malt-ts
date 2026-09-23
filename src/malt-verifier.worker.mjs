let initialization
let runtimeFailure

globalThis.addEventListener('message', (event) => {
  const message = event.data
  if (!message || typeof message !== 'object') return
  if (message.type === 'init') {
    if (initialization) {
      postFailure('init-error', 'local verifier worker was initialized more than once')
      return
    }
    initialization = initialize(message)
    void initialization
      .then(() => {
        globalThis.postMessage({
          type: 'ready',
          backend: globalThis.maltVerifierLoadedBackend
        })
      })
      .catch((err) => {
        postFailure('init-error', errorMessage(err))
      })
    return
  }
  if (message.type === 'verify') {
    void verify(message)
  }
})

async function initialize({ backend, runtimeURL, wasmURL, wasmModule, wasmBytes }) {
  if (backend !== 'all') {
    throw new Error(`unsupported worker verifier backend ${JSON.stringify(backend)}`)
  }
  globalThis.maltVerifierBackend = backend
  await import(/* @vite-ignore */ runtimeURL)
  if (typeof globalThis.Go !== 'function') {
    throw new Error(`${runtimeURL} did not register the Go WebAssembly runtime`)
  }

  const go = new globalThis.Go()
  const instantiated = await instantiateVerifierWASM({ wasmURL, wasmModule, wasmBytes }, go.importObject)
  void go.run(instantiated.instance).catch((err) => {
    runtimeFailure = errorMessage(err)
    postFailure('runtime-error', runtimeFailure)
  })
  await waitForProvider()
}

async function instantiateVerifierWASM({ wasmURL, wasmModule, wasmBytes }, importObject) {
  if (isWASMModule(wasmModule)) {
    return {
      instance: await WebAssembly.instantiate(wasmModule, importObject)
    }
  }
  if (wasmBytes instanceof ArrayBuffer) {
    const instantiated = await WebAssembly.instantiate(wasmBytes, importObject)
    return { instance: instantiated.instance }
  }
  if (!String(wasmURL || '').trim()) {
    throw new Error('local verifier Worker did not receive a WASM asset')
  }
  const response = await fetch(wasmURL)
  if (!response.ok) {
    throw new Error(`local verifier WASM request failed (${response.status})`)
  }
  const fallbackResponse = response.clone()
  try {
    const instantiated = await WebAssembly.instantiateStreaming(response, importObject)
    return { instance: instantiated.instance }
  } catch {
    const bytes = await fallbackResponse.arrayBuffer()
    const instantiated = await WebAssembly.instantiate(bytes, importObject)
    return { instance: instantiated.instance }
  }
}

function isWASMModule(value) {
  return typeof WebAssembly?.Module === 'function' && value instanceof WebAssembly.Module
}

async function verify({ id, kind, json }) {
  try {
    if (!initialization) throw new Error('local verifier worker is not initialized')
    await initialization
    if (runtimeFailure) throw new Error(`local verifier runtime failed: ${runtimeFailure}`)
    if (!Number.isSafeInteger(id) || id < 1) throw new Error('invalid verifier request ID')
    if (typeof json !== 'string') throw new Error('local verifier request is not JSON text')
    const fn = selectVerifier(kind)
    globalThis.postMessage({ type: 'result', id, result: fn(json) })
  } catch (err) {
    globalThis.postMessage({
      type: 'result',
      id,
      error: errorMessage(err)
    })
  }
}

function selectVerifier(kind) {
  switch (kind) {
    case 'derive':
      return (json) => { const { profile, label } = JSON.parse(json); return globalThis.maltDeriveCoordinate(profile, Uint8Array.from(atob(label), (c) => c.charCodeAt(0))) }
    case 'authentication':
      return globalThis.maltVerifyAuthentication
    default:
      throw new Error(`unsupported local verifier operation ${JSON.stringify(kind)}`)
  }
}

async function waitForProvider() {
  const deadline = Date.now() + 120_000
  while (!globalThis.maltVerifierReady) {
    if (runtimeFailure) throw new Error(`Go WASM runtime failed: ${runtimeFailure}`)
    if (globalThis.maltVerifierInitError) {
      throw new Error(`local verifier initialization failed: ${globalThis.maltVerifierInitError}`)
    }
    if (Date.now() >= deadline) throw new Error('local verifier initialization timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  for (const name of ['maltVerifyAuthentication', 'maltDeriveCoordinate']) {
    if (typeof globalThis[name] !== 'function') throw new Error(`local verifier did not register ${name}`)
  }

  if (globalThis.maltVerifierInitError) {
    throw new Error(`local verifier initialization failed: ${globalThis.maltVerifierInitError}`)
  }
}

function postFailure(type, error) {
  globalThis.postMessage({ type, error: String(error || 'unknown local verifier failure') })
}

function errorMessage(err) {
  return err instanceof Error ? err.message : String(err)
}
