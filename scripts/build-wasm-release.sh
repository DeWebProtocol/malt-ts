#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${1:-${repo_root}/dist/wasm-release}"
release_version="v$(node -p "require(process.argv[1]).version" "${repo_root}/package.json")"

if [[ ! "${release_version}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]]; then
	printf 'invalid MALT release version: %s\n' "${release_version}" >&2
	exit 1
fi

for command_name in awk env find git go gzip install mktemp node sha256sum tar; do
	command -v "${command_name}" >/dev/null 2>&1 || {
		printf 'required command not found: %s\n' "${command_name}" >&2
		exit 1
	}
done

if [[ -n "$(git -C "${repo_root}" status --porcelain --untracked-files=all)" ]]; then
	printf 'malt-ts source must be clean before constructing release assets\n' >&2
	exit 1
fi

source_commit="$(git -C "${repo_root}" rev-parse HEAD)"
source_epoch="$(git -C "${repo_root}" show -s --format=%ct HEAD)"
if [[ ! "${source_commit}" =~ ^[0-9a-f]{40}$ || ! "${source_epoch}" =~ ^[0-9]+$ ]]; then
	printf 'unable to resolve exact MALT release source\n' >&2
	exit 1
fi
if git -C "${repo_root}" show-ref --verify --quiet "refs/tags/${release_version}"; then
	tagged_commit="$(git -C "${repo_root}" rev-parse "${release_version}^{commit}")"
	if [[ "${tagged_commit}" != "${source_commit}" ]]; then
		printf 'release tag %s points to %s, not HEAD %s\n' \
			"${release_version}" "${tagged_commit}" "${source_commit}" >&2
		exit 1
	fi
fi

mkdir -p "${output_dir}"
if [[ -n "$(find "${output_dir}" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
	printf 'release output directory must be empty: %s\n' "${output_dir}" >&2
	exit 1
fi

temporary="$(mktemp -d "${TMPDIR:-/tmp}/malt-wasm-release.XXXXXXXX")"
cleanup() {
	if [[ "${temporary}" == "${TMPDIR:-/tmp}"/malt-wasm-release.* && -d "${temporary}" ]]; then
		rm -rf -- "${temporary}"
	fi
}
trap cleanup EXIT

build_source="${temporary}/source"
verifier_staging="${temporary}/verifier"
writer_staging="${temporary}/writer"
release_root="${temporary}/release"
mkdir -p "${build_source}" "${verifier_staging}" "${writer_staging}" "${release_root}"
git -C "${repo_root}" archive --format=tar "${source_commit}" | tar -x -C "${build_source}"

# Build the sole distributable ABI from this exact malt-ts source snapshot.
"${build_source}/scripts/build-wasm.sh" "${temporary}/assets"
"${build_source}/scripts/check-wasm.sh" "${temporary}/assets"
cp "${temporary}/assets/verifier/"* "${verifier_staging}/"
cp "${temporary}/assets/writer/"* "${writer_staging}/"
pin="$("${build_source}/scripts/resolve-core.sh")"
IFS=$'\t' read -r _ _ core_module_dir _ _ <<<"${pin}"
authentication_corpus_sha256="$(sha256sum "${core_module_dir}/conformance/authentication-v1.json" | awk '{print $1}')"

chmod 0644 "${verifier_staging}/"* "${writer_staging}/"*
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
chmod 0644 "${verifier_staging}/SHA256SUMS" "${writer_staging}/SHA256SUMS"

verifier_digest="$(sha256sum "${verifier_staging}/SHA256SUMS" | awk '{print $1}')"
writer_digest="$(sha256sum "${writer_staging}/SHA256SUMS" | awk '{print $1}')"
verifier_path="verifier/${verifier_digest}"
writer_path="writer/${writer_digest}"
mkdir -p "${release_root}/verifier" "${release_root}/writer"
mv "${verifier_staging}" "${release_root}/${verifier_path}"
mv "${writer_staging}" "${release_root}/${writer_path}"
find "${release_root}" -type d -exec chmod 0755 {} +

tar --format=ustar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${source_epoch}" \
	-C "${release_root}" -cf - "${verifier_path}" | gzip -n >"${temporary}/verifier.tar.gz"
tar --format=ustar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${source_epoch}" \
	-C "${release_root}" -cf - "${writer_path}" | gzip -n >"${temporary}/writer.tar.gz"
verifier_archive_sha256="$(sha256sum "${temporary}/verifier.tar.gz" | awk '{print $1}')"
writer_archive_sha256="$(sha256sum "${temporary}/writer.tar.gz" | awk '{print $1}')"
verifier_archive="malt-verifier-${release_version}-${verifier_digest}-${verifier_archive_sha256}.tar.gz"
writer_archive="malt-writer-${release_version}-${writer_digest}-${writer_archive_sha256}.tar.gz"
mv "${temporary}/verifier.tar.gz" "${temporary}/${verifier_archive}"
mv "${temporary}/writer.tar.gz" "${temporary}/${writer_archive}"

MALT_VERSION="${release_version}" MALT_COMMIT="${source_commit}" SOURCE_EPOCH="${source_epoch}" \
PROVENANCE_PATH="${release_root}/${verifier_path}/PROVENANCE.json" \
AUTHENTICATION_CORPUS_SHA256="${authentication_corpus_sha256}" \
VERIFIER_DIGEST="${verifier_digest}" VERIFIER_ARCHIVE="${verifier_archive}" \
VERIFIER_ARCHIVE_SHA256="${verifier_archive_sha256}" \
WRITER_DIGEST="${writer_digest}" WRITER_ARCHIVE="${writer_archive}" \
WRITER_ARCHIVE_SHA256="${writer_archive_sha256}" \
MANIFEST_PATH="${temporary}/WASM-RELEASE.json" node -e '
	const fs = require("node:fs")
	const provenance = JSON.parse(fs.readFileSync(process.env.PROVENANCE_PATH, "utf8"))
	const component = (kind) => ({
		asset_set_sha256: process.env[`${kind}_DIGEST`],
		path: `${kind.toLowerCase()}/${process.env[`${kind}_DIGEST`]}`,
		archive: process.env[`${kind}_ARCHIVE`],
		archive_sha256: process.env[`${kind}_ARCHIVE_SHA256`]
	})
	const manifest = {
		schema: "malt.ts-wasm-release/v1",
		source_repository: "https://github.com/DeWebProtocol/malt-ts.git",
		source_module: "github.com/dewebprotocol/malt-ts",
		source_version: process.env.MALT_VERSION,
		source_commit: process.env.MALT_COMMIT,
		source_epoch: Number(process.env.SOURCE_EPOCH),
		build_inputs_sha256: provenance.build_inputs_sha256,
		core: provenance.core,
		go_version: provenance.go_version,
		go_toolchain: provenance.go_toolchain,
		target: "js/wasm",
		archive_format: "ustar+gzip",
		conformance_corpora: {
			authentication: {schema: "malt.conformance.authentication/1", sha256: process.env.AUTHENTICATION_CORPUS_SHA256},
		},
		codegen_environment: {CGO_ENABLED: "0", GOEXPERIMENT: "none", GOWASM: "", GOFIPS140: "off"},
		components: {verifier: component("VERIFIER"), writer: component("WRITER")}
	}
	fs.writeFileSync(process.env.MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
'
manifest_digest="$(sha256sum "${temporary}/WASM-RELEASE.json" | awk '{print $1}')"
manifest_name="malt-wasm-release-${release_version}-${manifest_digest}.json"
mv "${temporary}/WASM-RELEASE.json" "${temporary}/${manifest_name}"
(
	cd "${temporary}"
	sha256sum "${verifier_archive}" "${writer_archive}" "${manifest_name}" >SHA256SUMS
)

for artifact in "${verifier_archive}" "${writer_archive}" "${manifest_name}" SHA256SUMS; do
	install -m 0644 "${temporary}/${artifact}" "${output_dir}/${artifact}"
done
"${repo_root}/scripts/check-wasm-release.sh" "${output_dir}"
printf 'built malt-ts WASM release assets in %s\n' "${output_dir}"
