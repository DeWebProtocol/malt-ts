#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
writer_root="${1:-${repo_root}/assets/writer}"
sh "${repo_root}/scripts/check-writer-backends.sh"

for command_name in go grep node; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r malt_version _ malt_module_dir _ _ <<<"${pin}"
if [[ -z "${malt_version}" || ! -d "${malt_module_dir}" ]]; then
	printf 'unable to resolve the pinned MALT Core dependency\n' >&2
	exit 1
fi

for runner in run-authentication-wasm.mjs run-retained-writer-wasm.mjs run-authentication-batch-wasm.mjs; do
 [[ -f "${malt_module_dir}/scripts/${runner}" ]] || {
  printf 'pinned Core release does not provide the current authentication runner: %s\n' "${runner}" >&2
  exit 1
 }
done
node --test "${repo_root}/node-tests/malt-writer-workers.mjs"
for profile in kzg direct compact fast; do
 backend=ipa
 wasm="${writer_root}/malt-writer-ipa-${profile}.wasm"
 profile_arg="${profile}"
 if [[ "${profile}" == kzg ]]; then backend=kzg; wasm="${writer_root}/malt-writer-kzg.wasm"; profile_arg=; fi
 node "${malt_module_dir}/scripts/run-authentication-wasm.mjs" writer "${wasm}" "${writer_root}/wasm_exec.js" "${malt_module_dir}/conformance/authentication-v1.json" "${backend}"
 node "${malt_module_dir}/scripts/run-retained-writer-wasm.mjs" "${wasm}" "${writer_root}/wasm_exec.js" "${backend}" "${profile_arg}"
 node "${malt_module_dir}/scripts/run-authentication-batch-wasm.mjs" "${wasm}" "${writer_root}/wasm_exec.js" "${backend}" "${profile_arg}"
done
node "${repo_root}/scripts/run-authentication-router-smoke.mjs" "${writer_root}" "${malt_module_dir}/scripts/run-writer-worker-node.mjs"
printf 'malt-ts writer passes MALT %s conformance.\n' "${malt_version}"
