#!/usr/bin/env bash
# Every changeset names a package the workspace actually has.
#
# WHY THIS EXISTS. `changeset version` refuses OUTRIGHT on a single unknown
# package name — it does not skip the file, it aborts the whole run:
#
#     Found changeset X for package @plot-pm/plot which is not in the workspace
#
# Measured 2026-08-26: six changesets named `@plot-pm/plot` (x4),
# `@plot-pm/skills` and `plot-deliver`, none of which is a workspace package.
# The release PR could therefore never regenerate. It sat at 8 of 98 changesets
# for FOUR DAYS, 355 commits behind main, and nothing reported why — the
# automation simply stopped producing updates. Merging it would have shipped a
# 2.9.0 whose changelog omitted 89 entries.
#
# The failure mode is the point: a refusal nobody sees is indistinguishable
# from nothing needing to be done. This turns it into a red PR check the day
# the bad name is written, rather than a silent freeze discovered at release.
#
# THE VALID NAMES ARE DERIVED, never hardcoded. They come from the workspace's
# own package.json files, so adding a package cannot leave this check stale.
set -euo pipefail

cd "$(dirname "$0")/.."

# The workspace's real package names: the root, plus every packages/* that has
# a package.json. Mirrors `pnpm-workspace.yaml` ("." and "packages/*").
valid=$(
  {
    node -pe "require('./package.json').name"
    for d in packages/*/; do
      [ -f "$d/package.json" ] && node -pe "require('./$d/package.json').name"
    done
  } | sort -u
)

[ -n "$valid" ] || { echo "check-changeset-packages: no workspace packages found" >&2; exit 2; }

fail=0
for f in .changeset/*.md; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in README.md|_template*) continue ;; esac

  # Frontmatter only — the body may legitimately mention anything. A changeset
  # with no frontmatter block yields nothing and is left to `changeset` itself.
  names=$(awk 'NR==1 && /^---/ {fm=1; next} fm && /^---/ {exit} fm && /:/ {
      gsub(/["'"'"']/, ""); sub(/:.*/, ""); gsub(/^[ \t]+|[ \t]+$/, ""); if ($0 != "") print
    }' "$f")

  for n in $names; do
    if ! printf '%s\n' "$valid" | grep -qxF "$n"; then
      echo "::error file=$f::changeset names '$n', which is not a workspace package. Valid: $(printf '%s' "$valid" | tr '\n' ' ')"
      fail=1
    fi
  done
done

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "A changeset naming an unknown package makes 'changeset version' abort the"
  echo "ENTIRE release, not just that file. Fix the frontmatter name."
  exit 1
fi

echo "All changesets name workspace packages."
