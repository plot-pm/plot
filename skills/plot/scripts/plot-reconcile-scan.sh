#!/usr/bin/env bash
# Plot helper: reconciliation sweep — deterministic extractor for plan/branch drift.
# Usage: plot-reconcile-scan.sh [--no-fetch]
# Output: five-section text report on stdout (each finding carries its exact
#         remediating command as copy-paste text — nothing is executed).
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# Reads the repo's plan files, symlink indexes, and git/gh ref state and emits
# a five-section report. This is the COMPUTATIONAL half of the reconciliation
# loop: mechanical, reproducible enumeration. The INFERENTIAL half — deciding
# which drift to fix, which branch is truly stale, whether a plan is ready to
# deliver — is the human's, guided by the /plot-reconcile skill that consumes
# this report.
#
# READ-ONLY. Nothing here moves a symlink, flips a status:, deletes a branch,
# or writes any file. Every finding is printed WITH the exact remediating
# command as copy-paste text — never executed. The scan reads origin/* refs
# (after a fetch) plus the local docs/plans/ tree; it makes no commits and no
# pushes.
#
# Sections:
#   1. Status<->symlink drift   — front-matter status: vs active//delivered/
#   2. Merged-but-not-delivered — impl PR merged, plan still Approved
#   3. Stale branches           — merged/orphan remote branches, no open PR
#   4. Concurrent-delivery      — active plans' branch divergence vs integration
#   5. Needs attention          — malformed / non-conforming / orphaned plans
#
# The integration branch defaults to `main` and is overridable via a
# `## Plot Config` line in the adopting project's CLAUDE.md:
#     - **Integration branch:** develop
#
# Exit 0 always (read-only reporting tool). An empty section is a valid,
# healthy result.

# No `set -e`: a parse hiccup on one plan file must not abort the whole
# read-only sweep. Keep unset-var and pipe-failure safety.
set -uo pipefail

# Operate on the repo the caller is in (like every plot helper) — NOT the
# script's own checkout: for marketplace installs that would be the plugin
# cache, silently sweeping plot's own repo instead of the adopting project.
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) \
  || { echo "plot-reconcile: not inside a git repository." >&2; exit 1; }
cd "$repo_root" || exit 1

# Integration branch: read from `## Plot Config` in CLAUDE.md, default `main`.
# Matches lines like "- **Integration branch:** develop" (case-insensitive key).
INTEGRATION=$(grep -m1 -iE '^\s*-?\s*\**integration branch\**\s*:' CLAUDE.md 2>/dev/null \
  | sed -E 's/^[^:]*:[[:space:]]*//; s/\**//g; s/^[[:space:]`]*//; s/[[:space:]`]*$//')
[ -n "$INTEGRATION" ] || INTEGRATION="main"

PLAN_DIR="docs/plans"
ACTIVE_DIR="$PLAN_DIR/active"
DELIVERED_DIR="$PLAN_DIR/delivered"

do_fetch=1
[ "${1:-}" = "--no-fetch" ] && do_fetch=0

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Front-matter scalar (first match), trimmed of quotes/space. Empty if absent.
fm() { # $1=file $2=key
  grep -m1 -iE "^$2:" "$1" 2>/dev/null \
    | sed -E "s/^[^:]*:[[:space:]]*//; s/^\"//; s/\"$//; s/[[:space:]]*$//"
}

# Normalize a status value to a canonical token, case-insensitively, mapping
# known synonyms. Echoes one of: draft approved delivered released superseded
# UNKNOWN (a non-empty value outside the known set) or NONE (blank).
norm_status() { # $1=raw
  local s
  s=$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  case "$s" in
    "") echo NONE ;;
    draft) echo draft ;;
    approved) echo approved ;;
    delivered) echo delivered ;;
    released) echo released ;;
    superseded) echo superseded ;;
    ready-for-review|readyforreview|inreview) echo approved ;; # synonym → approved-ish
    *) echo UNKNOWN ;;
  esac
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

# Open-PR source branch names, one per line, into the global $open_prs, and
# set $GH_OK. Assigned in the PARENT shell (not via $( ) command-substitution)
# so GH_OK survives — a subshell assignment would be lost. Plot is gh-native,
# so this uses `gh pr list --json headRefName`; on any gh failure $open_prs
# stays empty and GH_OK stays 0 (degraded mode).
GH_OK=0
open_prs=""
load_open_pr_branches() {
  local out
  out=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null)
  if [ $? -eq 0 ]; then
    GH_OK=1
    open_prs="$out"
  fi
}

hr() { printf '%s\n' "----------------------------------------------------------------------"; }

# ---------------------------------------------------------------------------
# 0. Fetch (read-only) + gather ref state
# ---------------------------------------------------------------------------

if [ "$do_fetch" = 1 ]; then
  git fetch origin --prune >/dev/null 2>&1 || true
fi

# Branches merged into origin/<integration> (the reliable, always-available signal).
merged_branches=$(git branch -r --merged "origin/$INTEGRATION" 2>/dev/null \
  | sed 's/^[[:space:]]*//; s#^origin/##' \
  | grep -vE "^($INTEGRATION|HEAD)" )

# All remote impl/idea branches under known prefixes.
all_branches=$(git branch -r 2>/dev/null \
  | sed 's/^[[:space:]]*//; s#^origin/##' \
  | grep -E '^(idea|feature|bug|docs|infra)/' )

# Open-PR branch list (populates $open_prs and $GH_OK in this shell).
load_open_pr_branches

echo "plot-reconcile sweep — $(git rev-parse --short "origin/$INTEGRATION" 2>/dev/null) on origin/$INTEGRATION"
if [ "$GH_OK" = 1 ]; then
  echo "PR state: gh pr list (open PRs enumerated)"
else
  echo "PR state: DEGRADED — gh unavailable; using git merge-state only."
  echo "          (stale-branch section may over-list branches with an open PR;"
  echo "           confirm each before deleting.)"
fi
echo

# ---------------------------------------------------------------------------
# 1. Status <-> symlink drift  (plot-managed plans only)
# 5. Needs attention           (collected here in the same pass)
# ---------------------------------------------------------------------------

drift_out=""
attention_out=""

for f in "$PLAN_DIR"/[0-9]*.md; do
  [ -f "$f" ] || continue
  base=$(basename "$f")
  raw_status=$(fm "$f" status)
  raw_phase=$(fm "$f" phase)
  st=$(norm_status "$raw_status")
  ph=$(norm_status "$raw_phase")

  in_active=""; in_delivered=""
  in_active=$(symlinked_from "$ACTIVE_DIR" "$base" || true)
  in_delivered=$(symlinked_from "$DELIVERED_DIR" "$base" || true)

  # --- Needs attention: non-conforming plans ---
  if [ "$st" = NONE ]; then
    attention_out+="  $base — no status: field (pre-plot / legacy plan)\n"
    continue   # legacy plans are not subject to drift rules
  fi
  if [ "$st" = UNKNOWN ]; then
    attention_out+="  $base — unrecognized status: '$raw_status'\n"
  fi
  if [ -n "$raw_phase" ] && [ "$st" != "$ph" ] && [ "$ph" != NONE ]; then
    attention_out+="  $base — status: '$raw_status' disagrees with phase: '$raw_phase' (phase is machine-read)\n"
  fi
  if [ -z "$in_active" ] && [ -z "$in_delivered" ]; then
    attention_out+="  $base — status '$raw_status' but NO symlink in active/ or delivered/ (orphaned)\n"
    printf -v _cmd '    fix: ln -s ../%s docs/plans/%s/%s' "$base" \
      "$([ "$st" = delivered ] || [ "$st" = released ] && echo delivered || echo active)" \
      "$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')"
    attention_out+="$_cmd\n"
    continue
  fi

  # --- Drift: status says one thing, symlink location says another ---
  case "$st" in
    delivered|released)
      if [ -n "$in_active" ] && [ -z "$in_delivered" ]; then
        slug=$(basename "$in_active")
        drift_out+="  $base — status '$raw_status' but symlink still in active/ (half-delivery failure mode)\n"
        drift_out+="    fix: git rm $in_active && ln -s ../$base docs/plans/delivered/$slug && git add -A\n"
      fi
      ;;
    draft|approved)
      if [ -n "$in_delivered" ] && [ -z "$in_active" ]; then
        slug=$(basename "$in_delivered")
        drift_out+="  $base — status '$raw_status' but symlink in delivered/\n"
        drift_out+="    fix: git rm $in_delivered && ln -s ../$base docs/plans/active/$slug && git add -A\n"
      fi
      ;;
  esac
done

echo "== 1. Status<->symlink drift =="
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
  st=$(norm_status "$(fm "$f" status)")
  [ "$st" = approved ] || continue
  # Resolve impl PR numbers from the Branches section's → #NNN links
  # (comma-joined onto one line).
  prs=$(sed -n '/^## Branches/,/^## /p' "$f" | grep -oE '→ #[0-9]+' | grep -oE '[0-9]+' \
    | paste -sd, - )
  # Resolve impl branch names from the same section.
  branches=$(sed -n '/^## Branches/,/^## /p' "$f" \
    | grep -oE '`(idea|feature|bug|docs|infra)/[^`]+`' | tr -d '`')
  merged_any=0
  for b in $branches; do
    if printf '%s\n' "$merged_branches" | grep -qx "$b"; then merged_any=1; fi
  done
  if [ "$merged_any" = 1 ]; then
    slug=$(echo "$base" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}-//')
    mnd_out+="  $base — impl branch merged to $INTEGRATION, plan still Approved (PRs: ${prs:-none-linked})\n"
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
    "$INTEGRATION"|release/*) continue ;;   # protected set (integration + release/*)
  esac
  has_open_pr=0
  if [ "$GH_OK" = 1 ] && printf '%s\n' "$open_prs" | grep -qx "$b"; then has_open_pr=1; fi
  is_merged=0
  if printf '%s\n' "$merged_branches" | grep -qx "$b"; then is_merged=1; fi

  if [ "$has_open_pr" = 1 ]; then
    continue   # live work — never a stale candidate
  fi
  if [ "$is_merged" = 1 ]; then
    stale_out+="  origin/$b — merged into $INTEGRATION, no open PR → deletion candidate\n"
    stale_out+="    fix: git push origin --delete $b\n"
  else
    stale_out+="  origin/$b — ahead of $INTEGRATION, no open PR → orphan (needs judgment)\n"
    stale_out+="    inspect: git log --oneline origin/$INTEGRATION..origin/$b\n"
  fi
done <<< "$all_branches"
if [ -n "$stale_out" ]; then printf '%b' "$stale_out"; else echo "  (none)"; fi
echo

# ---------------------------------------------------------------------------
# 4. Concurrent-delivery check (active plans' impl branches vs integration)
# ---------------------------------------------------------------------------

echo "== 4. Concurrent-delivery check (active plans) =="
cd_out=""
for l in "$ACTIVE_DIR"/*.md; do
  [ -L "$l" ] || continue
  target=$(readlink "$l" 2>/dev/null | sed 's|.*/||')
  df="$PLAN_DIR/$target"
  [ -f "$df" ] || continue
  branches=$(sed -n '/^## Branches/,/^## /p' "$df" \
    | grep -oE '`(idea|feature|bug|docs|infra)/[^`]+`' | tr -d '`')
  for b in $branches; do
    git rev-parse --verify --quiet "origin/$b" >/dev/null 2>&1 || continue
    counts=$(git rev-list --left-right --count "origin/$INTEGRATION...origin/$b" 2>/dev/null)
    behind=$(printf '%s' "$counts" | awk '{print $1}')
    ahead=$(printf '%s' "$counts" | awk '{print $2}')
    cd_out+="  $b — ${ahead:-?} ahead / ${behind:-?} behind origin/$INTEGRATION\n"
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
