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
#   6. a branch whose worktree has a live worker    (somebody is working NOW)
#   7. a branch whose worktree holds uncommitted work
#   8. a branch whose worktree holds a PLOT-BLOCKED marker
#
# THE LAST THREE ARRIVED 2026-09-06 AND THE SCRIPT DOES NOT OWN ANY OF THE
# EIGHT. They are `packages/domain/src/rules/reapable.ts`'s
# `refDeletionProblems`, and 1-5 moved there with them. This script and
# `plot-reap.sh` were asking the same question about the same thing in two
# places, and they had already drifted: this one never asked whether a worker
# was alive, and the reaper never asked `pr_open`. Each was blind to a guard
# the other applied, and deleting a ref out from under a running worker is the
# failure that cannot be repaired.
#
# The SCOPE is still this script's and is not shared. The rule answers about
# one branch and enumerates nothing; which branches to ask about stays bounded
# by the plan file, for the reason the paragraph above gives.
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

# The shared rule, resolved from THIS SCRIPT's location rather than the cwd, and
# as a `file://` URL because `import()` needs one for an absolute path. Missing
# or unreadable, the decision below reports "could not be asked" and keeps every
# ref — the same fail-safe `plot-reap.sh` applies to the same module.
#
# THIS SCRIPT NOW NEEDS NODE. The alternative is a second implementation of the
# guards living in shell where nothing can test it, which is what this branch
# exists to end: the two copies had already drifted apart by three readings.
RULE_PATH="file://$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." 2>/dev/null && pwd)/packages/domain/src/rules/reapable.ts"

# The default branch, via the host adapter when it can answer. The rule compares
# against it, and a wrong answer here can only ever protect MORE.
HOST="$script_dir/plot-host.sh"
DEFAULT=main
if [ -x "$HOST" ]; then
  d=$("$HOST" default-branch 2>/dev/null) && [ -n "$d" ] && DEFAULT="$d"
fi

# Every branch currently checked out ANYWHERE, WITH THE TREE THAT HOLDS IT.
#
# Collected once, before the loop, rather than asked per branch: `git worktree
# list` walks the whole estate and this script runs on the delivery path where
# that estate may hold dozens of trees. The answer cannot change underneath a
# single run in a way that matters — a worktree created mid-run holds a branch
# whose ref this run has not yet reached, and the next run sees it.
#
# THE PATH IS COLLECTED TOO, and that is what the shared rule needed. Until
# 2026-09-06 this script asked only *is it checked out* and never *what is
# happening in there* — so it could not see a live worker, an uncommitted file
# or a `PLOT-BLOCKED` marker, all three of which the reaper refuses on. A
# checked-out branch is kept either way; the readings are what let the refusal
# say WHICH thing is going on, and they cost one field in a walk already done.
checked_out=$(git worktree list --porcelain 2>/dev/null \
                | awk '/^worktree /{wt=substr($0,10)}
                       /^branch refs\/heads\//{print substr($0,19) "\t" wt}')

is_checked_out() {
  printf '%s\n' "$checked_out" | cut -f1 | grep -qxF "$1"
}

# The worktree holding a branch, or empty when none does.
worktree_of() {
  printf '%s\n' "$checked_out" | awk -F'\t' -v b="$1" '$1 == b {print $2; exit}'
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

  # THE READINGS, each taken once and none judged here. The script holds no
  # `if` about whether a ref may go — only about what to do with the answer.
  #
  # `pr_merged` reads `mergedAt` on ANY PR (never `state`, never ancestry) and
  # answers false when the host cannot be asked, so silence keeps the ref.
  # `pr_open` is asked separately rather than derived from it: a branch carries
  # both, and `changeset-release/main` is the measured case.
  merge=not-merged
  pr_merged "$br" && merge=merged

  open_pr=false
  pr_open "$br" && open_pr=true

  # THE TREE HOLDING THE BRANCH, when one does. Empty readings where none
  # does — a branch nobody has checked out has no worker, no dirty file and no
  # marker, and saying so is different from not looking.
  wt=$(worktree_of "$br")
  pid=""; dirty=""; marker=false
  if [ -n "$wt" ] && [ -d "$wt" ]; then
    if [ -f "$wt/.plot-worker.pid" ]; then
      p=$(cat "$wt/.plot-worker.pid" 2>/dev/null)
      if [ -n "$p" ] && ps -p "$p" >/dev/null 2>&1; then pid="$p"; fi
    fi
    ls "$wt"/PLOT-BLOCKED* >/dev/null 2>&1 && marker=true
    # The tiny-garden pulse is excused for the reason `plot-reap.sh` excuses
    # it: every board suite rewrites that fixture, so a worker that did nothing
    # but run the tests would otherwise never clear. Any OTHER path still
    # counts.
    dirty=$(git -C "$wt" status --porcelain 2>/dev/null \
              | grep -v 'tiny-garden/\.plot/state' | head -1)
  fi

  # THE DECISION. `packages/domain/src/rules/reapable.ts`, imported directly —
  # the same shape and the same reason as `plot-reap.sh`: node 24 strips the
  # types, so there is no build step between this script and the rule, and the
  # JS arrives on STDIN from a QUOTED heredoc so the shell expands none of it.
  #
  # ONE RULE, TWO CALLERS. These five guards and the reaper's five refusals
  # were the same question asked twice, and they disagreed: this script never
  # asked about a live pid, and the reaper never asked `pr_open`. A copy that
  # drifted toward permissive would delete a ref that is not re-creatable.
  #
  # A rule that cannot be asked REFUSES: node missing, the import failing, the
  # module throwing all leave `verdict` empty, and an empty verdict keeps the
  # ref and says why. Silence is never permission on this path either.
  verdict=$(PLOT_BRANCH="$br" PLOT_DEFAULT="$DEFAULT" PLOT_PID="$pid" \
            PLOT_DIRTY="$dirty" PLOT_MARKER="$marker" PLOT_MERGE="$merge" \
            PLOT_GIVEN_UP="$deferred" PLOT_OPEN_PR="$open_pr" \
            PLOT_CHECKED_OUT="$([ -n "$wt" ] && echo true || echo false)" \
            PLOT_RULE="$RULE_PATH" \
            node --input-type=module - <<'NODE_EOF' 2>/dev/null
// An ABSOLUTE path derived from this script, never from the cwd: this runs
// wherever the operator invoked it, and the reconcile suite runs it against
// sandbox repos in the temp directory.
const { firstRefRefusal } = await import(process.env.PLOT_RULE);

const problem = firstRefRefusal({
  branch: process.env.PLOT_BRANCH,
  defaultBranch: process.env.PLOT_DEFAULT,
  // This script never looks at the main checkout as a tree; the branch test
  // the rule makes is what catches the default branch.
  isMain: false,
  workerPid: process.env.PLOT_PID === "" ? null : process.env.PLOT_PID,
  dirtyPath: process.env.PLOT_DIRTY,
  blockedMarker: process.env.PLOT_MARKER === "true",
  merge: process.env.PLOT_MERGE,
  givenUp: process.env.PLOT_GIVEN_UP === "true",
  openPr: process.env.PLOT_OPEN_PR === "true",
  checkedOut: process.env.PLOT_CHECKED_OUT === "true",
});

process.stdout.write(problem === null ? "delete\t" : `${problem.refusal}\t${problem.detail}`);
NODE_EOF
  )

  refusal=${verdict%%$'\t'*}
  detail=${verdict#*$'\t'}

  if [ "$refusal" != "delete" ]; then
    # The rule named the refusal; this renders it. A verdict the rule could not
    # produce is empty, and an empty refusal keeps the ref and says so.
    case "$refusal" in
      given-up)            why="deferred — a given-up branch keeps its ref" ;;
      no-merged-pr)        why="unlanded work — no merged PR" ;;
      open-pr)             why="an open PR is using this branch" ;;
      checked-out)         why="checked out in a worktree — somebody is reading it" ;;
      on-default-branch)   why="the default branch — never deleted" ;;
      live-worker)         why="a worker is alive in its worktree (pid $detail)" ;;
      uncommitted-changes) why="uncommitted work in its worktree ($detail)" ;;
      blocked-marker)      why="a PLOT-BLOCKED marker holds a question for a person" ;;
      *)                   why="the rule could not be asked — keeping the ref" ;;
    esac
    printf '%-8s %-52s %s\n' "keep" "$br" "$why"
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
