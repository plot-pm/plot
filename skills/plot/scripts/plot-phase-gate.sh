#!/usr/bin/env bash
# Launcher. The decision — refuse an implementation commit while its governing
# plan is still Draft or Design on a shared ref, or while `.plot/hold` names the
# branch — now lives in `phaseGateRefusal` and `holdRefusal`
# (packages/domain/src/rules/phase-gate.ts), reached through the one
# `board/plot-gate.mjs` start every gate shares. This resolves it, passes the
# hook JSON on stdin and the exit code through, and decides nothing.
# A missing bundle, or no `node` on PATH, ALLOWS the call and says so: exiting 2
# here would block every Bash call, including the one that repairs the install.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-gate.mjs"
[ -f "$bundle" ] || {
  echo "plot-phase-gate: $bundle is missing — the gate went UNVERIFIED; update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 0
}
command -v node >/dev/null 2>&1 || { echo "plot-phase-gate: node is not on PATH, so $bundle cannot run — the gate went UNVERIFIED" >&2; exit 0; }
exec node "$bundle" phase "$@"
