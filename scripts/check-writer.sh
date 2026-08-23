#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
writer_dir="${1:-${repo_root}/assets/writer}"

for command_name in node sha256sum; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

node "${repo_root}/scripts/check-writer-checksums.mjs" "${writer_dir}"

pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r malt_version malt_commit malt_module_dir malt_module_sum malt_go_mod_sum \
	<<<"${pin}"
build_inputs_sha256="$("${repo_root}/scripts/build-wasm.sh" --print-source-digest)"
ipa_parameters_json="$(
	"${repo_root}/scripts/read-core-ipa-parameters.sh" "${malt_module_dir}"
)"
provenance_commit="$(
	IPA_PARAMETERS_JSON="${ipa_parameters_json}" \
	MALT_VERSION="${malt_version}" MALT_COMMIT="${malt_commit}" \
	MALT_SUM="${malt_module_sum}" MALT_GO_MOD_SUM="${malt_go_mod_sum}" \
	MALT_TS_BUILD_INPUTS_SHA256="${build_inputs_sha256}" \
		node "${repo_root}/scripts/check-writer-provenance.mjs" "${writer_dir}"
)"

(
	cd "${writer_dir}"
	sha256sum --check --strict SHA256SUMS
	node --check malt-writer-worker.mjs
	node --check malt-writer-workers.mjs
)

if [[ "${provenance_commit}" != "${malt_commit}" ]]; then
	printf 'writer provenance Core commit %s does not match pin %s\n' \
		"${provenance_commit}" "${malt_commit}" >&2
	exit 1
fi
printf 'malt-ts writer is built against MALT Core %s.\n' "${malt_version}"
