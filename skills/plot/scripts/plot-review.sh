#!/usr/bin/env bash
# Launcher. Reviewing a pull request is `board/plot-review.mjs`,
# a JS entry point over the domain — see its header for what it does. This
# resolves it, passes arguments and the exit code through, and decides nothing.
set -uo pipefail
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bundle="$script_dir/board/plot-review.mjs"
[ -f "$bundle" ] || {
  echo "plot-review: cannot find $bundle — update the plot plugin in this repository, or — in the plot repository itself — run: pnpm build:board" >&2
  exit 2
}
exec node "$bundle" "$@"
