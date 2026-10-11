#!/usr/bin/env bash
# Launcher. The decision — refuse a commit that CHANGES a `State:` line in a
# plan or sprint file unless the script that owns that write left a receipt —
# now lives in `stateTransitionOf` and `stateTransitionRefusal`
# (packages/domain/src/rules/state-transition.ts), reached through the one
# `board/plot-gate.mjs` start every gate shares. This resolves it, passes the
# hook JSON on stdin and the exit code through, and decides nothing.
# A missing bundle, or no `node` on PATH, ALLOWS the call and says so: exiting 2
# here would block every Bash call, including the one that repairs the install.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-gate.mjs"
[ -f "$bundle" ] || {
  echo "plot-state-gate: $bundle is missing — the gate went UNVERIFIED; update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 0
}
command -v node >/dev/null 2>&1 || { echo "plot-state-gate: node is not on PATH, so $bundle cannot run — the gate went UNVERIFIED" >&2; exit 0; }
exec node "$bundle" state "$@"
