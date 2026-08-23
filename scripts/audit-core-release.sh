#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_path="${repo_root}/malt-core.lock.json"

for command_name in gh node; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

"${repo_root}/scripts/resolve-core.sh" --audit-source-tag >/dev/null
readarray -t lock_fields < <(
	LOCK_PATH="${lock_path}" node -e '
		const fs = require("node:fs")
		const lock = JSON.parse(fs.readFileSync(process.env.LOCK_PATH, "utf8"))
		process.stdout.write(`${lock.module_version}\n${lock.release.manifest}\n`)
	'
)
core_version="${lock_fields[0]:-}"
manifest_name="${lock_fields[1]:-}"
[[ "${core_version}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
	printf 'invalid locked Core version\n' >&2
	exit 1
}
[[ "${manifest_name}" =~ ^malt-wasm-release-v[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{64}\.json$ ]] || {
	printf 'invalid locked Core release manifest\n' >&2
	exit 1
}

temporary="$(mktemp -d /tmp/malt-ts-core-release.XXXXXXXX)"
cleanup() {
	if [[ "${temporary}" == /tmp/malt-ts-core-release.* && -d "${temporary}" ]]; then
		rm -rf -- "${temporary}"
	fi
}
trap cleanup EXIT

gh release view "${core_version}" --repo DeWebProtocol/malt-core \
	--json tagName,isDraft,isPrerelease,assets >"${temporary}/release.json"
gh release download "${core_version}" --repo DeWebProtocol/malt-core \
	--pattern "${manifest_name}" --pattern SHA256SUMS --dir "${temporary}"
node "${repo_root}/scripts/check-core-release.mjs" \
	"${lock_path}" \
	"${temporary}/release.json" \
	"${temporary}/${manifest_name}" \
	"${temporary}/SHA256SUMS"
