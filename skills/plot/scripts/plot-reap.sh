#!/usr/bin/env bash
# Launcher. The mechanical half of reaping worktrees is `board/plot-reap.mjs`,
# a JS entry point over the domain — see its header for what it does. This
# resolves it, passes arguments and the exit code through, and decides
# nothing.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-reap.mjs"
[ -f "$bundle" ] || {
  echo "plot-reap: cannot find $bundle — update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 2
}
exec node "$bundle" "$@"
