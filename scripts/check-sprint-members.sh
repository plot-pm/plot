#!/usr/bin/env bash
# A PR adds no sprint member line that disagrees with its plan's Sprint: field.
# Launcher only: resolves the bundle and runs `plot-sprint-member.mjs check`.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle="$root/skills/plot/scripts/board/plot-sprint-member.mjs"
[ -f "$bundle" ] || { echo "::error::$bundle is missing; run pnpm run build:board first."; exit 1; }
# An optional first argument names the branch the pull request targets; with none, origin/main.
base="$(git -C "$root" merge-base "${1:-origin/main}" HEAD)"
exec node "$bundle" check --base "$base"
