#!/usr/bin/env bash
# A PR adds no sprint member line that disagrees with its plan's Sprint: field.
# Launcher only: resolves the bundle and runs `plot-sprint-member.mjs check`.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib-default-ref.sh
source "$root/scripts/lib-default-ref.sh"
bundle="$root/skills/plot/scripts/board/plot-sprint-member.mjs"
[ -f "$bundle" ] || { echo "::error::$bundle is missing; run pnpm run build:board first."; exit 1; }
# An optional first argument names the branch the pull request targets; with none, the ref origin/HEAD names.
ref=${1:-$(default_ref "$root")}
git -C "$root" rev-parse -q --verify "$ref^{commit}" >/dev/null || { echo "::error::check-sprint-members: $(absent_ref_reason "$ref")"; exit 1; }
base=$(git -C "$root" merge-base "$ref" HEAD) || base=
[ -n "$base" ] || { echo "::error::check-sprint-members: no merge base between HEAD and $ref"; exit 1; }
exec node "$bundle" check --base "$base"
