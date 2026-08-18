#!/usr/bin/env bash
# Fleet pulse: classify every worker worktree, and optionally restart the ones
# that stopped with work on the floor.
#
# Usage: fleet-pulse.sh [--restart] [--once]
#   (default)   report only, change nothing
#   --restart   relaunch workers classified ABANDONED
#   --once      one pass instead of looping
#
# WHY REPO STATE, NOT EXIT CODE. Measured 2026-08-18 across seven worktrees:
# EVERY worker exited 0 — including two that stopped mid-task to ask the
# operator a question, leaving uncommitted work behind. The process says
# "finished" in both cases. Only the tree distinguishes them.
#
# WHY THE RESTART IS OPT-IN, AND NARROW. The two workers that paused had good
# reasons: one refused to open a PR it could not prove green, the other asked
# which retry semantics were wanted and named the trade-offs. Restarting those
# blindly discards the question and re-runs the same guess. So a restart is
# only ever issued for a branch with WORK ON THE FLOOR and no PR, and the
# relaunch prompt tells the worker to read its own log first — the question it
# asked is in there, and so is any answer the operator committed since.
set -uo pipefail

restart=0
once=0
for a in "$@"; do
  case "$a" in
    --restart) restart=1 ;;
    --once)    once=1 ;;
    *) echo "fleet-pulse: unknown flag '$a'" >&2; exit 2 ;;
  esac
done

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "fleet-pulse: not a git repository" >&2; exit 1; }
cd "$root" || exit 1
parent=$(dirname "$root")

# A worker's prompt. It is deliberately NOT the original brief: this process
# has already run once, so the first thing it must do is find out how far it
# got and why it stopped.
relaunch_prompt() {
  local br="$1" slug="${1##*/}"
  cat <<EOF
Resume the branch $br in this worktree, alone. A previous worker stopped with
work uncommitted or unpushed and no PR open.

FIRST, before changing anything: read .plot-worker.log in this worktree. The
previous run's report is at the end of it. If it stopped to ask a question,
check whether the answer has since been committed to this branch — look at
git log and git diff. Do not re-litigate a decision that has already been made.

Then read .plot/briefs/${slug}.md, which is the specification.

Finish the remaining Definition of Done: commit what is on the floor, run the
test suites ONE AT A TIME (concurrent suites were measured to produce false
timeout failures that do not reproduce serially), add a changeset with its
bumps block if one is missing, and open a PR to main.

Follow CLAUDE.md. Use trash, not rm. GitHub's API has returned 503
intermittently; verify a push or merge via gh api rather than trusting the
error. End with a report: the PR number, what you found already done, and any
judgement call you made.
EOF
}

pass() {
  local restarted=0
  for d in "$parent"/plot-wt-*; do
    [ -d "$d" ] || continue
    br=$(git -C "$d" branch --show-current 2>/dev/null) || continue
    [ -n "$br" ] || continue

    pid=$(cat "$d/.plot-worker.pid" 2>/dev/null || echo "")
    alive=no
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && alive=yes

    dirty=$(git -C "$d" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
    ahead=$(git -C "$d" log --oneline "origin/main..HEAD" 2>/dev/null | wc -l | tr -d ' ')
    pr=$(gh pr list --state open --head "$br" --json number --jq '.[0].number' 2>/dev/null || echo "")
    merged=$(gh pr list --state merged --head "$br" --json number --jq '.[0].number' 2>/dev/null || echo "")

    # Order matters. A live worker is working whatever the tree looks like; a
    # merged PR is done whatever is left in the worktree; and an OPEN PR means
    # the work reached review, so leftover local edits are not abandonment.
    if   [ "$alive" = yes ];      then state="working";                        act=0
    elif [ -n "$merged" ];        then state="done (PR #$merged)";             act=0
    elif [ -n "$pr" ];            then state="awaiting-review (PR #$pr)";      act=0
    elif [ "$dirty" != 0 ];       then state="ABANDONED ($dirty uncommitted)"; act=1
    elif [ "$ahead" -gt 1 ];      then state="ABANDONED ($ahead commits, no PR)"; act=1
    # One commit and nothing else is the claim by itself — dispatch made the
    # worktree and the worker never got going. Reported, never auto-restarted:
    # it may be queued behind a wave, and relaunching it would fight the queue.
    else                               state="idle (claim only)";              act=0
    fi

    printf '%-48s %s\n' "$br" "$state"

    if [ "$restart" = 1 ] && [ "$act" = 1 ]; then
      # The prompt travels in the environment, not in the command string:
      # it contains quotes and newlines, and interpolating it into `sh -c`
      # would break on the first apostrophe. `</dev/null` is load-bearing —
      # without it the worker takes SIGHUP when this shell exits, which was
      # measured producing a 0-byte log and a worker that never ran.
      PLOT_PROMPT=$(relaunch_prompt "$br")
      export PLOT_PROMPT
      ( cd "$d" || exit 0
        nohup sh -c '( claude -p "$PLOT_PROMPT" --permission-mode bypassPermissions ); printf "%s" "$?" > .plot-worker.exit' \
          >>.plot-worker.log 2>&1 </dev/null &
        echo $! > .plot-worker.pid
      )
      echo "    -> restarted (pid $(cat "$d/.plot-worker.pid" 2>/dev/null))"
      restarted=$((restarted + 1))
    fi
  done
  echo "pulse: restarted=$restarted mode=$([ "$restart" = 1 ] && echo restart || echo report-only)"
}

if [ "$once" = 1 ]; then
  pass
else
  while true; do
    echo "--- $(git rev-parse --short HEAD 2>/dev/null) ---"
    pass
    sleep 120
  done
fi
