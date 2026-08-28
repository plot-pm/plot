#!/usr/bin/env bash
# Delete the REMOTE REFS of a delivered plan's merged branches.
#
# Usage: plot-release-refs.sh [--yes] [--max N] <slug>
#
#   <slug>   the plan whose branches to release
#   --yes    actually delete; without it this reports and deletes nothing
#   --max N  bound the number of deletions
#
# WHY THIS EXISTS: branches are what the scan actually costs. Measured
# 2026-08-27 across four runs of the fleet scan:
#
#   worktrees  branches  scan
#   54         43        462.9 s
#   42         43         51.3 s
#   11         43        218.5 s
#   11         34        111.5 s
#
# Worktree count does not order those runs — 11 worktrees was SLOWER than 42.
# What moved reliably was deleting nine merged branches: 218.5 s → 111.5 s,
# roughly halving it. The estate the scan walks is branches, and merged ones
# are pure cost. Reaping clears desks; this is what the scan notices.
#
# WHY A SEPARATE SCRIPT AND NOT PART OF `plot-reap.sh`. The reaper ends by
# saying what it is: "the branches and refs are untouched, deliberately — this
# removes CHECKOUTS... A reaped tree is re-creatable with `git worktree add`,
# so the destructive act is bounded to disk space... never to history." That is
# a stated LICENCE, and it does not extend here. A deleted ref is not
# re-creatable, so this act needs its own argument, its own guards and its own
# `--yes`. Folding it into the reaper would silently widen a licence that was
# written narrow on purpose.
#
# It is also SCOPED TO ONE PLAN, where the reaper is deliberately slug-blind.
# The reaper sweeps every worktree because a checkout is cheap to restore; this
# touches only the branches its plan names. A sweep that deleted every merged
# ref on the estate would satisfy "a delivered plan's merged branches lose
# their refs" and destroy unlanded work belonging to plans nobody delivered.
# The blast radius is bounded by the plan file.
#
# WHAT IS NEVER DELETED, in the order the tests run:
#   1. a branch annotated `deferred:` or `moved:`   (given up, not finished)
#   2. a branch NO PR of which merged               (unlanded work)
#   3. a branch with an OPEN PR                     (changeset-release/main)
#   4. a branch checked out in ANY worktree         (somebody is reading it)
#   5. the default branch itself                    (never ours to delete)
#
# THE RULE THIS MUST NOT BREAK. `/plot-implement` says plainly: *"leave the ref
# in place — never delete a remote ref another session may be reading."* Read in
# context that rule governs GIVING A BRANCH UP — work that turned out
# unnecessary, wrongly cut, or blocked — and its reason is that
# `/plot-reconcile` needs the ref PLUS its `deferred:`/`moved:` annotation to
# tell deliberate abandonment from a dead worker.
#
# A branch whose PR merged is neither abandoned nor ambiguous: its work is on
# main, its PR is closed, and there is nothing for `/plot-reconcile` to resolve.
# The rule protects UNLANDED refs, and this touches only landed ones. Guards 1
# and 2 are that reconciliation, enforced.
set -u

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

DRY=1; MAX=0; slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) DRY=0 ;;
    --dry-run) DRY=1 ;;
    --max) MAX="${2:-0}"; shift ;;
    -h|--help) sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "plot-release-refs: unknown argument: $1" >&2; exit 2 ;;
    *) slug="$1" ;;
  esac
  shift
done

die() { echo "plot-release-refs: $*" >&2; exit 2; }

[ -n "$slug" ] || die "need a plan slug (usage: plot-release-refs.sh [--yes] <slug>)"
command -v git >/dev/null 2>&1 || die "git not found"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# The SAME gate the reaper uses, sourced rather than re-derived. `pr_merged`
# reads `mergedAt` on ANY PR (never `state`, never ancestry); `pr_open` answers
# the veto in guard 3.
. "$script_dir/plot-pr-merged.sh"

cfg() { bash "$script_dir/plot-config.sh" get "$1" "$2"; }

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
DELIVERED_DIR=$(cfg "Delivered index" "docs/plans/delivered/")

# The plan is resolved exactly as `plot-deliver.sh` resolves it, including the
# `delivered/` directory — which is not incidental. This runs AFTER a delivery,
# so by the time it looks the symlink has already moved, and a resolver that
# knew only `active/` would find nothing for every plan it is called about.
plan_file=""
for cand in "$PLAN_DIR"*"$slug".md "$ACTIVE_DIR$slug.md" "$DELIVERED_DIR$slug.md"; do
  [ -e "$cand" ] && { plan_file="$cand"; break; }
done
[ -n "$plan_file" ] || die "no plan found for '$slug' — looked in $PLAN_DIR, $ACTIVE_DIR, $DELIVERED_DIR"

# The prefixes come from `Branch prefixes`, never a hardcoded list — the same
# derivation `plot-deliver.sh:144` and `plot-fleet-scan.sh:187` use. Without it
# this reads the parser's built-in default, and a project with its own prefixes
# would have EVERY branch of a plan silently disappear before the loop: the
# script would report `releasable=0` and look like it had nothing to do. That
# exact bug cost `plot-deliver.sh` four undeliverable plans on 2026-08-27.
#
# It fails safe (nothing is deleted) and is wrong all the same, and being wrong
# quietly is what makes it worth passing explicitly.
prefix_re=$(bash "$script_dir/plot-config.sh" get "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' - )
[ -n "$prefix_re" ] || prefix_re="idea|feature|bug|docs|infra"

meta=$(bash "$script_dir/plot-plan-meta.sh" --prefixes "$prefix_re" "$plan_file" 2>/dev/null) || meta=""
[ -n "$meta" ] || die "cannot parse '$plan_file' — refusing rather than guessing"

# The default branch, via the host adapter when it can answer. Guard 5 compares
# against it, and a wrong answer here can only ever protect MORE.
HOST="$script_dir/plot-host.sh"
DEFAULT=main
if [ -x "$HOST" ]; then
  d=$("$HOST" default-branch 2>/dev/null) && [ -n "$d" ] && DEFAULT="$d"
fi

# Every branch currently checked out ANYWHERE, for guard 4.
#
# Collected once, before the loop, rather than asked per branch: `git worktree
# list` walks the whole estate and this script runs on the delivery path where
# that estate may hold dozens of trees. The answer cannot change underneath a
# single run in a way that matters — a worktree created mid-run holds a branch
# whose ref this run has not yet reached, and the next run sees it.
checked_out=$(git worktree list --porcelain 2>/dev/null \
                | sed -n 's|^branch refs/heads/||p')

is_checked_out() {
  printf '%s\n' "$checked_out" | grep -qxF "$1"
}

released=0; kept=0; deleted=0
printf '%-8s %-52s %s\n' "verdict" "branch" "why"

# Branch and its deferred flag, one per line, from the plan's own parser.
#
# `plot-plan-meta.sh` is the plan-format contract, and asking it rather than
# grepping the file is what keeps this working across both plan dialects —
# `## Branches` lists and `## Waves` headings — without this script knowing
# which one it is reading.
while IFS=$'\t' read -r br deferred; do
  [ -n "$br" ] || continue

  # 5. The default branch is never ours to delete, whatever a plan says. A plan
  #    that names it is malformed, and acting on that is unrecoverable.
  if [ "$br" = "$DEFAULT" ]; then
    printf '%-8s %-52s %s\n' "keep" "$br" "the default branch — never deleted"
    kept=$((kept+1)); continue
  fi

  # 1. Given up, not finished. A `deferred:`/`moved:` annotation is what
  #    `/plot-reconcile` reads to tell deliberate abandonment from a dead
  #    worker, and it needs the REF to be there to read it against. Checked
  #    before the host is even asked: this is a decision a person already
  #    recorded, and no merge state overturns it.
  if [ "$deferred" = "true" ]; then
    printf '%-8s %-52s %s\n' "keep" "$br" "deferred — a given-up branch keeps its ref"
    kept=$((kept+1)); continue
  fi

  # 2. THE GATE. Unlanded work keeps its ref, always — `Done when` item 12, and
  #    the assertion a naive implementation passes without, since a sweep that
  #    deletes every ref of a delivered plan satisfies item 11 and destroys
  #    work that exists nowhere else. `pr_merged` also returns false when the
  #    host cannot be asked, so silence keeps the ref.
  if ! pr_merged "$br"; then
    printf '%-8s %-52s %s\n' "keep" "$br" "unlanded work — no merged PR"
    kept=$((kept+1)); continue
  fi

  # 3. An OPEN PR vetoes, even where an older PR merged. Measured by hand on
  #    2026-08-28: `changeset-release/main` is merged repeatedly, and Changesets
  #    RECREATES and reuses that same branch for the next release — so its ref
  #    carries a live release PR while an older PR of its own has merged.
  #    Deleting it disturbs the release in flight.
  if pr_open "$br"; then
    printf '%-8s %-52s %s\n' "keep" "$br" "an open PR is using this branch"
    kept=$((kept+1)); continue
  fi

  # 4. A ref another checkout is sitting on is one somebody is reading, and
  #    deleting it pulls the branch out from under them. Measured 2026-08-28:
  #    `bug/a-head-counts-its-own-waves` was merged AND checked out. This runs
  #    after the reap, so a worktree still here is one the reaper's own five
  #    measurements declined to remove — its verdict is inherited, not
  #    second-guessed.
  if is_checked_out "$br"; then
    printf '%-8s %-52s %s\n' "keep" "$br" "checked out in a worktree — somebody is reading it"
    kept=$((kept+1)); continue
  fi

  if [ "$MAX" -gt 0 ] && [ "$released" -ge "$MAX" ]; then
    printf '%-8s %-52s %s\n' "keep" "$br" "--max $MAX reached"
    kept=$((kept+1)); continue
  fi

  released=$((released+1))
  if [ "$DRY" -eq 1 ]; then
    printf '%-8s %-52s %s\n' "would" "$br" "merged — ref would be deleted"
  else
    # The REMOTE ref only. The local branch is left alone deliberately: it costs
    # the scan nothing (the scan derives from `origin/<branch>`), and a local
    # branch is the last copy of a reflog somebody may still want.
    if git push origin --delete "$br" >/dev/null 2>&1; then
      printf '%-8s %-52s %s\n' "released" "$br" "merged — remote ref deleted"
      deleted=$((deleted+1))
    else
      # A ref already gone is the common case on a re-run, and it is a SUCCESS
      # for this script's purpose: the end state asked for is the ref's absence.
      if git ls-remote --exit-code --heads origin "$br" >/dev/null 2>&1; then
        printf '%-8s %-52s %s\n' "FAILED" "$br" "git push --delete refused"
        kept=$((kept+1))
      else
        printf '%-8s %-52s %s\n' "released" "$br" "remote ref already absent"
        deleted=$((deleted+1))
      fi
    fi
  fi
done < <(printf '%s' "$meta" | jq -r '
  ([.waves[]?.branches[]?] as $w
   | if ($w | length) > 0 then $w
     else [.branches[]? | {branch: ., deferred: false}] end)
  | .[] | [.branch, (.deferred | tostring)] | @tsv' 2>/dev/null)

echo "summary: releasable=$released deleted=$deleted kept=$kept dry_run=$DRY"
exit 0
