#!/usr/bin/env bash
# Plot helper: reconciliation sweep — deterministic extractor for plan/branch drift.
# Usage: plot-reconcile-scan.sh [--no-fetch] [--no-pr] [--offline]
#   --no-fetch  skip `git fetch`   --no-pr  skip git-host pr list
#   --offline   both (no network)  — used by the ambient /plot hygiene line
# Output: five-section text report on stdout (each finding carries its exact
#         remediating command as copy-paste text — nothing is executed),
#         terminated by a machine-countable summary line:
#             summary: drift=0 merged_not_delivered=0 stale=0 claims=0 attention=0 concurrent=0 pr_source=gh main=main
#         Consumers that only need counts (the /plot dispatcher's hygiene
#         line, /plot-reconcile's Automation Output) read that one line.
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# Reads the repo's plan files, symlink indexes, and git/git-host ref state and
# emits a five-section report. This is the COMPUTATIONAL half of the
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
#   5. Needs attention          — malformed / non-conforming / orphaned plans
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

# Branches merged into origin/<main> (the reliable, always-available signal).
merged_branches=$(git branch -r --merged "origin/$MAIN" 2>/dev/null \
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
PR_SOURCE="degraded"
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

load_open_pr_branches() {
  local url slug out
  url=$(git remote get-url origin 2>/dev/null) || return 0
  case "$url" in
    *github.com*)
      # Pin gh to origin's repo so a second GitHub remote can't win.
      slug=$(printf '%s' "$url" | sed -E 's#\.git$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')
      # number AND head in one call: the head alone answers "is this branch the
      # PR's head", the number is needed to name the PR a branch is contained
      # in (section 3). Still ONE call — the extra field is free.
      if out=$(gh pr list -R "$slug" --state open --json number,headRefName \
                 --jq '.[] | "\(.number) \(.headRefName)"' 2>/dev/null); then
        PR_SOURCE="gh"; open_pr_heads="$out"; open_prs=$(pr_head_branches "$out")
        # Merged counterpart, same call shape, same repo pin. Bundled: ONE
        # call for all plans, so cost is constant in plan count.
        if out=$(gh pr list -R "$slug" --state merged --limit "$MERGED_PR_LIMIT" \
                   --json number,headRefName --jq '.[] | "\(.number) \(.headRefName)"' 2>/dev/null); then
          merged_pr_heads="$out"
        fi
      fi
      ;;
    *bitbucket*)
      # bb >=3.1 (agent-skills#18) is gh-symmetric for this call; older bb
      # rejects the field argument and falls back to the full-object form.
      # Full-object form FIRST here, unlike gh: it is the only bb shape known
      # to carry the PR id, and Bitbucket names it `.id`, not `.number` (see
      # the merged list below). The field-list form is kept as the fallback —
      # it answers "is this branch a PR head" but not "which PR", so section 3
      # degrades to the head test alone rather than naming a wrong PR.
      if out=$(bb pr list --state open --json 2>/dev/null \
                 | jq -r '.[] | "\(.id) \(.source.branch.name)"' 2>/dev/null) \
         && [ -n "$out" ]; then
        PR_SOURCE="bb"; open_pr_heads="$out"; open_prs=$(pr_head_branches "$out")
      elif out=$(bb pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null); then
        PR_SOURCE="bb"; open_prs="$out"
      fi
      if [ "$PR_SOURCE" = "bb" ]; then
        if out=$(bb pr list --state merged --json 2>/dev/null \
                   | jq -r '.[] | "\(.id) \(.source.branch.name)"' 2>/dev/null); then
          merged_pr_heads="$out"
        fi
      fi
      ;;
  esac
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
# (degraded = no CLI, or off = deliberately skipped), the stale-branch section
# leans on git merge-state alone and may over-list — so it warns to confirm.
case "$PR_SOURCE" in gh|bb) pr_reliable=1 ;; *) pr_reliable=0 ;; esac

echo "plot-reconcile sweep — $(git rev-parse --short "origin/$MAIN" 2>/dev/null) on origin/$MAIN"
if [ "$pr_reliable" = 1 ]; then
  echo "PR state: $PR_SOURCE pr list (open PRs enumerated)"
elif [ "$PR_SOURCE" = off ]; then
  echo "PR state: skipped (--no-pr) — git merge-state only; no git-host network call."
  echo "          (stale-branch section may over-list branches with an open PR;"
  echo "           run /plot-reconcile without --offline for the precise list.)"
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
#        | branches(space-joined) | prs(comma-joined)
# joined by the ASCII unit separator (0x1f) — NOT tab: tab is IFS whitespace,
# so bash `read` collapses runs of it and empty fields (phase_alt_raw is
# usually empty) would shift every later field left. A non-whitespace IFS
# preserves empty fields. Sections 1, 2, 4, and 5 all read from these rows —
# no re-parsing.
# ---------------------------------------------------------------------------

US=$'\x1f'
plan_rows=""
set -- "$PLAN_DIR"/[0-9]*.md
if [ -f "${1:-}" ]; then
  plan_rows=$("$script_dir/plot-plan-meta.sh" "$@" --prefixes "$PREFIX_RE" 2>/dev/null \
    | jq -r '[.file, .phase, .phase_raw, .phase_alt, .phase_alt_raw,
              (.branches | join(" ")), (.prs | map(tostring) | join(",")),
              (.type // "")] | join("\u001f")')
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

# ---------------------------------------------------------------------------
# 1. Phase <-> symlink drift  (plot-managed plans only)
# 5. Needs attention          (collected here in the same pass)
# ---------------------------------------------------------------------------

drift_out=""
attention_out=""

while IFS="$US" read -r f st raw_phase alt alt_raw _branches _prs _ptype; do
  [ -n "$f" ] || continue
  base=$(basename "$f")

  in_active=""; in_delivered=""
  in_active=$(symlinked_from "$ACTIVE_DIR" "$base" || true)
  in_delivered=$(symlinked_from "$DELIVERED_DIR" "$base" || true)

  # --- Needs attention: non-conforming plans ---
  if [ "$st" = NONE ]; then
    attention_out+="  $base — no phase field (pre-plot / legacy plan)\n"
    n_att=$((n_att + 1))
    continue   # legacy plans are not subject to drift rules
  fi
  if [ "$st" = UNKNOWN ]; then
    attention_out+="  $base — unrecognized phase: '$raw_phase'\n"
    n_att=$((n_att + 1))
  fi
  if [ -n "$alt_raw" ] && [ "$alt" != NONE ] && [ "$alt" != "$st" ]; then
    attention_out+="  $base — status: '$raw_phase' disagrees with phase: '$alt_raw' (phase is machine-read)\n"
    n_att=$((n_att + 1))
  fi
  if [ -z "$in_active" ] && [ -z "$in_delivered" ]; then
    attention_out+="  $base — phase '$raw_phase' but NO symlink in $ACTIVE_DIR/ or $DELIVERED_DIR/ (orphaned)\n"
    n_att=$((n_att + 1))
    # Terminal phases (delivered/released AND superseded/rejected) belong in the
    # delivered/ terminal index — not active/. Suggesting active/ for a
    # Superseded plan is the exact wrong-default a downstream operator had to
    # override (issue #33); route it correctly here.
    case "$st" in
      delivered|released|superseded|rejected) _idx="$DELIVERED_DIR" ;;
      *)                                       _idx="$ACTIVE_DIR" ;;
    esac
    printf -v _cmd '    fix: ln -s ../%s %s/%s' "$base" "$_idx" \
      "$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')"
    attention_out+="$_cmd\n"
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
    if printf '%s\n' "$merged_branches" | grep -qx "$b"; then merged_any=1; fi
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
# ---------------------------------------------------------------------------

echo "== 3. Stale branches =="
stale_out=""
claims_out=""
contained_out=""
while IFS= read -r b; do
  [ -n "$b" ] || continue
  case "$b" in
    "$MAIN"|release/*) continue ;;   # protected set (main + release/*)
  esac
  has_open_pr=0
  if [ "$pr_reliable" = 1 ] && printf '%s\n' "$open_prs" | grep -qx "$b"; then has_open_pr=1; fi
  is_merged=0
  if printf '%s\n' "$merged_branches" | grep -qx "$b"; then is_merged=1; fi

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

echo "== 5. Needs attention (malformed / non-conforming / orphaned) =="
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

echo "Sweep complete. This report is advisory — nothing was changed."
echo "summary: drift=$n_drift merged_not_delivered=$n_mnd stale=$n_stale claims=$n_claims attention=$n_att concurrent=$n_conc unreleased_delivered=$n_unrel pr_source=$PR_SOURCE main=$MAIN"
exit 0
