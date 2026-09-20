# MALT TypeScript SDK

`@dewebprotocol/malt` is the supported TypeScript/JavaScript boundary for
running the MALT authentication verifier and writer in browsers. It packages a
stable API, type declarations, Worker lifecycle management, reproducible WASM
assets, and Vite integration.

MALT Core remains the normative implementation and protocol source of truth.
This repository does not implement commitments, ProofLists, CID rules, or
writer semantics independently in TypeScript.

## Version and Core release

The package asset binding is `0.0.2-rc.3`, built against the published
`malt-core v0.0.9-rc.3` release at commit
`a4526f8751db403eaa2e1a7ac6add00b70ff2933`.
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
  verifyAuthenticationLocally
} from '@dewebprotocol/malt'

const lease = createBrowserVerifierLease()
const verifier = await loadBrowserVerifier({
  lease,
  runtimeURL: '/verifier/<asset-set>/wasm_exec.js',
  wasmURL: '/verifier/<asset-set>/malt-verifier.wasm'
})

const checked = await verifyAuthenticationLocally({ request, result, provider: verifier })
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


## Authentication API

`verifyAuthenticationLocally({request, result, ...options})` verifies the
caller-selected Root, typed steps and binding/range operation through Core.
`malt.authentication/1` also authenticates early path absence. Typed inputs
preserve base64 bytes and decimal uint64 strings; JavaScript performs no
input hashing or application path normalization.

`prepareAuthentication(backend, stateJSON)` builds a complete candidate.
`updateAuthentication(backend, candidateJSON, stateJSON)` verifies a complete
base and applies the current Core writer. Inputs are UTF-8 JSON `Uint8Array`s;
returned JSON follows Core's authentication candidate schema.

### Retained writers

`createAuthentication` and `importAuthentication` return JSON `{handle, root}`.
Handles are opaque identities bound to this router, backend and Worker.
`importAuthentication` transfers a candidate's complete ArrayBuffer when
possible; pass a copy if the caller needs those bytes afterwards.

`applyAuthentication` takes a handle and a `malt.authentication-delta/0`
change set. It returns a new independent handle and leaves its base usable.
`exportAuthentication` explicitly exports a complete candidate. Retained
updates do not resend or export the complete base.

```ts
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const handleBytes = (handle: string) => new TextEncoder().encode(handle)
const base = JSON.parse(await writer.createAuthentication('kzg', encode(state)))
const next = JSON.parse(await writer.applyAuthentication('kzg', handleBytes(base.handle), encode({
  profile: 'malt.authentication-delta/0',
  changes: [{ input: { kind: 'index', number: '0' }, before: oldCID, after: newCID }]
})))
const candidate = JSON.parse(await writer.exportAuthentication('kzg', handleBytes(next.handle)))
await writer.discardAuthentication('kzg', handleBytes(base.handle))
await writer.closeAuthentication('kzg')
```

Discard, close and Worker termination invalidate the associated handles.
Pending operations reserve their backend, and retained state prevents backend
switches until explicitly closed. Fatal runtime loss retires the Worker and
cancels pending operations; a subsequent request creates a new generation.

### Materialization batches and receipts

`validateAuthenticationBatch(backend, batchJSON)` verifies all candidates and
returns Core's digest of the exact `malt.authentication-batch/0` batch.
Candidates appear before parents and lineage successors. A bootstrap batch
includes its newly constructed base.

`validateAuthenticationReceipt(backend, batchJSON, receiptJSON)` checks the
`malt.authentication-receipt/0` transaction ID, base, final Root, digest and
durable boundary. It returns the final Root without modifying retained state.
Receipts acknowledge persistence; they neither prove a portable state
transition nor publish a head or grant client trust. Applications own durable
journals, snapshots, transport and publication.

### Source integration and release adoption

The current source removes Map/List, Resolve/Read, client-root, update-view and
session snapshot compatibility APIs. Worker readiness requires the complete
current ABI. There are no forwarding aliases or optional old-runtime exports.

The existing `malt-core.lock.json` and published binary assets still identify
Core `v0.0.9-rc.3`. Adopting the new host and batch APIs requires a separately
reviewed, published Core release, followed by a lock update and reproducible
asset rebuild. Source integration does not rewrite that provenance.

Validate both source checkouts under the workspace CPU scope:

```bash
./scripts/test-core-source.sh /absolute/path/to/core-checkout /tmp/malt-ts-source-wasm
```

The output directory must be new and empty. The script creates a temporary
Go workspace, builds outside `assets/`, checks backend isolation, runs typed
Core conformance and retained-writer/batch tests for all committer profiles,
and exercises the real browser router against a Worker. These are development
artifacts, separate from a package release. `make test-wasm` applies the same
current contracts to the exact release selected by the lock.
