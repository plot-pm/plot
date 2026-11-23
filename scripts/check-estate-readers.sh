#!/usr/bin/env bash
# AN ESTATE READER DECLARES WHAT IT READS. A contract test that lists the
# repository's own plan or sprint directory reads every file in it, so a pull
# request that changes only a plan can fail it. `plot-local-checks.mjs` selects
# such a test for a changed plan only where the test holds the line
#
#     // plot-reads: <dir>
#
# for that directory (`estateReaders` in `packages/domain/src/rules/local-checks.ts`).
# This gate fails on a `test/reconcile/*.test.mjs` file that calls
# `readdirSync` and builds the `Plan directory` or `Sprint directory` from the
# repository root, with no marker for that directory.
#
# Measured 2026-11-04: plan PRs #3114 and #3127 passed CI and turned main red
# from fbf670eaf, because the two parser tests that read docs/plans were never
# selected for a plan path.
#
# A path counts as built from the repository root where the directory's
# segments follow `'..'` or an identifier the file assigns as
# `path.join|resolve(<x>, '..', '..')`, as in
# `path.join(here, '..', '..', 'docs', 'plans')` or
# `path.join(repoRoot, 'docs/plans')`. A sandbox's `docs/plans` is built from
# its own directory and does not count.
#
# Usage: check-estate-readers.sh [repo-root]   (default: this repository)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
root="${1:-$here}"
config="$here/skills/plot/scripts/plot-config.sh"

dirs=""
for key in "Plan directory:docs/plans/" "Sprint directory:docs/sprints/"; do
  dir=$(PLOT_REPO_ROOT="$root" bash "$config" get "${key%%:*}" "${key#*:}")
  dir="${dir#./}"
  while [ "${dir%/}" != "$dir" ]; do dir="${dir%/}"; done
  [ -n "$dir" ] && dirs="$dirs$dir
"
done

# The directory as a path argument: `'a', 'b'` segments or one `'a/b'` string.
segments() {
  printf '%s' "$1" | sed -e 's/[][\.*^$]/\\&/g' -e "s#/#['\"],[[:space:]]*['\"]#g"
}

bad=""
for f in "$root"/test/reconcile/*.test.mjs; do
  [ -e "$f" ] || continue
  grep -q 'readdirSync' "$f" || continue
  anchors=$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?(const|let)[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*path\.(join|resolve)\([^)]*'\.\.',[[:space:]]*'\.\.'\);?[[:space:]]*$/\3/p" "$f" | tr '\n' '|')
  anchor="'\\.\\.'|\\\$\\{(${anchors}__none__)\\}|(^|[^A-Za-z0-9_$.])(${anchors}__none__)"
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    quoted=$(printf '%s' "$dir" | sed -e 's/[][\.*^$]/\\&/g')
    pattern="(${anchor})[[:space:]]*,[[:space:]]*['\"](($(segments "$dir"))|${quoted})['\"/]|(${anchor})/${quoted}"
    grep -q -E "$pattern" "$f" || continue
    grep -q -E "^[[:space:]]*//[[:space:]]*plot-reads:[[:space:]]*(\./)?${quoted}/?[[:space:]]*$" "$f" && continue
    bad="$bad  ${f#"$root"/}  reads $dir
"
  done <<EOF
$dirs
EOF
done

if [ -n "$bad" ]; then
  echo "::error::a contract test reads the plan estate and does not declare it."
  echo "A plan PR selects only the tests that declare the directory they read,"
  echo "so this test would not run for the change that can break it."
  printf '%s' "$bad"
  echo "Add the line '// plot-reads: <dir>' to each file, for each directory named."
  exit 1
fi

echo "estate readers: every test that reads the plan or sprint directory declares it."
