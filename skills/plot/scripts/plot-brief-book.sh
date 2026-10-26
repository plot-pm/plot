#!/usr/bin/env bash
# Launcher. Booking a branch's hand-off brief and its plan's `Started:` record
# in one disposable worktree is `board/plot-brief-book.mjs`, a JS entry point
# over the domain — see its header for what it does. This resolves it, passes
# arguments and the exit code through, and decides nothing.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-brief-book.mjs"
[ -f "$bundle" ] || {
  echo "plot-brief-book: cannot find $bundle — update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 2
}
exec node "$bundle" "$@"
