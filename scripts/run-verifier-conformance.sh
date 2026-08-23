#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
verifier_root="${1:-${repo_root}/assets/verifier}"

for command_name in node; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r malt_version malt_commit malt_module_dir _ _ <<<"${pin}"
if [[ -z "${malt_version}" || ! "${malt_commit}" =~ ^[0-9a-f]{40}$ || \
	! -d "${malt_module_dir}" ]]; then
	printf 'unable to resolve malt-ts MALT dependency to an exact commit\n' >&2
	exit 1
fi

runner="${malt_module_dir}/scripts/run-verifier-wasm-vectors.mjs"
vectors="${malt_module_dir}/conformance/resolve-read/v2/vectors.json"
map_proof_vectors="${malt_module_dir}/conformance/map-proof/v1/vectors.json"
for source_file in "${runner}" "${vectors}" "${map_proof_vectors}"; do
	if [[ ! -f "${source_file}" ]]; then
		printf 'pinned MALT module is missing verifier conformance input: %s\n' \
			"${source_file}" >&2
		exit 1
	fi
done

for backend in all kzg ipa; do
	node "${runner}" \
		"${verifier_root}/malt-verifier.wasm" \
		"${verifier_root}/wasm_exec.js" \
		"${vectors}" \
		"${backend}" \
		"${map_proof_vectors}"
done
printf 'malt-ts verifier passes the MALT %s conformance corpus.\n' "${malt_version}"
