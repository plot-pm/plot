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
# Fires when the current branch is an implementation branch
# (<prefix>/<slug> for the repo's configured branch prefixes, minus
# idea/) whose plan file exists and is still phase Draft — including the
# `Impl: same branch` flow, where the plan rides the work branch. Commits
# that touch ONLY the plan directory always pass (refining a draft is how
# it becomes approvable).
#
# THE PHASE IS READ FROM origin/<main>, NEVER THE WORKING TREE. The question
# this gate means to ask is "has this plan been approved where everyone can see
# it?", and only the shared ref answers it: an approval committed to a local
# branch and never pushed used to open this gate. When origin/<main> cannot be
# resolved the hook ALLOWS the commit and prints a line saying the phase went
# unverified — see the divergence note at the bottom of the script.
#
# The gate evaluates the commit's EFFECTIVE paths, not just the index:
# a single command like `git add -A && git commit -m x` or
# `git commit -a` stages at execution time, after this hook ran — so
# when the command itself stages, the gate folds the staged-by-then
# paths in (explicit `git add` pathspecs; all worktree changes for
# -A/--all/.; tracked modifications for commit -a). Conservative by
# design: a glob or directory pathspec counts as outside the plan dir.
#
#   Additionally: an explicit review hold — a line in the committed
#   `.plot/hold` file of the form `<branch> <free-text reason>` — blocks
#   implementation commits on exactly that branch (string equality on the
#   first field, never a pattern: a gate must not false-block). Skills
#   write an entry when a story/plan declares "code only after approval"
#   for a named branch; recording the approval removes it. Plan and story
#   edits still pass under a hold (refining the artifact under review is
#   the point) — story homes are matched by the configured Story
#   directory AND any directory sharing its basename (sub-unit homes,
#   e.g. clients/*/stories/).

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

# Implementation prefixes from config (idea/ is never an impl prefix).
PREFIX_ALT="$(bash "$HERE/plot-config.sh" get "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr ',' '\n' | tr -d ' ' | sed 's#/$##' | grep -v '^idea$' | grep -v '^$' | paste -sd'|' -)"
[ -n "$PREFIX_ALT" ] || PREFIX_ALT='feature|bug|docs|infra'

block() {
  echo "plot phase gate: $1" >&2
  echo "The plan is still Draft — implementation only ever references an approved plan (Manifesto P2)." >&2
  echo "Either: review and approve it (/plot-approve $2), or — if this commit only refines the plan — stage only the plan file." >&2
  exit 2
}

# Effective commit paths: the index, plus what the command itself stages.
effective_paths() {
  git diff --cached --name-only 2>/dev/null
  case "$CMD" in
    *" -a "*|*" -a"|*" --all"*|*" -am "*|*" -am"*)
      git diff --name-only 2>/dev/null ;;
  esac
  if [[ "$CMD" == *"git add"* ]]; then
    printf '%s\n' "$CMD" | sed -E 's/&&|;|\|/\n/g' | grep 'git add' | sed 's/.*git add//' \
    | while IFS= read -r segment; do
        for tok in $segment; do
          case "$tok" in
            -A|--all|-a|.|-u|--update)
              git status --porcelain 2>/dev/null | sed 's/^...//' ;;
            -*) ;;
            *) printf '%s\n' "$tok" ;;
          esac
        done
      done
  fi
}

# Any effective path outside the plan directory?
outside_plans() {
  local f found=1
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      "$PLAN_DIR"/*) ;;
      *) found=0 ;;
    esac
  done < <(effective_paths)
  return $found
}

STORY_DIR="$(bash "$HERE/plot-config.sh" get "Story directory" "docs/stories/")"
STORY_DIR="${STORY_DIR%/}"
STORY_BASE="$(basename "$STORY_DIR")"

# Hold carve-out: plan + story + .plot edits pass (both are review artifacts).
outside_plans_and_stories() {
  local f found=1
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    case "$f" in
      "$PLAN_DIR"/*|"$STORY_DIR"/*|.plot/*) ;;
      */"$STORY_BASE"/*) ;;
      *) found=0 ;;
    esac
  done < <(effective_paths)
  return $found
}

# Explicit review hold: exact branch entry (string equality) in .plot/hold.
if [ -f ".plot/hold" ]; then
  HOLD_LINE="$(awk -v b="$BRANCH" '$1 == b { print; exit }' .plot/hold 2>/dev/null)" || HOLD_LINE=""
  if [ -n "$HOLD_LINE" ] && outside_plans_and_stories; then
    REASON="${HOLD_LINE#"$BRANCH"}"
    echo "plot phase gate: branch '$BRANCH' is under an explicit review hold (.plot/hold):${REASON:- no reason recorded}" >&2
    echo "Finish the review and record the approval (which removes the hold), or stage only plan/story files." >&2
    exit 2
  fi
fi

if [[ "$BRANCH" =~ ^(${PREFIX_ALT})/ ]]; then
  SLUG="${BRANCH#*/}"

  # THE PHASE IS READ FROM THE SHARED REF, NOT THE WORKING TREE. The working
  # tree carries whatever branch was last checked out plus whatever is
  # uncommitted, and neither is a fact anyone else shares. Reading it let a
  # local-only approval — committed to a branch and never pushed — open this
  # gate, which turns Manifesto P2 ("plans are approved before implementation")
  # into "someone typed Approved in this filesystem". Reproduced 2026-08-18.
  # `|| true` on every step, and it is load-bearing: the fail-open trap at the
  # top of this script is `trap 'exit 0' ERR`, so a bare `git symbolic-ref` that
  # fails (no origin/HEAD — exactly the offline case) exits the hook silently
  # BEFORE the "phase unverified" line below can be printed. Failing open is
  # correct here; failing open without saying so is the bug being fixed.
  MAIN="$(bash "$HERE/plot-config.sh" get "Main branch" 2>/dev/null || true)"
  [ -n "$MAIN" ] || MAIN="$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true)"
  [ -n "$MAIN" ] || MAIN="main"
  GATE_REF="origin/$MAIN"

  # Anchored plan-file match: <plan dir>/YYYY-MM-DD-<slug>.md, exact slug
  # (string comparison — no glob/regex on the slug, so no suffix
  # collisions and no metacharacter surprises). Enumerated from the REF.
  PLAN_FILE=""
  if git rev-parse --verify --quiet "$GATE_REF^{commit}" >/dev/null 2>&1; then
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      base="${f##*/}"
      case "$base" in
        [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*)
          [ "${base#????-??-??-}" = "$SLUG.md" ] && { PLAN_FILE="$f"; break; } ;;
      esac
    done < <(git ls-tree -r --name-only "$GATE_REF" -- "$PLAN_DIR/" 2>/dev/null)
  else
    # FAIL OPEN, AND SAY SO. This is a PreToolUse hook: refusing every commit
    # when origin/<main> is unreadable would make the repo unusable offline,
    # and the fail-open is a deliberate property (see the header). But a silent
    # allow is indistinguishable from a gate that ran and passed — so the line
    # below is what makes this failing OPEN rather than failing SILENTLY. An
    # operator who sees it knows the gate did not run.
    #
    # This is the ONE place this hook and plot-dispatch.sh diverge, and the
    # reason is blast radius: dispatch refusing costs one fan-out you retry;
    # this refusing costs every commit in the repository.
    echo "plot-phase-gate: cannot read $GATE_REF — phase unverified," >&2
    echo "                 allowing the commit. Run \`git fetch\` to restore the gate." >&2
    exit 0
  fi

  [ -n "$PLAN_FILE" ] || exit 0   # unplanned quick work is legitimate

  # plot-plan-meta.sh is the format contract and takes a PATH, so the blob is
  # materialised. The X's must TRAIL the template: BSD mktemp (macOS) rejects a
  # suffix after them where GNU accepts it.
  GATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/plot-phase-gate-XXXXXX")" || exit 0
  GATE_BLOB="$GATE_DIR/${PLAN_FILE##*/}"
  if ! git show "$GATE_REF:$PLAN_FILE" >"$GATE_BLOB" 2>/dev/null; then
    rm -rf "$GATE_DIR"
    exit 0   # fail open: unreadable blob is not evidence of a Draft plan
  fi
  PHASE="$(bash "$HERE/plot-plan-meta.sh" "$GATE_BLOB" | jq -r .phase)"
  rm -rf "$GATE_DIR"

  if [ "$PHASE" = "draft" ] && outside_plans; then
    block "branch '$BRANCH' implements plan '$SLUG', which is still Draft on $GATE_REF." "$SLUG"
  fi
fi

exit 0
