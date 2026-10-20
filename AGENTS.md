# AGENTS.md

## Scope

This repository owns the stable TypeScript/JavaScript distribution of MALT:
public browser APIs, type declarations, Worker lifecycle, reproducible browser
WASM packaging, npm documentation, and bundler integration.

This is the sole owner of Go/WASM entrypoints, compilation, browser conformance
runners, and WASM release archives. Core provides the Go SDK and portable test
vectors; do not depend on Core-owned WASM commands, scripts, or release assets.

Also follow the workspace guide at `../AGENTS.md` when this checkout is part of
the combined MALT workspace.

## Boundaries

- `DeWebProtocol/malt-core` remains the normative source of truth for protocol,
  proof, CID, schema, commitment, and writer semantics. Do not reimplement
  those semantics in TypeScript.
- Build distributable assets only from the exact published Core release
  recorded in `malt-core.lock.json`. Never resolve `main`, `HEAD`, `latest`,
  a branch, or a floating module version for a release build.
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

- This repository may be a standalone checkout or a pinned submodule of
  `malt-integration`. In the latter case, also read the integration root's
  `AGENTS.md`. Keep malt-ts outside its native `go.work`; its Git link selects
  the package source, while `malt-core.lock.json` selects the published Core.
- Set `GOWORK=off` for locked package build, verification, and release
  commands, including npm or Make commands that launch Go. An ancestor
  workspace must not substitute local Core source for the locked release.
- For explicit development Core/WASM compatibility, use
  `./scripts/test-core-source.sh /absolute/path/to/core-checkout` under the
  shared host's resource limits. It creates a separate temporary workspace
  and writes non-release artifacts outside `assets/`. Record the selected
  Core and malt-ts HEADs and dirty states; do not publish those artifacts or
  change the published-Core lock/provenance for this diagnostic.
- Run `npm test`, `npm run typecheck`, and `npm run check:assets` for package
  changes.
- Run `make audit-core-release` when changing or validating the Core lock; it
  must verify the exact remote tag, Go module checksums, and a published
  non-draft GitHub Release. Core is a source dependency, not a WASM publisher.
- Run `make test-wasm` for Go/WASM ABI or asset changes. On the shared 8-CPU
  host, use the workspace resource-limited transient scope for this heavy
  workload.
- Verify `npm pack --dry-run` before publishing. Publishing an npm version,
  Git tag, or GitHub Release is a separate action from committing source.
- Documentation-only changes require relevant content checks and
  `git diff --check`, not package or WASM suites. Passing the integration
  repository's Go checks does not validate this package's browser/WASM assets
  or release provenance.
- Create a topic branch before editing a detached submodule. Push and review
  package changes in this repository before a separate integration pin update;
  keep Core lock updates and Gateway Console package-lock updates explicit in
  their owning repositories.
