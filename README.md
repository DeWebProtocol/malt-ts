# MALT TypeScript SDK

`@dewebprotocol/malt` is the supported TypeScript/JavaScript boundary for
running the MALT verifier and client-root writer in browsers. It packages a
stable API, type declarations, Worker lifecycle management, reproducible WASM
assets, and Vite integration.

MALT Core remains the normative implementation and protocol source of truth.
This repository does not implement commitments, ProofLists, CID rules, or
writer semantics independently in TypeScript.

## Version and Core release

The package is currently `0.0.1` and is built against the published
`malt-core v0.0.8` release at commit
`6c55430d39d17a4b4e633dbdc5915977cef8755d`.
[`malt-core.lock.json`](./malt-core.lock.json) binds that tag, commit, Go module
checksums, formal Core WASM release manifest, and Core asset-set digests.

Release builds must never resolve a mutable Core branch or `latest` alias. A
new Core release is adopted through a lock-file change and conformance run
before a new npm package is published. Package versions remain `v0.0.x` until
MALT Core publishes `v0.1.0`.

## Browser API

```ts
import {
  createBrowserMaltWriter,
  createBrowserVerifierLease,
  loadBrowserVerifier,
  releaseBrowserVerifier,
  verifyResolveLocally
} from '@dewebprotocol/malt'

const lease = createBrowserVerifierLease()
const verifier = await loadBrowserVerifier({
  lease,
  runtimeURL: '/verifier/<asset-set>/wasm_exec.js',
  wasmURL: '/verifier/<asset-set>/malt-verifier.wasm'
})

const checked = await verifyResolveLocally({ request, result, provider: verifier })
if (!checked.valid) throw new Error(checked.error || 'MALT verification failed')
releaseBrowserVerifier(lease)

const writer = await createBrowserMaltWriter({
  baseURL: '/writer/<asset-set>/'
})
```

All Gateway results remain untrusted until verified against a root and query
selected by the caller. Writer results are candidates; this package does not
publish or promote trusted roots.

## Vite assets

The package contains coordinated verifier and writer asset sets. Consumers can
serve them from digest-versioned same-origin paths with the included plugin:

```js
import {
  maltWasmAssetsDirectory,
  versionedWasmAssetsPlugin
} from '@dewebprotocol/malt/vite'

export default {
  publicDir: maltWasmAssetsDirectory(),
  plugins: [versionedWasmAssetsPlugin()]
}
```

Only the resulting full SHA-256 paths are suitable for immutable HTTP caching.
The package does not download executable assets during `postinstall`.

## Development

```bash
npm ci
npm test
npm run typecheck
npm run check:assets
```

For a Core release or Go/WASM ABI update, run the resource-limited workspace
equivalent of:

```bash
make audit-core-release
make test-wasm
npm pack --dry-run
```

Publishing an npm version, Git tag, or GitHub Release is intentionally separate
from committing source.


## Experimental typed authentication bridge

`verifyAuthenticationLocally({request, result, ...options})` forwards the
`malt.authentication/0` contract to Core/WASM. Typed inputs preserve opaque
base64 bytes and decimal uint64 strings; this package performs no AA hashing
or application path normalization. An unavailable ABI fails closed.

The current distributed assets remain locked to published Core v0.0.8 and do
**not** execute this new profile. Source integration can use the new Core
verifier WASM through explicitly configured `wasmURL` and `runtimeURL`, with
the same artifact verification policy as other custom verifier assets. This
source change does not publish or relabel those experimental Core builds.
Official adoption requires a published Core release, a reviewed exact lock
update, porting its new verifier/writer ABI entry points into this package,
regenerated assets and full release conformance before Console rollout.
Root V stays zero throughout that process; a package release does not declare
production readiness. Core's Root/input specification remains normative.
