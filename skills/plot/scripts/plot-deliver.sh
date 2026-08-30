#!/usr/bin/env bash
# Plot helper: perform the MECHANICAL half of delivering a plan.
# Usage: plot-deliver.sh [--dry-run] [--who <name>] <slug>
#   --dry-run   say what would happen; write nothing, push nothing
#   --who       the name recorded in the `Delivered:` line (default: git user.name)
#   <slug>      the plan to deliver
# Output: one `step:` line per step, then a machine-countable summary:
#             summary: phase=flipped record=written index=moved sprint=updated push=clean
#         Exit 0 when the plan is Delivered on the default branch (whether this
#         run did the work or found it already done); 1 on a refusal or a
#         failure, with the reason on stderr.
#
# WHY THIS EXISTS. The board computes `allWavesMerged` — exactly the condition
# that says a plan is ready to deliver — but the transition itself lives only in
# `/plot-deliver`'s prose. So `Delivered` in the board asked for a caller with
# nothing safe to call, and an implementer reaching that point would have
# rebuilt the phase flip, the `Delivered:` record and the symlink move in
# TypeScript. That is precisely the drift the `plot-approve.sh` split removed.
#
# This script is the `plot-approve.sh` of delivery: one implementation, two
# entrances. `/plot-deliver` keeps the judgement — the completeness check, the
# partial-deliverable question — and delegates the writes here. The board calls
# this script directly (or via an agent when a `Deliver command` is set).
#
# Manifesto Principle 3 draws the line: SCRIPTS COLLECT AND REPORT; SKILLS
# INTERPRET AND ADAPT. Flipping a phase and writing a dated record is
# collecting. Deciding whether PARTIAL work counts as delivered is interpreting,
# and stays in the skill.
#
# IT IS IDEMPOTENT, BECAUSE ONE STEP CANNOT BE UNDONE. The push is irreversible;
# everything before it is local. A run interrupted between flipping the phase
# and pushing leaves the plan at `Delivered` in a worktree but still `Approved`
# on main — so `plot-deliver.sh <slug>` may run any number of times, and RUN IT
# AGAIN is the repair for every interruption.
#
# Each step asks THE SOURCE IT WOULD HAVE WRITTEN whether it is already done:
# the plan file for the phase and the record, the index directories for the
# symlink, the sprint file for the annotation. Never a progress file of its own.
#
# WHAT IT REFUSES, and why refusing beats guessing:
#   - phase is not `approved` — nothing to deliver. (Already-Delivered is NOT a
#     refusal: it is the idempotent case, and the run still checks the record
#     and index.)
#   - any non-deferred branch is unmerged — work is not done. This is one of
#     Plot's four phase guardrails, moved from prose into an exit code.
#
# macOS bash 3.2 throughout: no associative arrays, no bash-4 line readers.
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
    -*) echo "plot-deliver: unknown flag '$1'" >&2; exit 1 ;;
    *) slug="$1" ;;
  esac
  shift
done

die() { echo "plot-deliver: $*" >&2; exit 1; }

[ -n "$slug" ] || die "need a plan slug (usage: plot-deliver.sh [--dry-run] <slug>)"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

cfg() { bash "$script_dir/plot-config.sh" get "$1" "$2"; }

repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
DELIVERED_DIR=$(cfg "Delivered index" "docs/plans/delivered/")
SPRINT_DIR=$(cfg "Sprint directory" "docs/sprints/")

# ---------------------------------------------------------------------------
# Step 1 — find the plan and read its state
# ---------------------------------------------------------------------------

plan_file=""
for cand in "$PLAN_DIR"*"$slug".md "$ACTIVE_DIR$slug.md" "$DELIVERED_DIR$slug.md"; do
  [ -e "$cand" ] && { plan_file="$cand"; break; }
done
[ -n "$plan_file" ] || die "no plan found for '$slug' — looked in $PLAN_DIR, $ACTIVE_DIR, $DELIVERED_DIR"

meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || meta=""
[ -n "$meta" ] || die "cannot parse '$plan_file' — refusing rather than guessing"

jfield() { printf '%s' "$meta" | jq -r "$1" 2>/dev/null; }

phase=$(jfield '.phase')
sprint=$(jfield '.sprint')
delivered_raw=$(jfield '.delivered_raw')

# --- refusal 1: the phase ---------------------------------------------------
#
# `approved` and `delivered` both proceed: Delivered is the idempotent case.
# A run that finds the phase already flipped still has a record to check, an
# index link to move, and an annotation to update — the very half-states this
# script exists to repair.
case "$phase" in
  approved|delivered) ;;
  released)
    die "plan '$slug' is already released — nothing to deliver." ;;
  draft|design)
    die "plan '$slug' is still '$phase' — approve it first." ;;
  NONE|"")
    die "cannot read the phase of '$slug' ($plan_file) — refusing rather than guessing." ;;
  *)
    die "plan '$slug' is in phase '$phase' — only an Approved plan can be delivered." ;;
esac

# ---------------------------------------------------------------------------
# Step 2 — verify all non-deferred branches are merged
# ---------------------------------------------------------------------------
#
# This is one of Plot's four phase guardrails. We call plot-impl-status.sh to
# check the merge state of all branches. Any branch that is not MERGED and not
# deferred is a refusal.

# Parse branches from the plan file, respecting deferred annotations.
# Read the plan's branches section (from ANY of the three spellings —
# ## Branches, ## Waves or ## Slices).
plan_content=$(cat "$plan_file")

# Extract branch lines from the branches section, whichever heading names it.
#
# `## Slices` is the spelling DESIGN-slice.md settles on, and `plot-plan-meta.sh`
# has read it since the migration began — this script had not, so a plan written
# in the current vocabulary parsed to ZERO branches here. That is the worst
# possible shape for the failure: no error, an empty list, and a delivery gate
# that passes because it found nothing to check. Measured 2026-08-30, two
# approved plans were in exactly that state.
#
# All three arms share one range for the same reason plot-plan-meta.sh shares
# one: the section's SHAPE is identical whichever word heads it, and a second
# range would be a second implementation of a re-spelling, free to drift.
branches_section=$(printf '%s' "$plan_content" | sed -n '/^## *[Bb]ranches\|^## *[Ww]aves\|^## *[Ss]lices/,/^## /p')

# A BRANCH LINE CARRIES A BRANCH PREFIX, and without that test a changelog
# bullet is read as a branch. The section range above closes at the next `## `,
# but a plan whose `## Changelog` bullet mentions a backticked identifier —
# `impl`, `pr_ready`, `--migrate`, `/api/story` were the four measured on
# 2026-08-27 — hands one of those to the merge check, which then refuses
# delivery over a branch that does not exist and never will.
#
# Four fully-merged plans were undeliverable for this reason. The prefixes come
# from `Branch prefixes` rather than a hardcoded list, the same derivation
# `plot-fleet-scan.sh:187` uses, so a project with its own prefixes is read
# correctly and one with none falls back to Plot's defaults.
prefix_re=$(bash "$script_dir/plot-config.sh" get "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' - )
[ -n "$prefix_re" ] || prefix_re="idea|feature|bug|docs|infra"

# Parse branches from old-style ## Branches section (backtick-quoted on list lines)
old_style_branches=$(printf '%s' "$branches_section" \
  | grep -oE "^- \`($prefix_re)/[A-Za-z0-9_./-]+\`" 2>/dev/null \
  | sed 's/^- `//; s/`$//' \
  | sort -u || true)

# Parse branches from a new-style ## Waves / ## Slices section (Branch: in ### headings)
new_style_branches=$(printf '%s' "$branches_section" \
  | grep -oE "### .*\(Branch: ($prefix_re)/[A-Za-z0-9_./-]+" 2>/dev/null \
  | sed 's/.*Branch: //' \
  | sort -u || true)

# Combine both styles
all_branches=$(printf '%s\n%s' "$old_style_branches" "$new_style_branches" | grep -v '^$' | sort -u || true)

if [ -z "$all_branches" ]; then
  echo "step: no branches found in plan — proceeding (nothing to verify)"
else
  # Check which branches are deferred. A deferred branch has `<!-- deferred:` on its line.
  deferred_branches=""
  non_deferred_branches=""

  for br in $all_branches; do
    # Check both spellings: old style has branch on a `- \`branch\`` line,
    # new style has branch in a `### ... (Branch: branch ...)` heading.
    if printf '%s' "$branches_section" | grep -F "\`$br\`" | grep -q '<!-- *deferred' 2>/dev/null; then
      deferred_branches="${deferred_branches}${br}
"
    elif printf '%s' "$branches_section" | grep "Branch: $br" | grep -q '<!-- *deferred' 2>/dev/null; then
      deferred_branches="${deferred_branches}${br}
"
    else
      non_deferred_branches="${non_deferred_branches}${br}
"
    fi
  done

  # Trim trailing newlines
  non_deferred_branches=$(printf '%s' "$non_deferred_branches" | grep -v '^$' || true)
  deferred_branches=$(printf '%s' "$deferred_branches" | grep -v '^$' || true)

  # Get implementation status for all branches
  impl_status=$(bash "$script_dir/plot-impl-status.sh" "$slug" 2>/dev/null) || impl_status='{"prs":[]}'

  # Check each non-deferred branch is merged
  unmerged_branches=""
  for br in $non_deferred_branches; do
    [ -z "$br" ] && continue
    # Look for this branch in the impl status. A branch is merged if its PR state is MERGED.
    pr_state=$(printf '%s' "$impl_status" | jq -r --arg br "$br" '.prs[] | select(.branch == $br) | .state' 2>/dev/null || true)
    if [ "$pr_state" != "MERGED" ]; then
      unmerged_branches="${unmerged_branches}${br}
"
    fi
  done

  unmerged_branches=$(printf '%s' "$unmerged_branches" | grep -v '^$' || true)

  if [ -n "$unmerged_branches" ]; then
    unmerged_count=$(printf '%s\n' "$unmerged_branches" | wc -l | tr -d ' ')
    unmerged_list=$(printf '%s' "$unmerged_branches" | tr '\n' ', ' | sed 's/, $//')
    die "cannot deliver: $unmerged_count branch(es) not merged: $unmerged_list
  Merge them first, or mark them deferred with \`<!-- deferred: <reason> -->\`."
  fi

  deferred_count=0
  [ -n "$deferred_branches" ] && deferred_count=$(printf '%s\n' "$deferred_branches" | wc -l | tr -d ' ')
  merged_count=$(printf '%s\n' "$non_deferred_branches" | wc -l | tr -d ' ')
  [ -z "$non_deferred_branches" ] && merged_count=0

  echo "step: verified $merged_count branch(es) merged${deferred_count:+, $deferred_count deferred}"
fi

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN=$(bash "$script_dir/plot-host.sh" default-branch 2>/dev/null) || MAIN=""
[ -n "$MAIN" ] || MAIN="main"

who="${who_override:-${PLOT_DELIVER_WHO:-$(git config user.name 2>/dev/null || echo plot)}}"
today=$(date +%Y-%m-%d)

if [ "$dry_run" = 1 ]; then
  echo "step: would flip Phase → Delivered and fill Delivered: $today"
  echo "step: would move active/ → delivered/ symlink"
  echo "step: would update the sprint annotation${sprint:+ (sprint: $sprint)}"
  echo "summary: phase=would record=would index=would sprint=would push=would"
  exit 0
fi

# ---------------------------------------------------------------------------
# Steps 3-6 — the local writes, in a booking worktree off origin/<default>
# ---------------------------------------------------------------------------
#
# A SEPARATE WORKTREE, not a checkout here. The caller's working tree may carry
# uncommitted work, and switching it out from under them is exactly the write
# this script otherwise refuses.

# The CANONICAL plan file, not the index symlink.
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

# The filename, for symlink creation.
plan_basename=$(basename "$rel")

# Flip `**Phase:** Approved` → `Delivered` in the `## Status` section only.
flip_phase() { # $1=file  → 0 if it changed the file, 1 if nothing to flip
  local f="$1"
  awk '
    BEGIN { section = ""; done = 0 }
    /^## / { section = ($0 ~ /^## Status/) ? "status" : ""; print; next }
    section == "status" && !done && tolower($0) ~ /^[ \t]*[-*]?[ \t]*\**phase[:*]/ {
      if (tolower($0) ~ /approved/) {
        sub(/[Aa]pproved/, "Delivered")
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

# Insert one `- **Delivered:** YYYY-MM-DD` line into the plan's `## Status` section.
# Fills the placeholder first; falls back to appending after the last list item.
append_delivered_line() { # $1=file $2=date
  local f="$1" line
  line="- **Delivered:** $2"
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
        if (lines[i] ~ /^[ \t]*[-*][ \t]*\*\*Delivered:\*\*[ \t]*$/) { slot = i; break }
        if (lines[i] ~ /^[ \t]*[-*][ \t]*\*\*Delivered:\*\*[ \t]*<!--/) { slot = i; break }
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

# Update the sprint item annotation for this plan.
update_sprint_annotation() { # $1=worktree root → prints none|updated|already|missing
  local root="$1" f found=""
  [ -n "$sprint" ] || { printf 'none'; return 0; }
  local dir="$root/${SPRINT_DIR#/}"
  [ -d "$dir" ] || { printf 'missing'; return 0; }
  # Find the sprint file by content (the [<slug>] reference), not by filename.
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    grep -q "\[$slug\]" "$f" 2>/dev/null && { found="$f"; break; }
  done
  [ -n "$found" ] || { printf 'missing'; return 0; }

  local before after
  before=$(cat "$found")
  after=$(awk -v slug="$slug" '
    index($0, "[" slug "]") == 0 { print; next }
    {
      line = $0
      # Check the box
      sub(/\[ \]/, "[x]", line)
      # Update or add status annotation
      if (index(line, "<!--") == 0) {
        line = line " <!-- status: delivered -->"
      } else {
        if (line ~ /status:[ \t]*[a-z-]+/) sub(/status:[ \t]*[a-z-]+/, "status: delivered", line)
        else sub(/-->/, ", status: delivered -->", line)
      }
      print line
    }
  ' "$found")
  if [ "$before" = "$after" ]; then printf 'already'; return 0; fi
  printf '%s\n' "$after" > "$found"
  printf 'updated'
}

# Move the active/ symlink to delivered/.
move_index_symlink() { # $1=worktree root → prints moved|created|already|skipped
  local root="$1"
  local active_link="$root/${ACTIVE_DIR#/}$slug.md"
  local delivered_link="$root/${DELIVERED_DIR#/}$slug.md"
  local delivered_dir="$root/${DELIVERED_DIR#/}"

  # Ensure delivered/ directory exists (best effort)
  mkdir -p "$delivered_dir" 2>/dev/null || true

  # Check if already in delivered/
  if [ -e "$delivered_link" ]; then
    # Remove from active/ if still there
    git rm -q --ignore-unmatch "$active_link" 2>/dev/null || true
    printf 'already'
    return 0
  fi

  # Create the delivered/ symlink (relative path to the plan)
  ln -sfn "../$plan_basename" "$delivered_link" 2>/dev/null || { printf 'skipped'; return 0; }

  # Remove from active/ (best effort, ignore if not there)
  git rm -q --ignore-unmatch "$active_link" 2>/dev/null || true

  printf 'moved'
}

# The whole local half, run inside one directory.
apply_local_writes() { # $1=root  → sets phase_report record_report index_report sprint_report
  local root="$1" f="$1/$rel"
  [ -f "$f" ] || { echo "plot-deliver: $rel is not present in $root" >&2; return 1; }

  # Step 3 — flip the phase. Already-done test: the file no longer says Approved.
  if flip_phase "$f"; then phase_report="flipped"; else phase_report="already"; fi

  # Step 4 — fill the Delivered: record. Already-done test: it is non-empty.
  local rec
  rec=$(bash "$script_dir/plot-plan-meta.sh" "$f" 2>/dev/null | jq -r '.delivered_raw // ""' 2>/dev/null)
  if [ -n "$rec" ]; then
    record_report="already"
  else
    if append_delivered_line "$f" "$today"; then
      record_report="written"
    else
      echo "plot-deliver: $rel has no '## Status' section — nowhere to record the delivery" >&2
      return 1
    fi
  fi

  # Step 5 — move the index symlink (best effort).
  index_report=$(move_index_symlink "$root")

  # Step 6 — update the sprint annotation.
  sprint_report=$(update_sprint_annotation "$root")
  return 0
}

phase_report="" record_report="" index_report="skipped" sprint_report="none"
push_report="n/a"

# Fetch and create a booking worktree off origin/<default>.
git fetch -q origin "$MAIN" 2>/dev/null

bookbr="plot/deliver-$slug"
tmpwt="$wt_root/.plot-deliver-$slug.$$"
# -B: a leftover branch from an earlier failed run must not block this one.
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

# Stage the plan file and index changes.
git -C "$tmpwt" add -- "$rel" >/dev/null 2>&1 || true
git -C "$tmpwt" add -- "${ACTIVE_DIR#/}" >/dev/null 2>&1 || true
git -C "$tmpwt" add -- "${DELIVERED_DIR#/}" >/dev/null 2>&1 || true
[ "$sprint_report" = "updated" ] && git -C "$tmpwt" add -- "${SPRINT_DIR#/}" >/dev/null 2>&1

if git -C "$tmpwt" diff --cached --quiet 2>/dev/null; then
  # THE IDEMPOTENT EXIT. Everything this run would have written was already
  # on the default branch, so there is nothing to push and nothing wrong.
  push_report="nothing-to-commit"
  echo "step: nothing to commit — the delivery is already recorded on $MAIN"
  cleanup
else
  if ! git -C "$tmpwt" -c "user.name=$who" commit -q -m "plot: deliver $slug"; then
    cleanup
    die "could not commit the delivery"
  fi

  push_out=$(bash "$script_dir/plot-push-main.sh" "$bookbr" "$MAIN" 2>&1)
  push_rc=$?
  printf '%s\n' "$push_out" | sed 's/^/  /'
  if [ "$push_rc" = 0 ]; then
    push_report=$(printf '%s' "$push_out" | sed -n 's/^push: \([a-z]*\).*/\1/p' | head -1)
    [ -n "$push_report" ] || push_report="unknown"
    cleanup
  else
    # BRANCH PROTECTION FALLBACK — open a micro-PR if push is rejected.
    echo "step: push rejected — opening a micro-PR instead"
    if git push -q origin "$bookbr" 2>/dev/null \
      && micro_url=$(bash "$script_dir/plot-host.sh" pr-create \
           --title "plot: deliver $slug" \
           --body "Records the delivery of \`$slug\`." \
           --base "$MAIN" --head "$bookbr" 2>/dev/null) \
      && micro_num=$(printf '%s' "$micro_url" | sed 's#.*/##') \
      && bash "$script_dir/plot-host.sh" pr-merge "$micro_num" --delete-branch >/dev/null 2>&1
    then
      push_report="micro-pr"
      echo "step: delivery landed via micro-PR $micro_url"
      cleanup
    else
      push_report="rejected"
      echo "plot-deliver: the delivery is committed on '$bookbr' but could not reach $MAIN." >&2
      echo "  Land '$bookbr' by hand, or re-run this command once the push works." >&2
      git worktree remove --force "$tmpwt" >/dev/null 2>&1 || true
      echo "summary: phase=$phase_report record=$record_report index=$index_report sprint=$sprint_report push=$push_report"
      exit 1
    fi
  fi
fi

echo "summary: phase=$phase_report record=$record_report index=$index_report sprint=$sprint_report push=$push_report"
exit 0
