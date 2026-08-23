#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
writer_root="${1:-${repo_root}/assets/writer}"

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

for runner in run-writer-wasm-smoke.mjs run-writer-worker-smoke.mjs; do
	[[ -f "${malt_module_dir}/scripts/${runner}" ]] || {
		printf 'pinned MALT module is missing writer conformance runner: %s\n' \
			"${runner}" >&2
		exit 1
	}
done
fixtures="${malt_module_dir}/conformance/client-root/v1/vectors.json"
[[ -s "${fixtures}" ]] || {
	printf 'pinned MALT module is missing the client-root conformance corpus: %s\n' \
		"${fixtures}" >&2
	exit 1
}

node --test "${repo_root}/node-tests/malt-writer-workers.mjs"

if (
	cd "${repo_root}"
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=auto \
		go list -buildvcs=false -deps -tags=writer_kzg ./cmd/malt-writer-wasm
) | grep -q '/auth/commitment/ipa$'; then
	printf 'malt-ts KZG writer unexpectedly links the IPA backend\n' >&2
	exit 1
fi
if (
	cd "${repo_root}"
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=auto \
		go list -buildvcs=false -deps -tags=writer_ipa,malt_no_default_kzg \
			./cmd/malt-writer-wasm
) | grep -q '/auth/commitment/kzg$'; then
	printf 'malt-ts IPA writer unexpectedly links the KZG backend\n' >&2
	exit 1
fi

node "${malt_module_dir}/scripts/run-writer-wasm-smoke.mjs" \
	"${writer_root}/malt-writer-kzg.wasm" \
	"${writer_root}/wasm_exec.js" "${fixtures}" kzg
node "${repo_root}/scripts/run-writer-snapshot-smoke.mjs" \
	"${writer_root}/malt-writer-kzg.wasm" \
	"${writer_root}/wasm_exec.js" kzg
for profile in direct compact fast; do
	node "${malt_module_dir}/scripts/run-writer-wasm-smoke.mjs" \
		"${writer_root}/malt-writer-ipa-${profile}.wasm" \
		"${writer_root}/wasm_exec.js" "${fixtures}" ipa "${profile}"
done
node "${repo_root}/scripts/run-writer-snapshot-smoke.mjs" \
	"${writer_root}/malt-writer-ipa-compact.wasm" \
	"${writer_root}/wasm_exec.js" ipa compact
node "${malt_module_dir}/scripts/run-writer-worker-smoke.mjs" \
	"${writer_root}/malt-writer-ipa-compact.wasm" \
	"${writer_root}/wasm_exec.js" \
	"${writer_root}/malt-writer-workers.mjs" \
	"${writer_root}/malt-writer-worker.mjs" \
	"${fixtures}" ipa compact
printf 'malt-ts writer passes MALT %s conformance.\n' "${malt_version}"
