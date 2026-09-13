#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
module_path="github.com/dewebprotocol/malt-core"
source_repository="https://github.com/DeWebProtocol/malt-core.git"
lock_path="${repo_root}/malt-core.lock.json"
audit_source_tag=0

case "${1:-}" in
"")
	[[ "$#" == 0 ]] || {
		printf 'usage: scripts/resolve-core.sh [--audit-source-tag]\n' >&2
		exit 1
	}
	;;
--audit-source-tag)
	[[ "$#" == 1 ]] || {
		printf 'usage: scripts/resolve-core.sh [--audit-source-tag]\n' >&2
		exit 1
	}
	audit_source_tag=1
	;;
*)
	printf 'usage: scripts/resolve-core.sh [--audit-source-tag]\n' >&2
	exit 1
	;;
esac

for command_name in go node; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

lock_fields="$(
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=auto \
		go mod edit -json "${repo_root}/go.mod" |
	REPO_ROOT="${repo_root}" node -e '
		let input = ""
		process.stdin.setEncoding("utf8")
		process.stdin.on("data", (chunk) => { input += chunk })
		process.stdin.on("end", () => {
			const fs = require("node:fs")
			const path = require("node:path")
			const moduleFile = JSON.parse(input)
			const modulePath = "github.com/dewebprotocol/malt-core"
			const requirements = (moduleFile.Require || []).filter(
				(requirement) => requirement.Path === modulePath
			)
			if (requirements.length !== 1 || !requirements[0].Version) {
				throw new Error(`gateway/go.mod must require ${modulePath} exactly once`)
			}
			const replacements = (moduleFile.Replace || []).filter(
				(replacement) => replacement.Old?.Path === modulePath
			)
			if (replacements.length !== 0) {
				throw new Error(`${modulePath} replacements are not valid malt-ts build provenance`)
			}
			const moduleVersion = requirements[0].Version
			const lock = JSON.parse(
				fs.readFileSync(path.join(process.env.REPO_ROOT, "malt-core.lock.json"), "utf8")
			)
			const expectedKeys = [
				"go_mod_sum", "module_path", "module_sum", "module_version", "release",
				"schema", "source_commit", "source_repository"
			]
			const actualKeys = Object.keys(lock).sort()
			if (
				JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys) ||
				lock.schema !== "malt.ts-core-lock/v1" ||
				lock.module_path !== modulePath ||
				lock.module_version !== moduleVersion ||
				lock.source_repository !== "https://github.com/DeWebProtocol/malt-core.git" ||
				!/^[0-9a-f]{40}$/.test(lock.source_commit || "") ||
				!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(moduleVersion)
			) {
				throw new Error(`malt-ts Core lock does not match ${modulePath}@${moduleVersion}`)
			}
			const expectedReleaseKeys = [
				"manifest", "manifest_sha256", "tag", "verifier_asset_set_sha256",
				"writer_asset_set_sha256"
			]
			const releaseKeys = lock.release && typeof lock.release === "object" && !Array.isArray(lock.release)
				? Object.keys(lock.release).sort()
				: []
			if (
				JSON.stringify(releaseKeys) !== JSON.stringify(expectedReleaseKeys) ||
				lock.release.tag !== moduleVersion ||
				!/^[0-9a-f]{64}$/.test(lock.release.manifest_sha256 || "") ||
				lock.release.manifest !== `malt-wasm-release-${moduleVersion}-${lock.release.manifest_sha256}.json` ||
				!/^([0-9a-f]{64})$/.test(lock.release.verifier_asset_set_sha256 || "") ||
				!/^([0-9a-f]{64})$/.test(lock.release.writer_asset_set_sha256 || "")
			) {
				throw new Error(`malt-ts Core release metadata does not match ${moduleVersion}`)
			}

			const sumLines = fs.readFileSync(path.join(process.env.REPO_ROOT, "go.sum"), "utf8")
				.split(/\r?\n/)
			function exactSum(versionField) {
				const matches = sumLines.map((line) => line.trim().split(/\s+/)).filter(
					(fields) => fields.length === 3 && fields[0] === modulePath && fields[1] === versionField
				)
				if (matches.length !== 1 || !/^h1:[A-Za-z0-9+/]+={0,2}$/.test(matches[0][2])) {
					throw new Error(`gateway/go.sum must contain exactly one valid ${modulePath} ${versionField} entry`)
				}
				return matches[0][2]
			}
			const moduleSum = exactSum(moduleVersion)
			const goModSum = exactSum(`${moduleVersion}/go.mod`)
			if (lock.module_sum !== moduleSum || lock.go_mod_sum !== goModSum) {
				throw new Error("malt-ts Core lock does not match go.sum")
			}
			process.stdout.write([
				moduleVersion, lock.source_commit, moduleSum, goModSum
			].join("\t"))
		})
	'
)"
IFS=$'\t' read -r malt_version locked_commit locked_module_sum locked_go_mod_sum \
	<<<"${lock_fields}"

download_json="$(
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=auto \
		go mod download -json "${module_path}@${malt_version}"
)"
(
	cd "${repo_root}"
	GOENV=off GOWORK=off GOFLAGS= GOTOOLCHAIN=auto go mod verify >/dev/null
)
validator=(
	env
	"MALT_MODULE=${module_path}"
	"MALT_VERSION=${malt_version}"
	"MALT_COMMIT=${locked_commit}"
	"MALT_SUM=${locked_module_sum}"
	"MALT_GO_MOD_SUM=${locked_go_mod_sum}"
)
if [[ "${audit_source_tag}" == "1" ]]; then
	tag_refs="$(
		"${repo_root}/scripts/resolve-core-tag.sh" \
			"${source_repository}" "${malt_version}"
	)"
	validator+=("MALT_TAG_REFS=${tag_refs}")
fi
"${validator[@]}" node "${repo_root}/scripts/check-core-download.mjs" \
	<<<"${download_json}"
