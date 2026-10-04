#!/usr/bin/env bash
# Launcher. The mechanical half of delivering (or releasing) a plan is
# `board/plot-deliver.mjs`, a JS entry point over the domain — see its header
# for what it does. This resolves it, passes arguments and the exit code
# through, and decides nothing.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-deliver.mjs"
[ -f "$bundle" ] || {
  echo "plot-deliver: cannot find $bundle — update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 2
}
exec node "$bundle" "$@"
