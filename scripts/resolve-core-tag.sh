#!/usr/bin/env bash
set -Eeuo pipefail

source_repository="${1:?source repository is required}"
module_version="${2:?module version is required}"
if [[ ! "${module_version}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]]; then
	printf 'invalid MALT module version: %s\n' "${module_version}" >&2
	exit 1
fi

for command_name in env git mktemp rm sleep; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

tag_lookup_dir="$(mktemp -d /tmp/malt-ts-core-tag.XXXXXXXX)"
cleanup() {
	if [[ "${tag_lookup_dir}" == /tmp/malt-ts-core-tag.* && -d "${tag_lookup_dir}" ]]; then
		rm -rf -- "${tag_lookup_dir}"
	fi
}
trap cleanup EXIT

tag_ref="refs/tags/${module_version}"
tag_lookup_error="${tag_lookup_dir}/stderr"
max_attempts=3
for ((attempt = 1; attempt <= max_attempts; attempt++)); do
	if tag_refs="$(
		env -u GIT_DIR -u GIT_WORK_TREE \
			-u GIT_CONFIG_COUNT -u GIT_CONFIG_PARAMETERS \
			GIT_CEILING_DIRECTORIES="${tag_lookup_dir}" \
			GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
			GIT_TERMINAL_PROMPT=0 \
			git -C "${tag_lookup_dir}" -c credential.helper= ls-remote --exit-code \
			"${source_repository}" "${tag_ref}" "${tag_ref}^{}" \
			2>"${tag_lookup_error}"
	)"; then
		printf '%s\n' "${tag_refs}"
		exit 0
	else
		status=$?
	fi
	if [[ "${attempt}" == "${max_attempts}" ]]; then
		printf '%s' "$(<"${tag_lookup_error}")" >&2
		[[ ! -s "${tag_lookup_error}" ]] || printf '\n' >&2
		exit "${status}"
	fi
	printf 'canonical MALT tag lookup attempt %d/%d failed; retrying in %ds\n' \
		"${attempt}" "${max_attempts}" "${attempt}" >&2
	sleep "${attempt}"
done
