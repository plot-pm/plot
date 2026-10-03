#!/usr/bin/env bash
# A PR'S DIFF CARRIES NO GENERATED BUNDLE.
#
# Today each PR commits its own build of the 34 generated paths under
# `skills/plot/scripts/board/`, listed in `BOARD_ARTIFACT_PATHS`
# (`packages/board/src/contract/bundles.generated.ts`). Every merge to `main`
# then makes every OTHER open PR's checked-in build stale, which the `-merge`
# attribute cannot fix: GitHub computes mergeability without reading
# `.gitattributes`. Measured 2026-10-02: after one PR merged, 10 open PRs read
# DIRTY and 9 of them conflicted only in bundles.
#
# `main` now builds and pushes its own bundles after every merge
# (`bug/main-builds-its-bundles`, #1249). A generated path in a PR's diff is
# therefore never this branch's work — it is a stale or hand-rebuilt copy of
# what `main` will produce on its own, and the fix is to drop it, never to
# read it.
#
# THE SET IS DERIVED, NEVER LISTED HERE. `build.mjs` declares each output as
# `const shippedX = path.join(here, '../../<path>')`; that declaration is what
# an author writes when adding a bundle, and a second list in this script would
# be a second place to forget — the defect `check-bundle-attributes.sh` was
# written for, wearing a different hat. The same `grep`/`sed` derivation is
# reused here verbatim so the two gates can never name different sets.
#
# THE SET IS NEVER THE DIRECTORY. `skills/plot/scripts/board/` holds 36 files;
# 34 are generated and 2 — `README.md` and `plot-monitor.mjs` — are written by
# hand. A gate on the directory would refuse a legitimate change to either.
#
# `bundles.generated.ts` AND `.gitattributes` ARE NEVER REFUSED. Two PRs that
# each add a bundle still conflict there, and reading that conflict is the
# correct repair — refusing it would block the PR that adds the next bundle.
#
# THE DIFF IS AGAINST THE MERGE BASE, NEVER `origin/main` OR `HEAD` ALONE.
# `origin/main` has moved on by the time a PR is reviewed, and diffing against
# it would blame a branch for bundles `main` itself changed after the branch
# was cut. `HEAD` alone cannot tell "the branch changed this" from "the branch
# never touched this", which is the same reason the restore line below reads
# from the merge base rather than from either tip.
#
# THE REFUSAL PRINTS THE EXACT REPAIR: one `git checkout <merge-base> --
# <path>` per changed generated path that the merge base holds, and `git rm`
# for one the merge base lacks (a path born on this branch, which a checkout
# from the merge base cannot restore because it was never there). It never
# prints the directory, because the directory also holds the two hand-written
# files this gate must not touch.

set -uo pipefail

# The tree to check. Defaults to this script's repo, which is what CI runs. An
# explicit root exists so the gate can be pointed at a fixture and its own
# refusal proven. See test/reconcile/no-bundle-diff-gate.test.mjs.
cd "${1:-$(dirname "${BASH_SOURCE[0]}")/..}" || exit 2

# The merge base. Defaults to `HEAD` against `origin/main`, the shape every PR
# run reads; a fixture overrides both refs via $2/$3 to compare a feature
# branch against a base commit that never touched the network.
HEAD_REF="${2:-HEAD}"
BASE_REF="${3:-origin/main}"

BUILD='packages/board/build.mjs'
GENERATED_SET_TS='packages/board/src/contract/bundles.generated.ts'
ATTRIBUTES='.gitattributes'

if [ ! -f "$BUILD" ]; then
  echo "::error::$BUILD is missing; the bundle set cannot be derived."
  exit 2
fi

generated=$(grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$BUILD" \
  | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" | sort -u)

if [ -z "$generated" ]; then
  echo "::error::no shipped bundles found in $BUILD; the derivation is blind."
  exit 2
fi

merge_base=$(git merge-base "$HEAD_REF" "$BASE_REF" 2>/dev/null)
if [ -z "$merge_base" ]; then
  echo "::error::no merge base between $HEAD_REF and $BASE_REF; cannot check the diff."
  exit 2
fi

changed=$(git diff --name-only "$merge_base" "$HEAD_REF" 2>/dev/null)

touched=""
while IFS= read -r path; do
  [ -n "$path" ] || continue
  # `bundles.generated.ts` and `.gitattributes` are never refused: two PRs
  # that each add a bundle still conflict there, and that conflict is the
  # correct one to read.
  [ "$path" = "$GENERATED_SET_TS" ] && continue
  [ "$path" = "$ATTRIBUTES" ] && continue
  if printf '%s\n' "$generated" | grep -qxF "$path"; then
    touched="${touched}${path}
"
  fi
done <<EOF
$changed
EOF

if [ -z "$touched" ]; then
  echo "No bundle diff: clean."
  exit 0
fi

echo "::error::this diff changes a generated board bundle. main builds its own bundles after every merge; a PR must not carry one."
echo
echo "Restore each from the merge base, and remove one the merge base never had:"
echo

while IFS= read -r path; do
  [ -n "$path" ] || continue
  if git cat-file -e "$merge_base:$path" 2>/dev/null; then
    echo "    git checkout \"$merge_base\" -- $path"
  else
    echo "    git rm $path"
  fi
done <<EOF
$touched
EOF

echo
echo "Changed generated paths:"
printf '%s' "$touched"
exit 1
