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
# THE SCRIPT DOES NOT OWN THE FIVE. They are conditions in
# `packages/domain/src/rules/reapable.ts`'s `finishedWith`, which states every
# condition that can hold a desk and judges none of them. This script and
# `plot-reap.sh` were asking about the same desk in two places, and they had
# already drifted: this one never asked whether a worker was alive, and the
# reaper never asked `pr_open`. Each was blind to a condition the other
# measured, and neither omission was argued for anywhere.
#
# WHAT CHANGED IS WHERE THE CONDITIONS ARE STATED, NOT WHICH ONES THIS SCRIPT
# ASKS. The rule also answers `liveWorker`, `uncommittedChanges` and
# `blockedMarker` — the reaper's three — and this script reads none of them.
# Folding them in *"would silently widen a licence that was written narrow on
# purpose"*, which is what line 30 above has warned since this script existed.
# The rule makes the difference VISIBLE; making it disappear is a different
# change, and it is not this one.
#
# `unknown` PERMITS HERE, AND THAT IS THE CALLER'S HALF. Four of the rule's
# conditions need a worktree and 69% of branches have none (22 of 32, measured
# 2026-09-06), so the rule answers `unknown` rather than inventing `false`. The
# reaper reads `unknown` as *nothing to reap*; this reads it as *no evidence
# against deletion*, which is exactly what it did before the rule existed.
# Refusing on silence is the estate's rule for an unreachable HOST — applied to
# a missing tree it would keep every ref on two branches in three and make this
# script useless where the scan cost is highest.
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
    -h|--help) sed -n '2,86p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "plot-release-refs: unknown argument: $1" >&2; exit 2 ;;
    *) slug="$1" ;;
  esac
  shift
done

die() { echo "plot-release-refs: $*" >&2; exit 2; }

[ -n "$slug" ] || die "need a plan slug (usage: plot-release-refs.sh [--yes] <slug>)"
command -v git >/dev/null 2>&1 || die "git not found"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

# The SAME lookups the reaper uses, sourced rather than re-derived:
# `_plot_merged_lookup` reads `mergedAt` on ANY PR (never `state`, never
# ancestry), and `_plot_open_lookup` answers the open-PR veto.
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
checked_out=$(git worktree list --porcelain 2>/dev/null \
                | awk '/^worktree /{wt=substr($0,10)}
                       /^branch refs\/heads\//{print substr($0,19) "\t" wt}')

# The worktree holding a branch, or empty when no tree holds it.
worktree_of() {
  printf '%s\n' "$checked_out" | awk -F'\t' -v b="$1" '$1 == b {print $2; exit}'
}

released=0; kept=0; deleted=0
remote=$(git ls-remote --heads origin 2>/dev/null) || remote=unread
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
  # `if` about whether a ref may go — only about which conditions it asks and
  # what to do with the answers.
  #
  # A REF ORIGIN DOES NOT HOLD HAS NOTHING TO RELEASE, and asking the host about
  # it only spends the limit. A listing that failed asks the host as before.
  if [ "$remote" != unread ] && ! awk -v r="refs/heads/$br" '$2 == r {f=1} END {exit !f}' <<<"$remote"; then
    printf '%-8s %-52s %s\n' "absent" "$br" "no remote ref — nothing to release"; continue
  fi

  # Each lookup answers `found`, `none` or `unaskable`. `merge` reads `mergedAt`
  # on ANY PR (never `state`, never ancestry); the open PR is asked separately
  # because a branch carries both, and `changeset-release/main` is the measured
  # case. An `unaskable` answer from either keeps the ref under its own name.
  merge=$(_plot_merged_lookup "$br")
  open_pr=$(_plot_open_lookup "$br")

  # WHETHER A WORKTREE HOLDS THE BRANCH. Nothing inside the tree is read: a live
  # pid, an uncommitted file and a `PLOT-BLOCKED` marker are the reaper's
  # conditions, and this script passes them empty so they never refuse. A
  # checked-out branch keeps its ref whatever is going on inside it.
  wt=$(worktree_of "$br")

  # THE DECISION. `firstRefRefusal` in `packages/domain/src/rules/reapable.ts`,
  # imported directly: node strips the types, so there is no build step between
  # this script and the rule, and the JS arrives on STDIN from a QUOTED heredoc
  # so the shell expands none of it. The rule names the first refusal in its
  # own order; a host that could not be asked refuses as `merge-unaskable` or
  # `open-unaskable`.
  #
  # A rule that cannot be asked REFUSES: node missing, the import failing, the
  # module throwing all leave `verdict` empty, and an empty verdict keeps the
  # ref and says why.
  verdict=$(PLOT_BRANCH="$br" PLOT_DEFAULT="$DEFAULT" PLOT_MERGE="$merge" \
            PLOT_GIVEN_UP="$deferred" PLOT_OPEN_PR="$open_pr" \
            PLOT_CHECKED_OUT="$([ -n "$wt" ] && echo true || echo false)" \
            PLOT_RULE="$RULE_PATH" \
            node --input-type=module - <<'NODE_EOF' 2>/dev/null
// An ABSOLUTE path derived from this script, never from the cwd.
//
// NO APOSTROPHE MAY APPEAR ANYWHERE IN THIS BLOCK. bash 3.2 parses the body of
// a quoted heredoc nested inside `$(...)`, so one contraction opens a string
// that never closes and the whole file fails to parse.
const { firstRefRefusal } = await import(process.env.PLOT_RULE);
const e = process.env;
const refusal = firstRefRefusal({
  branch: e.PLOT_BRANCH,
  defaultBranch: e.PLOT_DEFAULT,
  isMain: false,
  workerPid: null,
  dirtyPath: "",
  blockedMarker: false,
  merge: { found: "merged", none: "not-merged" }[e.PLOT_MERGE] ?? "unreachable",
  givenUp: e.PLOT_GIVEN_UP === "true",
  openPr: e.PLOT_OPEN_PR === "found",
  openPrUnaskable: e.PLOT_OPEN_PR === "unaskable",
  checkedOut: e.PLOT_CHECKED_OUT === "true",
});
process.stdout.write(refusal === null ? "delete\t" : `${refusal.refusal}\t${refusal.detail}`);
NODE_EOF
  )

  refusal=${verdict%%$'\t'*}

  if [ "$refusal" != "delete" ]; then
    # The rule named the refusal; this renders it. A verdict the rule could not
    # produce is empty, and an empty refusal keeps the ref and says so.
    case "$refusal" in
      given-up)            why="deferred — a given-up branch keeps its ref" ;;
      merge-unaskable)     why="the host could not be asked whether a PR merged" ;;
      no-merged-pr)        why="unlanded work — no merged PR" ;;
      open-unaskable)      why="the host could not be asked for an open PR" ;;
      open-pr)             why="an open PR is using this branch" ;;
      checked-out)         why="checked out in a worktree — somebody is reading it" ;;
      on-default-branch)   why="the default branch — never deleted" ;;
      # No arm for `live-worker`, `uncommitted-changes` or `blocked-marker`.
      # The rule answers all three and this script consults none, so none can
      # reach here; an arm for one would be the first line of a licence this
      # script does not hold.
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
