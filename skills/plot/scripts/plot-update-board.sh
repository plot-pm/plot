#!/usr/bin/env bash
# Plot helper: Update GitHub Projects board status for a PR
# Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>
# Adds the PR to the board (idempotent) and sets its Status field.
# Designed for small-model consumption: exit 0 on success or graceful skip, exit 1 on usage error.
#
# ---------------------------------------------------------------------------
# WHY THIS SCRIPT CALLS `gh` ITSELF, AND WHAT WOULD CHANGE THAT
# ---------------------------------------------------------------------------
#
# `plot-host.sh` is the ONE place that talks to a git host CLI, gated by
# `scripts/check-host-cli-callers.sh`. This script is exempted there BY NAME,
# and this is the reason the gate's entry points at.
#
# IT IS THE TRACKER PORT'S WRITE ARM, NOT THE HOST PORT'S. Settled when issue
# tracking got its own port: `Tracker` is a `## Plot Config` key declared
# INDEPENDENTLY of `Git host`, so a repository whose code lives with one vendor
# and whose tickets live with another has two foreign services with two
# accounts and two windows. `adapters/tracker/tracker-github.ts:62` resolves
# this script and `:72` is the only thing that runs it — no other caller
# exists. So the question is not *should this route to the adapter*, it is
# *which port owns it*, and the answer is `tracker`, which is the port it is
# already behind.
#
# ROUTING IT INTO `plot-host.sh` WOULD RE-MERGE WHAT THAT SPLIT SEPARATED.
# `plot-host.sh issue-status` is the tracker port's OTHER connector — Jira —
# and it exits 4 for any other scheme, deliberately: `plot-host.sh:2754` says
# so in its own words, *"this vendor's projects surface has a script of its own
# … and the two write through different APIs under different credentials."*
# Two connectors, two credential sets, one interface above them. Moving this
# script's four calls under the Jira arm would put both vendors' tokens in one
# place, which is the shape the port was split to refuse.
#
# AND IT IS A THIRD API FAMILY BESIDES. Its four calls are `gh project view`,
# `item-add`, `field-list` and `item-edit` — the GitHub Projects v2 API.
# `plot-host.sh` answers `pr-state`, `pr-list`, `pr-merge`, `pr-create`,
# `pr-body`, `issue-list`, `issue-view` and `issue-status`, and nothing at all
# about projects. Projects is neither the git host's PR API nor the tracker's
# issue API, and it has no Bitbucket equivalent — so an adapter whose whole
# point is that both vendors can answer would gain a surface only one of them
# has.
#
# WHAT WOULD CHANGE THIS, and it is one thing rather than a mood: a SECOND
# vendor's project board needing the same four operations. Two implementations
# of one question is what every routing argument in this repo turns on, and
# today there is one — GitHub's, reached by GitHub's connector. When a second
# arrives, the abstraction belongs on the `tracker` port beside `statusWrite`,
# NOT on `plot-host.sh`: it is a tracker capability with two connectors, the
# same shape `issue-status` already has. Delete the gate's exemption then.
#
# WHAT WOULD NOT CHANGE IT: this script growing more `gh project` calls, or a
# second Plot caller inside this repository. Neither adds a vendor, and the
# exemption is about which service is being asked, not about how often.

set -euo pipefail

PR_URL="${1:?Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>}"
STATUS="${2:?Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>}"
OWNER="${3:?Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>}"
PROJECT_NUMBER="${4:?Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>}"

GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || GIT_DIR=""
if [ -n "$GIT_DIR" ]; then
  CACHE_FILE="${GIT_DIR}/plot-board-cache-${OWNER}-${PROJECT_NUMBER}.json"
else
  CACHE_FILE="/tmp/plot-board-cache-${OWNER}-${PROJECT_NUMBER}.json"
fi

# --- Load or fetch project metadata (project ID, Status field ID, options) ---

PROJECT_ID=""
FIELD_ID=""
OPTIONS_JSON=""

if [ -f "$CACHE_FILE" ]; then
  PROJECT_ID=$(jq -r '.projectId // empty' "$CACHE_FILE" 2>/dev/null || true)
  FIELD_ID=$(jq -r '.fieldId // empty' "$CACHE_FILE" 2>/dev/null || true)
  OPTIONS_JSON=$(jq -c '.options // empty' "$CACHE_FILE" 2>/dev/null || true)
fi

# Step 1: Resolve project node ID
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq '.id' 2>/dev/null) || {
    echo "Warning: Could not resolve project ${OWNER}/${PROJECT_NUMBER} (missing token scope?)" >&2
    exit 0
  }
fi

# Step 2: Add PR to board (idempotent) and capture item ID
ITEM_ID=$(gh project item-add "$PROJECT_NUMBER" --owner "$OWNER" --url "$PR_URL" --format json --jq '.id' 2>/dev/null) || {
  echo "Warning: Could not add ${PR_URL} to project ${OWNER}/${PROJECT_NUMBER}" >&2
  exit 0
}

# Step 3: Find Status field and option IDs
if [ -z "$FIELD_ID" ] || [ -z "$OPTIONS_JSON" ]; then
  FIELDS_JSON=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json 2>/dev/null) || {
    echo "Warning: Could not list fields for project ${OWNER}/${PROJECT_NUMBER}" >&2
    exit 0
  }

  FIELD_ID=$(echo "$FIELDS_JSON" | jq -r '.fields[] | select(.name == "Status") | .id' 2>/dev/null || true)
  OPTIONS_JSON=$(echo "$FIELDS_JSON" | jq -c '.fields[] | select(.name == "Status") | .options' 2>/dev/null || true)

  if [ -z "$FIELD_ID" ]; then
    echo "Warning: No Status field found in project ${OWNER}/${PROJECT_NUMBER}" >&2
    exit 0
  fi

  # Cache project metadata for bulk operations (atomic write)
  jq -n \
    --arg projectId "$PROJECT_ID" \
    --arg fieldId "$FIELD_ID" \
    --argjson options "$OPTIONS_JSON" \
    '{projectId: $projectId, fieldId: $fieldId, options: $options}' > "$CACHE_FILE.tmp.$$" \
    && mv "$CACHE_FILE.tmp.$$" "$CACHE_FILE"
fi

# Step 4: Find option ID for target status
OPTION_ID=$(echo "$OPTIONS_JSON" | jq -r --arg status "$STATUS" '.[] | select(.name == $status) | .id' 2>/dev/null || true)

if [ -z "$OPTION_ID" ]; then
  echo "Warning: Status option '${STATUS}' not found in project ${OWNER}/${PROJECT_NUMBER}" >&2
  exit 0
fi

# Step 5: Set the status
gh project item-edit \
  --project-id "$PROJECT_ID" \
  --id "$ITEM_ID" \
  --field-id "$FIELD_ID" \
  --single-select-option-id "$OPTION_ID" >/dev/null 2>&1 || {
  echo "Warning: Could not set status '${STATUS}' for ${PR_URL}" >&2
  exit 0
}
