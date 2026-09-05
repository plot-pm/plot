#!/usr/bin/env bash
# Plot helper: Get plan PR state for a slug
# Usage: plot-pr-state.sh <slug>
# Output: JSON with number, state, isDraft, status, mergeCommit fields
# Designed for small-model consumption: structured JSON output, no interpretation needed.
#
# THE HOST IS ASKED THROUGH `plot-host.sh`, never `gh` directly. This script
# called `gh pr list --head idea/<slug>` until 2026-09-05, which meant a plan PR
# could be looked up on GitHub and nowhere else: on Bitbucket the call was not
# wrong, it was absent, and the helper answered `{"found": false}` about a plan
# whose PR was open. Routing it through the adapter is what makes the question
# host-agnostic — `pr-state` resolves a branch on both backends.
#
# `mergedAt` BECAME `mergeCommit`, and that is the one shape change. The adapter
# reports which commit carries the merge rather than when it happened, because
# `git tag --contains <sha>` answers "which release holds this?" exactly where a
# timestamp cannot. Nothing in this repo read the old field — grepped
# 2026-09-05, zero consumers outside this file — and `status` is what every
# caller branches on.

set -euo pipefail

SLUG="${1:?Usage: plot-pr-state.sh <slug>}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# A failed host call and a plan with no PR both answer `{"found": false}` here,
# which is the failure direction this helper has always had: `2>/dev/null` on
# the original `gh` call swallowed the same distinction. Routing must not turn a
# tolerated failure into a fatal one, so the tolerance is kept deliberately —
# `pr-state` exits 0 with state NONE on a miss, and a real transport failure
# lands in the same `|| PR_JSON=""` the old redirect produced.
PR_JSON=$(bash "$script_dir/plot-host.sh" pr-state "idea/${SLUG}" 2>/dev/null) || PR_JSON=""

# NONE is the adapter's word for "no PR found", and it arrives on exit 0 — so
# the miss is read from the payload, not from a status. An empty payload is the
# call itself having failed, and both answer the same way.
STATE=$(printf '%s' "$PR_JSON" | jq -r '.state // "NONE"' 2>/dev/null) || STATE="NONE"

if [ -z "$PR_JSON" ] || [ "$STATE" = "NONE" ]; then
  echo '{"found": false}'
  exit 0
fi

IS_DRAFT=$(printf '%s' "$PR_JSON" | jq -r '.draft')
NUMBER=$(printf '%s' "$PR_JSON" | jq -r '.number')
MERGE_COMMIT=$(printf '%s' "$PR_JSON" | jq -r '.mergeCommit // empty')

if [ "$STATE" = "MERGED" ]; then
  STATUS="merged"
elif [ "$STATE" = "CLOSED" ]; then
  STATUS="closed"
elif [ "$IS_DRAFT" = "true" ]; then
  STATUS="draft"
else
  STATUS="ready"
fi

jq -n \
  --argjson found true \
  --argjson number "$NUMBER" \
  --arg state "$STATE" \
  --argjson isDraft "$IS_DRAFT" \
  --arg status "$STATUS" \
  --arg mergeCommit "$MERGE_COMMIT" \
  '{found: $found, number: $number, state: $state, isDraft: $isDraft, status: $status, mergeCommit: $mergeCommit}'
