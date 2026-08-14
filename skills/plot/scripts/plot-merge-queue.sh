#!/usr/bin/env bash
# Plot helper: merge queue — safe merge ORDER plus conflict prediction.
# Usage: plot-merge-queue.sh [--no-fetch] [--offline] <slug>
#   --no-fetch / --offline  skip `git fetch`
#   <slug>                  the plan whose branches to order
# Output: one line per branch in merge order, terminated by:
#             summary: ready=2 conflicts=1 waiting=0 main=main
#
# READ-ONLY. Nothing here merges, pushes, or writes a repo file. That is the
# design, not a limitation: when several workers finish at once their PRs land
# in a burst and each merge invalidates the others' bases. Most of the value is
# in KNOWING THE SAFE ORDER — which is obtainable without granting any agent
# merge rights. The human still merges, from a list that says what will break.
#
# Conflict prediction uses `git merge-tree --write-tree`, which computes a merge
# entirely in memory: no working tree, no index, no checkout, nothing touched.
# A non-zero exit means the merge would conflict.
#
# Two questions are answered per branch:
#   1. Does it merge cleanly into main RIGHT NOW?  (its own readiness)
#   2. Does it conflict with a branch ahead of it in the queue?  (burst risk)
#
# Ordering rule: branches that touch fewer files first. A small, clean branch
# merged early invalidates the fewest other bases, and a branch that conflicts
# with one already ahead of it is the one that should rebase — not the other
# way round.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

do_fetch=1
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch|--offline) do_fetch=0 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }
[ -n "$slug" ] || { echo "plot-merge-queue: need a plan slug" >&2; exit 1; }

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
PREFIX_RE=$(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' -)
[ -n "$PREFIX_RE" ] || PREFIX_RE="idea|feature|bug|docs|infra"

MAIN=$(cfg "Main branch")
[ -n "$MAIN" ] || MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"
[ "$do_fetch" = 1 ] && git fetch -q origin 2>/dev/null

plan=""
for cand in "$ACTIVE_DIR$slug.md" "$PLAN_DIR"*"$slug".md; do
  [ -e "$cand" ] && { plan="$cand"; break; }
done
[ -n "$plan" ] || { echo "plot-merge-queue: no plan for '$slug'" >&2; exit 1; }

branches=$("$script_dir/plot-plan-meta.sh" "$plan" --prefixes "$PREFIX_RE" 2>/dev/null \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
for w in d.get("waves", []):
    for b in w["branches"]:
        ref = b["branch"]
        if b["deferred"] or ref.startswith("idea/") or "." in ref.rsplit("/", 1)[-1]:
            continue
        print(ref)
' 2>/dev/null)

# Candidates: branches with real work that has not landed yet. A merged branch
# is done; an empty claim has nothing to merge.
candidates=()
while IFS= read -r b; do
  [ -n "$b" ] || continue
  git show-ref -q --verify "refs/remotes/origin/$b" </dev/null 2>/dev/null || continue
  git merge-base --is-ancestor "origin/$b" "origin/$MAIN" </dev/null 2>/dev/null && continue
  [ "$(git rev-list --count "origin/$MAIN..origin/$b" </dev/null 2>/dev/null || echo 0)" != "0" ] || continue
  candidates+=("$b")
done <<< "$branches"

echo "plot merge queue — $slug against origin/$MAIN"
echo

if [ ${#candidates[@]} -eq 0 ]; then
  echo "  (nothing to merge)"
  echo "summary: ready=0 conflicts=0 waiting=0 main=$MAIN"
  exit 0
fi

# Order by footprint: fewest changed files first. The smallest clean branch
# merged first invalidates the fewest other bases.
ordered=$(for b in "${candidates[@]}"; do
  n=$(git diff --name-only "origin/$MAIN...origin/$b" </dev/null 2>/dev/null | wc -l | tr -d ' ')
  printf '%s\t%s\n' "$n" "$b"
done | sort -n -k1,1 -k2,2 | cut -f2)

# Would merging $2 into $1 conflict? Pure computation — no worktree, no index.
would_conflict() {
  ! git merge-tree --write-tree "$1" "$2" >/dev/null 2>&1
}

n_ready=0 n_conflicts=0 n_waiting=0
merged_so_far=()

while IFS= read -r b; do
  [ -n "$b" ] || continue
  files=$(git diff --name-only "origin/$MAIN...origin/$b" </dev/null 2>/dev/null | wc -l | tr -d ' ')

  if would_conflict "origin/$MAIN" "origin/$b"; then
    echo "  $b — CONFLICT with $MAIN ($files files) → rebase before merging"
    echo "      fix: git rebase origin/$MAIN   # on $b"
    n_conflicts=$((n_conflicts + 1))
    continue
  fi

  # Does it collide with anything already ahead of it in this queue? If so it
  # merges cleanly today but will not once that branch lands.
  clashes_with=""
  for ahead in ${merged_so_far[@]+"${merged_so_far[@]}"}; do
    if would_conflict "origin/$ahead" "origin/$b"; then
      clashes_with="$ahead"
      break
    fi
  done

  if [ -n "$clashes_with" ]; then
    echo "  $b — conflicts with $clashes_with ahead of it ($files files) → rebase after that merges"
    n_conflicts=$((n_conflicts + 1))
  else
    echo "  $b — clean ($files files)"
    merged_so_far+=("$b")
    n_ready=$((n_ready + 1))
  fi
done <<< "$ordered"

echo
echo "Queue computed. Nothing was merged — merge in the order above."
echo "summary: ready=$n_ready conflicts=$n_conflicts waiting=$n_waiting main=$MAIN"
