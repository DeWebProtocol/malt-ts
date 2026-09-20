#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verifier_root="${1:-${repo_root}/assets/verifier}"
provenance_path="${verifier_root}/PROVENANCE.json"

for command_name in node sha256sum; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r malt_version malt_commit malt_module_dir malt_module_sum malt_go_mod_sum \
	<<<"${pin}"
build_inputs_sha256="$("${repo_root}/scripts/build-wasm.sh" --print-source-digest)"
if [[ -z "${malt_version}" || ! "${malt_commit}" =~ ^[0-9a-f]{40}$ || \
	! -d "${malt_module_dir}" || ! "${malt_module_sum}" =~ ^h1: || \
	! "${malt_go_mod_sum}" =~ ^h1: || \
	! "${build_inputs_sha256}" =~ ^[0-9a-f]{64}$ ]]; then
	printf 'unable to resolve malt-ts verifier build provenance\n' >&2
	exit 1
fi

PROVENANCE_PATH="${provenance_path}" \
VERIFIER_ROOT="${verifier_root}" \
BUILD_INPUTS_SHA256="${build_inputs_sha256}" \
MALT_VERSION="${malt_version}" MALT_COMMIT="${malt_commit}" \
MALT_SUM="${malt_module_sum}" MALT_GO_MOD_SUM="${malt_go_mod_sum}" \
	node -e '
	const fs = require("node:fs")
	const path = require("node:path")
	const root = process.env.VERIFIER_ROOT
	const expectedEntries = [
		"PROVENANCE.json", "SHA256SUMS", "malt-verifier.wasm", "wasm_exec.js"
	]
	const entries = fs.readdirSync(root, {withFileTypes: true})
		.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
	if (entries.length !== expectedEntries.length || entries.some(
		(entry, index) => entry.name !== expectedEntries[index] || !entry.isFile()
	)) {
		throw new Error(
			`malt-ts verifier directory must contain exactly: ${expectedEntries.join(", ")}`
		)
	}
	const requiredArtifacts = new Set([
		"malt-verifier.wasm", "wasm_exec.js", "PROVENANCE.json"
	])
	const covered = new Set()
	for (const line of fs.readFileSync(path.join(root, "SHA256SUMS"), "utf8").trimEnd().split("\n")) {
		const match = /^([0-9a-f]{64})  ([^/\r\n]+)$/.exec(line)
		const artifact = match?.[2]
		if (!artifact || !requiredArtifacts.has(artifact) || covered.has(artifact)) {
			throw new Error(`unexpected malt-ts verifier checksum entry ${JSON.stringify(line)}`)
		}
		covered.add(artifact)
	}
	if (covered.size !== requiredArtifacts.size) {
		throw new Error("malt-ts verifier checksum manifest is incomplete")
	}

	const provenance = JSON.parse(fs.readFileSync(process.env.PROVENANCE_PATH, "utf8"))
	const expectedCore = {
		module_path: "github.com/dewebprotocol/malt-core",
		module_version: process.env.MALT_VERSION,
		source_repository: "https://github.com/DeWebProtocol/malt-core.git",
		source_commit: process.env.MALT_COMMIT,
		module_sum: process.env.MALT_SUM,
		go_mod_sum: process.env.MALT_GO_MOD_SUM
	}
	const expectedFlags = ["-mod=readonly", "-buildvcs=false", "-trimpath"]
	const expectedEnvironment = {
		GO111MODULE: "on", GOENV: "off", GOWORK: "off", GOFLAGS: "", GOTOOLCHAIN: "local"
	}
	const expectedCodegen = {
		CGO_ENABLED: "0", GOEXPERIMENT: "none", GOWASM: "", GOFIPS140: "off"
	}
	const expectedExports = [
		"maltVerifyAuthentication"
	]
	if (
		provenance.schema !== "malt.ts-verifier.provenance/v1" ||
		provenance.source_repository !== "https://github.com/DeWebProtocol/malt-ts.git" ||
		provenance.build_inputs_sha256 !== process.env.BUILD_INPUTS_SHA256 ||
		JSON.stringify(provenance.core) !== JSON.stringify(expectedCore) ||
		provenance.target !== "js/wasm" ||
		JSON.stringify(provenance.exports) !== JSON.stringify(expectedExports) ||
		JSON.stringify(provenance.build_flags) !== JSON.stringify(expectedFlags) ||
		JSON.stringify(provenance.build_environment) !== JSON.stringify(expectedEnvironment) ||
		JSON.stringify(provenance.codegen_environment) !== JSON.stringify(expectedCodegen)
	) {
		throw new Error("malt-ts verifier provenance does not match its wrapper and Core release pin")
	}
	if (!/^go[1-9][0-9]*\.[0-9]+(?:\.[0-9]+|(?:beta|rc)[1-9][0-9]*)?$/.test(provenance.go_version || "")) {
		throw new Error("malt-ts verifier provenance has an invalid Go version")
	}
	const toolchain = /^go version (go[^ ]+) ([a-z0-9]+)\/([a-z0-9]+)$/.exec(
		provenance.go_toolchain || ""
	)
	if (!toolchain || toolchain[1] !== provenance.go_version) {
		throw new Error("malt-ts verifier provenance has an invalid Go toolchain")
	}
	'

(
	cd "${verifier_root}"
	sha256sum --strict -c SHA256SUMS
)
printf 'malt-ts verifier is built against MALT Core %s.\n' "${malt_version}"
