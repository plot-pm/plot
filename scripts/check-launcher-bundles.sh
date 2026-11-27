#!/usr/bin/env bash
# THE GATE THAT KEEPS A LAUNCHER'S BUNDLE READABLE.
#
# A launcher resolves its bundle and runs it with `exec node "$bundle"`. The
# local-check selection reads each shipped `.sh` file's
# `bundle="$script_dir/board/<name>.mjs"` (or `$here`) line, and a test that
# runs the launcher is selected for every change to a source that bundle
# holds (`launcherBundles`, packages/domain/src/rules/local-checks.ts). A
# launcher that `exec`s a literal `board/<name>.mjs` path has no such line, so
# the selection maps it to nothing and its tests are not selected.
#
# Measured at 0bfe3f914: 14 shipped scripts ran `exec node …`, 13 through
# `"$bundle"` after a `bundle=` line, and one, plot-fleet-scan.sh:271, through
# a literal `"$here/board/plot-scan-walk.mjs"`.
#
# THE SCOPE IS THE `exec` LINE. A script that names a `board/*.mjs` mid-script
# or in a comment is not a launcher, and this gate refuses nothing there.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs.
# An explicit root lets a test point the gate at a fixture and prove its own
# refusal. See test/reconcile/launcher-bundles-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# A line that execs node on a literal bundle path.
LITERAL='^[[:space:]]*exec[[:space:]]+node[[:space:]]+[^#]*board/[A-Za-z0-9_.-]+\.mjs'

violations=$(grep -rEn --include='*.sh' --exclude-dir=board "$LITERAL" skills 2>/dev/null \
  | grep -vE '^([^:]*/)?(test|tests|__tests__)/')
launchers=$(grep -rEn --include='*.sh' --exclude-dir=board '^[[:space:]]*exec[[:space:]]+node[[:space:]]+"\$bundle"' skills 2>/dev/null | wc -l | tr -d ' ')

echo "launchers that exec \"\$bundle\": $launchers"

if [ -n "$violations" ]; then
  echo "::error::a shipped launcher execs a literal bundle path."
  echo
  echo "The local-check selection maps a launcher to its bundle through the"
  echo "launcher's bundle= line, so a test that runs this launcher is not"
  echo "selected when a source its bundle holds changes. Assign the bundle first:"
  echo "  bundle=\"\$script_dir/board/<name>.mjs\""
  echo "  exec node \"\$bundle\" \"\$@\""
  echo
  echo "Launchers that exec a literal bundle path:"
  printf '%s\n' "$violations"
  exit 1
fi

echo "Launcher bundles: clean."
