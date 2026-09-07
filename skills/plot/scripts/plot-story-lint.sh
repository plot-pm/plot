#!/usr/bin/env bash
# Plot helper: lint the story estate for mechanical drift.
# Usage: plot-story-lint.sh [--quiet]
# Checks (per story home discovered via `git ls-files '*STORY-*.md'` plus
# story-directory config):
#   S1  story folder without a STORY-*.md file
#   S2  STORY file without frontmatter, or without a `status:` key
#   S3  status done but neither archived/ location nor `archived:` date
#   S4  active story missing from the Story index file
#   S5  story whose written status is behind what its plans say (advisory)
# Output: one line per finding (`S<n> <path> — <what>`), then a
# machine-countable footer `story-lint: <n> finding(s)`. Read-only; reports,
# never fixes.
#
# EXIT: 1 when any of S1-S4 found something, 0 otherwise. S5 is ADVISORY and
# does not gate, while S1-S4 do. The four are broken pointers — a missing file,
# absent frontmatter, a half-written archival, a stale index — each repairable
# by a mechanical edit anyone can make. S5 is a reporting gap: the repair is a
# word only a person can choose, because `entities/story.ts:3` settles that no
# mechanism can observe whether knowledge is still being added to. Gating on it
# would stop a delivery until somebody made a judgement call the lint is
# forbidden from making for them.
#
# The footer counts all five, so a reader sees every finding; the exit code
# answers the narrower question a gate asks.
# Designed for small-model consumption: structured lines, no interpretation.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUIET="${1:-}"
findings=0

say() { [ "$QUIET" = "--quiet" ] || echo "$1"; findings=$((findings+1)); }

root=$(git rev-parse --show-toplevel 2>/dev/null) || root="."
cd "$root"

gate_findings=0
gate() { say "$1"; gate_findings=$((gate_findings+1)); }

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

# Which plans name which story, as `<story> <phase>` lines — read once for the
# whole estate rather than per story. `plot-plan-meta.sh` is the format
# contract and would be the right caller, but it costs ~0.28 s per plan and
# this repo holds 222 of them; a lint that took a minute would not be run.
#
# The two fields are read directly, and this does NOT repeat the duplication
# that mattered. That one was VOCABULARY — six statuses declared twice and a
# seventh derived against a `string` type. This awk names no phase and no
# status: it passes whatever word the plan carries through to the domain, which
# holds the only list. A plan with no `**Phase:**` is not a plan (the rule
# `plot-reconcile-scan.sh` applies) and contributes nothing.
#
# It flushes on the NEXT file's first line rather than in `ENDFILE`: that is a
# gawk extension, and macOS awk ignores it silently — the pattern never fires,
# the index comes back empty, and S5 reports nothing anywhere while exiting 0.
PLAN_DIR="$(bash "$HERE/plot-config.sh" get "Plan directory" "docs/plans/")"
STANDING="$HERE/board/plot-standing.mjs"
plan_phases=""
if [ -d "$PLAN_DIR" ]; then
  plan_phases=$(awk '
    function flush() { if (story != "" && phase != "") print story, phase; story=""; phase="" }
    FNR==1 { flush() }
    /^- \*\*Story:\*\*/ { s=$0; sub(/^[^:]*:\*\*[ \t]*/, "", s); gsub(/[ \t]+$/, "", s); story=s }
    /^- \*\*Phase:\*\*/ { s=$0; sub(/^[^:]*:\*\*[ \t]*/, "", s); gsub(/[ \t]+$/, "", s); phase=tolower(s) }
    END { flush() }
  ' "$PLAN_DIR"/*.md 2>/dev/null)
fi

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
        gate "S1 $dir — story folder without a STORY-*.md file"
      fi
      continue
    fi
    first="$(head -1 "$story" | tr -d '\r')"
    status=""
    if [ "$first" = "---" ]; then
      status="$(awk '{ gsub(/\r/, "") } /^---$/{n++; next} n==1 && tolower($0) ~ /^status:/ {sub(/^[^:]*:[ \t]*/, ""); print; exit}' "$story")"
      [ -n "$status" ] || gate "S2 $story — frontmatter has no status: key"
    else
      gate "S2 $story — no frontmatter"
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
      gate "S3 $story — status done but not archived (no archived/ location, no archived: date)"
    fi
    home_index="$(index_for_home "$home")"
    if [ "$in_archived" = 0 ] && [ -n "$home_index" ] \
       && ! grep -qF "$base/STORY-" "$home_index"; then
      gate "S4 $story — active story not listed in $home_index"
    fi

    # S5 — the written status against what the plans prove. The comparison is
    # the domain's (`transitions/story.ts`, reached through plot-standing.mjs),
    # so the lint holds no list of statuses and no notion of which is further
    # along. It reports both words and corrects neither: which status a story
    # should carry is a person's, and this says only that the plans have moved
    # past the one written down.
    if [ "$in_archived" = 0 ] && [ -n "$status_lc" ] && [ -s "$STANDING" ]; then
      phases=$(printf '%s\n' "$plan_phases" | awk -v s="$base" '$1 == s { print $2 }' | tr '\n' ' ')
      drift=$(printf '%s\t%s\n' "$status_lc" "${phases% }" \
              | node "$STANDING" 2>/dev/null | cut -f2)
      [ -n "$drift" ] && say "S5 $story — status $status_lc but $drift"
    fi
  done
done

echo "story-lint: $findings finding(s)"
# S1-S4 gate; S5 reports. See the EXIT note in the header.
[ "$gate_findings" -eq 0 ]
