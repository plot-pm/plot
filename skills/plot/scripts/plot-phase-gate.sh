#!/usr/bin/env bash
# Plot gate: block implementation commits while the governing plan is
# unapproved (Manifesto Principle 7 as a gate, not a rule).
#
# Wired as a Claude Code PreToolUse hook on the Bash tool (see
# hooks/hooks.json). Reads the hook JSON on stdin; acts only on commands
# that contain "git commit". Exit 2 blocks the call with a coached message
# on stderr; anything else allows it. FAIL-OPEN: any internal error allows
# the commit — a broken gate must never lock a repo.
#
# Fires when:
#   (a) the current branch is an implementation branch
#       ((feature|bug|docs|infra)/<slug>) whose plan file exists and is
#       still phase Draft, or
#   (b) the current branch carries a plan file that is still Draft
#       (`Impl: same branch` flow) and the commit stages files outside the
#       plan directory (editing the plan itself is always allowed —
#       that's how a draft becomes approvable).
#
# Not covered here (documented follow-up, lands with the story-tracking
# triage work): review-state declared in story frontmatter — branch↔story
# association is fuzzy and a gate must not false-block.

set -uo pipefail

# --- fail-open guard: any error below → allow ---
trap 'exit 0' ERR

INPUT="$(cat)"
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)" || exit 0
case "$CMD" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)" || exit 0
PLAN_DIR="$(bash "$HERE/plot-config.sh" get "Plan directory" "docs/plans/")"
PLAN_DIR="${PLAN_DIR%/}"

block() {
  echo "plot phase gate: $1" >&2
  echo "The plan is still Draft — implementation only ever references an approved plan (Manifesto P2)." >&2
  echo "Either: review and approve it (/plot-approve $2), or — if this commit only refines the plan — stage only the plan file." >&2
  exit 2
}

# Staged-files check: commits touching ONLY the plan dir are plan work → allowed.
staged_outside_plans() {
  local f
  while IFS= read -r f; do
    case "$f" in
      "$PLAN_DIR"/*) ;;
      *) return 0 ;;
    esac
  done < <(git diff --cached --name-only 2>/dev/null)
  return 1
}

case "$BRANCH" in
  feature/*|bug/*|docs/*|infra/*)
    SLUG="${BRANCH#*/}"
    PLAN_FILE="$(ls "$PLAN_DIR"/*-"$SLUG".md 2>/dev/null | head -1)"
    [ -n "$PLAN_FILE" ] || exit 0   # unplanned quick work is legitimate
    PHASE="$(bash "$HERE/plot-plan-meta.sh" "$PLAN_FILE" | jq -r .phase)"
    if [ "$PHASE" = "draft" ] && staged_outside_plans; then
      block "branch '$BRANCH' implements plan '$SLUG', which is still Draft." "$SLUG"
    fi
    ;;
  *)
    exit 0
    ;;
esac

exit 0
