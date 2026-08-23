#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
asset_root="${1:-${repo_root}/assets}"

"${repo_root}/scripts/check-verifier.sh" "${asset_root}/verifier"
"${repo_root}/scripts/check-writer.sh" "${asset_root}/writer"
