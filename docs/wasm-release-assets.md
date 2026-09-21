# WASM release assets

Malt-ts is the sole publisher of the supported MALT browser WASM ABI, Worker
runtime, and TypeScript API. Core publishes Go source, protocol rules, and a
portable conformance corpus. A Core release need not contain browser binaries.

## Source binding

`malt-core.lock.json` uses `malt.ts-core-lock/v2` and binds an exact published
Core version, source commit, module checksum, and go.mod checksum. Builds reject
module replacements, floating versions, conflicting origin metadata, and
checksum mismatches. `make audit-core-release` checks the canonical remote tag
against the locked commit and requires a matching non-draft GitHub Release.
It does not download a Core WASM manifest or archive.

Each asset set contains `PROVENANCE.json` and `SHA256SUMS`. Provenance binds
the exact Core source dependency, malt-ts build-input digest, Go toolchain,
sealed build environment, target, and required ABI exports. The writer also
binds the IPA parameter fingerprint, backend/profile artifacts, and Worker
invariants. Asset checks reject mixed files, stale source digests, altered
parameters, missing exports, and rehashed but inconsistent provenance.

## Reproducible archives

Run sequentially under the workspace resource limits, from clean source:

```bash
make audit-core-release
make test-wasm
make test-wasm-release
npm pack --dry-run
```

The archive builder snapshots the exact malt-ts Git commit, derives its
release version from `package.json`, rebuilds through `scripts/build-wasm.sh`,
and verifies the assets before packaging them. If a tag with that package
version already exists, it must select the same commit. The output directory
must be empty. Building archives does not publish npm, create tags, or publish
a GitHub Release.

`dist/wasm-release` contains exactly two component archives, one
`malt-wasm-release-<package-tag>-<manifest-sha256>.json`, and `SHA256SUMS`.
The manifest schema is `malt.ts-wasm-release/v1`; it binds the malt-ts source
commit, package version, build inputs, Core source identity, portable corpus
digest, and each component's asset-set and archive-byte SHA-256 values.

Archives contain `verifier/<asset-set-sha256>/` or
`writer/<asset-set-sha256>/`. The asset-set digest hashes that component's
`SHA256SUMS`. Archive names bind both this digest and the digest of the complete
compressed archive. Ustar ordering, metadata, timestamps, ownership, modes,
padding, and gzip headers are normalized and checked at the byte level.
Adversarial tests rehash malformed archives and require the checker to reject
them rather than trusting a self-consistent outer checksum.

Archive verification is relative to the checked-out malt-ts commit, its
package version, source-input digest, and Core lock. Formal releases must use
the final merged commit and publish every emitted artifact without changes.
Historical Core-owned manifests retain their original schema and meaning;
this publisher does not accept or relabel them.
