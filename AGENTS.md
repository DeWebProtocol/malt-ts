# AGENTS.md

## Scope

This repository owns the stable TypeScript/JavaScript distribution of MALT:
public browser APIs, type declarations, Worker lifecycle, reproducible browser
WASM packaging, npm documentation, and bundler integration.

Also follow the workspace guide at `../AGENTS.md` when this checkout is part of
the combined MALT workspace.

## Boundaries

- `DeWebProtocol/malt-core` remains the normative source of truth for protocol,
  proof, CID, schema, commitment, and writer semantics. Do not reimplement
  those semantics in TypeScript.
- Build only from the exact published Core release recorded in
  `malt-core.lock.json`. Never resolve `main`, `HEAD`, `latest`, a branch, or a
  floating module version for a release build.
- Keep the raw Go/WASM global ABI internal. The supported consumer contract is
  the package export surface and its TypeScript declarations.
- Do not add Gateway HTTP, account, Bucket, authorization, deployment,
  trusted-root, UnixFS, or product cache policy here.
- Preserve fail-closed verification against a caller-selected root and query.
  Writer results are candidates, not publication, freshness, or trust proofs.

## Versioning

- Keep this repository on `v0.0.x` while MALT Core remains below `v0.1.0`.
- Package SemVer is independent from Core SemVer. Every package release must
  expose and validate its exact Core release binding.
- A Core release update should arrive as a reviewed lock-file change and pass
  conformance before a package release. It must not publish automatically from
  a mutable latest-version lookup.

## Validation

- Run `npm test`, `npm run typecheck`, and `npm run check:assets` for package
  changes.
- Run `make audit-core-release` when changing or validating the Core lock; it
  must verify both the remote tag and the published GitHub Release manifest.
- Run `make test-wasm` for Go/WASM ABI or asset changes. On the shared 8-CPU
  host, use the workspace resource-limited transient scope for this heavy
  workload.
- Verify `npm pack --dry-run` before publishing. Publishing an npm version,
  Git tag, or GitHub Release is a separate action from committing source.
