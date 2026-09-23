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

for backend in all kzg ipa; do
	node "${repo_root}/scripts/run-authentication-wasm.mjs" verifier \
	"${verifier_root}/malt-verifier.wasm" "${verifier_root}/wasm_exec.js" \
	"${malt_module_dir}/conformance/authentication-v2.json" "${backend}"
done
printf 'malt-ts verifier passes the MALT %s conformance corpus.\n' "${malt_version}"
