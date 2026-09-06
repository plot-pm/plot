#!/usr/bin/env bash
# EVERY GENERATED BUNDLE IS MARKED `-merge`.
#
# MEASURED 2026-09-05, rebasing `feature/a-story-lifecycle-refuses` onto main:
#
#     board-server.mjs      0 conflict markers   (marked -merge)
#     plot-ask.mjs          5 conflict markers   (NOT marked)
#     plot-registryd.mjs    3 conflict markers   (NOT marked)
#
# The marked file behaved as `.gitattributes` documents: git kept one side whole
# and wrote no markers, so the artifact stayed valid JavaScript through the
# conflict. The two unmarked ones were line-merged, and eight conflict markers
# were spliced into generated output — which is committable, pushable, and not
# JavaScript. Four separate branches then hand-resolved the same three bundles.
#
# THIS DEFECT WAS BORN THE WAY A PROSE REMINDER FAILS. `.gitattributes` named
# one file, `build.mjs` gained seven more outputs, and not one of those seven
# touched `.gitattributes`. Nothing asked. CLAUDE.md's test — can you answer
# "did I complete this?" without doing the work? — a note asking the next author
# to remember a list fails it, so this is a gate.
#
# SO THE EMITTED SET IS DERIVED FROM `build.mjs`, never listed here. The build
# declares each output as `const shippedX = path.join(here, '…')`, and that
# declaration is what an author writes when adding one. A list in this script
# would be a second place to forget, which is the defect wearing a hat.
#
# AND A NINTH ARRIVED WHILE THE PLAN SAT IN DRAFT. `plot-landed.mjs` came with
# #706 on 2026-09-06, after the brief had counted eight and named them. The
# derivation found it; a hand-written list would have shipped the same hole
# under a new filename, one day old. That is the argument, measured on itself.
#
# WHAT IT DOES NOT DEMAND: a tracked file that no `build.mjs` output names.
# `plot-monitor.mjs` is committed and documented at `entry/monitor.ts:14`, and
# appears in no `outfile`. Nothing rebuilds it, so it has no deterministic
# rebuild — and the deterministic rebuild is the whole licence for `-merge`,
# because "keep either side, then rebuild" is only safe when the rebuild
# overwrites what was kept. Marking it would assert a rebuild that does not
# exist. The gate reads the build, so it cannot ask for it.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven — a gate nothing tests is a gate that passes because nobody
# looked. See test/reconcile/bundle-attribute-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

BUILD='packages/board/build.mjs'
ATTRIBUTES='.gitattributes'

for required in "$BUILD" "$ATTRIBUTES"; do
  if [ ! -f "$required" ]; then
    echo "::error::$required is missing; the bundle set cannot be derived."
    exit 2
  fi
done

# The emitted set, read from the build's own declarations. `-a` because a
# generated-output check must never be blinded by a NUL byte the way six gates
# already were here — `build.mjs` is source today, and the banner and vendoring
# blocks it carries are exactly where one would arrive.
emitted=$(grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$BUILD" \
  | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" \
  | sort -u)

if [ -z "$emitted" ]; then
  echo "::error::no shipped bundles found in $BUILD."
  echo
  echo "This gate derives the set from declarations shaped"
  echo "  const shippedX = path.join(here, '../../<path>');"
  echo "Finding none means the build changed shape and the gate is now blind,"
  echo "which is worse than the defect it was written for. Fix the derivation."
  exit 2
fi

count=$(printf '%s\n' "$emitted" | grep -c .)
echo "bundles emitted by $BUILD: $count"

unmarked=""
while IFS= read -r bundle; do
  [ -n "$bundle" ] || continue
  # The attribute as git resolves it, not as the file spells it. `git
  # check-attr` reads precedence, later-line override and pattern syntax — a
  # grep for the path would call a bundle marked that a subsequent line unset.
  state=$(git check-attr merge -- "$bundle" 2>/dev/null | sed 's/.*: //')
  if [ "$state" != "unset" ]; then
    unmarked="${unmarked}${bundle} (merge: ${state:-unreadable})
"
  fi
done <<EOF
$emitted
EOF

if [ -n "$unmarked" ]; then
  echo "::error::a generated bundle would be line-merged into invalid JavaScript."
  echo
  echo "git blends two versions of these files line by line. They are minified"
  echo "bundles of a few enormous lines, so disjoint source changes collide"
  echo "there, and the conflict markers git splices in are committable, are"
  echo "pushable, and are not JavaScript. Measured 2026-09-05: eight markers in"
  echo "two bundles, in one rebase."
  echo
  echo "Mark each in .gitattributes, beside the others:"
  echo
  printf '%s' "$unmarked" | sed 's/ (merge:.*//' | sed 's/^/    /' | sed 's/$/ -merge/'
  echo
  echo "-merge keeps one side whole and writes no markers. The resolution is to"
  echo "rebuild, never to read the diff: the artifact is deterministic output,"
  echo "so which side survives cannot matter."
  echo
  echo "Unmarked bundles:"
  printf '%s' "$unmarked"
  exit 1
fi

echo "Bundle attributes: clean."
exit 0
