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

# The index that covers a home is found by walking UP from the home to the
# first project boundary (the index file itself, or a CLAUDE.md/AGENTS.md/
# .git marking a nested project — e.g. an embedded test-fixture repo). A
# nested project without the index file is not checkable against THIS
# repo's index: S4 is skipped for it (empty result), never false-flagged.
index_for_home() {
  local d="$1"
  while :; do
    if [ -f "$d/$INDEX_FILE" ]; then printf '%s\n' "$d/$INDEX_FILE"; return; fi
    if [ "$d" != "." ] && { [ -f "$d/CLAUDE.md" ] || [ -f "$d/AGENTS.md" ] || [ -e "$d/.git" ]; }; then
      return   # nested project boundary without the index — skip S4
    fi
    [ "$d" = "." ] || [ "$d" = "/" ] && break
    d="$(dirname "$d")"
  done
  [ -f "$INDEX_FILE" ] && printf '%s\n' "$INDEX_FILE"
}

# Story homes: parents of tracked STORY files that follow the convention
# <home>/<slug>/STORY-<slug>.md (the dir name must equal the slug — this
# excludes shipped/copied STORY-template.md files and any stray match),
# normalized past archived/, plus the configured default.
homes=$(
  { git ls-files '*STORY-*.md' 2>/dev/null | while IFS= read -r f; do
      base="$(basename "$f")"
      slug="${base#STORY-}"; slug="${slug%.md}"
      dir="$(dirname "$f")"
      [ "$(basename "$dir")" = "$slug" ] || continue
      home="$(dirname "$dir")"
      printf '%s\n' "${home%/archived}"
    done
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
    first="$(head -1 "$story" | tr -d '\r')"
    status=""
    if [ "$first" = "---" ]; then
      status="$(awk '{ gsub(/\r/, "") } /^---$/{n++; next} n==1 && tolower($0) ~ /^status:/ {sub(/^[^:]*:[ \t]*/, ""); print; exit}' "$story")"
      [ -n "$status" ] || say "S2 $story — frontmatter has no status: key"
    else
      say "S2 $story — no frontmatter"
    fi
    status_lc="$(echo "$status" | tr '[:upper:]' '[:lower:]')"
    case "$dir" in
      */archived/*) in_archived=1 ;;
      *) in_archived=0 ;;
    esac
    # S3 is the shell half of `archivalIsConsistent`
    # (packages/domain/src/entities/story.ts) and of the `archive-date-missing`
    # refusal in `transitions/story.ts`: done and an `archived:` date are two
    # writes that must agree, so either alone is a half-archived story.
    #
    # DELIBERATELY DUPLICATED, not bundled, and this comment is the choice.
    # The nine bundles under scripts/board/ each answer a question their caller
    # cannot compute — a merge state, a transition record, an eligibility
    # verdict. This one is `status == done` against `grep -qi '^archived:'`, two
    # lines that cannot drift from the invariant because they ARE the invariant.
    # A bundle would buy nothing and cost a `node` spawn per story on a lint
    # that already reads every frontmatter itself; there is no Story object here
    # to hand it without writing a second parser to build one.
    #
    # The duplication that mattered was the VOCABULARY — six statuses declared
    # twice and a seventh derived against a `string` type. This check names no
    # status but `done`, so it cannot drift by gaining one.
    if [ "${status_lc%% *}" = "done" ] && [ "$in_archived" = 0 ] \
       && ! grep -qi '^archived:' "$story"; then
      say "S3 $story — status done but not archived (no archived/ location, no archived: date)"
    fi
    home_index="$(index_for_home "$home")"
    if [ "$in_archived" = 0 ] && [ -n "$home_index" ] \
       && ! grep -qF "$base/STORY-" "$home_index"; then
      say "S4 $story — active story not listed in $home_index"
    fi
  done
done

echo "story-lint: $findings finding(s)"
[ "$findings" -eq 0 ]
