#!/usr/bin/env bash
set -Eeuo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
for command_name in gh node; do
 command -v "${command_name}" >/dev/null 2>&1 || { printf 'required command not found: %s\n' "${command_name}" >&2; exit 1; }
done
# This checks the canonical remote tag against the locked commit, verifies
# module/go.mod checksums and rejects module replacements or conflicting origin.
pin="$("${repo_root}/scripts/resolve-core.sh" --audit-source-tag)"
IFS=$'\t' read -r core_version _ _ _ _ <<<"${pin}"
[[ "${core_version}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
 printf 'invalid locked Core version\n' >&2; exit 1;
}
temporary="$(mktemp -d /tmp/malt-ts-core-release.XXXXXXXX)"
trap 'rm -rf -- "${temporary}"' EXIT
gh release view "${core_version}" --repo DeWebProtocol/malt-core \
 --json tagName,isDraft,isPrerelease,url >"${temporary}/release.json"
node "${repo_root}/scripts/check-core-release.mjs" \
 "${repo_root}/malt-core.lock.json" "${temporary}/release.json"
