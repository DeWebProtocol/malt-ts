# MALT TypeScript SDK

`@dewebprotocol/malt` is the supported TypeScript/JavaScript boundary for
running the MALT verifier and client-root writer in browsers. It packages a
stable API, type declarations, Worker lifecycle management, reproducible WASM
assets, and Vite integration.

MALT Core remains the normative implementation and protocol source of truth.
This repository does not implement commitments, ProofLists, CID rules, or
writer semantics independently in TypeScript.

## Version and Core release

The package is currently `0.0.2-rc.2` and is built against the published
`malt-core v0.0.9-rc.2` release at commit
`ccae498e29a323eb003b74fb12aa23b87bd13832`.
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

The distributed verifier and writer assets are rebuilt from this package's ABI
wrappers against the exact published Core `v0.0.9-rc.2` release. The verifier
executes typed authentication through `maltVerifyAuthentication`; the internal
writer ABI also supports `maltPrepareAuthentication`. Release provenance binds
both exports. These assets use Core's v3 transaction-ID corpus; historical v1/v2 corpus
bytes remain archived in Core.

`make audit-core-release` verifies the canonical tag and published release
manifest, and `make test-wasm` validates both legacy and typed contracts. The
package version `0.0.2-rc.2` is independent of the locked Core version.
Root V stays zero throughout that process; a package release does not declare
production readiness. Core's Root/input specification remains normative.

### Typed ArcSet writer candidates

`writer.prepareAuthentication(backend, stateJSON)` creates a complete typed
candidate. `writer.updateAuthentication(backend, candidateJSON, stateJSON)`
verifies the base and applies the Core typed writer. Inputs are UTF-8 JSON
`Uint8Array`s; returned JSON follows Core's authentication candidate schema.
Candidates neither publish nor accept Roots. The request-selected
`malt.authentication/1` verifier profile also supports proven early path absence.

The distributed assets include these writer APIs and bind the exact published
Core release in `malt-core.lock.json`. Development builds must preserve this
release provenance; temporary builds are not substitutes for the distribution.

### Transaction identity

Writer methods take `transactionID` bytes. The current Core contract uses
`TransactionID` in Go and `transaction_id` in bundle/receipt JSON, with bundle
and receipt profiles `/v2` and writer result profile `/v3`. Old operation-ID
fields and result profiles are rejected rather than translated. Candidate
computation and receipt acceptance do not publish an application head or grant
client trust. Conformance and distributed assets use the v3 client-root corpus, with an exact
published Core lock and matching checksums.
