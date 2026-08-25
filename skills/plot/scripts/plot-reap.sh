#!/usr/bin/env bash
# Remove worktrees whose work has landed, and the dead worker files in them.
#
# The gap this fills was named by a comment before it existed:
# `plot-reconcile-scan.sh:323` says "with a deferred: annotation the reaper
# would offer to DELETE real work" — describing a reaper that was never
# written. The scan reports; nothing reaped. Measured 2026-08-25 on this
# estate: 56 worktrees, 42 of them dispatch trees, of which 29 were finished.
#
# WHY A SCRIPT RATHER THAN AN AGENT (Manifesto Principle 3, and the licence
# `plot-resolve-artifact.sh` states for the one other automatic write): every
# refusal below is a MEASUREMENT, not a judgement. Is a process alive; is the
# tree dirty; did the host merge the PR. An agent asked "is this safe to
# delete?" can talk itself past any of the three. A script cannot, and
# judgement's absence is exactly what licenses the delete.
#
# DEFAULT IS --dry-run. Removal happens only under --yes.
#
#   plot-reap.sh                # report what WOULD be reaped
#   plot-reap.sh --yes          # actually remove them
#   plot-reap.sh --yes --max 5  # bound it
#
# What is NEVER reaped, in the order the tests run:
#   1. a worktree with a LIVE worker process        (a desk someone is at)
#   2. a worktree with uncommitted changes           (work that exists nowhere else)
#   3. a worktree carrying a PLOT-BLOCKED* marker    (a worker waiting on a person)
#   4. a branch whose PR is not merged               (the host is the authority)
#   5. the main checkout, and any non-dispatch tree  (not ours to remove)
set -u

DRY=1; MAX=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) DRY=0 ;;
    --dry-run) DRY=1 ;;
    --max) MAX="${2:-0}"; shift ;;
    -h|--help) sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "plot-reap: unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v git >/dev/null 2>&1 || { echo "plot-reap: git not found" >&2; exit 2; }
ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "plot-reap: not a git repository" >&2; exit 2; }

# The default branch, via the host adapter when it can answer and `main`
# otherwise. A wrong answer here would only ever make the ancestry test MORE
# conservative, never less.
HOST="$(dirname "${BASH_SOURCE[0]}")/plot-host.sh"
DEFAULT=main
if [ -x "$HOST" ]; then
  d=$("$HOST" default-branch 2>/dev/null) && [ -n "$d" ] && DEFAULT="$d"
fi
git fetch origin "$DEFAULT" --quiet 2>/dev/null || true

# Does the host say this branch's PR was merged?
#
# `merged` is read, NEVER `state`: a merged PR reports state CLOSED, and
# trusting `state` would refuse every squash-merged branch — which is the whole
# population this script exists for. Squash-merge rewrites the commits, so the
# branch stays "ahead of main" forever and ancestry alone can never clear it.
pr_merged() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || return 1
  out=$(gh pr list --head "$br" --state all --limit 1 --json mergedAt 2>/dev/null) || return 1
  case "$out" in *'"mergedAt":"'*) return 0 ;; *) return 1 ;; esac
}

reap=0; kept=0; removed=0
printf '%-8s %-52s %s\n' "verdict" "branch" "why"

while IFS=$'\t' read -r wt br; do
  [ -n "$wt" ] || continue
  short=${br#refs/heads/}

  # 5. Only dispatch trees. A hand-made worktree and the main checkout are not
  #    this script's to remove, whatever state they are in.
  case "$wt" in *"/plot-wt-"*) ;; *) continue ;; esac
  [ "$wt" = "$ROOT" ] && continue

  # 1. A live worker outranks every other signal. Checked FIRST because it is
  #    the only one describing a person or process acting right now.
  if [ -f "$wt/.plot-worker.pid" ]; then
    pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null)
    if [ -n "$pid" ] && ps -p "$pid" >/dev/null 2>&1; then
      printf '%-8s %-52s %s\n' "keep" "$short" "worker alive (pid $pid)"; kept=$((kept+1)); continue
    fi
  fi

  # 3. A marker means a worker stopped to ask a person something. Reaping it
  #    discards the question along with the tree.
  if ls "$wt"/PLOT-BLOCKED* >/dev/null 2>&1; then
    printf '%-8s %-52s %s\n' "keep" "$short" "PLOT-BLOCKED marker — needs a person"; kept=$((kept+1)); continue
  fi

  # 2. Uncommitted work exists in exactly one place. The tiny-garden pulse is
  #    excused because every board suite rewrites it — a worker that did
  #    nothing but run the tests would otherwise never be reapable. Any OTHER
  #    dirty path still keeps the tree, which is what keeps this an exception
  #    rather than a hole.
  dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
            | grep -v 'tiny-garden/\.plot/state' | head -1)
  if [ -n "$dirty" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "uncommitted: ${dirty:0:40}"; kept=$((kept+1)); continue
  fi

  # 4a. A tree sitting ON the default branch answers the ancestry test
  #     trivially — `origin/main..main` is empty — and would be reaped with the
  #     reason "merged into main", which says nothing about the work it was
  #     dispatched for. Measured here 2026-08-25: one dispatch tree had been
  #     left on `main` by its worker, and the first draft of this script
  #     offered to reap it for a reason that was true and irrelevant.
  #
  #     It is KEPT and named. Deleting a tree whose dispatched branch is no
  #     longer checked out means deleting something whose state was never
  #     measured — and "probably fine" is the judgement this script exists to
  #     not make.
  if [ "$short" = "$DEFAULT" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "on $DEFAULT — dispatched branch not checked out"
    kept=$((kept+1)); continue
  fi

  # 4b. Landed, by either route: ancestry for a merge commit, the host for a
  #     squash. Ancestry is tried first because it needs no network.
  why=""
  if [ -n "$short" ] && [ "$(git -C "$wt" rev-list --count "origin/$DEFAULT..$short" 2>/dev/null || echo 1)" = "0" ]; then
    why="merged into $DEFAULT"
  elif [ -n "$short" ] && pr_merged "$short"; then
    why="PR merged (squash)"
  else
    printf '%-8s %-52s %s\n' "keep" "$short" "unlanded work — no merged PR"; kept=$((kept+1)); continue
  fi

  if [ "$MAX" -gt 0 ] && [ "$reap" -ge "$MAX" ]; then
    printf '%-8s %-52s %s\n' "keep" "$short" "--max $MAX reached"; kept=$((kept+1)); continue
  fi

  reap=$((reap+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$short" "$why"
  else
    if git worktree remove --force "$wt" 2>/dev/null; then
      printf '%-8s %-52s %s\n' "reaped" "$short" "$why"; removed=$((removed+1))
    else
      printf '%-8s %-52s %s\n' "FAILED" "$short" "git worktree remove refused"; kept=$((kept+1))
    fi
  fi
done < <(git worktree list --porcelain \
          | awk '/^worktree /{p=$2} /^branch /{print p"\t"$2}')

[ "$DRY" -eq 0 ] && git worktree prune 2>/dev/null

# The branches and refs are untouched, deliberately: this removes CHECKOUTS.
# A reaped tree is re-creatable with `git worktree add`, so the destructive act
# is bounded to disk space and never to history.
echo "summary: reapable=$reap removed=$removed kept=$kept dry_run=$DRY"
exit 0
