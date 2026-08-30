#!/usr/bin/env bash
# Plot helper: Get implementation PR states for a slug
# Usage: plot-impl-status.sh <slug>
# Reads the plan file for <slug> (date-prefixed, in the configured Plan
# directory) from the remote default branch and checks PR states.
# Cross-repo (split-home) aware: a Branches annotation `→ owner/repo#12` is
# looked up in that repo via plot-host.sh; bare `→ #12` stays local. All host
# access goes through plot-host.sh (gh or bb — never called directly here).
# Output: JSON {prs: [{number, state, draft, url, repo}]}
# Designed for small-model consumption: structured JSON output, no interpretation needed.

set -euo pipefail

SLUG="${1:?Usage: plot-impl-status.sh <slug>}"

_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN_DIR="$(bash "$_HERE/plot-config.sh" get "Plan directory" "docs/plans/")"
PLAN_DIR="${PLAN_DIR%/}"

# Read plan file from main (not CWD) so PR links are always current.
# On impl branches the local copy is stale — it lacks the → #N annotations
# written when PRs are created (by the implementing session per its
# /plot-implement brief, or back-filled by /plot-deliver step 4).
#
# Find the date-prefixed plan file via the active or delivered symlink index
# `|| true` on the pipeline, not just `2>/dev/null` on the git call: under
# `set -euo pipefail` a failing `git symbolic-ref` kills the script at this line
# and the fallback below never runs. A FRESH CLONE has no `origin/HEAD` — it is
# set by `clone` only when the remote advertises it — so this aborted with
# exit 128 and no output in exactly the repos a test harness creates.
DEFAULT_BRANCH="$( { git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||'; } || true)"
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
PLAN_PATH=$(git ls-tree --name-only "origin/$DEFAULT_BRANCH" "$PLAN_DIR/" 2>/dev/null \
  | grep -E "[0-9]{4}-[0-9]{2}-[0-9]{2}-${SLUG}\.md$" | head -1)
if [ -n "$PLAN_PATH" ]; then
  PLAN_CONTENT=$(git show "origin/$DEFAULT_BRANCH:${PLAN_PATH}" 2>/dev/null || true)
else
  PLAN_CONTENT=""
fi

if [ -z "$PLAN_CONTENT" ]; then
  echo '{"error": "Plan file not found on main", "prs": []}'
  exit 0
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# The ## Branches section, one branch per line. Each line is
#   - `feature/name` — description [→ #12 | → owner/repo#12]
# The annotation is OPTIONAL — a worker is told to append it and, measured
# 2026-08-23, in most plans did not. So this reads the section per BRANCH, not
# per annotation: a line with `→ #N` resolves by that number (and a cross-repo
# `owner/repo#N` routes to that repo — a form head-matching could never reach);
# a line WITHOUT one falls back to matching the branch NAME against the heads of
# merged PRs. This is the same derivation plot-reconcile-scan.sh already applies
# in section 2 ("the missing annotation and the missing delivery share a cause,
# so an annotation-dependent check is blind to exactly the plans it exists to
# catch"). All host access stays inside plot-host.sh.
# TWO DIALECTS, AND THIS READ ONLY ONE UNTIL 2026-08-27. A plan states its
# branches either as `## Branches` list items or as `## Waves` headings of the
# form `### Name (Branch: x, PR: #N)`. Measured on this estate the day this
# changed: **126 plans use Waves, 27 use Branches** — so reading only the latter
# left the MAJORITY dialect with no branch lines at all.
#
# The consequence was not a visible error. `plot-deliver.sh` calls this helper,
# swallows a failure into `{"prs":[]}`, and then finds no PR for any branch — so
# every branch of every Waves plan read *not merged* and four fully-merged plans
# were refused delivery with a message naming branches whose PRs had landed the
# day before. Absent read as false, in a gate.
BRANCHES_SECTION=$(echo "$PLAN_CONTENT" | sed -n '/^## Branches/,/^## /p')
# `## Slices` is the spelling DESIGN-slice.md settles on, and the shape is
# identical to `## Waves` — the branch and PR ride the `### ` heading either way.
# One range for both, for the reason plot-plan-meta.sh gives: a second range is a
# second implementation of a re-spelling, free to drift.
#
# Without it a Slices plan yielded NO branches here, and the caller reported
# {"error": "No branches found in plan"} for a plan with five — measured
# 2026-08-30 against the-domain-runs-the-workflows-in-a-sandbox.
WAVES_SECTION=$(echo "$PLAN_CONTENT" | sed -n '/^## Waves\|^## Slices/,/^## [A-Z]/p')

# Branch lines: the backticked name at the head of a `- ` bullet. A backticked
# name elsewhere in prose is not a branch line — the same distinction the parser
# draws — so anchor on the list-item form.
# A Waves heading names its branch inside the parentheses:
#   ### Keyed (Branch: feature/a-plan-cites-a-jira-key, PR: #447)
# The two sets are unioned rather than chosen between, so a plan carrying both
# sections (a reslice in progress) reports every branch it names.
BRANCH_LINES=$({ { echo "$BRANCHES_SECTION" \
  | grep -oE '^- `[A-Za-z0-9_./-]+`' \
  | sed 's/^- `//; s/`$//'
  echo "$WAVES_SECTION" \
  | grep -oE '^### .*\(Branch: [A-Za-z0-9_./-]+' \
  | sed 's/.*(Branch: //'; } | grep -v '^$' | sort -u; } || true)

# Annotation for a given branch, if its line carries one. Empty otherwise.
# `|| true` on the greps: a branch with no annotation is the ORDINARY case this
# whole change exists for, and under `set -e` a no-match grep (exit 1) inside
# the `$(...)` would abort the script rather than report "un-annotated".
# The two dialects annotate DIFFERENTLY, and the difference is not cosmetic:
# Branches carries a trailing `→ #N`, Waves carries `PR: #N` INSIDE the heading.
# A trailing arrow on a Waves plan parses as no annotation at all, which is why
# both forms are read here rather than one being normalised into the other.
annotation_for() { # $1=branch → "#N" | "owner/repo#N" | ""
  local a
  a=$({ echo "$BRANCHES_SECTION" \
    | grep -F -- "\`$1\`" \
    | grep -oE '→ [A-Za-z0-9_.-]*/?[A-Za-z0-9_.-]*#[0-9]+' \
    | head -1 \
    | sed 's/^→ //'; } || true)
  [ -n "$a" ] && { printf '%s' "$a"; return; }
  { echo "$WAVES_SECTION" \
    | grep -F -- "(Branch: $1" \
    | grep -oE 'PR: [A-Za-z0-9_.-]*/?[A-Za-z0-9_.-]*#[0-9]+' \
    | head -1 \
    | sed 's/^PR: //'; } || true
}

if [ -z "$BRANCH_LINES" ]; then
  echo '{"error": "No branches found in plan", "prs": []}'
  exit 0
fi

# The merged-PR head list, fetched ONCE for the whole plan (constant in branch
# count) and only when some branch is un-annotated — an annotated-only plan pays
# nothing. Loaded at TOP LEVEL, not lazily inside a `$(...)`: a function that set
# this from within command substitution would set it in a subshell and the value
# would not survive, re-fetching per branch. Lines are "<number>\t<head>", from
# the host adapter's structured pr-list. A failed or unavailable host leaves it
# empty, and an un-annotated branch then simply does not resolve — never
# fabricated as merged.
MERGED_HEADS=""
ANY_UNANNOTATED=0
for BR in $BRANCH_LINES; do
  [ -z "$(annotation_for "$BR")" ] && { ANY_UNANNOTATED=1; break; }
done
if [ "$ANY_UNANNOTATED" = 1 ]; then
  # --limit 500: the host CLI pages at 30 by default, too shallow to reach an
  # old plan's merge; the same headroom plot-reconcile-scan.sh uses.
  MERGED_HEADS=$(bash "$HERE/plot-host.sh" pr-list --state merged --limit 500 2>/dev/null \
    | jq -r 'select((.state // "MERGED") | ascii_upcase == "MERGED") | "\(.number)\t\(.head)"' 2>/dev/null || true)
fi

# The merged PR whose head is this branch. Echoes its number, or nothing.
merged_pr_for_branch() { # $1=branch → number | ""
  [ -n "$MERGED_HEADS" ] || return 0
  printf '%s\n' "$MERGED_HEADS" | awk -F'\t' -v b="$1" '$2 == b { print $1; exit }'
}

# Build JSON array of PR states via the host adapter, one entry per branch that
# resolves to a real (non-NONE) PR.
RESULT="["
FIRST=true
append() { # $1=compact PR JSON
  if [ "$FIRST" = true ]; then FIRST=false; else RESULT="${RESULT},"; fi
  RESULT="${RESULT}$1"
}

for BR in $BRANCH_LINES; do
  REF=$(annotation_for "$BR")
  if [ -n "$REF" ]; then
    # Annotated line: resolve by number, honoring a cross-repo prefix.
    NUM="${REF##*#}"
    REPO="${REF%#*}"
    if [ -n "$REPO" ]; then
      PR_JSON=$(bash "$HERE/plot-host.sh" pr-state "$NUM" --repo "$REPO" 2>/dev/null || echo '{"state":"NONE"}')
    else
      PR_JSON=$(bash "$HERE/plot-host.sh" pr-state "$NUM" 2>/dev/null || echo '{"state":"NONE"}')
    fi
    [ "$(echo "$PR_JSON" | jq -r .state)" = "NONE" ] && continue
    append "$(echo "$PR_JSON" | jq -c --arg repo "$REPO" --arg branch "$BR" '. + {repo: $repo, branch: $branch}')"
  else
    # Un-annotated line: match the branch name against merged PR heads. A hit is
    # a merged PR by construction; a miss resolves nothing and the branch is
    # reported by its absence — the delivery gate then refuses and names it.
    NUM=$(merged_pr_for_branch "$BR")
    [ -n "$NUM" ] || continue
    # Confirm state and url via pr-state, so the shape matches the annotated
    # path exactly (same host, same fields) rather than trusting the list row.
    PR_JSON=$(bash "$HERE/plot-host.sh" pr-state "$NUM" 2>/dev/null || echo '{"state":"NONE"}')
    [ "$(echo "$PR_JSON" | jq -r .state)" = "NONE" ] && continue
    append "$(echo "$PR_JSON" | jq -c --arg branch "$BR" '. + {repo: "", branch: $branch}')"
  fi
done
RESULT="${RESULT}]"

jq -n --argjson prs "$RESULT" '{prs: $prs}'
