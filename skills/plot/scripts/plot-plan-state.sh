#!/usr/bin/env bash
# Launcher. A plan's phase reflected on the issues it answers is
# `board/plot-plan-state.mjs`, a JS entry point over the domain — see its header
# for what it does. This resolves it, passes arguments and the exit code
# through, and decides nothing.
# Usage: plot-plan-state.sh <plan file> --phase <draft|approved|delivered|released> --plan-link <link> [--version <v>]
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-plan-state.mjs"
[ -f "$bundle" ] || {
  echo "plot-plan-state: cannot find $bundle — update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 2
}
exec node "$bundle" "$@"
