#!/usr/bin/env bash
# Plot helper: lint the story estate for mechanical drift.
# Usage: plot-story-lint.sh [--quiet]
# Checks (per story home discovered via `git ls-files '*STORY-*.md'` plus
# story-directory config):
#   S1  story folder without a STORY-*.md file
#   S2  STORY file without frontmatter, or without a `status:` key
#   S3  status done but neither archived/ location nor `archived:` date
#   S4  active story missing from the Story index file
# Output: one line per finding (`S<n> <path> — <what>`), then a
# machine-countable footer `story-lint: <n> finding(s)`. Exit 1 if any
# findings, 0 if clean — gate-friendly. Read-only; reports, never fixes.
# Designed for small-model consumption: structured lines, no interpretation.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUIET="${1:-}"
findings=0

say() { [ "$QUIET" = "--quiet" ] || echo "$1"; findings=$((findings+1)); }

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
cd "$root"

INDEX_FILE="$(bash "$HERE/plot-config.sh" get "Story index" "README.md")"

# Story homes: parents of tracked STORY files + the configured default.
homes=$(
  { git ls-files '*STORY-*.md' 2>/dev/null | sed -E 's#/[^/]+/STORY-[^/]+$##'
    bash "$HERE/plot-config.sh" get "Story directory" "docs/stories/" | sed 's#/$##'
  } | sort -u
)

for home in $homes; do
  [ -d "$home" ] || continue
  for dir in "$home"/*/ "$home"/archived/*/; do
    [ -d "$dir" ] || continue
    dir="${dir%/}"
    base="$(basename "$dir")"
    [ "$base" = "archived" ] && continue
    story="$(ls "$dir"/STORY-*.md 2>/dev/null | head -1)"
    if [ -z "$story" ]; then
      # only flag folders that contain tracked files (scratch dirs are ignored)
      if [ -n "$(git ls-files "$dir" 2>/dev/null)" ]; then
        say "S1 $dir — story folder without a STORY-*.md file"
      fi
      continue
    fi
    first="$(head -1 "$story")"
    status=""
    if [ "$first" = "---" ]; then
      status="$(awk '/^---$/{n++; next} n==1 && tolower($0) ~ /^status:/ {sub(/^[^:]*:[ \t]*/, ""); print; exit}' "$story")"
      [ -n "$status" ] || say "S2 $story — frontmatter has no status: key"
    else
      say "S2 $story — no frontmatter"
    fi
    status_lc="$(echo "$status" | tr '[:upper:]' '[:lower:]')"
    case "$dir" in
      */archived/*) in_archived=1 ;;
      *) in_archived=0 ;;
    esac
    if [ "${status_lc%% *}" = "done" ] && [ "$in_archived" = 0 ] \
       && ! grep -qi '^archived:' "$story"; then
      say "S3 $story — status done but not archived (no archived/ location, no archived: date)"
    fi
    if [ "$in_archived" = 0 ] && [ -f "$INDEX_FILE" ] \
       && ! grep -q "$base" "$INDEX_FILE"; then
      say "S4 $story — active story not listed in $INDEX_FILE"
    fi
  done
done

echo "story-lint: $findings finding(s)"
[ "$findings" -eq 0 ]
