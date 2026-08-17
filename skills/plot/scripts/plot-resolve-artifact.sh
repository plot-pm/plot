#!/usr/bin/env bash
# Plot helper: repair an ARTIFACT-ONLY merge conflict on one branch.
# Usage: plot-resolve-artifact.sh [--dry-run] <branch>
#   --dry-run   print the sequence and the worktree it would use; change nothing
#   <branch>    the branch to repair — must already exist on origin
# Output: one `step:` line per stage, then a machine-countable footer:
#     summary: branch=<name> outcome=pushed|abandoned|refused reason=<word>
#
# THE ONLY AUTOMATIC WRITE THIS SYSTEM GRANTS, and it is granted for three
# verified reasons rather than for convenience:
#
#   1. `-merge` KEEPS THE FILE VALID. `.gitattributes` marks the artifact
#      `-merge`, so git keeps one side whole and writes NO conflict markers.
#      The artifact stays buildable JavaScript *through* a conflict — which is
#      why a script may touch it at all.
#   2. THE REBUILD IS DETERMINISTIC. Measured: `build.mjs` embeds no timestamp
#      and no randomness, so the output does not depend on which side was kept.
#   3. CI PROVES IT. The no-diff gate fails the build if the committed artifact
#      does not match a fresh rebuild.
#
# Together those make this the one repair whose correctness is checkable
# WITHOUT JUDGEMENT. That is the whole licence. No other failure has these
# three properties, and none may be added to this path — widening the entry
# condition removes the argument that grants the permission, even if the code
# looks correct.
#
# THIS IS A SCRIPT AND NOT AN AGENT, deliberately. Every step below is fixed
# and nothing between them is a decision, which is *precisely* what licenses the
# automation. Handing the sequence to an agent would introduce judgement exactly
# where its absence is the permission. (Measured on 2026-08-17: this repo has no
# `Worker command` configured either, so plot-dispatch.sh would report
# `worker=unconfigured` and start nothing — but the shape is the reason, not
# the measurement.)
#
# TESTS RUN BEFORE THE PUSH. The CI no-diff gate is what makes the repair
# checkable, and CI runs only AFTER a push — so a resolver that pushed and
# waited would manufacture exactly the state this exists to remove: a red PR in
# the queue. The sequence therefore ends on `pnpm run test:board` green in the
# branch's own worktree, and CI becomes confirmation rather than discovery.
#
# IF THE SUITE FAILS, NOTHING IS PUSHED. The repair stopped being mechanical the
# moment its own gate said so; the branch is left exactly as it was, and the
# board reports it as a conflict a human owns.
#
# WHICH SIDE IS TAKEN CANNOT MATTER, and the diff is never read. `--theirs` is
# named here only because `git checkout` needs a word: the rebuild overwrites
# whichever side was kept. Never phrase it as "take ours" — under `git merge`
# *ours* is the branch being merged into, under `git rebase` it is the upstream,
# and this repo rebases routinely.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# The one file this script may resolve. Named here as well as in the board's
# contract because the two run in different languages and neither can import
# the other's constant; the pairing is asserted by a test rather than trusted.
ARTIFACT_PATH="skills/plot/scripts/board/board-server.mjs"

dry_run=0
branch=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    -*) echo "plot-resolve-artifact: unknown option '$1'" >&2; exit 2 ;;
    *) branch="$1" ;;
  esac
  shift
done

# The footer travels on EVERY exit path, including the refusals. A run that
# ends without one is indistinguishable from a crash, and a silent automatic
# write is the failure mode this whole plan exists to remove.
finish() { # $1=outcome $2=reason
  echo "summary: branch=$branch outcome=$1 reason=$2"
  case "$1" in
    pushed) exit 0 ;;
    *) exit 1 ;;
  esac
}

[ -n "$branch" ] || { echo "usage: plot-resolve-artifact.sh [--dry-run] <branch>" >&2; exit 2; }

git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "plot-resolve-artifact: not a git repository" >&2
  finish refused not-a-repo
}

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"

repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)
# The same name-flattening rule plot-dispatch.sh uses, so a branch already
# dispatched is repaired in the worktree it is already checked out in rather
# than in a second copy of itself. Two worktrees on one branch is not merely
# untidy — git refuses the second checkout, and the two would fight over the
# same index if it did not.
wt="$wt_root/plot-wt-$(printf '%s' "$branch" | tr '/' '-')"

if [ "$dry_run" = 1 ]; then
  echo "step: would use worktree $wt"
  echo "step: would merge origin/$MAIN, take a side of $ARTIFACT_PATH, rebuild, test"
  echo "step: would push only if pnpm run test:board passes"
  finish refused dry-run
fi

git fetch -q origin "$MAIN" "$branch" 2>/dev/null || true

# ONE REPAIR AT A TIME, AND NEVER TWO ON ONE BRANCH.
#
# A second run while the first is working would fight over the same worktree:
# the merge, the rebuild and the five-minute suite all write into it, and two of
# them interleaved produce an artifact belonging to neither run. The lock is a
# DIRECTORY rather than a file because `mkdir` is atomic on every filesystem
# this runs on — two processes racing it, one wins, and the loser learns it lost
# from the exit code rather than from a check-then-write that both pass.
#
# The board guards its own in-flight repairs too, in memory. Both are needed and
# neither is redundant: the board's registry cannot see a repair started by a
# second board or by a human at a shell, and this lock cannot stop the board
# from spawning (it learns only after the spawn). The lock is the authority.
lock="$repo_root/.plot/state/resolve-$(printf '%s' "$branch" | tr '/' '-').lock"
mkdir -p "$(dirname "$lock")" 2>/dev/null || true
if ! mkdir "$lock" 2>/dev/null; then
  echo "step: a repair is already in flight for $branch ($lock)"
  finish refused already-in-flight
fi
# Released on every exit, including a kill. A lock that outlives its process
# would make one interrupted repair block the branch forever — and the repair is
# idempotent, so there is nothing to protect after the process is gone.
trap 'rmdir "$lock" 2>/dev/null || true' EXIT INT TERM

if [ -d "$wt" ] && git worktree list --porcelain | grep -qx "worktree $wt"; then
  echo "step: reusing worktree $wt"
else
  if ! git worktree add -q "$wt" "$branch" 2>/dev/null; then
    if ! git worktree add -q -b "$branch" "$wt" "origin/$branch" 2>/dev/null; then
      echo "plot-resolve-artifact: cannot create a worktree for $branch at $wt" >&2
      finish refused no-worktree
    fi
  fi
  echo "step: worktree $wt"
fi

# THE FIXED SEQUENCE. Five steps, no decision between them.

# 1. Merge. The conflict is EXPECTED — that is why we are here — so a non-zero
#    exit is not yet a failure. What decides is which paths came back
#    unmerged, checked next.
git -C "$wt" merge --no-edit "origin/$MAIN" >/dev/null 2>&1
merge_status=$?

if [ "$merge_status" -eq 0 ]; then
  # Nothing conflicted after all — the prediction was made from refs that have
  # since moved, which is the direction this repo already knows they move in.
  # The merge stands; there is nothing to repair and nothing to prove, so this
  # pushes nothing rather than pushing a merge nobody asked for.
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  git -C "$wt" reset -q --hard "HEAD" >/dev/null 2>&1 || true
  echo "step: no conflict on merge — nothing to repair"
  finish refused no-conflict
fi

# 2. VERIFY THE SET, HERE, AGAINST THE REAL MERGE.
#
# The board classified from `merge-tree`, which predicts IN MEMORY from the refs
# this machine holds. This is the merge itself, and it is the only place the set
# is a fact rather than a forecast — a stale ref makes the prediction wrong in
# the reassuring direction, so the entry condition is re-checked against reality
# before anything is written.
#
# EXACTLY the artifact: one path, that path, nothing else. Not "the artifact
# among the conflicts" — an implementation asking that passes every
# artifact-only case and silently repairs merges that need judgement as a whole.
unmerged=$(git -C "$wt" diff --name-only --diff-filter=U)
n_unmerged=$(printf '%s\n' "$unmerged" | grep -c . || true)
if [ "$n_unmerged" != "1" ] || [ "$unmerged" != "$ARTIFACT_PATH" ]; then
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  echo "step: conflict set is not exactly the artifact — refusing"
  printf 'step: unmerged: %s\n' "$(printf '%s' "$unmerged" | tr '\n' ' ')"
  finish refused not-artifact-only
fi

# 3. Take a side. WHICH SIDE CANNOT MATTER — the rebuild overwrites it — and the
#    diff is never read. `--theirs` because the command needs a word.
git -C "$wt" checkout --theirs -- "$ARTIFACT_PATH" 2>/dev/null \
  || git -C "$wt" checkout --ours -- "$ARTIFACT_PATH" 2>/dev/null \
  || true
git -C "$wt" add -- "$ARTIFACT_PATH" 2>/dev/null || true
echo "step: took a side of $ARTIFACT_PATH (either — the rebuild decides)"

# 4. Rebuild, in the branch's OWN worktree. This is what makes the kept side
#    irrelevant, and it is the property CI's no-diff gate then re-checks.
if ! (cd "$wt" && pnpm build:board >/dev/null 2>&1); then
  git -C "$wt" merge --abort >/dev/null 2>&1 || true
  echo "step: rebuild failed — pushing nothing"
  finish abandoned build-failed
fi
git -C "$wt" add -- "$ARTIFACT_PATH" 2>/dev/null || true
echo "step: rebuilt $ARTIFACT_PATH"

# The merge commit exists only once the rebuild has produced the artifact it
# will carry. Committing before the build would leave a commit holding a stale
# artifact if the build then failed — exactly what CI's no-diff gate catches,
# arriving as a push instead of as a refusal.
if ! git -C "$wt" commit -q --no-edit 2>/dev/null; then
  echo "step: nothing to commit after the rebuild"
  finish abandoned nothing-to-commit
fi

# 5. THE GATE. Green in this worktree BEFORE the push, never CI after it.
#    A resolver that pushed and let CI decide passes every correctness check
#    above and manufactures a red PR in the queue — the exact stuck state this
#    plan exists to remove.
echo "step: running pnpm run test:board"
if ! (cd "$wt" && pnpm run test:board >/dev/null 2>&1); then
  # NOTHING IS PUSHED, and the merge is undone so the branch is left exactly as
  # it was found. A half-repaired branch would be a third state nobody named.
  git -C "$wt" reset -q --hard "HEAD~1" 2>/dev/null || true
  echo "step: test:board failed — pushing nothing, this is a conflict a human owns"
  finish abandoned tests-failed
fi
echo "step: test:board passed"

if ! git -C "$wt" push -q origin "HEAD:$branch" 2>/dev/null; then
  echo "step: push rejected — the branch moved under us; leaving the repair local"
  finish abandoned push-failed
fi

echo "step: pushed $branch"
finish pushed artifact-conflict-resolved
