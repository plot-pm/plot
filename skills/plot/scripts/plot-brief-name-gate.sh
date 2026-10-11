#!/usr/bin/env bash
# Launcher. The decision — refuse a commit that ADDS or RENAMES a hand-off brief
# to `.plot/briefs/<prefix>-<slug>.md`, a name no reader computes — now lives in
# `briefNameRefusal` (packages/domain/src/rules/brief-name.ts), reached through
# the one `board/plot-gate.mjs` start every gate shares. This resolves it,
# passes the hook JSON on stdin and the exit code through, and decides nothing.
# A missing bundle, or no `node` on PATH, ALLOWS the call and says so: exiting 2
# here would block every Bash call, including the one that repairs the install.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-gate.mjs"
[ -f "$bundle" ] || {
  echo "plot-brief-name-gate: $bundle is missing — the gate went UNVERIFIED; update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 0
}
command -v node >/dev/null 2>&1 || { echo "plot-brief-name-gate: node is not on PATH, so $bundle cannot run — the gate went UNVERIFIED" >&2; exit 0; }
exec node "$bundle" brief-name "$@"
