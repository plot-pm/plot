#!/usr/bin/env bash
# Launcher. The PreToolUse gates are answered by `board/plot-gate.mjs`, one
# `node` start for every gate — see its header. This resolves it, passes the
# hook JSON on stdin and the exit code through, and decides nothing. A missing
# bundle, or no `node` on PATH, ALLOWS the call and says so: exiting 2 here
# would block every Bash call, including the one that repairs the install.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-gate.mjs"
[ -f "$bundle" ] || {
  echo "plot-gates: $bundle is missing — the gates went UNVERIFIED; update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 0
}
command -v node >/dev/null 2>&1 || { echo "plot-gates: node is not on PATH, so $bundle cannot run — the gates went UNVERIFIED" >&2; exit 0; }
exec node "$bundle" --all "$@"
