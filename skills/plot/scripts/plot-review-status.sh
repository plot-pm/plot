#!/usr/bin/env bash
# Plot helper: Get review status for sprint items
# Usage: plot-review-status.sh <sprint-slug>
# Output: JSON array of {slug, pr, branch, reviewed_at, review_sha, head_sha, needs_review}
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
  # Extract slug from [slug] pattern
  ITEM_SLUG=$(echo "$line" | grep -oE '\[([a-z0-9-]+)\]' | head -1 | tr -d '[]')
  [ -z "$ITEM_SLUG" ] && continue

  # Check if item has an annotation comment
  ANNOTATION=$(echo "$line" | grep -oE '<!--.*-->' || true)
  [ -z "$ANNOTATION" ] && continue

  # Parse annotation fields
  PR=$(echo "$ANNOTATION" | grep -oE 'pr: #[0-9]+' | grep -oE '[0-9]+' || echo "")
  BRANCH=$(echo "$ANNOTATION" | grep -oE 'branch: [^ ,>]+' | sed 's/branch: //' || echo "")
  REVIEWED_AT=$(echo "$ANNOTATION" | grep -oE 'reviewed_at: [^ ,>]+' | sed 's/reviewed_at: //' || echo "")
  REVIEW_SHA=$(echo "$ANNOTATION" | grep -oE 'review_sha: [^ ,>]+' | sed 's/review_sha: //' || echo "")

  # Determine current HEAD SHA for the branch
  HEAD_SHA=""
  NEEDS_REVIEW=true

  if [ -n "$BRANCH" ]; then
    HEAD_SHA=$(git ls-remote origin "$BRANCH" 2>/dev/null | cut -f1 || echo "")
    if [ -z "$HEAD_SHA" ]; then
      HEAD_SHA="branch-not-found"
      NEEDS_REVIEW=true
    elif [ -n "$REVIEW_SHA" ] && [ "$HEAD_SHA" = "$REVIEW_SHA" ]; then
      NEEDS_REVIEW=false
    fi
  fi

  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    RESULT="${RESULT},"
  fi

  RESULT="${RESULT}$(jq -n \
    --arg slug "$ITEM_SLUG" \
    --arg pr "${PR:-none}" \
    --arg branch "$BRANCH" \
    --arg reviewed_at "$REVIEWED_AT" \
    --arg review_sha "$REVIEW_SHA" \
    --arg head_sha "$HEAD_SHA" \
    --argjson needs_review "$NEEDS_REVIEW" \
    '{slug: $slug, pr: $pr, branch: $branch, reviewed_at: $reviewed_at, review_sha: $review_sha, head_sha: $head_sha, needs_review: $needs_review}'
  )"
done < "$SPRINT_FILE"

RESULT="${RESULT}]"

jq -n --argjson items "$RESULT" '{items: $items}'
