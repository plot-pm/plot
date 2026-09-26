#!/usr/bin/env bash
# Plot helper: Get implementation PR states for a slug
# Usage: plot-impl-status.sh <slug>
# Reads the plan file for <slug> (date-prefixed, in the configured Plan
# directory) from the remote default branch and checks PR states.
# Cross-repo (split-home) aware: a Branches annotation `→ owner/repo#12` is
# looked up in that repo via plot-host.sh; bare `→ #12` stays local. All host
# access goes through plot-host.sh (gh or bb — never called directly here).
# Output: JSON {prs: [{number, state, draft, url, repo}]}
#
# THE PR INDEX IS ASKED BEFORE THE HOST, and it answers only MERGED rows — the
# one state that cannot change. A fully merged plan therefore costs no host call
# at all, and every other branch falls through to the host exactly as before.
# The store is read through the domain (board/plot-pr-index-lookup.mjs), never
# with `jq`; a missing store, a missing bundle or a missing row all mean *ask*.
# A branch resolved from the index carries no `mergeCommit`: the row holds none,
# and no reader of this output reads it.
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
# ONE HEADING PER RANGE, AND THEY MUST NOT BE MERGED. A plan mid-reslice carries
# `## Branches` AND `## Waves` at once, and the two branch sets are unioned so
# no branch is dropped for sitting under the other heading.
#
# Tried 2026-09-04: accepting every spelling in ONE range drops a branch. A
# `sed` range ends at the first line matching its terminator, which is the
# SECOND section's own heading, and it does not reopen there — so a plan
# carrying both reported only whichever came first. The dialects are told apart
# here by the heading because that is the only place they still differ; which
# LAYOUT a section holds is decided by shape in `plot-plan-meta.sh`.
BRANCHES_SECTION=$(echo "$PLAN_CONTENT" | sed -nE '/^## Branches/,/^## /p')
# `## Slices` is the spelling DESIGN-slice.md settles on, and the shape is
# identical to `## Waves` — the branch and PR ride the `### ` heading either way.
# One range for both, for the reason plot-plan-meta.sh gives: a second range is a
# second implementation of a re-spelling, free to drift.
#
# Without it a Slices plan yielded NO branches here, and the caller reported
# {"error": "No branches found in plan"} for a plan with five — measured
# 2026-08-30 against the-domain-runs-the-workflows-in-a-sandbox.
WAVES_SECTION=$(echo "$PLAN_CONTENT" | sed -nE '/^## (Waves|Slices)/,/^## [A-Z]/p')

# Branch lines: the backticked name at the head of a `- ` bullet. A backticked
# name elsewhere in prose is not a branch line — the same distinction the parser
# draws — so anchor on the list-item form.
# A Waves heading names its branch inside the parentheses:
#   ### Keyed (Branch: feature/a-plan-cites-a-jira-key, PR: #447)
# The two sets are unioned rather than chosen between, so a plan carrying both
# sections (a reslice in progress) reports every branch it names.
# BOTH PATTERNS RUN OVER BOTH SECTIONS, and that is what makes a heading
# renameable. The layout and the heading word are independent since 2026-09-04:
# a plan may say `## Slices` while still carrying list-item branches, and the
# 182 renamed on that date all do. Reading only the heading pattern out of the
# Slices range would have dropped every one of their branches — silently, since
# an empty branch set reports as a plan with nothing to deliver.
#
# The cost of the cross product is a duplicate line, which `sort -u` removes.
BRANCH_LINES=$({ { printf '%s\n%s\n' "$BRANCHES_SECTION" "$WAVES_SECTION" \
  | grep -oE '^- `[A-Za-z0-9_./-]+`' \
  | sed 's/^- `//; s/`$//'
  printf '%s\n%s\n' "$BRANCHES_SECTION" "$WAVES_SECTION" \
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
#
# BOTH ANNOTATION FORMS RUN OVER BOTH SECTIONS, for the reason `BRANCH_LINES`
# above already gives: the layout and the heading word are independent, so a
# plan may say `## Slices` and still carry LIST-ITEM branches with a trailing
# `→ #N`. Reading the arrow out of `BRANCHES_SECTION` alone found nothing for
# those — measured 2026-09-15 on a plan written from the shipped template,
# where `feature/one — … → #1` resolved to NO annotation from either lookup.
# The branch was still found (that cross product was already correct) and only
# its PR number was lost, so the plan reported every branch unmerged.
annotation_for() { # $1=branch → "#N" | "owner/repo#N" | ""
  local a
  a=$({ printf '%s\n%s\n' "$BRANCHES_SECTION" "$WAVES_SECTION" \
    | grep -F -- "\`$1\`" \
    | grep -oE '→ [A-Za-z0-9_.-]*/?[A-Za-z0-9_.-]*#[0-9]+' \
    | head -1 \
    | sed 's/^→ //'; } || true)
  [ -n "$a" ] && { printf '%s' "$a"; return; }
  # The heading form reads both sections for the same reason, in the mirror
  # direction: a plan mid-reslice carries `## Branches` AND `## Waves` at once,
  # and a `### Name (Branch: x, PR: #N)` heading under the former would
  # otherwise be invisible here while `BRANCH_LINES` finds its branch.
  { printf '%s\n%s\n' "$BRANCHES_SECTION" "$WAVES_SECTION" \
    | grep -F -- "(Branch: $1" \
    | grep -oE 'PR: [A-Za-z0-9_.-]*/?[A-Za-z0-9_.-]*#[0-9]+' \
    | head -1 \
    | sed 's/^PR: //'; } || true
}

if [ -z "$BRANCH_LINES" ]; then
  echo '{"error": "No branches found in plan", "prs": []}'
  exit 0
fi

# THE INDEX IS ASKED FIRST, AND IT ANSWERS ONLY WHAT CANNOT CHANGE.
#
# `PrIndexStore` is a plain JSON file under the COMMON git dir, written by a
# running board after each host call. This is its first shell consumer and the
# first outside the process that writes it — which is the question the slice
# exists to answer: can a script read it with no board running?
#
# ONLY A MERGED ROW IS TAKEN. A merged PR cannot revert on the host, so the row
# stays true however old it is — `PLOT_TERMINAL_CACHE`'s licence
# (plot-fleet-scan.sh:1234), adopted rather than invented. An OPEN, CLOSED or
# draft row is stale in either direction, so the host is asked for those exactly
# as before. The effect is that a fully merged plan — which is the case in which
# /plot-deliver runs — costs ZERO host calls, and no gate ever rests on a stale
# non-terminal answer.
#
# THE STORE NEVER SAYS "NO". A branch it cannot answer for reads `ask`, and the
# host is asked. Three situations produce that — no store at all, no row, and a
# non-terminal row — and none of them is evidence that no PR exists: the store's
# own `complete` latch records that a missing row may simply never have been
# seen. Absence stays absence, which is the property this whole helper's history
# is about.
#
# READ THROUGH THE DOMAIN, NOT WITH `jq`. `decodePrIndex` owns the version check
# and the rule that an unparseable or unrecognised file is `null` rather than a
# failure. A `jq` read here would be a second implementation of that decoder,
# free to drift the first time PR_INDEX_VERSION moves — and the store on this
# machine was already a version behind its own schema when this was written.
# docs/shell-and-domain.md licenses the call: this runs once per operator
# command, and a bundle answers in 39 ms.
#
# A MISSING BUNDLE IS NOT AN ERROR. An npm install, an unbuilt checkout or a
# node that will not run leaves INDEX_ANSWERS empty and every branch falls
# through to the host — today's behaviour exactly, which is the only safe
# direction for a helper a delivery gate reads.
INDEX_LOOKUP="$HERE/board/plot-pr-index-lookup.mjs"
INDEX_ANSWERS=""
if [ -f "$INDEX_LOOKUP" ] && command -v node >/dev/null 2>&1; then
  # The connector names the store's file, and it is asked the way the board asks
  # it (`fleet.ts:1792`) so both sides resolve one file rather than two.
  INDEX_CONNECTOR=$(bash "$HERE/plot-host.sh" backend 2>/dev/null || true)
  if [ -n "$INDEX_CONNECTOR" ]; then
    # One query per branch, in BRANCH_LINES order: the annotated PR number, or
    # the branch to match against merged heads. The answer is positional, so the
    # two lists must stay in step — the bundle refuses a malformed batch rather
    # than dropping a line, for exactly that reason.
    INDEX_QUERIES=""
    for BR in $BRANCH_LINES; do
      REF=$(annotation_for "$BR")
      if [ -n "$REF" ] && [ -z "${REF%#*}" ]; then
        # A LOCAL annotation only. A cross-repo `owner/repo#N` names a PR in
        # another repository, and this store holds THIS checkout's — answering
        # it from here would report a foreign repo's PR as if it were ours.
        INDEX_QUERIES="${INDEX_QUERIES}${REF##*#}	-
"
      elif [ -n "$REF" ]; then
        INDEX_QUERIES="${INDEX_QUERIES}-	-
"
      else
        INDEX_QUERIES="${INDEX_QUERIES}-	${BR}
"
      fi
    done
    INDEX_ANSWERS=$(printf '%s' "$INDEX_QUERIES" \
      | node "$INDEX_LOOKUP" "$INDEX_CONNECTOR" 2>/dev/null || true)
  fi
fi

# The index's answer for a branch, by its position in BRANCH_LINES. Echoes the
# answer line, or nothing where the index was not consulted at all.
index_answer_for() { # $1=1-based position → "<number>\t<state>\t<draft>\t<url>\t<head>" | ""
  [ -n "$INDEX_ANSWERS" ] || return 0
  printf '%s\n' "$INDEX_ANSWERS" | sed -n "${1}p"
}

# Whether the index answered this position, rather than saying `ask`.
index_answered() { # $1=answer line
  case "$1" in
    ''|*"	ask	"*) return 1 ;;
    *) return 0 ;;
  esac
}

# Which positions the index could NOT answer. Only those reach the host, and
# only their shape decides whether the merged-head list is fetched at all.
POS=0
UNRESOLVED_UNANNOTATED=0
for BR in $BRANCH_LINES; do
  POS=$((POS + 1))
  index_answered "$(index_answer_for "$POS")" && continue
  [ -z "$(annotation_for "$BR")" ] && { UNRESOLVED_UNANNOTATED=1; break; }
done

# The merged-PR head list, fetched ONCE for the whole plan (constant in branch
# count) and only when some branch is un-annotated — an annotated-only plan pays
# nothing. Loaded at TOP LEVEL, not lazily inside a `$(...)`: a function that set
# this from within command substitution would set it in a subshell and the value
# would not survive, re-fetching per branch. Lines are "<number>\t<head>", from
# the host adapter's structured pr-list. A failed or unavailable host leaves it
# empty, and an un-annotated branch then simply does not resolve — never
# fabricated as merged.
#
# THE INDEX NARROWS THIS FURTHER. It is now fetched only where some un-annotated
# branch the STORE could not answer remains, so a fully merged plan skips this
# call along with every pr-state below it.
MERGED_HEADS=""
ANY_UNANNOTATED="$UNRESOLVED_UNANNOTATED"
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

POS=0
for BR in $BRANCH_LINES; do
  POS=$((POS + 1))
  REF=$(annotation_for "$BR")

  # THE INDEX FIRST, AND ONLY WHERE IT COMMITTED. An answered line is a MERGED
  # row, which is the one answer that cannot change — so the host is not asked
  # and the branch is reported from what it already said.
  #
  # `mergeCommit` IS ABSENT HERE, AND THAT IS DELIBERATE. The row does not carry
  # one, and every reader of this script's output was surveyed on 2026-09-26:
  # /plot-deliver reads number, state, branch and repo, and /plot-release reads
  # mergeCommit from `pr-state` DIRECTLY (skills/plot-release/SKILL.md:381),
  # never from here. Emitting an empty string would be this machine inventing an
  # answer the host never gave.
  INDEX_LINE=$(index_answer_for "$POS")
  if index_answered "$INDEX_LINE"; then
    IFS='	' read -r I_NUM I_STATE I_DRAFT I_URL _I_HEAD <<< "$INDEX_LINE"
    [ "$I_URL" = "-" ] && I_URL=""
    append "$(jq -nc --argjson number "$I_NUM" --arg state "$I_STATE" \
      --argjson draft "$I_DRAFT" --arg url "$I_URL" --arg branch "$BR" \
      '{number: $number, state: $state, draft: $draft, url: $url, repo: "", branch: $branch}')"
    continue
  fi

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
