#!/usr/bin/env bash
# Plot helper: worker loop launcher.
# Usage: plot-worker-loop.sh
#
# The worker loop itself is JS, bundled at board/plot-worker-loop.mjs from
# packages/board/src/server/entry/worker-loop.ts (the-worker-loop-runs-in-js).
# This script resolves that bundle and execs it. A missing bundle is a loud
# exit 2, never a silent fallback — the fleet must never run the wrong loop
# because this file flew under a build that skipped it.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/plot-tmp.sh"

bundle="$script_dir/board/plot-worker-loop.mjs"
[ -f "$bundle" ] || { echo "plot-worker-loop: $bundle is missing — the-shell-shrinks-into-the-domain" >&2; exit 2; }
rm -f "$PLOT_TMP_REGISTRY"
exec node "$bundle"
