#!/usr/bin/env bash
# Plot helper: Get review status for sprint items
# Usage: plot-review-status.sh <sprint-slug>
# Output: JSON array of {slug, pr, prs, branch, reviewed_at, review_sha, head_sha, needs_review}
# `pr` is the annotation's first PR number (or "none"); `prs` is every PR
# number the `pr:` field names, de-duplicated, in order of appearance.
# Parses sprint file annotations and compares HEAD SHAs via git ls-remote.
# Designed for small-model consumption: structured JSON output, no interpretation needed.

set -euo pipefail

SLUG="${1:?Usage: plot-review-status.sh <sprint-slug>}"

SPRINT_FILE=$(ls docs/sprints/*-"${SLUG}".md 2>/dev/null | head -1)
if [ -z "$SPRINT_FILE" ]; then
  echo '{"error": "Sprint file not found", "items": []}'
  exit 0
fi

# Parse plan-backed items with annotations
# Format: - [ ] [slug] description <!-- pr: #N, branch: feature/foo, review_sha: abc123 -->
#
# `status:` WAS READ HERE and is gone, 2026-09-08. `status = merged` skipped the
# review, and the arm was unreachable: no writer ever wrote that value —
# /plot-approve wrote `approved`, /plot-deliver `delivered` — and zero of the 67
# annotated lines on the estate carried it. `review_sha` answers the same
# question by measurement, which is why removing the shortcut costs nothing.

RESULT="["
FIRST=true

while IFS= read -r line; do
  # Only a checklist line can be a sprint item — a comment or prose line
  # (e.g. the template's scope-change format line) never reaches extraction.
  [[ "$line" =~ ^[[:space:]]*-\ \[[\ xX]\] ]] || continue

  # [slug] when present, else the item's own key/text (after the checkbox,
  # before the first annotation comment, trimmed).
  ITEM_SLUG=$(echo "$line" | grep -oE '\[([a-z0-9-]+)\]' | head -1 | tr -d '[]' || true)
  [ -z "$ITEM_SLUG" ] && ITEM_SLUG=$(echo "$line" | sed -E 's/^[[:space:]]*- \[[ xX]\][[:space:]]*//; s/<!--.*//; s/[[:space:]]+$//')
  [ -z "$ITEM_SLUG" ] && continue

  # Check if item has an annotation comment
  ANNOTATION=$(echo "$line" | grep -oE '<!--.*-->' || true)
  [ -z "$ANNOTATION" ] && continue

  # Walk the annotation comma by comma, tracking which `key:` is active (a
  # comma-separated chunk with none continues the previous key — needed for
  # "pr: #1 #2" and a repeated "pr:" key), and collect every `#<number>`
  # while that key is `pr`. This is what keeps `branch:`/`review_sha:`
  # numbers out: a single `#[0-9]+` grep over the whole annotation cannot
  # tell which key a digit belongs to.
  PRS=$(echo "$ANNOTATION" | awk 'BEGIN{RS=","} match($0,/[a-z_]+:/){k=substr($0,RSTART,RLENGTH-1)} k=="pr"{n=$0;while(match(n,/#[0-9]+/)){v=substr(n,RSTART+1,RLENGTH-1);if(!(v in seen)){seen[v]=1;print v};n=substr(n,RSTART+RLENGTH)}}' || echo "")
  BRANCH=$(echo "$ANNOTATION" | grep -oE 'branch: [^ ,>]+' | sed 's/branch: //' || echo "")
  REVIEWED_AT=$(echo "$ANNOTATION" | grep -oE 'reviewed_at: [^ ,>]+' | sed 's/reviewed_at: //' || echo "")
  REVIEW_SHA=$(echo "$ANNOTATION" | grep -oE 'review_sha: [^ ,>]+' | sed 's/review_sha: //' || echo "")

  # Determine current HEAD SHA for the branch
  HEAD_SHA=""; NEEDS_REVIEW=true

  if [ -n "$BRANCH" ]; then
    HEAD_SHA=$(git ls-remote origin "$BRANCH" 2>/dev/null | cut -f1 || echo "")
    if [ -z "$HEAD_SHA" ]; then
      HEAD_SHA="branch-not-found"
    elif [ -n "$REVIEW_SHA" ] && [ "$HEAD_SHA" = "$REVIEW_SHA" ]; then
      NEEDS_REVIEW=false
    fi
  fi

  [ "$FIRST" = true ] && FIRST=false || RESULT="${RESULT},"

  RESULT="${RESULT}$(jq -n \
    --arg slug "$ITEM_SLUG" \
    --arg prs_raw "$PRS" \
    --arg branch "$BRANCH" \
    --arg reviewed_at "$REVIEWED_AT" \
    --arg review_sha "$REVIEW_SHA" \
    --arg head_sha "$HEAD_SHA" \
    --argjson needs_review "$NEEDS_REVIEW" \
    '($prs_raw | split("\n") | map(select(length > 0))) as $prs | {slug: $slug, pr: ($prs[0] // "none"), prs: $prs, branch: $branch, reviewed_at: $reviewed_at, review_sha: $review_sha, head_sha: $head_sha, needs_review: $needs_review}'
  )"
done < "$SPRINT_FILE"

RESULT="${RESULT}]"

jq -n --argjson items "$RESULT" '{items: $items}'
