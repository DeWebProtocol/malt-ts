#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

build_inputs_digest() {
	(
		cd "${repo_root}"
		{
			find cmd/malt-verifier-wasm cmd/malt-writer-wasm \
				-type f -name '*.go' ! -name '*_test.go' -printf '%p\n'
			printf '%s\n' \
				Makefile \
				go.mod \
				go.sum \
				malt-core.lock.json \
				assets/writer/malt-writer-worker.mjs \
				assets/writer/malt-writer-workers.mjs \
				scripts/build-wasm.sh \
				scripts/check-core-download.mjs \
				scripts/read-core-ipa-parameters.sh \
				scripts/resolve-core.sh
		} |
			LC_ALL=C sort |
			while IFS= read -r source_file; do
				[[ -f "${source_file}" && ! -L "${source_file}" ]] || {
					printf 'malt-ts WASM build input is missing or unsafe: %s\n' \
						"${source_file}" >&2
					exit 1
				}
				sha256sum "${source_file}"
			done |
			sha256sum |
			awk '{print $1}'
	)
}

if [[ "${1:-}" == "--print-source-digest" ]]; then
	[[ "$#" == 1 ]] || {
		printf 'usage: scripts/build-wasm.sh --print-source-digest\n' >&2
		exit 1
	}
	build_inputs_digest
	exit 0
fi

output_root="${1:-${repo_root}/assets}"
for command_name in awk env find go install mktemp node realpath sha256sum sort; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

output_root="$(realpath -m -- "${output_root}")"
if [[ "${output_root}" == "/" || "${output_root}" == "${repo_root}" ]]; then
	printf 'refusing unsafe malt-ts WASM output directory: %s\n' "${output_root}" >&2
	exit 1
fi

pin="$("${repo_root}/scripts/resolve-core.sh")"
IFS=$'\t' read -r malt_version malt_commit malt_module_dir malt_module_sum malt_go_mod_sum \
	<<<"${pin}"
if [[ -z "${malt_version}" || ! "${malt_commit}" =~ ^[0-9a-f]{40}$ || \
	! -d "${malt_module_dir}" || ! "${malt_module_sum}" =~ ^h1: || \
	! "${malt_go_mod_sum}" =~ ^h1: ]]; then
	printf 'unable to resolve the pinned MALT Core dependency\n' >&2
	exit 1
fi

temporary="$(mktemp -d "${TMPDIR:-/tmp}/malt-ts-wasm.XXXXXXXX")"
cleanup() {
	if [[ "${temporary}" == "${TMPDIR:-/tmp}"/malt-ts-wasm.* && -d "${temporary}" ]]; then
		rm -rf -- "${temporary}"
	fi
}
trap cleanup EXIT
verifier_staging="${temporary}/verifier"
writer_staging="${temporary}/writer"
mkdir -p "${verifier_staging}" "${writer_staging}"

go_directive="$(awk '$1 == "go" { print $2; exit }' "${repo_root}/go.mod")"
if [[ ! "${go_directive}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	printf 'go.mod must pin an exact release toolchain version\n' >&2
	exit 1
fi
required_toolchain="go${go_directive}"
go_root="$(
	cd "${repo_root}"
	env -u GOROOT -u GOOS -u GOARCH GO111MODULE=on GOENV=off GOWORK=off GOFLAGS= \
		GOTOOLCHAIN="${required_toolchain}" GOEXPERIMENT=none GOWASM= \
		GOFIPS140=off CGO_ENABLED=0 go env GOROOT
)"
go_binary="${go_root}/bin/go"
if [[ ! -x "${go_binary}" ]]; then
	printf 'selected Go toolchain is missing its executable: %s\n' "${go_binary}" >&2
	exit 1
fi
go_command=(
	env -u GOROOT -u GOOS -u GOARCH
	GO111MODULE=on GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=local
	GOEXPERIMENT=none GOWASM= GOFIPS140=off CGO_ENABLED=0
	"${go_binary}"
)
wasm_go_command=(
	env -u GOROOT
	GOOS=js GOARCH=wasm GO111MODULE=on
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=local
	GOEXPERIMENT=none GOWASM= GOFIPS140=off CGO_ENABLED=0
	"${go_binary}"
)
go_version="$(
	cd "${repo_root}"
	"${go_command[@]}" env GOVERSION
)"
go_toolchain="$(
	cd "${repo_root}"
	"${go_command[@]}" version
)"
build_inputs_sha256="$(build_inputs_digest)"
ipa_parameters_json="$("${repo_root}/scripts/read-core-ipa-parameters.sh" "${malt_module_dir}")"

(
	cd "${repo_root}"
	"${go_command[@]}" mod verify
	"${wasm_go_command[@]}" build -mod=readonly -buildvcs=false -trimpath \
		-o "${verifier_staging}/malt-verifier.wasm" ./cmd/malt-verifier-wasm
	"${wasm_go_command[@]}" build -mod=readonly -buildvcs=false -trimpath \
		-tags=writer_kzg \
		-o "${writer_staging}/malt-writer-kzg.wasm" ./cmd/malt-writer-wasm
	for profile in direct compact fast; do
		"${wasm_go_command[@]}" build -mod=readonly -buildvcs=false -trimpath \
			-tags=writer_ipa,malt_no_default_kzg \
			-ldflags="-X=main.ipaCommitterProfile=${profile}" \
			-o "${writer_staging}/malt-writer-ipa-${profile}.wasm" \
			./cmd/malt-writer-wasm
	done
)

install -m 0644 "${go_root}/lib/wasm/wasm_exec.js" \
	"${verifier_staging}/wasm_exec.js"
install -m 0644 "${go_root}/lib/wasm/wasm_exec.js" \
	"${writer_staging}/wasm_exec.js"
install -m 0644 "${repo_root}/assets/writer/malt-writer-worker.mjs" \
	"${writer_staging}/malt-writer-worker.mjs"
install -m 0644 "${repo_root}/assets/writer/malt-writer-workers.mjs" \
	"${writer_staging}/malt-writer-workers.mjs"

MALT_TS_BUILD_INPUTS_SHA256="${build_inputs_sha256}" \
MALT_VERSION="${malt_version}" MALT_COMMIT="${malt_commit}" \
MALT_SUM="${malt_module_sum}" MALT_GO_MOD_SUM="${malt_go_mod_sum}" \
GO_VERSION="${go_version}" GO_TOOLCHAIN="${go_toolchain}" \
PROVENANCE_PATH="${verifier_staging}/PROVENANCE.json" node -e '
	const fs = require("node:fs")
	const provenance = {
		schema: "malt.ts-verifier.provenance/v1",
		source_repository: "https://github.com/DeWebProtocol/malt-ts.git",
		build_inputs_sha256: process.env.MALT_TS_BUILD_INPUTS_SHA256,
		core: {
			module_path: "github.com/dewebprotocol/malt-core",
			module_version: process.env.MALT_VERSION,
			source_repository: "https://github.com/DeWebProtocol/malt-core.git",
			source_commit: process.env.MALT_COMMIT,
			module_sum: process.env.MALT_SUM,
			go_mod_sum: process.env.MALT_GO_MOD_SUM
		},
		target: "js/wasm",
		exports: [
			"maltVerifyArtifact", "maltVerifyAuthentication", "maltVerifyMapProof",
			"maltVerifyRead", "maltVerifyResolve"
		],
		go_version: process.env.GO_VERSION,
		go_toolchain: process.env.GO_TOOLCHAIN,
		build_flags: ["-mod=readonly", "-buildvcs=false", "-trimpath"],
		build_environment: {
			GO111MODULE: "on", GOENV: "off", GOWORK: "off",
			GOFLAGS: "", GOTOOLCHAIN: "local"
		},
		codegen_environment: {
			CGO_ENABLED: "0", GOEXPERIMENT: "none", GOWASM: "", GOFIPS140: "off"
		}
	}
	fs.writeFileSync(process.env.PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`)
'

MALT_TS_BUILD_INPUTS_SHA256="${build_inputs_sha256}" \
MALT_VERSION="${malt_version}" MALT_COMMIT="${malt_commit}" \
MALT_SUM="${malt_module_sum}" MALT_GO_MOD_SUM="${malt_go_mod_sum}" \
GO_VERSION="${go_version}" GO_TOOLCHAIN="${go_toolchain}" \
IPA_PARAMETERS_JSON="${ipa_parameters_json}" \
PROVENANCE_PATH="${writer_staging}/PROVENANCE.json" node -e '
	const fs = require("node:fs")
	const provenance = {
		schema: "malt.ts-writer.provenance/v1",
		source_repository: "https://github.com/DeWebProtocol/malt-ts.git",
		build_inputs_sha256: process.env.MALT_TS_BUILD_INPUTS_SHA256,
		core: {
			module_path: "github.com/dewebprotocol/malt-core",
			module_version: process.env.MALT_VERSION,
			source_repository: "https://github.com/DeWebProtocol/malt-core.git",
			source_commit: process.env.MALT_COMMIT,
			module_sum: process.env.MALT_SUM,
			go_mod_sum: process.env.MALT_GO_MOD_SUM
		},
		target: "js/wasm",
		exports: [
			"maltComputeClientRootV1", "maltPrepareAuthentication", "maltWriterAcceptSessionReceiptV1",
			"maltWriterBootstrapSessionV1", "maltWriterCloseSessionV1",
			"maltWriterDiscardSessionCandidateV1", "maltWriterGetPreparedResultV1",
			"maltWriterLoadSessionV1", "maltWriterPrepareSessionV1",
			"maltWriterRestoreSessionV1", "maltWriterSnapshotSessionV1",
			"maltWriterValidateReceiptV1"
		],
		parameters: JSON.parse(process.env.IPA_PARAMETERS_JSON),
		go_version: process.env.GO_VERSION,
		go_toolchain: process.env.GO_TOOLCHAIN,
		build_flags: ["-mod=readonly", "-buildvcs=false", "-trimpath"],
		artifacts: {
			kzg: {file: "malt-writer-kzg.wasm", build_tags: ["writer_kzg"]},
			ipa: {
				direct: {
					file: "malt-writer-ipa-direct.wasm",
					build_tags: ["writer_ipa", "malt_no_default_kzg"],
					linker_profile: "direct", retained_fixed_base_table_bytes: 0
				},
				compact: {
					file: "malt-writer-ipa-compact.wasm",
					build_tags: ["writer_ipa", "malt_no_default_kzg"],
					linker_profile: "compact", retained_fixed_base_table_bytes: 12582912
				},
				fast: {
					file: "malt-writer-ipa-fast.wasm",
					build_tags: ["writer_ipa", "malt_no_default_kzg"],
					linker_profile: "fast", retained_fixed_base_table_bytes: 350355456
				}
			}
		},
		runtime_invariants: {
			one_runtime_per_controller: true, exact_backend_profile: true
		},
		build_environment: {
			GO111MODULE: "on", GOENV: "off", GOWORK: "off",
			GOFLAGS: "", GOTOOLCHAIN: "local"
		},
		codegen_environment: {
			CGO_ENABLED: "0", GOEXPERIMENT: "none", GOWASM: "", GOFIPS140: "off"
		}
	}
	fs.writeFileSync(process.env.PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`)
'

(
	cd "${verifier_staging}"
	sha256sum malt-verifier.wasm wasm_exec.js PROVENANCE.json >SHA256SUMS
)
(
	cd "${writer_staging}"
	sha256sum \
		malt-writer-kzg.wasm \
		malt-writer-ipa-direct.wasm \
		malt-writer-ipa-compact.wasm \
		malt-writer-ipa-fast.wasm \
		malt-writer-worker.mjs \
		malt-writer-workers.mjs \
		wasm_exec.js \
		PROVENANCE.json >SHA256SUMS
)
chmod 0644 "${verifier_staging}/"* "${writer_staging}/"*

publish_asset_set() {
	local kind="$1"
	local stage="${temporary}/${kind}"
	local destination="${output_root}/${kind}"
	local expected
	if [[ "${kind}" == "verifier" ]]; then
		expected='PROVENANCE.json SHA256SUMS malt-verifier.wasm wasm_exec.js'
	else
		expected='PROVENANCE.json SHA256SUMS malt-writer-ipa-compact.wasm malt-writer-ipa-direct.wasm malt-writer-ipa-fast.wasm malt-writer-kzg.wasm malt-writer-worker.mjs malt-writer-workers.mjs wasm_exec.js'
	fi
	mkdir -p "${destination}"
	while IFS= read -r existing; do
		if [[ " ${expected} " != *" ${existing} "* ]]; then
			printf 'refusing to overwrite unexpected %s asset: %s\n' "${kind}" "${existing}" >&2
			exit 1
		fi
	done < <(find "${destination}" -mindepth 1 -maxdepth 1 -printf '%f\n' | LC_ALL=C sort)
	while IFS= read -r artifact; do
		[[ "${artifact}" == "SHA256SUMS" ]] && continue
		install -m 0644 "${stage}/${artifact}" "${destination}/${artifact}"
	done < <(find "${stage}" -mindepth 1 -maxdepth 1 -type f -printf '%f\n' | LC_ALL=C sort)
	install -m 0644 "${stage}/SHA256SUMS" "${destination}/SHA256SUMS"
}

publish_asset_set verifier
publish_asset_set writer
printf 'built malt-ts WASM from MALT Core %s in %s\n' \
	"${malt_version}" "${output_root}"
