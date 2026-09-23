#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="${1:-${repo_root}/dist/wasm-release}"

for command_name in awk find mktemp node sha256sum tar; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

temporary="$(mktemp -d "${TMPDIR:-/tmp}/malt-wasm-release-check.XXXXXXXX")"
cleanup() {
	if [[ "${temporary}" == "${TMPDIR:-/tmp}"/malt-wasm-release-check.* && -d "${temporary}" ]]; then
		rm -rf -- "${temporary}"
	fi
}
trap cleanup EXIT

go_directive="$(awk '$1 == "go" { print $2; exit }' "${repo_root}/go.mod")"
if [[ ! "${go_directive}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	printf 'go.mod must pin an exact release toolchain version\n' >&2
	exit 1
fi
expected_go_version="go${go_directive}"
pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r _ _ core_module_dir _ _ <<<"${pin}"
expected_authentication_corpus_sha256="$(sha256sum "${core_module_dir}/conformance/authentication-v2.json" | awk '{print $1}')"
expected_commit="$(git -C "${repo_root}" rev-parse HEAD)"
expected_epoch="$(git -C "${repo_root}" show -s --format=%ct HEAD)"
expected_build_inputs="$("${repo_root}/scripts/build-wasm.sh" --print-source-digest)"

mapfile -t entries < <(find "${release_dir}" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)
if [[ "${#entries[@]}" -ne 4 || " ${entries[*]} " != *" SHA256SUMS "* ]]; then
	printf 'WASM release directory must contain exactly two archives, one manifest, and SHA256SUMS\n' >&2
	exit 1
fi
RELEASE_DIR="${release_dir}" node -e '
	const fs = require("node:fs")
	const path = require("node:path")
	const lines = fs.readFileSync(path.join(process.env.RELEASE_DIR, "SHA256SUMS"), "utf8")
	if (!lines.endsWith("\n")) throw new Error("release SHA256SUMS must end with LF")
	const names = new Set()
	for (const line of lines.trimEnd().split("\n")) {
		const match = /^[0-9a-f]{64}  ([^/\r\n]+)$/.exec(line)
		if (!match || names.has(match[1])) throw new Error(`invalid release checksum entry ${JSON.stringify(line)}`)
		names.add(match[1])
	}
	const values = [...names]
	if (values.length !== 3 ||
		values.filter((name) => /^malt-verifier-.+\.tar\.gz$/.test(name)).length !== 1 ||
		values.filter((name) => /^malt-writer-.+\.tar\.gz$/.test(name)).length !== 1 ||
		values.filter((name) => /^malt-wasm-release-.+\.json$/.test(name)).length !== 1) {
		throw new Error("release SHA256SUMS must cover exactly two archives and one manifest")
	}
'
(
	cd "${release_dir}"
	sha256sum --strict -c SHA256SUMS
)

manifest_path="$(find "${release_dir}" -maxdepth 1 -type f -name 'malt-wasm-release-*.json' -print -quit)"
if [[ -z "${manifest_path}" ]]; then
	printf 'WASM release manifest is missing\n' >&2
	exit 1
fi

release_fields="$(REPO_ROOT="${repo_root}" EXPECTED_COMMIT="${expected_commit}" EXPECTED_EPOCH="${expected_epoch}" \
EXPECTED_BUILD_INPUTS="${expected_build_inputs}" MANIFEST_PATH="${manifest_path}" RELEASE_DIR="${release_dir}" \
EXPECTED_GO_VERSION="${expected_go_version}" \
AUTHENTICATION_CORPUS_SHA256="${expected_authentication_corpus_sha256}" node -e '
	const fs = require("node:fs")
	const path = require("node:path")
	const manifestPath = process.env.MANIFEST_PATH
	const releaseDir = process.env.RELEASE_DIR
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
	const lock = JSON.parse(fs.readFileSync(path.join(process.env.REPO_ROOT, "malt-core.lock.json"), "utf8"))
	const pkg = JSON.parse(fs.readFileSync(path.join(process.env.REPO_ROOT, "package.json"), "utf8"))
	const expectedCore = Object.fromEntries(["module_path", "module_version", "source_repository", "source_commit", "module_sum", "go_mod_sum"].map(key => [key, lock[key]]))
	const hex40 = /^[0-9a-f]{40}$/
	const hex64 = /^[0-9a-f]{64}$/
	const version = /^v[0-9]+\.[0-9]+\.[0-9]+(?:[.-][0-9A-Za-z.-]+)?$/
	const expectedCodegen = {CGO_ENABLED: "0", GOEXPERIMENT: "none", GOWASM: "", GOFIPS140: "off"}
	const expectedCorpora = {
		authentication: {schema: "malt.conformance.authentication/2", sha256: process.env.AUTHENTICATION_CORPUS_SHA256},
	}
	const toolchain = /^go version (go[0-9]+\.[0-9]+\.[0-9]+) ([a-z0-9]+)\/([a-z0-9]+)$/.exec(manifest.go_toolchain || "")
	if (manifest.schema !== "malt.ts-wasm-release/v1" ||
		manifest.source_repository !== "https://github.com/DeWebProtocol/malt-ts.git" ||
		manifest.source_module !== "github.com/dewebprotocol/malt-ts" ||
		!version.test(manifest.source_version || "") ||
		!hex40.test(manifest.source_commit || "") ||
		manifest.source_commit !== process.env.EXPECTED_COMMIT ||
		manifest.source_version !== `v${pkg.version}` ||
		manifest.build_inputs_sha256 !== process.env.EXPECTED_BUILD_INPUTS ||
		JSON.stringify(manifest.core) !== JSON.stringify(expectedCore) ||
		!Number.isSafeInteger(manifest.source_epoch) || manifest.source_epoch <= 0 ||
		manifest.source_epoch !== Number(process.env.EXPECTED_EPOCH) ||
		manifest.target !== "js/wasm" ||
		manifest.archive_format !== "ustar+gzip" ||
		JSON.stringify(manifest.conformance_corpora) !== JSON.stringify(expectedCorpora) ||
		manifest.go_version !== process.env.EXPECTED_GO_VERSION ||
		!toolchain || toolchain[1] !== manifest.go_version ||
		JSON.stringify(manifest.codegen_environment) !== JSON.stringify(expectedCodegen)) {
		throw new Error("invalid WASM release provenance")
	}
	const values = [manifest.source_version, manifest.source_commit, manifest.source_epoch, manifest.go_version, manifest.go_toolchain]
	for (const kind of ["verifier", "writer"]) {
		const component = manifest.components?.[kind]
		if (!component || !hex64.test(component.asset_set_sha256 || "") ||
			component.path !== `${kind}/${component.asset_set_sha256}` ||
			!hex64.test(component.archive_sha256 || "")) {
			throw new Error(`invalid ${kind} release component`)
		}
		const expectedArchive = `malt-${kind}-${manifest.source_version}-${component.asset_set_sha256}-${component.archive_sha256}.tar.gz`
		if (component.archive !== expectedArchive ||
			!fs.statSync(path.join(releaseDir, expectedArchive)).isFile()) {
			throw new Error(`invalid ${kind} archive name`)
		}
		values.push(component.archive, component.asset_set_sha256, component.archive_sha256)
	}
	process.stdout.write(values.join("\t"))
')"
IFS=$'\t' read -r release_version source_commit source_epoch go_version go_toolchain \
	verifier_archive verifier_digest verifier_archive_sha256 \
	writer_archive writer_digest writer_archive_sha256 <<<"${release_fields}"

manifest_digest="$(sha256sum "${manifest_path}" | awk '{print $1}')"
expected_manifest_name="malt-wasm-release-${release_version}-${manifest_digest}.json"
if [[ "$(basename "${manifest_path}")" != "${expected_manifest_name}" ]]; then
	printf 'WASM release manifest filename does not bind its version and digest\n' >&2
	exit 1
fi

[[ "$(sha256sum "${release_dir}/${verifier_archive}" | awk '{print $1}')" == "${verifier_archive_sha256}" ]]
[[ "$(sha256sum "${release_dir}/${writer_archive}" | awk '{print $1}')" == "${writer_archive_sha256}" ]]

validate_archive() {
	local archive_path="$1"
	local expected_root="$2"
	local expected_epoch="$3"
	shift 3
	local listing
	local -a actual_entries=() expected_entries=("${expected_root}/")
	local filename index

	for filename in "$@"; do
		expected_entries+=("${expected_root}/${filename}")
	done
	if ! listing="$(tar -tzf "${archive_path}")"; then
		printf 'unable to list archive %s\n' "${archive_path}" >&2
		return 1
	fi
	mapfile -t actual_entries <<<"${listing}"
	if [[ "${#actual_entries[@]}" -ne "${#expected_entries[@]}" ]]; then
		printf 'archive %s does not contain the exact release member set\n' "${archive_path}" >&2
		return 1
	fi
	for index in "${!expected_entries[@]}"; do
		if [[ "${actual_entries[index]}" != "${expected_entries[index]}" ]]; then
			printf 'archive %s has non-canonical member order or contents\n' "${archive_path}" >&2
			return 1
		fi
	done
	if ! node "${repo_root}/scripts/check-wasm-archive.mjs" \
		"${archive_path}" "${expected_root}" "${expected_epoch}" "$@"; then
		printf 'archive %s does not use canonical ustar+gzip encoding\n' "${archive_path}" >&2
		return 1
	fi
}

validate_archive "${release_dir}/${verifier_archive}" "verifier/${verifier_digest}" "${source_epoch}" \
	PROVENANCE.json SHA256SUMS malt-verifier.wasm wasm_exec.js
validate_archive "${release_dir}/${writer_archive}" "writer/${writer_digest}" "${source_epoch}" \
	PROVENANCE.json SHA256SUMS \
	malt-writer-ipa-compact.wasm malt-writer-ipa-direct.wasm malt-writer-ipa-fast.wasm \
	malt-writer-kzg.wasm malt-writer-worker.mjs malt-writer-workers.mjs wasm_exec.js
tar -xzf "${release_dir}/${verifier_archive}" -C "${temporary}"
tar -xzf "${release_dir}/${writer_archive}" -C "${temporary}"
verifier_root="${temporary}/verifier/${verifier_digest}"
writer_root="${temporary}/writer/${writer_digest}"
[[ "$(sha256sum "${verifier_root}/SHA256SUMS" | awk '{print $1}')" == "${verifier_digest}" ]]
[[ "$(sha256sum "${writer_root}/SHA256SUMS" | awk '{print $1}')" == "${writer_digest}" ]]

# Reuse the package gates: exact ABI, parameter fingerprint, Core module/tag
# provenance, wrapper source digest, file sets, and every payload checksum.
"${repo_root}/scripts/check-verifier.sh" "${verifier_root}"
"${repo_root}/scripts/check-writer.sh" "${writer_root}"
MANIFEST_PATH="${manifest_path}" VERIFIER_ROOT="${verifier_root}" WRITER_ROOT="${writer_root}" node -e '
 const fs = require("node:fs")
 const path = require("node:path")
 const manifest = JSON.parse(fs.readFileSync(process.env.MANIFEST_PATH, "utf8"))
 for (const root of [process.env.VERIFIER_ROOT, process.env.WRITER_ROOT]) {
  const provenance = JSON.parse(fs.readFileSync(path.join(root, "PROVENANCE.json"), "utf8"))
  for (const key of ["go_version", "go_toolchain", "build_inputs_sha256", "core", "codegen_environment"]) {
   if (JSON.stringify(provenance[key]) !== JSON.stringify(manifest[key])) throw new Error(`WASM release ${key} differs from its component`)
  }
 }
'
printf 'malt-ts WASM release %s at %s is complete and self-consistent.\n' \
 "${release_version}" "${source_commit}"
