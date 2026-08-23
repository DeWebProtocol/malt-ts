#!/usr/bin/env bash
set -Eeuo pipefail

source_dir="${1:?usage: read-core-ipa-parameters.sh CORE_SOURCE_DIRECTORY [GO_BINARY] [GOTOOLCHAIN]}"
go_binary="${2:-go}"
go_toolchain="${3:-auto}"

for command_name in node; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done
if [[ ! -d "${source_dir}" || ! -f "${source_dir}/go.mod" ]]; then
	printf 'Core source directory does not contain go.mod: %s\n' "${source_dir}" >&2
	exit 1
fi
if [[ "${go_binary}" == */* ]]; then
	[[ -x "${go_binary}" ]] || {
		printf 'Go binary is not executable: %s\n' "${go_binary}" >&2
		exit 1
	}
else
	command -v "${go_binary}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${go_binary}" >&2
		exit 1
	}
fi
case "${go_toolchain}" in
	auto | local) ;;
	*)
		printf 'unsupported GOTOOLCHAIN mode: %s\n' "${go_toolchain}" >&2
		exit 1
		;;
esac

parameters_json="$(
	cd "${source_dir}"
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN="${go_toolchain}" \
		"${go_binary}" run -mod=readonly ./cmd/malt-ipa-parameters
)"

IPA_PARAMETERS_JSON="${parameters_json}" node -e '
	const raw = process.env.IPA_PARAMETERS_JSON
	let parameters
	try {
		parameters = JSON.parse(raw)
	} catch (error) {
		throw new Error(`Core IPA parameter export is not JSON: ${error.message}`)
	}
	const keys = parameters && typeof parameters === "object" && !Array.isArray(parameters)
		? Object.keys(parameters).sort()
		: []
	if (
		JSON.stringify(keys) !== JSON.stringify(["id", "sha256"]) ||
		typeof parameters.id !== "string" ||
		parameters.id.length === 0 ||
		/[\u0000-\u001f\u007f]/.test(parameters.id) ||
		!(/^[0-9a-f]{64}$/.test(parameters.sha256 || ""))
	) {
		throw new Error("Core IPA parameter export must contain exactly a non-empty id and lowercase SHA-256")
	}
	process.stdout.write(`${JSON.stringify(parameters)}\n`)
'
