#!/usr/bin/env bash
# Plot helper: perform the MECHANICAL half of approving a plan.
# Usage: plot-approve.sh [--dry-run] [--who <name>] <slug>
#   --dry-run   say what would happen; merge nothing, write nothing, push nothing
#   --who       the name recorded in the `Approved:` line (default: git user.name)
#   <slug>      the plan to approve
# Output: one `step:` line per step, then a machine-countable summary:
#             summary: merged=yes phase=flipped record=written holds=1 sprint=none push=clean
#         Exit 0 when the plan is Approved on the default branch (whether this
#         run did the work or found it already done); 1 on a refusal or a
#         failure, with the reason on stderr.
#
# WHY THIS EXISTS. `Start work` on the board calls plot-dispatch.sh, a script
# Plot ships, and works out of the box. `Approve` beside it called
# `sh -c '<Approve command> ...'` and did not, because no such script existed —
# so the board reached for an agent, and the button rendered dimmed on every
# card in a repo that declares no `Approve command`.
#
# The justification for the asymmetry did not survive the comparison.
# `Worker command` is per-project because dispatch starts an agent that WRITES
# AN IMPLEMENTATION — genuinely unknowable to Plot (Principle 5). Approving,
# under `Review: pr`, is seven writes with no judgement in any of them:
# read the ceremony answers and the PR state, merge the plan PR, flip the
# phase, fill the `Approved:` record, clear the `.plot/hold` entries, update
# the sprint annotation, push. Every one is gh, git, or one line into a
# markdown file. Approving writes one line; dispatching starts a program that
# writes a codebase.
#
# Manifesto Principle 3 draws the line where this problem is: SCRIPTS COLLECT
# AND REPORT; SKILLS INTERPRET AND ADAPT. Merging a PR whose number the plan
# already records, and writing a dated line into a known field, is collecting.
# Deciding whether a plan is READY is interpreting, and stays in the skill —
# along with the in-session walkthrough, the ballot tally, the two ceremony
# questions, and the tracer-bullet suggestion.
#
# SEVEN STEPS, NOT FIVE. The hold and the sprint annotation are here because
# they are writes with no decision in them, and because leaving either to a
# caller re-creates the split this script exists to close. An approval that
# leaves the hold in place STILL BLOCKS commits; one that skips the annotation
# makes `/plot-sprint status` wrong. Five of seven steps would be a
# half-approval, which is worse than none.
#
# IT IS IDEMPOTENT, BECAUSE ONE STEP CANNOT BE UNDONE. Step 2 merges the PR and
# that write is irreversible; everything after it is local. A run interrupted
# between the merge and the push leaves the PR merged while the plan on the
# default branch still reads `Phase: Draft` — the exact state the skill names as
# the thing never to allow. So `plot-approve.sh <slug>` may run any number of
# times, and RUN IT AGAIN is the repair for every interruption.
#
# Each step asks THE SOURCE IT WOULD HAVE WRITTEN whether it is already done:
# pr-state for the merge, plot-plan-meta.sh for the phase and the record, the
# hold file for the holds, the sprint file for the annotation. Never a progress
# file of its own — that would be a second source of truth, free to disagree
# with the repository exactly when a human intervened by hand between two runs,
# which is the case it would exist for. Git and the files ARE the state
# (Principle 1).
#
# Reordering to put the merge LAST was the alternative and it is worse: it
# would leave a window where the plan reads `Approved` while its PR is still
# open, and where the `Approved:` record names a PR number that never merged —
# trading a recoverable half-state for a lying one.
#
# IT SURVIVES ITS OWN REPO'S GATE. plot-phase-gate.sh is a PreToolUse hook that
# blocks implementation commits while the governing plan is Draft — and this
# script commits exactly then, because rewriting the phase IS the transition.
# The gate lets plan-file-only commits through (`outside_plans` returns false
# when every effective path is under the plan directory), which is why this
# script stages ONLY the plan file and the two bookkeeping files, and never
# `git add -A`. That is not a nicety: an -A here would stage whatever else the
# booking worktree happened to hold and hand the gate a reason to block.
#
# THE HOLD IS KEYED BY BRANCH, NOT BY PLAN. plot-phase-gate.sh:121 matches
# `$1 == b` against the branch NAME, and a plan names several branches. So this
# reads the plan's `## Branches` section and removes the entry for each — the
# plan is what connects a slug to the branch names the hold file speaks in.
# Entries for branches this plan does not name stay exactly where they are:
# approving one piece of work must not release someone else's gate. There is no
# `.plot/hold` in this repo at all, so the ABSENT path is the common one and is
# never an error.
#
# WHAT IT REFUSES, and why refusing beats guessing:
#   - phase is not `draft`   — nothing to approve.
#   - `Review:` is not `pr`  — `in-session` and `ballot` need a human in the
#     room. Every plan in this repo declares `Review: pr`, so this fires for
#     nothing today and is still load-bearing: /plot-idea offers all three, and
#     a script treating an unfamiliar `Review:` as `pr` would approve a plan
#     nobody discussed, silently, with a commit indistinguishable from a
#     legitimate one.
#   - the PR is draft, closed, or absent — the skill's preconditions, moved
#     from prose into an exit code.
# Refusing is this script's job; EXPLAINING is its output. The board surfaces a
# failing command's own words on the card, so a refusal reaches the reader
# without the board learning any of these rules.
#
# macOS bash 3.2: no `declare -A`, no `mapfile`.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

dry_run=0
who_override=""
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --who) who_override="${2:?--who needs a value}"; shift ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    -*) echo "plot-approve: unknown flag '$1'" >&2; exit 1 ;;
    *) slug="$1" ;;
  esac
  shift
done

die() { echo "plot-approve: $*" >&2; exit 1; }

[ -n "$slug" ] || die "need a plan slug (usage: plot-approve.sh [--dry-run] <slug>)"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

cfg() { bash "$script_dir/plot-config.sh" get "$1" "$2"; }

repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
SPRINT_DIR=$(cfg "Sprint directory" "docs/sprints/")

# ---------------------------------------------------------------------------
# Step 1 — read the plan's ceremony answers and the PR state
# ---------------------------------------------------------------------------

plan_file=""
for cand in "$ACTIVE_DIR$slug.md" "$PLAN_DIR"*"$slug".md; do
  [ -e "$cand" ] && { plan_file="$cand"; break; }
done
[ -n "$plan_file" ] || die "no plan found for '$slug' — looked in $ACTIVE_DIR and $PLAN_DIR"

meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || meta=""
[ -n "$meta" ] || die "cannot parse '$plan_file' — refusing rather than guessing"

jfield() { printf '%s' "$meta" | jq -r "$1" 2>/dev/null; }

phase=$(jfield '.phase')
review=$(jfield '.review')
impl=$(jfield '.impl')
sprint=$(jfield '.sprint')
approved_raw=$(jfield '.approved_raw')

# The plan's branches, one per line. This is what the hold file is keyed by.
plan_branches=$(jfield '.branches[]?')

# --- refusal 1: the phase ---------------------------------------------------
#
# `approved` is NOT a refusal: it is the idempotent case. A run that finds the
# phase already flipped still has holds to clear, an annotation to check, and a
# record that may be missing — the very half-states this script exists to
# repair. Only phases with nothing to approve are refused.
case "$phase" in
  draft|approved) ;;
  delivered|released)
    die "plan '$slug' is already $phase — nothing to approve." ;;
  NONE|"")
    die "cannot read the phase of '$slug' ($plan_file) — refusing rather than guessing." ;;
  *)
    die "plan '$slug' is in phase '$phase', not Draft — nothing to approve." ;;
esac

# --- refusal 2: the review channel ------------------------------------------
#
# NONE means a pre-Plot-2 plan on an idea branch, which the skill documents as
# `pr` by default. An unrecognised value is refused rather than defaulted:
# "carry on" is the shape of stale assumption this whole story keeps finding.
case "$review" in
  pr|NONE) ;;
  in-session)
    die "plan '$slug' declares 'Review: in-session' — the reviewer is a human in the room.
  A script cannot stand in for one. Approve it with /plot-approve $slug." ;;
  ballot)
    die "plan '$slug' declares 'Review: ballot' — the tally is the approval.
  A script cannot read a ballot. Approve it with /plot-approve $slug." ;;
  *)
    die "plan '$slug' records an unrecognised 'Review:' answer ('$review').
  Refusing rather than treating it as 'pr' — that would approve a plan nobody discussed." ;;
esac

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN=$(bash "$script_dir/plot-host.sh" default-branch 2>/dev/null) || MAIN=""
[ -n "$MAIN" ] || MAIN="main"

# The PR that carries the plan. `Impl: same branch` puts plan and code on the
# work branch, so its PR is the WORK branch's — and it must not be merged here
# (it merges once, at the end, carrying the implementation with it).
same_branch=0
[ "$impl" = "same-branch" ] && same_branch=1

if [ "$same_branch" = 1 ]; then
  pr_branch="$slug"
  for p in $(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" | tr ',' ' '); do
    p="${p%/}"; p="${p# }"
    [ -z "$p" ] && continue
    [ "$p" = "idea" ] && continue
    if git show-ref --verify --quiet "refs/heads/$p/$slug" \
      || git show-ref --verify --quiet "refs/remotes/origin/$p/$slug"; then
      pr_branch="$p/$slug"
      break
    fi
  done
else
  pr_branch="idea/$slug"
fi

pr_json=$(bash "$script_dir/plot-host.sh" pr-state "$pr_branch" 2>/dev/null) || pr_json=""
[ -n "$pr_json" ] || pr_json='{"number":0,"state":"NONE","draft":false,"url":""}'
pr_number=$(printf '%s' "$pr_json" | jq -r '.number // 0' 2>/dev/null)
pr_state=$(printf '%s' "$pr_json" | jq -r '.state // "NONE"' 2>/dev/null)
pr_draft=$(printf '%s' "$pr_json" | jq -r '.draft // false' 2>/dev/null)

# --- refusal 3: the PR ------------------------------------------------------
case "$pr_state" in
  MERGED) ;;
  OPEN)
    if [ "$pr_draft" = "true" ]; then
      die "plan '$slug' is still a draft PR (#$pr_number). Mark it ready for review first."
    fi ;;
  CLOSED)
    die "the plan PR for '$slug' (#$pr_number) is closed. Reopen it or create a new one." ;;
  NONE|*)
    die "no PR found for branch '$pr_branch'. Run /plot-idea first, or push the branch." ;;
esac

echo "step: plan $plan_file — phase=$phase review=${review} impl=${impl} pr=#$pr_number($pr_state)"

who="${who_override:-${PLOT_APPROVE_WHO:-$(git config user.name 2>/dev/null || echo plot)}}"
today=$(date +%Y-%m-%d)

if [ "$dry_run" = 1 ]; then
  echo "step: would merge PR #$pr_number"
  echo "step: would flip Phase → Approved and fill Approved: $today, $who, plan-PR #$pr_number merged"
  echo "step: would clear .plot/hold entries for: $(printf '%s' "$plan_branches" | tr '\n' ' ')"
  echo "step: would update the sprint annotation${sprint:+ in $SPRINT_DIR (sprint $sprint)}"
  echo "summary: merged=would phase=would record=would holds=would sprint=would push=would"
  exit 0
fi

# ---------------------------------------------------------------------------
# Step 2 — merge the plan PR. THE ONE IRREVERSIBLE WRITE.
# ---------------------------------------------------------------------------
#
# Already-done test: pr-state reports MERGED. That is the source this step
# would have written, asked directly.
#
# Merge commits, not squash: plan refinement history is the context a later
# reader wants. `--delete-branch` retires idea/<slug>, which has no further job.
merged_report="already"
if [ "$same_branch" = 1 ]; then
  # Plan and code ride one branch; the PR merges once, at the end, and merging
  # it here would land an unfinished implementation on the default branch.
  merged_report="skipped-same-branch"
  echo "step: merge skipped — 'Impl: same branch' keeps PR #$pr_number open for the implementation"
elif [ "$pr_state" = "MERGED" ]; then
  echo "step: PR #$pr_number is already merged — the approval already happened"
else
  if bash "$script_dir/plot-host.sh" pr-merge "$pr_number" --delete-branch >/dev/null 2>&1; then
    merged_report="yes"
    echo "step: merged PR #$pr_number"
  else
    die "could not merge PR #$pr_number. Nothing else was written; re-run once the merge works."
  fi
fi

# ---------------------------------------------------------------------------
# Steps 3-6 — the local writes, all in one booking worktree off origin/<default>
# ---------------------------------------------------------------------------
#
# A SEPARATE WORKTREE, not a checkout here. The caller's working tree may carry
# uncommitted work, and switching it out from under them to record a note is
# exactly the write this script otherwise refuses. plot-dispatch.sh books the
# same way and for the same reason.
#
# `same branch` and the direct flow are the exceptions: their plan lives on the
# current branch, where it is already checked out, and the record belongs there.

# The CANONICAL plan file, not the index symlink: a later active/ → delivered/
# move would carry the symlink and leave the record behind.
real_plan_path() { # $1 = plan file as found
  local p="$1" d b t
  d=$(cd "$(dirname "$p")" 2>/dev/null && pwd) || return 1
  b=$(basename "$p")
  t=$(readlink "$d/$b" 2>/dev/null || true)
  if [ -n "$t" ]; then
    case "$t" in
      /*) d=$(cd "$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
      *)  d=$(cd "$d/$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
    esac
    b=$(basename "$t")
  fi
  case "$d" in
    "$repo_root")   printf '%s' "$b" ;;
    "$repo_root"/*) printf '%s/%s' "${d#$repo_root/}" "$b" ;;
    *) return 1 ;;
  esac
}

rel=$(cd "$repo_root" && real_plan_path "$plan_file") || rel=""
[ -n "$rel" ] || die "$plan_file is outside the repository root"

# Flip `**Phase:** Draft` → `Approved` in the `## Status` section only.
#
# Scoped to that section because a plan that QUOTES a status block in its prose
# (this repo has several, documenting the format) would otherwise have its
# illustration rewritten too — a silent corruption of the very files that
# specify the format.
flip_phase() { # $1=file  → 0 if it changed the file, 1 if there was nothing to flip
  local f="$1"
  awk '
    BEGIN { section = ""; done = 0 }
    /^## / { section = ($0 ~ /^## Status/) ? "status" : ""; print; next }
    section == "status" && !done && tolower($0) ~ /^[ \t]*[-*]?[ \t]*\**phase[:*]/ {
      if (tolower($0) ~ /draft/) {
        sub(/[Dd]raft/, "Approved")
        done = 1
        changed = 1
      }
    }
    { print }
    END { exit (changed ? 0 : 1) }
  ' "$f" > "$f.plot-tmp"
  local rc=$?
  if [ "$rc" = 0 ]; then mv "$f.plot-tmp" "$f"; else rm -f "$f.plot-tmp"; fi
  return "$rc"
}

# Insert one `- **Approved:** ...` line into the plan's `## Status` section.
#
# THIS IS append_started_line()'s SHAPE, DELIBERATELY. That function
# (plot-dispatch.sh:423) was repaired on 2026-08-17 after appending below
# `- **Delivered:**` instead of filling the empty placeholder the template
# ships — the parser still read it, so nothing failed loudly, but the block
# listed a start after a delivery and two plans had to be tidied by hand.
# A second implementation that re-derived the awk would repeat exactly that
# bug, so this one fills the placeholder first and only falls back to appending
# after the last list item for plans that never had one (pre-Plot-2 files).
#
# A plan with no `## Status` heading is a REFUSAL, not a best-effort append:
# plot-plan-meta.sh reads these records out of that section, so a line below it
# parses as nothing at all — a record that exists on disk and not in the data is
# worse than no record, because it looks written.
append_approved_line() { # $1=file $2=date $3=who $4=channel
  local f="$1" line
  line="- **Approved:** $2, $3, $4"
  awk -v line="$line" '
    { lines[++n] = $0 }
    END {
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]*[Ss]tatus[ \t]*$/) { start = i; break }
      }
      if (!start) exit 1

      insert = start
      for (i = start + 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]/) break
        if (lines[i] ~ /^[ \t]*[-*][ \t]*\*\*Approved:\*\*[ \t]*$/) { slot = i; break }
        if (lines[i] ~ /^[ \t]*[-*][ \t]/) insert = i
      }

      for (i = 1; i <= n; i++) {
        if (i == slot) { print line; continue }   # replaces the empty placeholder
        print lines[i]
        if (!slot && i == insert) print line
      }
    }
  ' "$f" > "$f.plot-tmp" || { rm -f "$f.plot-tmp"; return 1; }
  mv "$f.plot-tmp" "$f"
}

# Remove the `.plot/hold` entry for EVERY branch the plan names, and nothing
# else. String equality on the first field, exactly as the gate reads it
# (plot-phase-gate.sh:121) — a pattern here would release gates the plan never
# named. Returns the number of entries removed on stdout.
clear_holds() { # $1=worktree root; reads $plan_branches
  local root="$1" hold="$1/.plot/hold" removed=0
  [ -f "$hold" ] || { printf '0'; return 0; }
  [ -n "$plan_branches" ] || { printf '0'; return 0; }
  # SPACE-separated, not newline-separated: BSD awk (macOS bash 3.2's awk)
  # rejects a literal newline inside a -v value outright — "newline in string".
  # A git branch name cannot contain a space (git check-ref-format forbids it),
  # so a space is a safe separator where a newline is not portable.
  local list
  list=$(printf '%s' "$plan_branches" | tr '\n' ' ')
  removed=$(awk -v branches="$list" '
    BEGIN { n = split(branches, b, " "); for (i = 1; i <= n; i++) if (b[i] != "") want[b[i]] = 1 }
    ($1 in want) { c++; next }
    { print > OUT }
    END { print c + 0 }
  ' OUT="$hold.plot-tmp" "$hold")
  # awk never creates OUT when every line matched; an empty hold file is the
  # honest result of removing the last entry, not a reason to leave it.
  [ -f "$hold.plot-tmp" ] || : > "$hold.plot-tmp"
  mv "$hold.plot-tmp" "$hold"
  printf '%s' "$removed"
}

# Update the sprint item annotation this plan appears in:
#     - [ ] [slug] description <!-- pr: #N, status: draft, branch: feature/slug -->
# /plot-sprint READS these (`pr`, `status`, `branch`) and /plot-approve writes
# them, so an approval that skips this makes `/plot-sprint status` wrong rather
# than merely incomplete.
#
# A plan in NO sprint is a no-op, never an error — that is the common case.
# Already-done test: the annotation already carries `status: approved`.
update_sprint_annotation() { # $1=worktree root → prints none|updated|already|missing
  local root="$1" f found=""
  [ -n "$sprint" ] || { printf 'none'; return 0; }
  local dir="$root/${SPRINT_DIR#/}"
  [ -d "$dir" ] || { printf 'missing'; return 0; }
  # Found by CONTENT, not by filename. The `Sprint:` field holds a slug while
  # the file is named `<week>-<slug>.md` — and the week prefix is written in
  # whatever case /plot-sprint's ISO week produced (`2026-W33-...` measured),
  # so a glob on the slug misses it on a case-sensitive filesystem. The item
  # line `- [ ] [<slug>] ...` is the actual relationship, and it is what
  # /plot-sprint reads back.
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    grep -q "\[$slug\]" "$f" 2>/dev/null && { found="$f"; break; }
  done
  [ -n "$found" ] || { printf 'missing'; return 0; }

  local before after
  before=$(cat "$found")
  after=$(awk -v slug="$slug" -v pr="$pr_number" -v br="$(printf '%s' "$plan_branches" | head -1)" '
    index($0, "[" slug "]") == 0 { print; next }
    {
      line = $0
      if (index(line, "<!--") == 0) {
        line = line " <!-- pr: #" pr ", status: approved" (br != "" ? ", branch: " br : "") " -->"
      } else {
        if (line ~ /status:[ \t]*[a-z-]+/) sub(/status:[ \t]*[a-z-]+/, "status: approved", line)
        else sub(/-->/, ", status: approved -->", line)
        if (line ~ /pr:[ \t]*#?[0-9a-z]+/) sub(/pr:[ \t]*#?[0-9a-z]+/, "pr: #" pr, line)
        else sub(/<!--/, "<!-- pr: #" pr ",", line)
        if (br != "") {
          if (line ~ /branch:[ \t]*[^,>]+/) sub(/branch:[ \t]*[^,>]*[^,> \t]/, "branch: " br, line)
          else sub(/-->/, ", branch: " br " -->", line)
        }
      }
      print line
    }
  ' "$found")
  if [ "$before" = "$after" ]; then printf 'already'; return 0; fi
  printf '%s\n' "$after" > "$found"
  printf 'updated'
}

# The whole local half, run inside one directory — the booking worktree in the
# `pr` flow, the caller's own repo root in the `same branch` / direct flow.
apply_local_writes() { # $1=root  → sets phase_report record_report holds_report sprint_report
  local root="$1" f="$1/$rel"
  [ -f "$f" ] || { echo "plot-approve: $rel is not present in $root" >&2; return 1; }

  # Step 3 — flip the phase. Already-done test: the file no longer says Draft.
  if flip_phase "$f"; then phase_report="flipped"; else phase_report="already"; fi

  # Step 4 — fill the Approved: record. Already-done test: it is non-empty in
  # THE FILE BEING WRITTEN, re-parsed here rather than trusted from the caller's
  # copy: on the `pr` flow those are different files, and the plan on the
  # default branch is the one that counts.
  local rec
  rec=$(bash "$script_dir/plot-plan-meta.sh" "$f" 2>/dev/null | jq -r '.approved_raw // ""' 2>/dev/null)
  if [ -n "$rec" ]; then
    record_report="already"
  else
    local channel="plan-PR #$pr_number merged"
    [ "$same_branch" = 1 ] && channel="plan-PR #$pr_number reviewed"
    if append_approved_line "$f" "$today" "$who" "$channel"; then
      record_report="written"
    else
      echo "plot-approve: $rel has no '## Status' section — nowhere to record the approval" >&2
      return 1
    fi
  fi

  # Step 5 — clear the holds, keyed by branch.
  holds_report=$(clear_holds "$root")

  # Step 6 — the sprint annotation.
  sprint_report=$(update_sprint_annotation "$root")
  return 0
}

phase_report="" record_report="" holds_report="0" sprint_report="none"
push_report="n/a"

# `Impl: same branch` records on the work branch, in place. Everything else
# records on the default branch, through a disposable branch.
if [ "$same_branch" = 1 ]; then
  apply_local_writes "$repo_root" || exit 1
  git -C "$repo_root" add -- "$rel" >/dev/null 2>&1 || true
  [ -f "$repo_root/.plot/hold" ] && git -C "$repo_root" add -- .plot/hold >/dev/null 2>&1
  [ "$sprint_report" = "updated" ] && git -C "$repo_root" add -- "${SPRINT_DIR#/}" >/dev/null 2>&1
  if git -C "$repo_root" diff --cached --quiet 2>/dev/null; then
    push_report="nothing-to-commit"
    echo "step: nothing to commit — the approval was already recorded"
  else
    git -C "$repo_root" commit -q -m "plot: approve $slug" || die "could not commit the approval"
    push_report="local"
    echo "step: recorded on $(git -C "$repo_root" branch --show-current) — push it with the implementation"
  fi
else
  # Fetched even under --offline: recording is a push, so the network is
  # already required, and a stale origin/<default> guarantees a
  # non-fast-forward. --offline is honoured everywhere it can be, and this is
  # not one of those places.
  git fetch -q origin "$MAIN" 2>/dev/null

  bookbr="plot/approve-$slug"
  tmpwt="$wt_root/.plot-approve-$slug.$$"
  # -B: a leftover branch from an earlier failed run must not block this one.
  # It is disposable by construction — created here, pushed, deleted.
  git worktree add -q -B "$bookbr" "$tmpwt" "origin/$MAIN" 2>/dev/null \
    || die "could not prepare a booking worktree at $tmpwt"

  cleanup() {
    git worktree remove --force "$tmpwt" >/dev/null 2>&1 || true
    git branch -D "$bookbr" >/dev/null 2>&1 || true
  }

  if ! apply_local_writes "$tmpwt"; then
    cleanup
    exit 1
  fi

  git -C "$tmpwt" add -- "$rel" >/dev/null 2>&1 || true
  [ -f "$tmpwt/.plot/hold" ] && git -C "$tmpwt" add -- .plot/hold >/dev/null 2>&1
  [ "$sprint_report" = "updated" ] && git -C "$tmpwt" add -- "${SPRINT_DIR#/}" >/dev/null 2>&1

  if git -C "$tmpwt" diff --cached --quiet 2>/dev/null; then
    # THE IDEMPOTENT EXIT. Everything this run would have written was already
    # on the default branch, so there is nothing to push and nothing wrong.
    push_report="nothing-to-commit"
    echo "step: nothing to commit — the approval is already recorded on $MAIN"
    cleanup
  else
    if ! git -C "$tmpwt" -c "user.name=$who" commit -q -m "plot: approve $slug"; then
      cleanup
      die "could not commit the approval"
    fi
    # plot-push-main.sh rather than a bare `git push`: a repo whose protection
    # is configured but NOT ENFORCED waves the push through with exit 0 and
    # only a notice on stderr, so a bare push cannot tell a bypass from a clean
    # landing. Its words are carried verbatim — which rules were stepped over
    # and which checks did not run is information only the remote has.
    push_out=$(bash "$script_dir/plot-push-main.sh" "$bookbr" "$MAIN" 2>&1)
    push_rc=$?
    printf '%s\n' "$push_out" | sed 's/^/  /'
    if [ "$push_rc" = 0 ]; then
      push_report=$(printf '%s' "$push_out" | sed -n 's/^push: \([a-z]*\).*/\1/p' | head -1)
      [ -n "$push_report" ] || push_report="unknown"
      cleanup
    else
      # BRANCH PROTECTION FALLBACK — the only path where a micro-PR is right.
      # Never leave the merged plan stranded at `Phase: Draft`: the merge is
      # done and irreversible, so the recorded phase must follow it.
      echo "step: push rejected — opening a micro-PR instead"
      if git push -q origin "$bookbr" 2>/dev/null \
        && micro_url=$(bash "$script_dir/plot-host.sh" pr-create \
             --title "plot: approve $slug" \
             --body "Records the approval of \`$slug\` (plan-PR #$pr_number merged)." \
             --base "$MAIN" --head "$bookbr" 2>/dev/null) \
        && micro_num=$(printf '%s' "$micro_url" | sed 's#.*/##') \
        && bash "$script_dir/plot-host.sh" pr-merge "$micro_num" --delete-branch >/dev/null 2>&1
      then
        push_report="micro-pr"
        echo "step: approval landed via micro-PR $micro_url"
        cleanup
      else
        push_report="rejected"
        echo "plot-approve: the approval is committed on '$bookbr' but could not reach $MAIN." >&2
        echo "  PR #$pr_number IS MERGED — the plan must not stay at Phase: Draft." >&2
        echo "  Land '$bookbr' by hand, or re-run this command once the push works." >&2
        git worktree remove --force "$tmpwt" >/dev/null 2>&1 || true
        echo "summary: merged=$merged_report phase=$phase_report record=$record_report holds=$holds_report sprint=$sprint_report push=$push_report"
        exit 1
      fi
    fi
  fi
fi

echo "summary: merged=$merged_report phase=$phase_report record=$record_report holds=$holds_report sprint=$sprint_report push=$push_report"
exit 0
