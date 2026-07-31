#!/usr/bin/env bash
# Plot helper: Get implementation PR states for a slug
# Usage: plot-impl-status.sh <slug>
# Reads the plan file for <slug> (date-prefixed in docs/plans/) and checks PR states.
# Cross-repo (split-home) aware: a Branches annotation `→ owner/repo#12` is
# looked up in that repo via plot-host.sh; bare `→ #12` stays local. All host
# access goes through plot-host.sh (gh or bb — never called directly here).
# Output: JSON {prs: [{number, state, draft, url, repo}]}
# Designed for small-model consumption: structured JSON output, no interpretation needed.

set -euo pipefail

SLUG="${1:?Usage: plot-impl-status.sh <slug>}"

# Read plan file from main (not CWD) so PR links are always current.
# On impl branches the local copy is stale — it lacks the → #N annotations
# that /plot-approve adds to main after creating impl PRs.
#
# Find the date-prefixed plan file via the active or delivered symlink index
PLAN_PATH=$(git ls-tree --name-only origin/main docs/plans/ 2>/dev/null \
  | grep -E "[0-9]{4}-[0-9]{2}-[0-9]{2}-${SLUG}\.md$" | head -1)
if [ -n "$PLAN_PATH" ]; then
  PLAN_CONTENT=$(git show "origin/main:${PLAN_PATH}" 2>/dev/null || true)
else
  PLAN_CONTENT=""
fi

if [ -z "$PLAN_CONTENT" ]; then
  echo '{"error": "Plan file not found on main", "prs": []}'
  exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse PR references from ## Branches section.
# Formats: `→ #12` (this repo) and `→ owner/repo#12` (split-home impl repo).
PR_REFS=$(echo "$PLAN_CONTENT" \
  | sed -n '/^## Branches/,/^## /p' \
  | grep -oE '→ [A-Za-z0-9_.-]*/?[A-Za-z0-9_.-]*#[0-9]+' \
  | sed 's/^→ //' \
  | sort -u)

if [ -z "$PR_REFS" ]; then
  echo '{"error": "No PR references found in plan", "prs": []}'
  exit 0
fi

# Build JSON array of PR states via the host adapter
RESULT="["
FIRST=true
for REF in $PR_REFS; do
  NUM="${REF##*#}"
  REPO="${REF%#*}"
  if [ -n "$REPO" ]; then
    PR_JSON=$(bash "$HERE/plot-host.sh" pr-state "$NUM" --repo "$REPO" 2>/dev/null || echo '{"state":"NONE"}')
  else
    PR_JSON=$(bash "$HERE/plot-host.sh" pr-state "$NUM" 2>/dev/null || echo '{"state":"NONE"}')
  fi

  if [ "$(echo "$PR_JSON" | jq -r .state)" = "NONE" ]; then
    continue
  fi

  PR_JSON=$(echo "$PR_JSON" | jq -c --arg repo "$REPO" '. + {repo: $repo}')

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    RESULT="${RESULT},"
  fi

  RESULT="${RESULT}${PR_JSON}"
done
RESULT="${RESULT}]"

jq -n --argjson prs "$RESULT" '{prs: $prs}'
