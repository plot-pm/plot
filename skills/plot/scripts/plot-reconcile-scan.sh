#!/usr/bin/env bash
# Plot helper: reconciliation sweep — deterministic extractor for plan/branch drift.
# Usage: plot-reconcile-scan.sh [--no-fetch]
# Output: five-section text report on stdout (each finding carries its exact
#         remediating command as copy-paste text — nothing is executed).
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# Reads the repo's plan files, symlink indexes, and git/forge ref state and
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
#   3. Stale branches           — merged/orphan remote branches, no open PR
#   4. Concurrent-delivery      — active plans' branch divergence vs main
#   5. Needs attention          — malformed / non-conforming / orphaned plans
#
# Configuration is read via plot-config.sh from the adopting project's
# `## Plot Config` (Plan directory, Active index, Delivered index, Branch
# prefixes). Plan files are parsed via plot-plan-meta.sh — the shared plan
# parser; this script never greps plan files itself.
#
# The main branch is auto-detected from origin/HEAD (self-healing via
# `git remote set-head origin -a` during the fetch) and can be overridden
# with a `## Plot Config` line:
#     - **Main branch:** develop
#
# Open-PR enumeration tries `gh`, then `bb` (Bitbucket), then degrades to git
# merge-state alone (the report header states which source was used).
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
meta() { "$script_dir/plot-plan-meta.sh" "$1" --prefixes "$PREFIX_RE"; }

do_fetch=1
[ "${1:-}" = "--no-fetch" ] && do_fetch=0

# ---------------------------------------------------------------------------
# Configuration (## Plot Config, with plot's defaults)
# ---------------------------------------------------------------------------

PLAN_DIR=$(cfg "Plan directory" "docs/plans/"); PLAN_DIR="${PLAN_DIR%/}"
ACTIVE_DIR=$(cfg "Active index" "$PLAN_DIR/active/"); ACTIVE_DIR="${ACTIVE_DIR%/}"
DELIVERED_DIR=$(cfg "Delivered index" "$PLAN_DIR/delivered/"); DELIVERED_DIR="${DELIVERED_DIR%/}"

# "idea/, feature/, bug/, docs/, infra/" -> "idea|feature|bug|docs|infra"
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

# Open-PR source branches, from the forge CLI matching ORIGIN's host — the
# scan compares origin/* refs, so PR state must come from the same remote (a
# repo can carry extra remotes on other forges; letting gh/bb resolve "any"
# remote would silently enumerate the wrong repo's PRs). Unknown host →
# degraded (git merge-state only).
PR_SOURCE="degraded"
open_prs=""
load_open_pr_branches() {
  local url slug out
  url=$(git remote get-url origin 2>/dev/null) || return 0
  case "$url" in
    *github.com*)
      # Pin gh to origin's repo so a second GitHub remote can't win.
      slug=$(printf '%s' "$url" | sed -E 's#\.git$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')
      if out=$(gh pr list -R "$slug" --state open --json headRefName --jq '.[].headRefName' 2>/dev/null); then
        PR_SOURCE="gh"; open_prs="$out"
      fi
      ;;
    *bitbucket*)
      if out=$(bb pr list --state open --json 2>/dev/null | jq -r '.[].source.branch.name' 2>/dev/null); then
        PR_SOURCE="bb"; open_prs="$out"
      fi
      ;;
  esac
}
load_open_pr_branches

echo "plot-reconcile sweep — $(git rev-parse --short "origin/$MAIN" 2>/dev/null) on origin/$MAIN"
if [ "$PR_SOURCE" = degraded ]; then
  echo "PR state: DEGRADED — no forge CLI (gh/bb) available; using git merge-state only."
  echo "          (stale-branch section may over-list branches with an open PR;"
  echo "           confirm each before deleting.)"
else
  echo "PR state: $PR_SOURCE pr list (open PRs enumerated)"
fi
if [ ! -d "$PLAN_DIR" ]; then
  echo "warning: plan directory '$PLAN_DIR' not found — no plans scanned."
  echo "         (Check the '## Plot Config' section: Plan directory.)"
fi
echo

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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

# ---------------------------------------------------------------------------
# 1. Phase <-> symlink drift  (plot-managed plans only)
# 5. Needs attention          (collected here in the same pass)
# ---------------------------------------------------------------------------

drift_out=""
attention_out=""

for f in "$PLAN_DIR"/[0-9]*.md; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  m=$(meta "$f")
  st=$(printf '%s' "$m" | jq -r .phase)
  raw_phase=$(printf '%s' "$m" | jq -r .phase_raw)
  alt=$(printf '%s' "$m" | jq -r .phase_alt)
  alt_raw=$(printf '%s' "$m" | jq -r .phase_alt_raw)

  in_active=""; in_delivered=""
  in_active=$(symlinked_from "$ACTIVE_DIR" "$base" || true)
  in_delivered=$(symlinked_from "$DELIVERED_DIR" "$base" || true)

  # --- Needs attention: non-conforming plans ---
  if [ "$st" = NONE ]; then
    attention_out+="  $base — no phase field (pre-plot / legacy plan)\n"
    continue   # legacy plans are not subject to drift rules
  fi
  if [ "$st" = UNKNOWN ]; then
    attention_out+="  $base — unrecognized phase: '$raw_phase'\n"
  fi
  if [ -n "$alt_raw" ] && [ "$alt" != NONE ] && [ "$alt" != "$st" ]; then
    attention_out+="  $base — status: '$raw_phase' disagrees with phase: '$alt_raw' (phase is machine-read)\n"
  fi
  if [ -z "$in_active" ] && [ -z "$in_delivered" ]; then
    attention_out+="  $base — phase '$raw_phase' but NO symlink in $ACTIVE_DIR/ or $DELIVERED_DIR/ (orphaned)\n"
    if [ "$st" = delivered ] || [ "$st" = released ]; then
      _idx="$DELIVERED_DIR"
    else
      _idx="$ACTIVE_DIR"
    fi
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
      fi
      ;;
    draft|approved)
      if [ -n "$in_delivered" ] && [ -z "$in_active" ]; then
        slug=$(basename "$in_delivered")
        drift_out+="  $base — phase '$raw_phase' but symlink in $DELIVERED_DIR/\n"
        drift_out+="    fix: git rm $in_delivered && ln -s ../$base $ACTIVE_DIR/$slug && git add -A\n"
      fi
      ;;
  esac
done

echo "== 1. Phase<->symlink drift =="
if [ -n "$drift_out" ]; then printf '%b' "$drift_out"; else echo "  (none — all plot-managed plans consistent)"; fi
echo

# ---------------------------------------------------------------------------
# 2. Merged-but-not-delivered
# ---------------------------------------------------------------------------

echo "== 2. Merged-but-not-delivered (candidate /plot-deliver) =="
mnd_out=""
for f in "$PLAN_DIR"/[0-9]*.md; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  m=$(meta "$f")
  st=$(printf '%s' "$m" | jq -r .phase)
  [ "$st" = approved ] || continue
  prs=$(printf '%s' "$m" | jq -r '.prs | join(",")')
  branches=$(printf '%s' "$m" | jq -r '.branches[]')
  merged_any=0
  for b in $branches; do
    if printf '%s\n' "$merged_branches" | grep -qx "$b"; then merged_any=1; fi
  done
  if [ "$merged_any" = 1 ]; then
    slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    mnd_out+="  $base — impl branch merged to $MAIN, plan still Approved (PRs: ${prs:-none-linked})\n"
    mnd_out+="    consider: /plot-deliver ${slug%.md}\n"
  fi
done
if [ -n "$mnd_out" ]; then printf '%b' "$mnd_out"; else echo "  (none)"; fi
echo

# ---------------------------------------------------------------------------
# 3. Stale branches
# ---------------------------------------------------------------------------

echo "== 3. Stale branches =="
stale_out=""
while IFS= read -r b; do
  [ -n "$b" ] || continue
  case "$b" in
    "$MAIN"|release/*) continue ;;   # protected set (main + release/*)
  esac
  has_open_pr=0
  if [ "$PR_SOURCE" != degraded ] && printf '%s\n' "$open_prs" | grep -qx "$b"; then has_open_pr=1; fi
  is_merged=0
  if printf '%s\n' "$merged_branches" | grep -qx "$b"; then is_merged=1; fi

  if [ "$has_open_pr" = 1 ]; then
    continue   # live work — never a stale candidate
  fi
  if [ "$is_merged" = 1 ]; then
    stale_out+="  origin/$b — merged into $MAIN, no open PR → deletion candidate\n"
    stale_out+="    fix: git push origin --delete $b\n"
  else
    stale_out+="  origin/$b — ahead of $MAIN, no open PR → orphan (needs judgment)\n"
    stale_out+="    inspect: git log --oneline origin/$MAIN..origin/$b\n"
  fi
done <<< "$all_branches"
if [ -n "$stale_out" ]; then printf '%b' "$stale_out"; else echo "  (none)"; fi
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
  branches=$(meta "$df" | jq -r '.branches[]')
  for b in $branches; do
    git rev-parse --verify --quiet "origin/$b" >/dev/null 2>&1 || continue
    counts=$(git rev-list --left-right --count "origin/$MAIN...origin/$b" 2>/dev/null)
    behind=$(printf '%s' "$counts" | awk '{print $1}')
    ahead=$(printf '%s' "$counts" | awk '{print $2}')
    cd_out+="  $b — ${ahead:-?} ahead / ${behind:-?} behind origin/$MAIN\n"
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

echo "Sweep complete. This report is advisory — nothing was changed."
exit 0
