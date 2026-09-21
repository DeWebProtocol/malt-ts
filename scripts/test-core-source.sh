#!/usr/bin/env bash
set -Eeuo pipefail

# Explicit development integration. This never produces distributable assets
# or edits the published Core lock/provenance. Invoke under the workspace CPU scope.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
core_root="$(cd "${1:?usage: test-core-source.sh CORE_CHECKOUT [OUTPUT_DIRECTORY]}" && pwd -P)"
output="${2:-$(mktemp -d /tmp/malt-ts-source-wasm.XXXXXX)}"
mkdir -p "${output}"
output="$(cd "${output}" && pwd -P)"
case "${output}/" in "${repo_root}/assets/"*) printf 'development output must be outside published assets\n' >&2; exit 1;; esac
if [[ -n "$(find "${output}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
 printf 'development output must be a new empty directory (no files or symlinks)\n' >&2
 exit 1
fi
jobs="${MALT_VALIDATION_JOBS:-6}"
[[ "${jobs}" =~ ^[1-9][0-9]*$ ]] || { printf 'invalid validation concurrency\n' >&2; exit 1; }
work_dir="$(mktemp -d /tmp/malt-ts-source-work.XXXXXX)"
trap 'rm -rf "${work_dir}"' EXIT
(
 cd "${work_dir}"
 GOWORK=off go work init "${repo_root}" "${core_root}"
)
export GOWORK="${work_dir}/go.work"
export GOMAXPROCS="${jobs}"
export GOFLAGS="-p=${jobs}"
mkdir -p "${output}/writer" "${output}/verifier"
(
 cd "${repo_root}"
 go test -p="${jobs}" -parallel="${jobs}" ./...
 sh scripts/check-writer-backends.sh
 GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -o "${output}/verifier/malt-verifier.wasm" ./cmd/malt-verifier-wasm
 GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -tags=writer_kzg -o "${output}/writer/malt-writer-kzg.wasm" ./cmd/malt-writer-wasm
 for profile in direct compact fast; do
  GOOS=js GOARCH=wasm go build -buildvcs=false -trimpath -tags=writer_ipa,malt_no_default_kzg \
   -ldflags="-X=main.ipaCommitterProfile=${profile}" -o "${output}/writer/malt-writer-ipa-${profile}.wasm" ./cmd/malt-writer-wasm
 done
)
go_root="$(go env GOROOT)"
cp "${go_root}/lib/wasm/wasm_exec.js" "${output}/writer/wasm_exec.js"
cp "${go_root}/lib/wasm/wasm_exec.js" "${output}/verifier/wasm_exec.js"
cp "${repo_root}/assets/writer/malt-writer-worker.mjs" "${repo_root}/assets/writer/malt-writer-workers.mjs" "${output}/writer/"
node "${repo_root}/scripts/run-authentication-wasm.mjs" verifier "${output}/verifier/malt-verifier.wasm" \
 "${output}/verifier/wasm_exec.js" "${core_root}/conformance/authentication-v1.json" all
for profile in kzg direct compact fast; do
 backend=ipa
 wasm="${output}/writer/malt-writer-ipa-${profile}.wasm"
 profile_arg="${profile}"
 if [[ "${profile}" == kzg ]]; then backend=kzg; wasm="${output}/writer/malt-writer-kzg.wasm"; profile_arg=; fi
 node "${repo_root}/scripts/run-authentication-wasm.mjs" writer "${wasm}" "${output}/writer/wasm_exec.js" \
  "${core_root}/conformance/authentication-v1.json" "${backend}"
 node "${repo_root}/scripts/run-retained-writer-wasm.mjs" "${wasm}" "${output}/writer/wasm_exec.js" "${backend}" "${profile_arg}"
 node "${repo_root}/scripts/run-authentication-batch-wasm.mjs" "${wasm}" "${output}/writer/wasm_exec.js" "${backend}" "${profile_arg}"
done
node --test "${repo_root}/node-tests/malt-writer-workers.mjs"
node "${repo_root}/scripts/run-authentication-router-smoke.mjs" "${output}/writer" "${repo_root}/scripts/run-writer-worker-node.mjs"
printf 'Development source integration passed; non-release artifacts: %s\n' "${output}"
