#!/usr/bin/env bash
# Plot helper: fleet pulse — deterministic extractor for wave/claim state.
# Usage: plot-fleet-scan.sh [--no-fetch] [--offline] [<slug>]
#   --no-fetch  skip `git fetch`
#   --offline   same (no network) — used for cheap, ambient pulses
#   <slug>      limit the report to one plan (default: all active plans)
# Output: per-plan wave report on stdout, terminated by a machine-countable
#         summary line:
#             summary: plans=1 waves=3 branches=5 claimed=1 eligible=2 blocked=1 deferred=1 main=main
#         Consumers that only need counts (the /plot-fleet pulse log, the
#         board) read that one line and never re-count the body.
# Designed for small-model consumption: mechanical enumeration, no judgment.
#
# STATELESS AND READ-ONLY. This is the whole design (Manifesto Principle 1):
# there is no fleet database. Every fact printed here is re-derived from git
# refs and plan files on each run, so a killed dispatcher, a dead worker, or a
# crashed pulse costs nothing — the next pulse re-derives the truth. Nothing
# here creates a branch, pushes a ref, starts a worker, or writes a repo file.
#
# Wave eligibility (the one rule this script encodes):
#   A wave is ELIGIBLE when every non-deferred branch in every PRIOR wave is
#   merged into the main branch. Prior waves outstanding → BLOCKED. All of a
#   wave's own non-deferred branches merged → COMPLETE.
# Deferred branches never count as outstanding work — that is what the
# `<!-- deferred: -->` annotation is for.
#
# Claim state comes from git, not from the plan file. A branch whose remote ref
# exists but holds no commits of its own is a CLAIM: a worker pushed an empty
# branch to take the work atomically (a ref push either wins or is rejected).
# The plan's `<!-- claimed: -->` annotation is a reflection for humans and the
# board; where the two disagree, git wins. The one exception is the reaper in
# plot-reconcile-scan.sh, which reads the annotation to tell a deliberately
# abandoned claim from a dead worker.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

do_fetch=1
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch|--offline) do_fetch=0 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }

PLAN_DIR=$(cfg "Plan directory" "docs/plans/")
ACTIVE_DIR=$(cfg "Active index" "docs/plans/active/")
PREFIX_RE=$(cfg "Branch prefixes" "idea/, feature/, bug/, docs/, infra/" \
  | tr -d ' ' | tr ',' '\n' | sed 's#/$##' | grep -v '^$' | paste -sd'|' -)
[ -n "$PREFIX_RE" ] || PREFIX_RE="idea|feature|bug|docs|infra"

MAIN=$(cfg "Main branch")
if [ -z "$MAIN" ]; then
  MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
fi
[ -n "$MAIN" ] || MAIN="main"

[ "$do_fetch" = 1 ] && git fetch -q origin "$MAIN" 2>/dev/null

# Resolve which plans to report on.
plans=()
if [ -n "$slug" ]; then
  for cand in "$PLAN_DIR"*"$slug".md "$ACTIVE_DIR$slug.md"; do
    [ -e "$cand" ] && { plans+=("$(cd "$(dirname "$cand")" && pwd)/$(basename "$cand")"); break; }
  done
else
  for link in "$ACTIVE_DIR"*.md; do
    [ -e "$link" ] || continue
    plans+=("$link")
  done
fi

if [ ${#plans[@]} -eq 0 ]; then
  echo "No active plans found in ${ACTIVE_DIR}."
  echo "summary: plans=0 waves=0 branches=0 claimed=0 eligible=0 blocked=0 deferred=0 main=$MAIN"
  exit 0
fi

# A branch is merged when its remote ref is an ancestor of origin/<main>.
# Absent ref → not merged, not claimed: the work has not been taken yet.
#
# Every git call here redirects stdin from /dev/null: this function runs inside
# `while read ... <<< "$states"` loops, and a child process inheriting that
# here-string would swallow the loop's remaining lines.
branch_state() {
  local br="$1"
  if ! git show-ref -q --verify "refs/remotes/origin/$br" </dev/null 2>/dev/null; then
    echo "open"; return
  fi
  if git merge-base --is-ancestor "origin/$br" "origin/$MAIN" </dev/null 2>/dev/null; then
    # Ref exists and adds nothing beyond main: either merged work, or an empty
    # branch pushed to stake a claim. Commit count tells them apart.
    if [ "$(git rev-list --count "origin/$MAIN..origin/$br" </dev/null 2>/dev/null || echo 0)" = "0" ] \
       && [ "$(git rev-list --count "origin/$br" </dev/null 2>/dev/null || echo 0)" \
            = "$(git rev-list --count "origin/$MAIN" </dev/null 2>/dev/null || echo 0)" ]; then
      echo "claimed"; return
    fi
    echo "merged"; return
  fi
  echo "wip"
}

echo "plot-fleet pulse — $(git rev-parse --short HEAD) on origin/$MAIN"
echo

n_plans=0 n_waves=0 n_branches=0 n_claimed=0 n_eligible=0 n_blocked=0 n_deferred=0

for plan in "${plans[@]}"; do
  meta=$("$script_dir/plot-plan-meta.sh" "$plan" --prefixes "$PREFIX_RE" 2>/dev/null) || continue
  [ -n "$meta" ] || continue
  n_plans=$((n_plans + 1))

  # One awk pass over the parsed JSON would need a JSON parser; instead the
  # wave walk below is driven by plot-plan-meta.sh's own output via a tiny
  # python shim (present wherever the board's toolchain is).
  echo "== $(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")") =="

  wave_lines=$(printf '%s' "$meta" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for i, w in enumerate(d.get("waves", [])):
    name = w["name"]
    for b in w["branches"]:
        ref = b["branch"]
        # Not every prefixed token in a ## Branches section is implementation
        # work. A cited file path (`docs/note.md`) matches the docs/ branch
        # prefix, and an idea/ branch carries the plan itself — counting either
        # as outstanding would keep a finished wave blocked forever.
        if ref.startswith("idea/") or "." in ref.rsplit("/", 1)[-1]:
            continue
        row = [str(i), ref, str(b["deferred"]).lower(),
               name or "-", b["claimed"] or "-"]
        print("\t".join(x.replace("\t", " ") for x in row))
' 2>/dev/null) || wave_lines=""

  [ -n "$wave_lines" ] || { echo "  (no branches)"; echo; continue; }

  # Pass 1: per-branch git state.
  #
  # Field order matters: tab is an IFS whitespace character, so bash collapses
  # a run of tabs into ONE separator. A branch with no claim note would shift
  # every later field left by one. Everything that must survive `read` is
  # therefore placed BEFORE the optional claim note, which stays last.
  # Emitted fields are never empty ("-" stands in), so no tab run can collapse.
  states=""
  while IFS=$'\t' read -r idx br deferred wname claim; do
    [ -n "$br" ] || continue
    if [ "$deferred" = "true" ]; then st="deferred"; else st=$(branch_state "$br"); fi
    states+="$idx	$br	$st	$deferred	$wname	$claim"$'\n'
  done <<< "$wave_lines"

  # Pass 2: wave verdicts. A wave is complete when none of its non-deferred
  # branches is outstanding; eligible when all PRIOR waves are complete.
  wave_ids=$(printf '%s' "$states" | cut -f1 | sort -un)
  prior_ok=1
  for wid in $wave_ids; do
    wname=$(printf '%s' "$states" | awk -F'\t' -v w="$wid" '$1==w {print $5; exit}')
    [ "$wname" = "-" ] && wname=""
    outstanding=0
    while IFS=$'\t' read -r idx br st deferred nm claim; do
      [ "$idx" = "$wid" ] || continue
      [ "$st" = "deferred" ] && continue
      [ "$st" = "merged" ] || outstanding=$((outstanding + 1))
    done <<< "$states"

    if [ "$outstanding" -eq 0 ]; then verdict="complete"
    elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
    else verdict="blocked"; fi

    echo "  ${wname:-(unnamed)} — $verdict"
    while IFS=$'\t' read -r idx br st deferred nm claim; do
      [ "$idx" = "$wid" ] || continue
      [ "$claim" = "-" ] && claim=""
      n_branches=$((n_branches + 1))
      case "$st" in
        deferred) n_deferred=$((n_deferred + 1)); note="deferred" ;;
        claimed)  n_claimed=$((n_claimed + 1));   note="claimed${claim:+ ($claim)}" ;;
        merged)   note="merged" ;;
        wip)      note="in progress" ;;
        *)        note="open" ;;
      esac
      [ "$verdict" = "eligible" ] && [ "$st" = "open" ] && n_eligible=$((n_eligible + 1))
      echo "      $br — $note"
    done <<< "$states"

    n_waves=$((n_waves + 1))
    [ "$verdict" = "complete" ] || prior_ok=0
    [ "$verdict" = "blocked" ] && n_blocked=$((n_blocked + 1))
  done
  echo
done

echo "Pulse complete. This report is derived — nothing was changed."
echo "summary: plans=$n_plans waves=$n_waves branches=$n_branches claimed=$n_claimed eligible=$n_eligible blocked=$n_blocked deferred=$n_deferred main=$MAIN"
