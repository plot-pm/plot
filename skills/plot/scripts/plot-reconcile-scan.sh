#!/usr/bin/env bash
# Plot helper: reconciliation sweep — deterministic extractor for plan/branch drift.
# Usage: plot-reconcile-scan.sh [--no-fetch] [--no-pr] [--offline]
#   --no-fetch  skip `git fetch`   --no-pr  skip git-host pr list
#   --offline   both (no network)  — used by the ambient /plot hygiene line
# Output: thirteen-section text report on stdout (each finding carries its exact
#         remediating command as copy-paste text — nothing is executed),
#         terminated by a machine-countable summary line:
#             summary: drift=0 merged_not_delivered=0 stale=0 claims=0 attention=0 concurrent=0 unreleased_delivered=0 unsliced_waves=0 prose_wave_names=0 sprint_drift=0 stale_tally=0 index_drift=0 double_claims=0 rounds_drift=0 pr_source=gh main=main
#         Consumers that only need counts (the /plot dispatcher's hygiene
#         line, /plot-reconcile's Automation Output) read that one line.
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# Reads the repo's plan files, symlink indexes, and git/git-host ref state and
# emits a thirteen-section report. This is the COMPUTATIONAL half of the
# reconciliation loop: mechanical, reproducible enumeration. The INFERENTIAL
# half — deciding which drift to fix, which branch is truly stale, whether a
# plan is ready to deliver — is the human's, guided by the /plot-reconcile
# skill that consumes this report.
#
# READ-ONLY. Nothing here moves a symlink, flips a phase, deletes a branch,
# or writes any repo file. Every finding is printed WITH the exact remediating
# command as copy-paste text — never executed. The scan reads origin/* refs
# (after a fetch) plus the local plan tree; it makes no commits and no pushes.
# (The fetch may also set the local origin/HEAD ref when unset — git metadata,
# not repo content.)
#
# Sections:
#   1. Phase<->symlink drift    — plan phase vs active//delivered/ index
#   2. Merged-but-not-delivered — impl branch merged, plan still Approved
#                                 (two signals: the branch is merged into main,
#                                  OR it was the head of a merged PR — the
#                                  latter survives the branch being deleted)
#   3. Stale branches           — merged/orphan remote branches, no open PR,
#                                 plus CLAIMS (empty branches a worker took);
#                                 a branch contained in an open PR is listed
#                                 as in flight and does NOT count as stale
#   4. Concurrent-delivery      — active plans' branch divergence vs main
#   5. Needs attention          — malformed / non-conforming plans, plus
#                                 DANGLING index symlinks (a link pointing at
#                                 nothing is a broken pointer)
#   6. Delivered but released   — delivered plans already inside a release tag
#   7. Uncut slices           — a `### ` wave heading carrying MORE THAN ONE
#                                 branch line. A wave holds exactly one branch
#                                 (MANIFESTO.md); one holding several is a shape
#                                 /plot-reslice can repair. ACTIONABLE BUT
#                                 NON-BLOCKING — someone runs /plot-reslice, so
#                                 it sits before index drift, and it is kept out
#                                 of the `attention` count for the same reason
#                                 index drift is: nothing is blocked by a shape
#   8. Prose wave names         — a `### ` wave heading written as a sentence,
#                                 not a label. A sentence-length name paints over
#                                 the cells beside it on the board; the fix is to
#                                 rename the heading in the PLAN. ACTIONABLE BUT
#                                 NON-BLOCKING — someone renames it — so it sits
#                                 with the unsliced section and is kept out of
#                                 the `attention` count for the same reason. The
#                                 threshold is the parser's (LONG_WAVE_NAME_MAX);
#                                 this only surfaces the `long_wave_names` field
#   9. Sprint drift             — a plan whose `Sprint:` field disagrees with
#                                 the sprint file listing it, or is empty while
#                                 a sprint lists it; also a sprint member whose
#                                 slug names no plan. ACTIONABLE BUT NON-BLOCKING
#                                 — someone edits the plan or sprint — so it sits
#                                 with the unsliced and prose sections and is kept
#                                 out of the `attention` count for the same reason
#  10. Index drift              — CONVENIENCE level: a plan with no symlink, or
#                                 a phase-less file in the plan directory.
#                                 Since #254 the phase grouping is derived from
#                                 plan content, so nothing depends on these;
#                                 they are browsing gaps, deliberately kept out
#                                 of the `attention` count that gates delivery
#  11. Stale sprint tally       — sprint items left unchecked whose plan is
#                                 delivered or released. Covers CLOSED sprints
#                                 too, because those are the population whose
#                                 tally nothing else will ever recompute. An
#                                 item with no resolvable plan is skipped
#                                 silently — section 9 already catches that.
#                                 ADVISORY, like section 9; stays out of
#                                 `attention`, gates nothing.
#  12. Double-claimed branches  — a branch listed by MORE THAN ONE plan, naming
#                                 both plans and the wave each lists it under.
#                                 Only meaningful since the matcher anchored
#                                 (#490): before that a dependency CITED in
#                                 prose read as a second claim. REPORTS AND
#                                 NEVER GATES — a double claim is a shape for a
#                                 person to resolve, not a branch that cannot
#                                 move — so it carries `double_claims=` and
#                                 stays out of `attention`.
#  13. Stale interrogation rounds — a DRAFT plan whose recorded `Rounds:` value
#                                 predates its own last amendment, naming the
#                                 round, the commit that last wrote it, and the
#                                 commit that amended the plan after it. A plan
#                                 recording NO round is not a finding: an
#                                 unquestioned plan is honestly unquestioned.
#                                 `Rounds: 0` IS a recorded value. REPORTS AND
#                                 NEVER GATES — a stale round is a hint about a
#                                 badge, not a reason to stop a delivery — so
#                                 it carries `rounds_drift=` and stays out of
#                                 `attention`. Placed LAST so sections 1-12
#                                 keep their numbers, and with them
#                                 /plot-deliver's `== 7.` gate marker.
#
# Configuration is read via plot-config.sh from the adopting project's
# `## Plot Config` (Plan directory, Active index, Delivered index, Branch
# prefixes). Plan files are parsed via plot-plan-meta.sh — the shared plan
# parser — in ONE invocation for all plans (single awk pass), so the sweep
# stays cheap enough for ambient use on every /plot even at ~100 plans.
#
# The main branch is auto-detected from origin/HEAD (self-healing via
# `git remote set-head origin -a` during the fetch) and can be overridden
# with a `## Plot Config` line:
#     - **Main branch:** develop
#
# PR enumeration binds to ORIGIN's git host — gh on GitHub, bb on Bitbucket —
# and degrades to git merge-state alone otherwise (the report header states
# which source was used). Two bundled lists are fetched, both ONE call for the
# whole sweep regardless of plan count: open PRs (section 3) and merged PRs
# (section 2). --no-pr/--offline skip both.
#
# Exit 0 on a completed sweep (an empty section is a valid, healthy result);
# exit 1 only when the sweep cannot run at all (not a git repo).

# No `set -e`: a parse hiccup on one plan file must not abort the whole
# read-only sweep. Keep unset-var and pipe-failure safety.
set -uo pipefail

# Operate on the repo the caller is in (like every plot helper) — NOT the
# script's own checkout: for marketplace installs that would be the plugin
# cache, silently sweeping plot's own repo instead of the adopting project.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) \
  || { echo "plot-reconcile: not inside a git repository." >&2; exit 1; }
cd "$repo_root" || exit 1

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

# jq is required: the plan-metadata rows are read through a jq pipe below.
# Without it that pipe yields nothing and every plan-derived section (1, 2,
# 4, 5) would silently report empty — a false "drift=0" clean. Fail loudly
# instead, so a missing jq can never masquerade as a healthy sweep.
command -v jq >/dev/null 2>&1 \
  || { echo "plot-reconcile: jq is required but not found on PATH." >&2; exit 1; }

# Flags (any order, any combination):
#   --no-fetch  skip `git fetch` (offline, or when you just fetched)
#   --no-pr     skip git-host PR enumeration (no `gh/bb pr list` network call) —
#               falls back to git merge-state, same as an absent git-host CLI
#   --offline   both of the above: a fully network-free sweep. Used by the
#               ambient /plot hygiene line so /plot never blocks on the network.
do_fetch=1
do_pr=1
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch) do_fetch=0 ;;
    --no-pr)    do_pr=0 ;;
    --offline)  do_fetch=0; do_pr=0 ;;
    *) ;;   # ignore unknown args (keeps $ARGUMENTS pass-through forgiving)
  esac
  shift
done

# ---------------------------------------------------------------------------
# Configuration (## Plot Config, with plot's defaults)
# ---------------------------------------------------------------------------

PLAN_DIR=$(cfg "Plan directory" "docs/plans/"); PLAN_DIR="${PLAN_DIR%/}"
ACTIVE_DIR=$(cfg "Active index" "$PLAN_DIR/active/"); ACTIVE_DIR="${ACTIVE_DIR%/}"
DELIVERED_DIR=$(cfg "Delivered index" "$PLAN_DIR/delivered/"); DELIVERED_DIR="${DELIVERED_DIR%/}"

# "idea/, feature/, bug/, docs/, infra/" -> "idea|feature|bug|docs|infra"
# Hours after which a bare claim is worth a second look. A DURATION, so it is
# deliberately NOT `Sprint stall limit` — that counts iterations without a
# deliverable in a serial run, which is a different quantity. Reusing it would
# have silently read "3 iterations" as "3 hours".
CLAIM_STALE_H=$(cfg "Claim stale after" "24")
PREFIX_RE=$(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' /' | tr ',' '|')

# ---------------------------------------------------------------------------
# 0. Fetch (read-only) + main-branch detection + ref state
# ---------------------------------------------------------------------------

if [ "$do_fetch" = 1 ]; then
  git fetch origin --prune >/dev/null 2>&1 || true
fi

# Main branch: `## Plot Config` override, else origin/HEAD (self-heal it once
# via set-head when unset and we're allowed to touch the network), else `main`.
MAIN=$(cfg "Main branch")
if [ -z "$MAIN" ]; then
  MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  if [ -z "$MAIN" ] && [ "$do_fetch" = 1 ]; then
    git remote set-head origin -a >/dev/null 2>&1 || true
    MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
  fi
fi
[ -n "$MAIN" ] || MAIN="main"

# Branches whose tip is already contained in origin/<main>.
#
# ANCESTRY, AND IT IS EVIDENCE RATHER THAN THE ANSWER. Read alone it is wrong
# about every squash-merged branch there is: the squashed commit is not the
# branch's commit, so the ref stays ahead of main forever. Measured 2026-09-04
# on this estate — ten merged branches still carrying a ref, ancestry
# disagreeing with the host on TEN OF TEN.
#
# `branch_merged` below is what the sections ask. It reads the HOST first, from
# the merged-PR list this scan already fetches in one bundled call, and falls
# back to this set — which stays because it is the answer that survives a host
# nobody can reach, and because a branch pushed straight to main carries no PR
# at all.
#
# The name says what it holds. It said `merged_branches` until 2026-09-04, and
# a set named for the question rather than for its evidence is how the two came
# to be treated as one thing.
#
# plot-ancestry: evidence — handed to `branch_merged`, which asks the host's
# merged-PR list first and reads this only where no PR exists to read.
ancestor_of_main=$(git branch -r --merged "origin/$MAIN" 2>/dev/null \
  | sed 's/^[[:space:]]*//; s#^origin/##' \
  | grep -vE "^($MAIN|HEAD)" )

# All remote impl/idea branches under the configured prefixes.
all_branches=$(git branch -r 2>/dev/null \
  | sed 's/^[[:space:]]*//; s#^origin/##' \
  | grep -E "^($PREFIX_RE)/" )

# Open-PR source branches, from the git-host CLI matching ORIGIN — the
# scan compares origin/* refs, so PR state must come from the same remote (a
# repo can carry extra remotes on other git hosts; letting gh/bb resolve "any"
# remote would silently enumerate the wrong repo's PRs). Unknown host →
# degraded (git merge-state only).
#
# PR_SOURCE states (named states, machine-countable):
#   absent  — no CLI installed matching the host
#   failed  — CLI present but call failed (429, 401, network error)
#   gh/bb   — CLI present, call succeeded (including zero open PRs)
#   off     — deliberately skipped via --no-pr/--offline
#   degraded — legacy state, kept for backwards compatibility when host unknown
#
# PR_ERROR carries the CLI's first stderr line, beside the state. A machine
# reads the state; a human reads the reason.
PR_SOURCE="degraded"
PR_ERROR=""            # first stderr line from the CLI, if failed
open_prs=""            # head branch names, one per open PR
open_pr_heads=""       # "<number> <head>" lines, same PRs — section 3 names the
                       # PR a branch is contained in, which needs the number.

# How many MERGED PRs to fetch for the single-PR-plan check below. The default
# page size (30) is far too small: on plot's own repo it reaches back only to
# #90, so #40 — `idea/kanban-board-v1`, the five-week-late plan this check
# exists to find — is invisible at the default. Too low silently misses old
# plans, which is precisely this check's own failure mode; the cost of going
# high is a single page-walk, not a per-plan call. Measured on plot's repo
# (106 merged PRs): limit 200 ≈ 0.79-0.92 s, limit 500 ≈ 0.81-1.06 s — the
# round trip dominates, so headroom is nearly free. Saturation is REPORTED
# rather than silent (see MERGED_PR_TRUNCATED below).
MERGED_PR_LIMIT=500
merged_pr_heads=""       # "<number> <head>" lines, one per merged PR
MERGED_PR_TRUNCATED=0    # 1 when the list came back full — older PRs unseen

# Drop the leading PR number from "<number> <head>" lines. A branch name may
# contain spaces in principle, so take everything AFTER the first field rather
# than the second field alone.
pr_head_branches() { # $1="<number> <head>" lines → head lines
  printf '%s\n' "$1" | sed -n 's/^[0-9][0-9]*  *//p'
}

# THE HOST IS ASKED THROUGH `plot-host.sh`, never `gh` or `bb` directly.
#
# Until 2026-09-05 this function held its own copy of the backend split: a
# `case` on origin's URL, a `command -v` probe per CLI, two query shapes for
# GitHub and three for Bitbucket (bb >=3.1 field form, the older full-object
# fallback, and their two separate jq parses). Every one of those is a decision
# the adapter already makes, and holding a second copy is how the two came to
# disagree — `plot-host.sh` learned Bitbucket's `DECLINED`-is-`CLOSED`
# normalisation and its rate-limit exit codes, and this copy did not.
#
# `pr-list` answers on both backends and emits ONE shape: JSON lines carrying
# `number` and `head`, already normalised. So the parse below is backend-blind,
# which is what the duplication cost us.
#
# EVERY STATE THIS FUNCTION REPORTED IS STILL REPORTED, and the mapping is the
# only new thing here. The adapter has no `command -v` probe — it calls the CLI
# and lets it fail — so an absent CLI arrives as a failed call whose stderr says
# `command not found`, and that text is what separates `absent` from `failed`.
# Both were exit-0-with-a-state before and both still are: the scan degrades,
# it does not die.
#
# TWO CALLS, NOT ONE. `--state all` would fetch both lists in a single round
# trip, but the two are consumed differently — open PRs gate section 3, merged
# heads answer the single-PR-plan check, and only the merged one is truncation
# -checked against `MERGED_PR_LIMIT`. A merged list capped at 500 and an open
# list capped at nothing cannot share a limit, and a shared page would let
# hundreds of merged PRs crowd out the open ones the scan actually gates on.
#
# THE ERROR TEXT IS THE CLI'S OWN, carried through the adapter's stderr. A
# machine reads `PR_SOURCE`; a person reads `PR_ERROR`, and "HTTP 429" said by
# the host is worth more than any word this scan could substitute.
load_open_pr_branches() {
  local out err rc tmpstderr host_script backend

  host_script="$script_dir/plot-host.sh"
  if [ ! -r "$host_script" ]; then
    PR_SOURCE="absent"; PR_ERROR="plot-host.sh not found beside this script"; return 0
  fi

  # ORIGIN NAMES THE HOST, AND THE ADAPTER TALKS TO IT. These are two different
  # facts and this function now holds only the first.
  #
  # WHY ORIGIN AND NOT `plot-host.sh backend`. The adapter resolves its backend
  # from the `Git host` config key, defaulting to github — a DECLARATION about
  # the repo. This scan needs the host that origin actually points at, because
  # it compares `origin/*` refs and a repo may carry extra remotes on other
  # hosts: letting the CLI resolve "any" remote silently enumerates the wrong
  # repo's PRs. That was this function's original reason for the URL `case` and
  # it is untouched by routing. A Bitbucket checkout that never wrote the config
  # key still reads `pr_source=bb` here, as it always has.
  #
  # `PLOT_HOST` IS HOW THE ANSWER IS CARRIED, and it is the adapter's own
  # documented override — `plot-host.sh:1306`, "$PLOT_HOST (github|bitbucket)
  # wins". So the scan states which host it means and the adapter obeys, rather
  # than each reaching a private conclusion. Exported for the call only; a repo
  # whose config disagrees with its origin is still asking about origin, which
  # is the only remote whose refs this scan reads.
  #
  # `degraded` SURVIVES as the legacy state for an origin on neither host — the
  # host is unknown rather than broken, and git merge-state alone still answers.
  local url host_env slug repo_args
  url=$(git remote get-url origin 2>/dev/null) || return 0
  case "$url" in
    *github.com*) backend="gh"; host_env="github" ;;
    *bitbucket*)  backend="bb"; host_env="bitbucket" ;;
    *) return 0 ;;
  esac

  # PIN THE LIST TO ORIGIN'S REPOSITORY, for the same reason the host is read
  # from origin one comment up: this scan joins the PR list against `origin/*`
  # refs, and a checkout with a second remote on the same host lets an unpinned
  # list enumerate the other repository — every branch would read as having no
  # open PR, and section 3 would call the whole estate orphaned.
  #
  # GitHub only. `bb` is already scoped to the repository it is run in and
  # takes no `-R`, so passing one would fail the call rather than narrow it.
  repo_args=""
  if [ "$backend" = "gh" ]; then
    slug=$(printf '%s' "$url" | sed -E 's#\.git$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')
    [ -n "$slug" ] && repo_args="--repo $slug"
  fi

  tmpstderr=$(mktemp) || { PR_SOURCE="failed"; PR_ERROR="could not create a temp file"; return 0; }
  # Clean up the temp file on return. Use /bin/rm to avoid PATH issues.
  trap "/bin/rm -f '$tmpstderr' 2>/dev/null" RETURN

  # SEPARATE call from parse: capture the adapter's own exit status, not jq's.
  # A 429 makes it exit 5; testing `$?` after a pipe loses that.
  out=$(PLOT_HOST="$host_env" bash "$host_script" pr-list --state open $repo_args </dev/null 2>"$tmpstderr")
  rc=$?
  err=$(head -1 "$tmpstderr" 2>/dev/null)
  if [ "$rc" -ne 0 ]; then
    # An absent CLI is a CONFIGURATION, not a fault, and it was `absent` here
    # long before the adapter existed. The adapter cannot tell them apart by
    # exit code — `plot-host.sh` exits 3 for a missing binary and for a genuine
    # transport failure alike — so the CLI's own words decide, the same reading
    # `plot-fleet-scan.sh` makes of the same stderr.
    case "$err" in
      *"command not found"*|*"not found"*|*"No such file or directory"*)
        PR_SOURCE="absent"; PR_ERROR="${backend} not found on PATH" ;;
      *)
        PR_SOURCE="failed"; PR_ERROR="${err:-plot-host.sh exited $rc}" ;;
    esac
    return 0
  fi
  # SUCCESS — empty output is a VALUE (zero open PRs), not a failure.
  #
  # `number` AND `head` from one call: the head alone answers "is this branch
  # the PR's head", the number is needed to name the PR a branch is contained
  # in (section 3). The adapter emits both on every line.
  PR_SOURCE="$backend"
  open_pr_heads=$(printf '%s' "$out" | jq -r 'select(.number != null) | "\(.number) \(.head)"' 2>/dev/null)
  open_prs=$(pr_head_branches "$open_pr_heads")

  # Merged counterpart, same call shape. Bundled: ONE call for all plans, so
  # cost is constant in plan count. A failure here is TOLERATED and always was
  # — the merged list feeds one advisory check, and section 8 says so in its
  # own note when the heads are missing.
  if out=$(PLOT_HOST="$host_env" bash "$host_script" pr-list --state merged --limit "$MERGED_PR_LIMIT" $repo_args </dev/null 2>/dev/null); then
    merged_pr_heads=$(printf '%s' "$out" | jq -r 'select(.number != null) | "\(.number) \(.head)"' 2>/dev/null)
  fi

  # Did the page fill exactly? Then older merged PRs exist that we did not see.
  if [ -n "$merged_pr_heads" ] \
     && [ "$(printf '%s\n' "$merged_pr_heads" | grep -c .)" -ge "$MERGED_PR_LIMIT" ]; then
    MERGED_PR_TRUNCATED=1
  fi
}
if [ "$do_pr" = 1 ]; then
  load_open_pr_branches
else
  PR_SOURCE="off"   # deliberately skipped (--no-pr/--offline), not a failure
fi

# Open-PR info is trustworthy only from a real git-host listing. When it isn't
# (absent/failed/degraded/off), the stale-branch section leans on git
# merge-state alone — and when pr_source is absent or failed, section 3 is
# suppressed entirely (no rows printed) because the predicate "no open PR"
# cannot be evaluated.
case "$PR_SOURCE" in gh|bb) pr_reliable=1 ;; *) pr_reliable=0 ;; esac

echo "plot-reconcile sweep — $(git rev-parse --short "origin/$MAIN" 2>/dev/null) on origin/$MAIN"
if [ "$pr_reliable" = 1 ]; then
  echo "PR state: $PR_SOURCE pr list (open PRs enumerated)"
elif [ "$PR_SOURCE" = off ]; then
  echo "PR state: skipped (--no-pr) — git merge-state only; no git-host network call."
  echo "          (stale-branch section may over-list branches with an open PR;"
  echo "           run /plot-reconcile without --offline for the precise list.)"
elif [ "$PR_SOURCE" = absent ]; then
  echo "PR state: ABSENT — no git-host CLI (gh/bb) found on PATH."
  echo "          Section 3 (stale branches) not evaluated — cannot determine which"
  echo "          branches have an open PR without a working CLI."
elif [ "$PR_SOURCE" = failed ]; then
  echo "PR state: FAILED — $PR_ERROR"
  echo "          Section 3 (stale branches) not evaluated — the git-host call failed."
else
  echo "PR state: DEGRADED — no git-host CLI (gh/bb) available; using git merge-state only."
  echo "          (stale-branch section may over-list branches with an open PR;"
  echo "           confirm each before deleting.)"
fi
if [ ! -d "$PLAN_DIR" ]; then
  echo "warning: plan directory '$PLAN_DIR' not found — no plans scanned."
  echo "         (Check the '## Plot Config' section: Plan directory.)"
fi
echo

# ---------------------------------------------------------------------------
# Parse ALL plans once (single parser invocation, single awk pass), then
# flatten to delimited rows:
#   file | phase | phase_raw | phase_alt | phase_alt_raw
#        | branches(space-joined) | prs(comma-joined) | type | sprint
# joined by the ASCII unit separator (0x1f) — NOT tab: tab is IFS whitespace,
# so bash `read` collapses runs of it and empty fields (phase_alt_raw is
# usually empty) would shift every later field left. A non-whitespace IFS
# preserves empty fields. Sections 1, 2, 4, 5, and 9 all read from these rows —
# no re-parsing.
# ---------------------------------------------------------------------------

US=$'\x1f'
plan_rows=""
plan_json=""
set -- "$PLAN_DIR"/[0-9]*.md
if [ -f "${1:-}" ]; then
  # ONE parser invocation for the whole sweep (see the single-pass note above).
  # Captured raw as JSON lines so the unsliced-wave section (7) can read the
  # `waves[]` structure without a second call and without a second parser — the
  # parser is the format contract, and `a-plan-branch-can-be-a-parser-artifact`
  # is the failure a hand-rolled branch count would reproduce.
  plan_json=$("$script_dir/plot-plan-meta.sh" "$@" --prefixes "$PREFIX_RE" 2>/dev/null)
  plan_rows=$(printf '%s\n' "$plan_json" \
    | jq -r '[.file, .phase, .phase_raw, .phase_alt, .phase_alt_raw,
              (.branches | join(" ")), (.prs | map(tostring) | join(",")),
              (.type // ""), (.sprint // "")] | join("\u001f")')
fi

# Branches (space-joined) recorded for a plan file, from the parsed rows.
plan_branches() { # $1=plan file path
  printf '%s\n' "$plan_rows" | awk -F"$US" -v f="$1" '$1 == f { print $6; exit }'
}

# Is this remote branch an empty CLAIM — a ref pushed to take work atomically,
# holding no commits of its own? Distinct from "merged" (real work, landed) and
# from "orphan" (real work, never landed).
# Count commits beyond main that are NOT claim markers. A claim marker must be
# BOTH titled `plot: claim ...` AND empty (its tree equals its parent's) — the
# subject alone is not evidence. A human commit titled "plot: claim handling
# refactor" carrying real files would otherwise read as an empty claim, and
# with a deferred: annotation the reaper would offer to DELETE real work.
real_commits_beyond_main() { # $1=branch → count
  local br="$1" c n=0 subj
  for c in $(git rev-list "origin/$MAIN..origin/$br" </dev/null 2>/dev/null); do
    subj=$(git log -1 --format=%s "$c" </dev/null 2>/dev/null)
    # A claim marker is titled `plot: claim ...` AND empty. Both, or it counts
    # as real work.
    case "$subj" in
      "plot: claim "*)
        if [ "$(git rev-parse "$c^{tree}" </dev/null 2>/dev/null)" \
             = "$(git rev-parse "$c^^{tree}" </dev/null 2>/dev/null)" ]; then
          continue
        fi ;;
    esac
    n=$((n + 1))
  done
  echo "$n"
}

is_empty_claim() { # $1=branch
  local ahead real
  git show-ref -q --verify "refs/remotes/origin/$1" </dev/null 2>/dev/null || return 1
  ahead=$(git rev-list --count "origin/$MAIN..origin/$1" </dev/null 2>/dev/null || echo 0)
  # Claim commits are empty markers pushed to take a branch (see
  # plot-dispatch.sh, "THE CLAIM"). A branch carrying only those is claimed but
  # unworked; one carrying any real commit is work in progress, not a claim.
  [ "$ahead" -gt 0 ] || return 1   # nothing of its own → merged work, not a claim
  real=$(real_commits_beyond_main "$1")
  [ "${real:-0}" = "0" ]
}
# A branch with NO commits of its own is deliberately not treated as a claim,
# even though pre-claim-commit fleets produced exactly that shape. Such a
# branch is indistinguishable from merged work — which is why claims carry a
# commit now. Reporting merged branches as claimed would hide real deletion
# candidates, so the ambiguous legacy shape falls through to the stale-branch
# logic instead.

# How did this claim end? Git cannot say — an abandoned claim and a dead worker
# leave the identical empty branch. The plan annotation is the only signal, and
# reading it here is the ONE deliberate exception to "no gate reads the
# annotation": this gate decides CLEANUP, not work, so a wrong annotation costs
# at most a missed cleanup — never lost or duplicated work.
# How old is this claim, in whole days? The claim ref's commit date is when the
# worker took the branch.
claim_age_days() { # $1=branch → integer days
  local when now
  when=$(git log -1 --format=%ct "origin/$1" </dev/null 2>/dev/null) || { echo 0; return; }
  [ -n "$when" ] || { echo 0; return; }
  now=$(date -u +%s)
  echo $(( (now - when) / 86400 ))
}

claim_disposition() { # $1=branch → "abandoned" | "unresolved"
  local br="$1" l line
  for l in "$ACTIVE_DIR"/*.md; do
    [ -e "$l" ] || continue
    line=$(grep -F -- "\`$br\`" "$l" 2>/dev/null | head -1)
    [ -n "$line" ] || continue
    case "$line" in
      *"<!-- deferred:"*|*"<!-- moved:"*) echo "abandoned"; return ;;
    esac
  done
  echo "unresolved"
}

# Is this branch an ANCESTOR of some open PR's head — work in flight on a
# stack, rather than work nobody picked up? Echoes the PR number of the first
# such PR, or nothing. Asking only "is it the head" (the test above) misses
# every branch below the top of a stack: on this repo's own history seven of
# eight `stale=` entries were branches contained in one open PR, which is
# enough false noise to make a person stop reading the section.
#
# Cost is one merge-base per candidate per open PR — branches x open PRs, both
# small, and only reached by branches that already failed the head test.
contained_in_open_pr() { # $1=branch → PR number, or empty
  local br="$1" n head
  [ -n "$open_pr_heads" ] || return 1
  git show-ref -q --verify "refs/remotes/origin/$br" </dev/null 2>/dev/null || return 1
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    n=${line%% *}
    head=${line#* }
    [ "$head" = "$br" ] && continue   # itself; the head test already ran
    git show-ref -q --verify "refs/remotes/origin/$head" </dev/null 2>/dev/null || continue
    # plot-ancestry: prefilter — this asks whether one branch sits BELOW an open
    # PR's head, never whether either landed. A miss prints one extra `orphan`
    # row for a person to read; it hides nothing.
    if git merge-base --is-ancestor "origin/$br" "origin/$head" </dev/null 2>/dev/null; then
      echo "$n"; return 0
    fi
  done <<< "$open_pr_heads"
  return 1
}

# Does a dated plan file have a symlink pointing at it from a given index dir?
symlinked_from() { # $1=index_dir $2=dated_basename
  local l t
  for l in "$1"/*.md; do
    [ -L "$l" ] || continue
    t=$(readlink "$l" 2>/dev/null | sed 's|.*/||')
    [ "$t" = "$2" ] && { echo "$l"; return 0; }
  done
  return 1
}

n_drift=0; n_mnd=0; n_stale=0; n_att=0; n_conc=0; n_claims=0; n_unrel=0
n_unsliced=0; n_prose=0; n_sprint_drift=0; n_stale_tally=0; n_idx=0; n_double=0
n_rounds_drift=0

# ---------------------------------------------------------------------------
# 1. Phase <-> symlink drift  (plot-managed plans only)
# 5. Needs attention          (collected here in the same pass)
# 7. Index drift, convenience level (also collected here)
# ---------------------------------------------------------------------------

drift_out=""
attention_out=""
index_out=""

while IFS="$US" read -r f st raw_phase alt alt_raw _branches _prs _ptype; do
  [ -n "$f" ] || continue
  base=$(basename "$f")

  in_active=""; in_delivered=""
  in_active=$(symlinked_from "$ACTIVE_DIR" "$base" || true)
  in_delivered=$(symlinked_from "$DELIVERED_DIR" "$base" || true)

  # --- A file with no phase field is NOT A PLAN, and says so at convenience
  # level rather than counting as attention.
  #
  # THIS RESOLVES A DISAGREEMENT BETWEEN TWO CONSUMERS OF ONE DIRECTORY.
  # plot-fleet-scan.sh (#254) decided the rule: a `.md` file in $PLAN_DIR whose
  # `phase` parses as NONE never claimed to be a plan, so the pulse does not
  # enumerate it — measured in plot's own repo, two such files are a worker
  # report and an open-questions note. This script used to call the SAME file a
  # plan needing attention. Two scripts, one file, opposite verdicts is exactly
  # the shape of the invisible-plan incident this plan exists to close, so the
  # split is settled here rather than left for a reader to discover.
  #
  # Settled in #254's direction — not a plan — because the alternative puts the
  # format contract in two places. plot-plan-meta.sh is the contract (Manifesto
  # Principle 3); "is this a plan" is its answer, and a maintenance sweep that
  # answered differently would be a second implementation free to drift from
  # the first. UNKNOWN stays attention for the same reason it stays a plan
  # there: a declared-but-unrecognised phase IS a plan with a bad field.
  #
  # It is not silently dropped, because the visibility the old line bought was
  # real: a phase-less file in the plan directory is still worth a human
  # glance, and section 9 (index drift) is where a glance-level finding belongs
  # now. What
  # changes is the claim — "nobody classified this" instead of "this plan is
  # broken" — and that it no longer inflates the `attention` count that gates
  # /plot-deliver and the /plot hygiene line.
  if [ "$st" = NONE ]; then
    index_out+="  $base — no phase field → not a plan (decision log / note?)\n"
    n_idx=$((n_idx + 1))
    continue   # non-plans are not subject to drift or index rules
  fi
  if [ "$st" = UNKNOWN ]; then
    attention_out+="  $base — unrecognized phase: '$raw_phase'\n"
    n_att=$((n_att + 1))
  fi
  if [ -n "$alt_raw" ] && [ "$alt" != NONE ] && [ "$alt" != "$st" ]; then
    attention_out+="  $base — status: '$raw_phase' disagrees with phase: '$alt_raw' (phase is machine-read)\n"
    n_att=$((n_att + 1))
  fi
  # --- An unlinked plan is index drift, not an orphan.
  #
  # This line said "(orphaned)" and counted as attention until #254, and it was
  # right when it was written: the fleet scan enumerated $ACTIVE_DIR, so a plan
  # with no symlink was genuinely unreachable — invisible to every unscoped
  # pulse, absent from the board, undispatchable. Orphaned was the accurate
  # word for that.
  #
  # #254 made the pulse enumerate $PLAN_DIR and group by declared phase. The
  # same plan is now fully visible everywhere that decides anything; only
  # `ls $ACTIVE_DIR/` misses it. The report did not become wrong — it EXPIRED.
  #
  # So the severity drops to convenience: the symlinks still serve human
  # browsing and stable slug-named paths, a missing one is worth mentioning,
  # and the fix command is still printed for anyone who wants the browsing path
  # back. What it must not do is count as `attention`, because that count gates
  # the /plot-deliver delivery-landed check and the /plot hygiene line — and a
  # cosmetic gap holding up a delivery is a false stop.
  #
  # A DANGLING SYMLINK KEEPS ITS SEVERITY and is reported below, separately: a
  # link pointing at nothing is a broken pointer, which no amount of deriving
  # makes harmless.
  if [ -z "$in_active" ] && [ -z "$in_delivered" ]; then
    index_out+="  $base — phase '$raw_phase', no symlink in $ACTIVE_DIR/ or $DELIVERED_DIR/ (browsing only)\n"
    n_idx=$((n_idx + 1))
    # Terminal phases (delivered/released AND superseded/rejected) belong in the
    # delivered/ terminal index — not active/. Suggesting active/ for a
    # Superseded plan is the exact wrong-default a downstream operator had to
    # override (issue #33); route it correctly here.
    case "$st" in
      delivered|released|superseded|rejected) _idx="$DELIVERED_DIR" ;;
      *)                                       _idx="$ACTIVE_DIR" ;;
    esac
    printf -v _cmd '    optional: ln -s ../%s %s/%s' "$base" "$_idx" \
      "$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')"
    index_out+="$_cmd\n"
    continue
  fi

  # --- Drift: phase says one thing, symlink location says another ---
  case "$st" in
    delivered|released)
      if [ -n "$in_active" ] && [ -z "$in_delivered" ]; then
        slug=$(basename "$in_active")
        drift_out+="  $base — phase '$raw_phase' but symlink still in $ACTIVE_DIR/ (half-delivery failure mode)\n"
        drift_out+="    fix: git rm $in_active && ln -s ../$base $DELIVERED_DIR/$slug && git add -A\n"
        n_drift=$((n_drift + 1))
      fi
      ;;
    superseded|rejected)
      # Terminal, non-delivery phases: the symlink belongs in delivered/ too.
      # Previously uncaught — a Superseded/Rejected plan lingering in active/
      # kept showing up as an "active" plan it no longer is.
      if [ -n "$in_active" ] && [ -z "$in_delivered" ]; then
        slug=$(basename "$in_active")
        drift_out+="  $base — phase '$raw_phase' (terminal) but symlink still in $ACTIVE_DIR/\n"
        drift_out+="    fix: git rm $in_active && ln -s ../$base $DELIVERED_DIR/$slug && git add -A\n"
        n_drift=$((n_drift + 1))
      fi
      ;;
    draft|approved)
      if [ -n "$in_delivered" ] && [ -z "$in_active" ]; then
        slug=$(basename "$in_delivered")
        drift_out+="  $base — phase '$raw_phase' but symlink in $DELIVERED_DIR/\n"
        drift_out+="    fix: git rm $in_delivered && ln -s ../$base $ACTIVE_DIR/$slug && git add -A\n"
        n_drift=$((n_drift + 1))
      fi
      ;;
  esac
done <<< "$plan_rows"

# --- Dangling index symlinks → attention (the severity the unlinked plan lost)
#
# A link in $ACTIVE_DIR/ or $DELIVERED_DIR/ whose target does not resolve. This
# was reported NOWHERE before: the loop above walks PLANS and asks "does a link
# point at me", so a link pointing at a file that no longer exists matched no
# plan and was silently skipped — the check ran in the one direction that
# cannot see it.
#
# It has to be reported now, and at attention level, because this is the fact
# the demotion above must not swallow. A missing link is a browsing gap; a link
# pointing at nothing is a BROKEN POINTER — `cat $ACTIVE_DIR/foo.md` fails, a
# bookmarked path 404s, and the plan it named may have been renamed, moved, or
# deleted. Deriving the phase grouping does not make that harmless: nothing
# derives away a pointer to a file that is not there.
#
# No fix command is printed, deliberately. Two remedies exist — repoint the
# link at the plan's new name, or remove a link whose plan is gone — and the
# script cannot tell which without knowing why the target vanished. That is
# judgment, and Principle 3 puts judgment on the other side of the line.
for _idx_dir in "$ACTIVE_DIR" "$DELIVERED_DIR"; do
  [ -d "$_idx_dir" ] || continue
  for _l in "$_idx_dir"/*.md; do
    [ -L "$_l" ] || continue
    [ -e "$_l" ] && continue   # resolves — not our case
    attention_out+="  $_l — symlink target missing: $(readlink "$_l" 2>/dev/null) (dangling index link)\n"
    attention_out+="    inspect: readlink $_l — then repoint it at the renamed plan, or git rm it\n"
    n_att=$((n_att + 1))
  done
done

echo "== 1. Phase<->symlink drift =="
if [ -n "$drift_out" ]; then printf '%b' "$drift_out"; else echo "  (none — all plot-managed plans consistent)"; fi
echo

# ---------------------------------------------------------------------------
# 2. Merged-but-not-delivered
# ---------------------------------------------------------------------------

echo "== 2. Merged-but-not-delivered (candidate /plot-deliver) =="

# Which merged PR has this branch as its head? Echoes the PR number, or nothing.
# This is the signal that survives a DELETED branch: in single-PR mode the plan
# and its implementation ride one idea branch, which is deleted at merge — so
# `git branch -r --merged` can never match it, and the plan hangs unreported.
# Deliberately NOT keyed on the plan's own `prs` field: `kanban-board-v1` sat
# undelivered for five weeks carrying no PR annotation at all (`→ #40` was
# back-filled at delivery). The missing annotation and the missing delivery
# share a cause, so an annotation-dependent check is blind to exactly the plans
# it exists to catch.
merged_pr_for_branch() { # $1=branch → PR number, or empty
  [ -n "$merged_pr_heads" ] || return 0
  printf '%s\n' "$merged_pr_heads" | awk -v b="$1" '$2 == b { print $1; exit }'
}

# DID THIS BRANCH'S WORK LAND? The one question sections 2 and 3 ask, and the
# one place that answers it.
#
# THE HOST FIRST. `merged_pr_heads` is this scan's merged-PR list, already
# fetched in ONE bundled call above, so reading it costs nothing per branch —
# and it is the only source that is right about a squash merge. Measured
# 2026-09-04 on this estate: ten merged branches still carrying a ref, and
# ancestry disagreeing with the host on TEN OF TEN of them. That is not an
# occasional miss. `plot-pr-merged.sh` already states the rule the reaper and
# the ref sweep follow — read the merge, never the state, never ancestry — and
# this is the same rule applied where the scan kept deriving its own answer.
#
# ANCESTRY SECOND, AND ONLY AS A SECOND CHANCE TOWARD "LANDED". Two populations
# need it and neither has a merged PR to read: a branch pushed straight to main
# with no PR at all, and every branch in a repo whose host cannot be reached.
# It can only ever ADD a merged verdict, never withdraw one, so a squash merge
# that ancestry misreads is decided by the host above it and never reaches here.
#
# WHAT A WRONG ANSWER COSTS, in each direction:
#   * a false `merged` names a live branch a deletion candidate (section 3) —
#     which is why neither source may guess and both must be positive evidence;
#   * a false `not merged` hides a finished plan from /plot-deliver (section 2)
#     and leaves a landed ref unreported, which is the failure measured above.
#
# Section 2 keeps its own OR over the two signals rather than calling this: it
# needs the PR NUMBER to print, so it reads `merged_pr_for_branch` directly and
# would ask the same list twice.
branch_merged() { # $1=branch → 0 when its work landed
  [ -n "$(merged_pr_for_branch "$1")" ] && return 0
  printf '%s\n' "$ancestor_of_main" | grep -qx "$1"
}

mnd_out=""
while IFS="$US" read -r f st _raw _alt _alt_raw branches prs _ptype; do
  [ -n "$f" ] || continue
  [ "$st" = approved ] || continue
  base=$(basename "$f")
  merged_any=0
  merged_pr_hits=""
  for b in $branches; do
    # Signal A — the ref still exists and is merged into main. Unchanged: this
    # is how fan-out plans are caught, whose per-branch PRs merge separately.
    if printf '%s\n' "$ancestor_of_main" | grep -qx "$b"; then merged_any=1; fi
    # Signal B — a merged PR had this branch as its head. Catches the branch
    # whose ref is gone. OR-ed with A, never replacing it.
    hit=$(merged_pr_for_branch "$b")
    if [ -n "$hit" ]; then
      merged_any=1
      merged_pr_hits="${merged_pr_hits:+$merged_pr_hits, }#$hit ($b)"
    fi
  done
  if [ "$merged_any" = 1 ]; then
    slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    mnd_out+="  $base — impl branch merged to $MAIN, plan still Approved (PRs: ${prs:-none-linked})\n"
    if [ -n "$merged_pr_hits" ]; then
      mnd_out+="    merged PR head: $merged_pr_hits\n"
    fi
    mnd_out+="    consider: /plot-deliver ${slug%.md}\n"
    n_mnd=$((n_mnd + 1))
  fi
done <<< "$plan_rows"
if [ -n "$mnd_out" ]; then printf '%b' "$mnd_out"; else echo "  (none)"; fi
# Degradation and truncation are STATED, never silent — a check that quietly
# skipped is indistinguishable from a check that found nothing, and "silence
# reads as health" is the exact defect this section was fixed for.
if [ "$pr_reliable" != 1 ]; then
  echo "  note: merged-PR heads not consulted (pr_source=$PR_SOURCE) — plans whose"
  echo "        branch was deleted at merge cannot be detected in this mode."
elif [ "$MERGED_PR_TRUNCATED" = 1 ]; then
  echo "  note: merged-PR list hit its limit of $MERGED_PR_LIMIT — older merged PRs were"
  echo "        not examined; a long-hanging plan may still be missed here."
fi
echo

# ---------------------------------------------------------------------------
# 3. Stale branches
#
# When PR state is ABSENT or FAILED, the predicate "no open PR" cannot be
# evaluated — printing rows would be printing confident claims from unverified
# input. The section is suppressed: no rows, but the reason and branch count
# are stated so the reader knows what was NOT checked.
#
# When PR state is OFF (--no-pr/--offline), the caller asked for git merge-state
# only and knows what it costs — rows are printed with a warning, as before.
#
# stale= reports 0 when the section was not evaluated, because a consumer
# counting stale=12 from an unevaluated section is being handed a number nobody
# measured.
# ---------------------------------------------------------------------------

echo "== 3. Stale branches =="
stale_out=""
claims_out=""
contained_out=""

# Count how many branches are ahead of main — the number we would have reported
# if PR state were available. Only counted when suppressing; otherwise derived
# from the findings themselves.
n_ahead_of_main=0

# Suppression decision: absent or failed mean the open-PR list is unknown, so
# the orphan/stale classification cannot run. Off (--no-pr) and degraded
# (unknown host) print rows with a warning, preserving the old behaviour for
# readers who know what they asked for.
section3_suppressed=0
case "$PR_SOURCE" in absent|failed) section3_suppressed=1 ;; esac

while IFS= read -r b; do
  [ -n "$b" ] || continue
  case "$b" in
    "$MAIN"|release/*) continue ;;   # protected set (main + release/*)
  esac

  # If suppressed, still count branches ahead of main for the advisory message.
  if [ "$section3_suppressed" = 1 ]; then
    is_merged=0
    if branch_merged "$b"; then is_merged=1; fi
    if [ "$is_merged" = 0 ]; then
      n_ahead_of_main=$((n_ahead_of_main + 1))
    fi
    continue
  fi

  has_open_pr=0
  if [ "$pr_reliable" = 1 ] && printf '%s\n' "$open_prs" | grep -qx "$b"; then has_open_pr=1; fi
  is_merged=0
  if branch_merged "$b"; then is_merged=1; fi

  if [ "$has_open_pr" = 1 ]; then
    continue   # live work — never a stale candidate
  fi
  # An empty claim is neither merged work nor an orphan: someone took this
  # branch and may still be on it. Classify it before those two verdicts, or it
  # falls into "ahead of main → orphan", which is doubly wrong — it is not
  # ahead, and "orphan" hides that a worker may be alive there.
  if is_empty_claim "$b"; then
    if [ "$(claim_disposition "$b")" = "abandoned" ]; then
      claims_out+="  origin/$b — abandoned claim (plan says deferred/moved) → deletion candidate\n"
      claims_out+="    fix: git push origin --delete $b\n"
    else
      age_d=$(claim_age_days "$b")
      if [ "$CLAIM_STALE_H" -gt 0 ] && [ $((age_d * 24)) -ge "$CLAIM_STALE_H" ]; then
        # Stale is EVIDENCE, not permission: still no deletion command, because
        # a slow worker and a dead one look identical and one of them is doing
        # real work. The age lets a human decide; the tool must not.
        claims_out+="  origin/$b — still claimed, no commits, ${age_d}d old → stale, needs judgment\n"
        claims_out+="    inspect: plot-dispatch.sh --status   # is its worker alive?\n"
      else
        claims_out+="  origin/$b — still claimed, no commits → needs judgment (worker thinking, or dead)\n"
        claims_out+="    inspect: git log -1 --format='claimed %cr' origin/$b\n"
      fi
    fi
    n_claims=$((n_claims + 1))
    continue
  fi
  if [ "$is_merged" = 1 ]; then
    # "merged" HERE MEANS THE HOST SAID SO, or — where it had no PR to read —
    # that the tip is contained in `$MAIN`. See `branch_merged`. The wording
    # stays "merged into $MAIN" because that is what a reader needs to act on;
    # what changed is which source is asked first.
    stale_out+="  origin/$b — merged into $MAIN, no open PR → deletion candidate\n"
    stale_out+="    fix: git push origin --delete $b\n"
  else
    # Ahead of main and not a PR head — but is it BELOW one? A branch contained
    # in an open PR is work in flight on a stack, and calling it an orphan is
    # the section's loudest false answer. Only asked here, in the unmerged arm:
    # a merged branch is an ancestor of main and therefore of every open PR
    # head branched from it, so asking earlier would swallow the whole
    # deletion-candidate class.
    #
    # ORDERING — this comes AFTER the claim check above, and the obvious reason
    # is the wrong one. An empty claim is an ancestor of nothing: its claim
    # commit puts it one commit AHEAD of the branch point, so the ancestry runs
    # the other way. The real case is that once a worker builds on its claim,
    # the claim commit becomes part of the working branch — typically the head
    # of the PR it opens. Such a claim IS legitimately contained in an open PR,
    # and must still be reported as a claim, because that is the more specific
    # fact. Claim first, containment second.
    if contained_pr=$(contained_in_open_pr "$b"); then
      contained_out+="  origin/$b — contained in open PR #$contained_pr → not orphaned\n"
      continue   # not stale: it does not count toward stale=
    fi
    stale_out+="  origin/$b — ahead of $MAIN, no open PR → orphan (needs judgment)\n"
    stale_out+="    inspect: git log --oneline origin/$MAIN..origin/$b\n"
  fi
  n_stale=$((n_stale + 1))
done <<< "$all_branches"

# Output depends on whether the section was suppressed.
if [ "$section3_suppressed" = 1 ]; then
  # Section not evaluated — no rows, but say why and report the count.
  if [ "$PR_SOURCE" = absent ]; then
    echo "  (not evaluated — PR state unknown: $PR_ERROR)"
  else
    echo "  (not evaluated — PR state unknown: $PR_ERROR)"
  fi
  echo "  $n_ahead_of_main branches are ahead of $MAIN; whether any is stale cannot be decided"
  echo "  without the open-PR list. Re-run once the git host answers."
  # stale= stays 0 — nobody measured it.
else
  if [ -n "$stale_out" ]; then printf '%b' "$stale_out"; else echo "  (none)"; fi
  if [ -n "$claims_out" ]; then
    echo
    echo "  -- claims (empty branches taken by a worker) --"
    printf '%b' "$claims_out"
  fi
  # Printed rather than silent: the section stays honest about what it examined
  # and rejected. A scan that quietly drops findings is what this plan was
  # written to fix — "silence reads as health".
  if [ -n "$contained_out" ]; then
    echo
    echo "  -- contained in an open PR (work in flight, not stale) --"
    printf '%b' "$contained_out"
  fi
fi
echo

# ---------------------------------------------------------------------------
# 4. Concurrent-delivery check (active plans' impl branches vs main)
# ---------------------------------------------------------------------------

echo "== 4. Concurrent-delivery check (active plans) =="
cd_out=""
for l in "$ACTIVE_DIR"/*.md; do
  [ -L "$l" ] || continue
  target=$(readlink "$l" 2>/dev/null | sed 's|.*/||')
  df="$PLAN_DIR/$target"
  [ -f "$df" ] || continue
  branches=$(plan_branches "$df")
  for b in $branches; do
    git rev-parse --verify --quiet "origin/$b" >/dev/null 2>&1 || continue
    counts=$(git rev-list --left-right --count "origin/$MAIN...origin/$b" 2>/dev/null)
    behind=$(printf '%s' "$counts" | awk '{print $1}')
    ahead=$(printf '%s' "$counts" | awk '{print $2}')
    cd_out+="  $b — ${ahead:-?} ahead / ${behind:-?} behind origin/$MAIN\n"
    n_conc=$((n_conc + 1))
  done
done
if [ -n "$cd_out" ]; then printf '%b' "$cd_out"; else echo "  (no active plans with resolvable impl branches)"; fi
echo

# ---------------------------------------------------------------------------
# 5. Needs attention
# ---------------------------------------------------------------------------

echo "== 5. Needs attention (malformed / non-conforming / broken pointers) =="
if [ -n "$attention_out" ]; then printf '%b' "$attention_out"; else echo "  (none)"; fi
echo

# ---------------------------------------------------------------------------
# 6. Delivered plans whose work is already inside a release tag.
#
# The fourth phase went unreached for sixteen releases because nothing compared
# these two facts: /plot-release ships a version, and the plans describing that
# version stay at Delivered. Neither side is wrong on its own, so neither side
# complained.
#
# The question is "which release tag contains this plan's merge commit", and
# git answers it exactly. It is deliberately NOT a date comparison: the
# delivery date records when a plan was BOOKED, not when its code merged (one
# plan here sat five months between the two), and two tags in this repo share a
# date, so day resolution cannot separate them even in principle.
echo "== 6. Delivered but already released (candidate /plot-release) =="
unrel_out=""
while IFS="$US" read -r f st _raw _alt _alt_raw _branches prs ptype; do
  [ -n "$f" ] || continue
  [ "$st" = delivered ] || continue
  # docs/infra plans end at Delivered: /plot-deliver already tells their authors
  # "live on main — no release needed". Reporting them here would contradict a
  # message Plot itself sends, on every sweep, forever.
  case "$ptype" in docs|infra) continue ;; esac

  base=$(basename "$f")
  if [ -z "$prs" ]; then
    # "Cannot tell" and "nothing wrong" must not look the same — that
    # indistinguishability is the whole finding this section exists for.
    unrel_out+="  $base — delivered, but no PR annotation → cannot resolve a version\n"
    unrel_out+="    inspect: add → #N to its Branches section, then re-run\n"
    n_unrel=$((n_unrel + 1))
    continue
  fi

  last_pr="${prs##*,}"
  sha=$("$script_dir/plot-host.sh" pr-state "$last_pr" </dev/null 2>/dev/null \
        | jq -r '.mergeCommit // empty' 2>/dev/null)
  # No grep fallback. An earlier draft searched commit messages for "#N", which
  # matched any commit MENTIONING the PR rather than its merge — and reported
  # v2.2.0 for a plan that shipped in v1.7.0. A wrong version in a transition
  # record is a claim nobody re-checks, so an unanswerable case says so instead.
  if [ -z "$sha" ]; then
    unrel_out+="  $base — delivered, but PR #$last_pr has no merge commit → cannot resolve\n"
    unrel_out+="    inspect: gh pr view $last_pr --json state,mergeCommit\n"
    n_unrel=$((n_unrel + 1))
    continue
  fi

  tag=$(git tag --contains "$sha" 2>/dev/null \
        | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | head -1)
  [ -n "$tag" ] || continue   # genuinely not released yet — nothing to report

  slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
  unrel_out+="  $base — shipped in $tag, plan still Delivered\n"
  unrel_out+="    consider: /plot-release (records Phase: Released, ${slug%.md})\n"
  n_unrel=$((n_unrel + 1))
done <<< "$plan_rows"
if [ -n "$unrel_out" ]; then printf '%b' "$unrel_out"; else echo "  (none)"; fi
echo

# ---------------------------------------------------------------------------
# 7. Uncut slices
#
# A wave holds exactly one branch (MANIFESTO.md): a `### ` heading carrying MORE
# THAN ONE branch line is a shape /plot-reslice can repair. This section reports
# every such heading — its plan file, its heading, and its branch count — and
# repairs nothing. That is Manifesto Principle 3's split: this collects,
# /plot-reslice and a person conclude.
#
# IT DOES NOT GATE, and that is load-bearing, not a preference. /plot-deliver's
# delivery-landed gate and the /plot hygiene line both read `attention=` from
# the footer; adding a cosmetic-by-nature finding to that count would make every
# delivery in this repo stop on an uncut slice that blocks nothing. An
# uncut slice is a SHAPE TO FIX, not a branch that cannot move — so it carries
# its own footer counter (`unsliced_waves=`) exactly as index drift carries
# `index_drift=`, and stays out of `attention`.
#
# PLACEMENT: it is actionable (someone runs /plot-reslice) where index drift is
# pure convenience, so it sits BEFORE index drift — this is section 7. The
# prose-wave-name section (8) later joined it, and index drift moved to 9.
# Sections 1-6 keep their numbers, so /plot-deliver's gate marker
# (`sed -n '/^== 7./q;p'`) still stops before the first non-blocking section:
# what used to be section 7 (index drift, non-blocking) is now this section
# (uncut slices, non-blocking), and the blocking set stays 1-6. The marker
# text is therefore unchanged BY DESIGN — its meaning ("stop before the
# non-blocking sections") is preserved because every non-blocking section sits
# at 7 or later.
#
# The COUNT is branch LINES under the heading, taken from plot-plan-meta.sh's
# `waves[]` — never a second parser. A backticked branch name in a plan's prose
# is not a branch line (`a-plan-branch-can-be-a-parser-artifact`), and the
# parser already draws that distinction; re-deriving it here would reproduce the
# exact defect. A file with no `Phase:` is not a plan (phase == NONE) and is
# skipped, the same rule section 1 applies. A `complete`/`released` wave is
# history and still counts: hiding it would be lying about the estate, and
# /plot-reslice declines the waves it should — that is a constraint on the
# REPAIR, not on the REPORT.
echo "== 7. Uncut slices (a slice holds one branch — candidate /plot-reslice) =="
unsliced_out=""
if [ -n "$plan_json" ]; then
  # One jq pass over the already-captured parser output, one record per
  # multi-branch wave: file, heading (may be empty for an unnamed wave), branch
  # count. Fields are joined with the ASCII unit separator (US, 0x1f) and read
  # with IFS="$US" — NOT a tab: a wave with an empty name emits an empty middle
  # field, and tab is IFS whitespace, so `read` would collapse the two adjacent
  # tabs and shift the count into the name. This is the same reason plan_rows
  # uses US above; @tsv here reproduced exactly that field-shift bug.
  # Phase-less files (phase == "NONE") are dropped, matching "a file with no
  # Phase: is not a plan".
  while IFS="$US" read -r f wname wcount; do
    [ -n "$f" ] || continue
    base=$(basename "$f")
    slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    # An unnamed wave (branches before any `### `) has no heading to name; say so
    # rather than print an empty token.
    disp="${wname:-(unnamed wave)}"
    unsliced_out+="  $base — wave '$disp' carries $wcount branch lines (a wave holds one)\n"
    # /plot-reslice is the repair, and it needs a human to name the slices and
    # argue their order — so the verb is `reslice:`, not `fix:`: a person must
    # decide, exactly as index drift's (section 9) is `optional:`.
    unsliced_out+="    reslice: /plot-reslice ${slug%.md}\n"
    n_unsliced=$((n_unsliced + 1))
  done < <(printf '%s\n' "$plan_json" \
    | jq -r 'select(.phase != "NONE") | .file as $f
             | .waves[]? | select((.branches | length) > 1)
             | [$f, .name, (.branches | length | tostring)] | join("")')
fi
if [ -n "$unsliced_out" ]; then printf '%b' "$unsliced_out"; else echo "  (none — every slice holds a single branch)"; fi
echo

# ---------------------------------------------------------------------------
# 8. Prose wave names
#
# A wave name is a label — Shaped, Gated, Folded, Offered first. A sentence-
# length heading (the offender in the estate is 53 characters) is a plan-
# authoring mistake the board can only render badly: the name cell is sized for
# a word, so a sentence paints over the cells beside it. This section reports
# every such name — its plan file and the name — so the PLAN gets fixed, rather
# than the board being asked to make prose fit a label's cell.
#
# IT REPORTS; IT DOES NOT REFUSE, and it DOES NOT GATE. The name is already in
# the estate: a parser that rejected it would make an existing plan unreadable
# rather than untidy, so plot-plan-meta.sh keeps returning the wave and this
# only surfaces the length. And like the unsliced-wave section above, it stays
# OUT of the `attention` count: /plot-deliver's delivery-landed gate and the
# /plot hygiene line read `attention=` from the footer, and a cosmetic finding
# there would fail every delivery in this repo. So it carries its own footer
# counter (`prose_wave_names=`), exactly as uncut slices and index drift do.
#
# PLACEMENT: it is actionable (someone renames the heading) like the unsliced
# section, so it sits with it, after the blocking set (1-6) and before index
# drift. Index drift moves to section 9. /plot-deliver's gate marker
# (`sed -n '/^== 7./q;p'`) still stops before the first non-blocking section —
# what changes is that TWO non-blocking sections (7 unsliced, 8 prose names) now
# sit before index drift (9) instead of one; the blocking set stays 1-6 and the
# marker text is unchanged BY DESIGN.
#
# The THRESHOLD is the parser's judgement, applied ONCE in plot-plan-meta.sh
# (LONG_WAVE_NAME_MAX): this reads the `long_wave_names` field it emits and never
# re-measures. The parser counts the SAME wave names it reports in waves[], so a
# backticked name in a plan's prose is not a wave name — the distinction
# `a-citation-is-not-a-claim` exists for. A file with no `Phase:` is not a plan
# (phase == NONE) and is skipped, the same rule sections 1 and 7 apply.
echo "== 8. Prose slice names (a slice name is a label, not a sentence) =="
prose_out=""
if [ -n "$plan_json" ]; then
  # One jq pass over the already-captured parser output, one record per
  # over-long wave name: file, name. Fields joined with the ASCII unit separator
  # (US, 0x1f) and read with IFS="$US" — NOT a tab: a wave name can contain
  # runs of spaces, and tab is IFS whitespace, so `read` would mangle them. Same
  # reason plan_rows and the unsliced section use US. Phase-less files
  # (phase == "NONE") are dropped, matching "a file with no Phase: is not a plan".
  while IFS="$US" read -r f wname; do
    [ -n "$f" ] || continue
    base=$(basename "$f")
    slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    prose_out+="  $base — wave name '$wname' reads as prose, not a label (rename it)\n"
    # The repair is a human editing the plan: a wave heading shortened to a label.
    # Not a `fix:` command a shell can run — naming is judgement — so the verb is
    # `rename:`, exactly as section 7's is `reslice:` and section 10's is `optional:`.
    prose_out+="    rename: shorten the wave heading in prose ${slug%.md} (full name kept on hover)\n"
    n_prose=$((n_prose + 1))
  done < <(printf '%s\n' "$plan_json" \
    | jq -r 'select(.phase != "NONE") | .file as $f
             | .long_wave_names[]? | [$f, .] | join("")')
fi
if [ -n "$prose_out" ]; then printf '%b' "$prose_out"; else echo "  (none — every slice name is a label)"; fi
echo

# ---------------------------------------------------------------------------
# 9. Sprint drift
#
# A plan whose `Sprint:` field disagrees with the sprint file listing it, or is
# empty while a sprint lists it; also a sprint member whose slug names no plan.
# ACTIONABLE BUT NON-BLOCKING — someone edits the plan or sprint — so it sits
# with the unsliced and prose sections and is kept out of the `attention` count.
#
# WHY THIS MATTERS: The plan's `Sprint:` field is a back-reference, not the
# source of truth; membership comes from the sprint file's `- [ ] [slug]` list.
# A filter joining on `plan.Sprint` would show 5 of 19 plans and silently hide
# the rest — including the sprint's largest Must Haves. This section reports the
# disagreement so it can be fixed, while the filter always works correctly.
#
# THE SPRINT FILE IS THE TRUTH. When a plan's `Sprint:` disagrees, the plan's
# field is what needs editing, not the sprint file's membership. The one
# exception — a sprint member naming no plan — is the sprint file's fault and
# is reported separately.
#
# IT DOES NOT GATE, and that is deliberate: /plot-deliver's delivery-landed gate
# and the /plot hygiene line both read `attention=` from the footer. A cosmetic
# finding there would fail every delivery. So it carries its own footer counter
# (`sprint_drift=`), exactly as uncut slices and prose names do.
echo "== 9. Sprint drift (plan Sprint: field disagrees with sprint file) =="
sprint_drift_out=""
SPRINT_DIR=$(cfg "Sprint directory" "docs/sprints/"); SPRINT_DIR="${SPRINT_DIR%/}"

# Build newline-delimited maps of "slug<TAB>sprint" and "slug<TAB>phase" from
# plan_rows. Uses plan_rows which has: file|phase|...|type|sprint (phase is
# field 2, sprint is field 9). The slug is derived from the file basename, same
# as elsewhere. The phase map is what section 11 reads to answer "is this
# sprint item's plan delivered/released" — the PHASE, never the directory.
plan_sprint_map=""
plan_phase_map=""
while IFS="$US" read -r f _st _raw _alt _alt_raw _branches _prs _ptype psprint; do
  [ -n "$f" ] || continue
  base=$(basename "$f" .md)
  # `2026-08-23-the-foo` → `the-foo`
  pslug=$(printf '%s' "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
  plan_sprint_map="$plan_sprint_map$pslug"$'\t'"$psprint"$'\n'
  plan_phase_map="$plan_phase_map$pslug"$'\t'"$_st"$'\n'
done <<< "$plan_rows"

# Lookup a plan's phase from the map. $1 = slug; prints the phase (draft,
# approved, delivered, released, …) or nothing. Returns 0 if the slug names a
# known plan, 1 otherwise — an item whose slug resolves to no plan is not this
# section's finding (the brief: bare prose lines carry no phase to read).
lookup_plan_phase() {
  local result
  result=$(printf '%s' "$plan_phase_map" | awk -F'\t' -v s="$1" '$1 == s { print $2; exit }')
  if printf '%s' "$plan_phase_map" | grep -q "^$1"$'\t'; then
    printf '%s' "$result"
    return 0
  fi
  return 1
}

# Lookup a plan's sprint field from the map.
# $1 = slug; prints the sprint field value (may be empty)
# Returns 0 if found, 1 if not found.
lookup_plan_sprint() {
  local result
  result=$(printf '%s' "$plan_sprint_map" | awk -F'\t' -v s="$1" '$1 == s { print $2; exit }')
  if printf '%s' "$plan_sprint_map" | grep -q "^$1"$'\t'; then
    printf '%s' "$result"
    return 0
  fi
  return 1
}

# Parse each sprint file and check its members. Walk ALL sprint files (not just
# active/) because a closed sprint's membership is still subject to drift.
if [ -d "$SPRINT_DIR" ]; then
  for sf in "$SPRINT_DIR"/[0-9]*.md; do
    [ -f "$sf" ] || continue
    # Extract sprint slug from filename: `2026-W35-the-board-tells-the-truth` → `the-board-tells-the-truth`
    sf_base=$(basename "$sf" .md)
    sprint_slug=$(printf '%s' "$sf_base" | sed -E 's/^[0-9]{4}-W?[0-9]{2}(-[0-9]{2})?-//')
    # Track which slugs we've seen in THIS sprint file — a plan sliced across
    # waves lists its slug once per wave, but we only report drift once.
    seen_in_sprint=""
    # Parse member lines: `- [ ] [slug]` or `- [x] [slug]` — same regex as board.ts
    while IFS= read -r line; do
      # Match `- [ ] [slug]` or `- [x] [slug]` lines, extract the slug
      if [[ "$line" =~ ^-\ \[\ \|x\]\ \[([^\]]+)\] ]]; then
        member_slug="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^-\ \[(\ |x)\]\ \[([^\]]+)\] ]]; then
        member_slug="${BASH_REMATCH[2]}"
      else
        continue
      fi
      # Dedupe: a plan with multiple waves appears multiple times in the file,
      # but we only report drift once per slug per sprint.
      case "$seen_in_sprint" in
        *"$member_slug"*) continue ;;
      esac
      seen_in_sprint="$seen_in_sprint$member_slug"$'\n'

      # Does this slug name a plan we know about?
      if ! plan_field=$(lookup_plan_sprint "$member_slug"); then
        sprint_drift_out+="  $sf_base → [$member_slug] — sprint member names no plan\n"
        sprint_drift_out+="    inspect: is the slug a typo, or has the plan been renamed/deleted?\n"
        n_sprint_drift=$((n_sprint_drift + 1))
        continue
      fi

      # Does the plan's Sprint: field match this sprint's slug?
      if [ -z "$plan_field" ]; then
        sprint_drift_out+="  $member_slug — listed by sprint '$sprint_slug' but plan has no Sprint: field\n"
        sprint_drift_out+="    backfill: add \`Sprint: $sprint_slug\` to the plan's ## Status section\n"
        n_sprint_drift=$((n_sprint_drift + 1))
      elif [ "$plan_field" != "$sprint_slug" ]; then
        sprint_drift_out+="  $member_slug — listed by sprint '$sprint_slug' but plan Sprint: says '$plan_field'\n"
        sprint_drift_out+="    fix: update the plan's Sprint: field to '$sprint_slug', or remove it from the sprint file\n"
        n_sprint_drift=$((n_sprint_drift + 1))
      fi
    done < "$sf"
  done
fi

if [ -n "$sprint_drift_out" ]; then printf '%b' "$sprint_drift_out"; else echo "  (none — every sprint member's plan agrees)"; fi
echo

# ---------------------------------------------------------------------------
# 10. Index drift (convenience level)
#
# A SEPARATE SECTION rather than a softer line inside section 5, because
# section 5's count is load-bearing: /plot-deliver's delivery-landed gate and
# the /plot hygiene line both read `attention=` from the footer, and a section
# that mixed "worth a glance" with "needs a decision" would leave every reader
# of that number to re-derive the split from the body — which is what reading a
# machine-countable footer is meant to avoid.
#
# Nothing here blocks anything. The findings are cosmetic by construction: the
# derived phase grouping (#254) already sees these plans, so the only thing
# missing is the browsing convenience, and the printed command is `optional:`
# for that reason — section 1's are `fix:`.
echo "== 10. Index drift (convenience — nothing depends on these) =="
if [ -n "$index_out" ]; then printf '%b' "$index_out"; else echo "  (none — the convenience indexes match the plans)"; fi
echo

# ---------------------------------------------------------------------------
# 11. Stale sprint tally
#
# Sprint items left unchecked whose plan is delivered or released — in CLOSED
# sprints as well as active ones. A closed sprint's tally is never recomputed
# by anything; `/plot-sprint close` (wave 1, #457) fixes every sprint closed
# from now on, but nothing fixes the ones already closed before that fix
# shipped. Those are the population this section exists for.
#
# ADVISORY, exactly like section 9. It names the file, the item and the plan's
# phase, prints the fix, and GATES NOTHING. A closed sprint with a stale tick
# is wrong, not broken, and rewriting history automatically is worse than
# reporting it. The footer carries its own counter (`stale_tally=`), and it
# stays out of `attention=`.
#
# An item with no resolvable plan is SKIPPED SILENTLY. Two shapes reach this:
# a bare prose line with no `[slug]` at all — "A release window: dispatch
# refuses…" — which the member regex never matches, and a `[slug]` that names
# no plan file, for which lookup_plan_phase returns non-zero. Both carry no
# phase to read, so the question this section asks (is the plan delivered?) has
# no answer. Naming them would say "this item is stale" when all we know is
# "this item has no plan" — and the slug-names-no-plan case is already section
# 9's finding (sprint drift → sprint member names no plan).
#
# THE PHASE, NOT THE DIRECTORY. The brief is explicit: `plot-plan-meta.sh`
# answers the phase. A delivered plan whose symlink move failed — the case
# `/plot-deliver` deliberately made survivable — must still report as done.
echo "== 11. Stale sprint tally (unchecked items whose plan is delivered/released) =="
stale_tally_out=""

# Walk ALL sprint files (not just active/) because a CLOSED sprint is exactly
# the population whose tally nothing else will ever recompute.
if [ -d "$SPRINT_DIR" ]; then
  for sf in "$SPRINT_DIR"/[0-9]*.md; do
    [ -f "$sf" ] || continue
    sf_base=$(basename "$sf" .md)
    # Track which slugs we've seen in THIS sprint file — a plan sliced across
    # waves lists its slug once per wave, but we only report staleness once.
    seen_stale_in_sprint=""
    # Parse member lines: `- [ ] [slug]` or `- [x] [slug]` — same regex as
    # board.ts and section 9. Only UNCHECKED items matter here.
    while IFS= read -r line; do
      # Extract check state and slug.
      local_checked=""
      local_slug=""
      if [[ "$line" =~ ^-\ \[\ \]\ \[([^\]]+)\] ]]; then
        local_checked=false
        local_slug="${BASH_REMATCH[1]}"
      elif [[ "$line" =~ ^-\ \[[xX]\]\ \[([^\]]+)\] ]]; then
        local_checked=true
        local_slug="${BASH_REMATCH[1]}"
      else
        continue
      fi
      # Only unchecked items are candidates.
      [ "$local_checked" = false ] || continue
      # Dedupe: a plan with multiple waves appears multiple times.
      case "$seen_stale_in_sprint" in
        *"$local_slug"*) continue ;;
      esac
      seen_stale_in_sprint="$seen_stale_in_sprint$local_slug"$'\n'

      # Does this slug name a plan we know about? An unresolvable item is not
      # this section's finding — skip silently (see comment above).
      if ! plan_phase=$(lookup_plan_phase "$local_slug"); then
        continue
      fi
      # Is the plan delivered or released? Only those are stale.
      case "$plan_phase" in
        delivered|released)
          stale_tally_out+="  $sf_base → [$local_slug] — unchecked but plan is $plan_phase\n"
          stale_tally_out+="    fix: tick the item, or add an annotation explaining why it stays unchecked\n"
          n_stale_tally=$((n_stale_tally + 1))
          ;;
      esac
    done < "$sf"
  done
fi

if [ -n "$stale_tally_out" ]; then printf '%b' "$stale_tally_out"; else echo "  (none — every unchecked item's plan is still open)"; fi
echo

# ---------------------------------------------------------------------------
# 12. Double-claimed branches
#
# A branch listed by MORE THAN ONE plan. Reports every such branch, naming both
# plans and the wave each lists it under, and repairs nothing — Manifesto
# Principle 3's split: this collects, a person concludes.
#
# WHY THIS EXISTS: the board found this defect and the sweep whose whole purpose
# is estate faults did not. Two rows wore an orange `claimed twice` mark on
# 2026-08-23 while all eleven sections here reported clean, so the board was the
# only thing in the system that could see it.
#
# WAVE 1 IS WHAT MAKES THIS MEANINGFUL. Before the matcher was anchored (#490),
# plot-plan-meta.sh read any backticked branch name anywhere under `## Branches`
# as a claim, so a plan CITING another plan's branch to declare a dependency
# read as a second claimant. Roughly two in three backticked branch names in
# `docs/plans/` are citations rather than claims, so this section built first
# would have been a list of false positives. Anchored, a double claim can only
# come from two plans genuinely LISTING one branch — a real conflict needing a
# human, and exactly what belongs here.
#
# IT DOES NOT GATE, and that is load-bearing, not a preference. /plot-deliver's
# delivery-landed gate and the /plot hygiene line both read `attention=` from
# the footer. A double claim is a SHAPE TO FIX — both plans' waves can still
# move, and the branch itself is fine — so putting it in `attention` would stop
# every delivery in this repo over bookkeeping. It carries its own footer
# counter (`double_claims=`), exactly as uncut slices, prose names, sprint
# drift and index drift do.
#
# PLACEMENT: last, so the section numbers 1-11 keep their meanings. Every
# consumer that reads a number reads an existing one — /plot-deliver's gate
# marker is `sed -n '/^== 7./q;p'`, which stops before the first non-blocking
# section, and that stays true only while nothing is inserted below 7.
#
# THE CLAIM SET IS THE PARSER'S, never a second one. Branch and wave both come
# from plot-plan-meta.sh's `waves[]` — the same source sections 7 and 8 read.
# Re-deriving "which branches does this plan claim" with a grep here would
# reproduce the very defect wave 1 removed, one layer up. A file with no
# `Phase:` is not a plan (phase == NONE) and is skipped, the same rule sections
# 1, 7 and 8 apply: a decision log naming a branch is not a claimant.
#
# ONE FINDING PER BRANCH, not one per claimant: the finding IS the collision, so
# a branch claimed by three plans is one line naming three, not three lines.
echo "== 12. Double-claimed branches (one branch, two plans — a person decides) =="
double_out=""
if [ -n "$plan_json" ]; then
  # One jq pass over the already-captured parser output. Emits one record per
  # branch claimed more than once: branch, the claimants as `slug (wave)` joined
  # by `, `, and how many. jq does the grouping so the shell loop stays a
  # renderer — the same division of labour sections 7 and 8 use.
  #
  # `--slurp` IS LOAD-BEARING, and it is what makes this section different from
  # every other one here. The parser emits ONE JSON OBJECT PER PLAN, and jq
  # without `-s` evaluates the whole program once per object. Sections 7 and 8
  # ask a question about a SINGLE plan (does this wave hold two branches, is
  # this name too long), so per-object evaluation is exactly right for them.
  # This section asks a question ACROSS plans — is this branch claimed twice —
  # which cannot be answered from one object at a time. Unslurped, `group_by`
  # groups each plan against itself, every group has length 1, and the section
  # reports `(none)` on an estate that has a collision. That failure is INVISIBLE
  # in the report, because a clean estate prints the same line; it was caught
  # here only by counting the collisions independently first.
  #
  # Fields are joined with the ASCII unit separator (US, 0x1f) and read with
  # IFS="$US" — NOT a tab: a wave name can contain runs of spaces, and tab is
  # IFS whitespace, so `read` would mangle them. Same reason plan_rows and
  # sections 7 and 8 use US.
  #
  # An unnamed wave (branches before any `### `) has no heading to name, so it
  # renders as `(unnamed wave)` rather than an empty parenthesis — section 7
  # makes the same substitution for the same reason.
  #
  # DEDUPED BY PLAN, not by claim line: a plan that lists one branch twice (in
  # two waves, or twice in one) is ONE claimant, not two. Without this a single
  # plan's own duplicate would read as a conflict between two plans, which is a
  # different fault with a different repair — and it is not this section's.
  while IFS="$US" read -r br claimants n_claimants; do
    [ -n "$br" ] || continue
    double_out+="  $br — claimed by $n_claimants plans: $claimants\n"
    # The repair is a human editing one of the plans: deciding which plan owns
    # the branch and how the other expresses its dependency. Not a `fix:` a
    # shell can run — ownership is judgement — so the verb is `resolve:`,
    # exactly as section 7's is `reslice:` and section 8's is `rename:`.
    double_out+="    resolve: decide which plan owns \`$br\`; the other should cite it in prose, not list it\n"
    n_double=$((n_double + 1))
  done < <(printf '%s\n' "$plan_json" \
    | jq -s -r --arg US "$US" '
        [ .[] | select(.phase != "NONE")
          | (.file | sub("^.*/"; "") | sub("\\.md$"; "")
                   | sub("^[0-9]{4}-[0-9]{2}-[0-9]{2}-"; "")) as $slug
          | .waves[]? as $w
          | $w.branches[]?
          | { branch: .branch, slug: $slug,
              wave: (if ($w.name // "") == "" then "(unnamed wave)" else $w.name end) } ]
        | group_by(.branch)[]
        | unique_by(.slug) as $per_plan
        | select(($per_plan | length) > 1)
        | [ ($per_plan[0].branch),
            ($per_plan | map(.slug + " (" + .wave + ")") | join(", ")),
            ($per_plan | length | tostring) ]
        | join($US)')
fi
if [ -n "$double_out" ]; then printf '%b' "$double_out"; else echo "  (none — every branch is claimed by exactly one plan)"; fi
echo

# ---------------------------------------------------------------------------
# 13. Stale interrogation rounds
#
# A Draft plan whose recorded round predates its own last amendment. The
# finding is the DISAGREEMENT between what the plan says it was questioned
# through and what its text has become since — the case the board's badge gets
# wrong, because the badge shows the number and the reader cannot see that the
# questioning predates the current text.
#
# A MISSING ROUND IS NOT A DEFECT. A plan with no `Rounds:` field produces no
# finding: a plan nobody has questioned is honestly unquestioned, and
# `PlanCard.tsx` renders no badge for it — silence, not a zero. Only a plan
# that HAS a recorded round can disagree with itself. The test is the KEY'S
# PRESENCE (`has("rounds")`), never its truthiness: `- **Rounds:** 0` is a
# recorded value — a plan explicitly saying it was never questioned — and a
# shell test treating `0` as empty would silence exactly that plan.
#
# THE PARSER IS THE SOURCE, never a second grep. plot-plan-meta.sh reads
# `Rounds:` from three places in a fixed order (## Status, YAML front matter,
# the CHALLENGE-THE-PLAN-METADATA block), and `plan_json` above already holds
# its answer. Re-deriving the number here would reproduce the defect wave 1 of
# the reslice work removed, one layer up, and would disagree with the board
# whenever a plan uses front matter or the block.
#
# IT DOES NOT COUNT ROUNDS FROM GIT. Bookkeeping commits, PR annotations and
# phase flips all touch a plan, so a commit count over-counts; an interrogation
# whose findings land in one commit under-counts. A round is a judgement about
# what happened, not a diff count. This compares a recorded round against an
# edit date and reports only that the two disagree.
#
# THE TWO DATES, AND WHY THESE TWO — the plan left this open, so it is decided
# here:
#   - the amendment:    `git log -1 --format=%ct -- <plan>`, the same call
#                       claim_age_days uses. The plan file's last commit.
#   - the round record: `git log -1 --format=%ct -G'[Rr]ounds?[:*"]' -- <plan>`,
#                       the last commit that CHANGED a rounds line.
# `-G` and not `-S`. `-S` counts occurrences of the string, so a value edited
# from `Rounds: 1` to `Rounds: 2` leaves the count at one and `-S` reports the
# commit that first introduced the field — measured 2026-09-01 in a three-commit
# fixture, `-S` named c1 where `-G` named c2. The pattern spans all three
# sources the parser reads, including the block's `"round":` key.
#
# THE FINDING IS WEAKER THAN THE FACT, and it names its inputs so a reader can
# judge it: the recorded round, the commit the round was last written in, and
# the commit that amended the plan after it. A hint that names its inputs can
# be argued with; a bare verdict cannot. Two shapes are silent rather than
# guessed: a plan whose rounds line has no commit of its own (uncommitted, or a
# repo the file was added to whole), and one whose amendment is that same
# commit.
#
# DRAFT PLANS ONLY. An Approved plan has already passed the review the
# questioning feeds; a Draft plan is the one whose card a reader judges by the
# badge. A file with no `Phase:` is not a plan (phase == NONE) and never
# reaches this test, the same rule sections 1, 7, 8 and 12 apply.
#
# CONVENIENCE, NEVER A GATE. A stale round is a hint about a badge; it must not
# stop a delivery. It carries its own footer counter (`rounds_drift=`) and
# stays OUT of `attention=`, exactly as uncut slices, prose slice names,
# sprint drift, stale tallies, index drift and double claims each do. And it
# sits LAST, after section 12: /plot-deliver's gate marker is
# `sed -n '/^== 7./q;p'`, which stops before the first non-blocking section,
# and that stays true only while nothing is inserted below 7.
echo "== 13. Stale interrogation rounds (a Draft plan amended since its last round) =="
rounds_out=""
if [ -n "$plan_json" ]; then
  # One jq pass, one record per Draft plan that RECORDS a round. `has("rounds")`
  # is the presence test the section turns on — see the note above on `0`.
  while IFS="$US" read -r f rounds; do
    [ -n "$f" ] || continue
    [ -f "$f" ] || continue
    round_ct=$(git log -1 --format=%ct -G'[Rr]ounds?[:*"]' -- "$f" </dev/null 2>/dev/null)
    [ -n "$round_ct" ] || continue     # no commit recorded the round → nothing to compare
    edit_ct=$(git log -1 --format=%ct -- "$f" </dev/null 2>/dev/null)
    [ -n "$edit_ct" ] || continue
    [ "$edit_ct" -gt "$round_ct" ] || continue
    round_sha=$(git log -1 --format=%h -G'[Rr]ounds?[:*"]' -- "$f" </dev/null 2>/dev/null)
    edit_sha=$(git log -1 --format=%h -- "$f" </dev/null 2>/dev/null)
    base=$(basename "$f")
    rounds_out+="  $base — records round $rounds (last written in $round_sha), amended since in $edit_sha\n"
    # The repair is a person re-reading the plan and deciding whether the
    # amendment needs questioning — so the verb is `consider:`, not `fix:`. A
    # shell cannot judge whether a typo correction invalidates a round.
    rounds_out+="    consider: re-question the plan, or leave it — the round is stale, not wrong\n"
    n_rounds_drift=$((n_rounds_drift + 1))
  done < <(printf '%s\n' "$plan_json" \
    | jq -r --arg US "$US" '
        select(.phase == "draft") | select(has("rounds"))
        | [.file, (.rounds | tostring)] | join($US)')
fi
if [ -n "$rounds_out" ]; then printf '%b' "$rounds_out"; else echo "  (none — no Draft plan has been amended since the round it records)"; fi
echo

echo "Sweep complete. This report is advisory — nothing was changed."
echo "summary: drift=$n_drift merged_not_delivered=$n_mnd stale=$n_stale claims=$n_claims attention=$n_att concurrent=$n_conc unreleased_delivered=$n_unrel uncut_slices=$n_unsliced prose_slice_names=$n_prose sprint_drift=$n_sprint_drift stale_tally=$n_stale_tally index_drift=$n_idx double_claims=$n_double rounds_drift=$n_rounds_drift pr_source=$PR_SOURCE main=$MAIN"
exit 0
