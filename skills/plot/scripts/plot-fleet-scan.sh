#!/usr/bin/env bash
# Plot helper: fleet pulse — deterministic extractor for wave/claim state.
# Usage: plot-fleet-scan.sh [--no-fetch] [--offline] [--next] [<slug>]
#   --no-fetch  skip `git fetch`
#   --offline   same (no network) — used for cheap, ambient pulses
#   --list-eligible  print EVERY claimable branch, one per line (exit 1 if none).
#               For callers that need the count rather than one item — a dry
#               run changes nothing, so its answer cannot go stale.
#   --loose     a prior wave counts as satisfied when its branches carry PUSHED
#               work, not only merged work. Buys throughput, pays in rebase
#               risk — the plan requires a stated reason for using it. Default
#               is strict (merged only).
#   --log-pulse append one pulse line to each reported plan's ## Notes, clean
#               pulses included — without a record of quiet pulses an idle fleet
#               and a dead fleet look identical. The ONLY thing this script ever
#               writes, and it is a log, not state.
#   --next      print ONE claimable branch name and exit 0; print nothing and
#               exit 1 when there is none. Used by /plot-implement to pick work
#               without re-deriving eligibility. "Nothing to start" is a normal
#               state — the exit code, not stderr, is what says so.
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
# here creates a branch, pushes a ref, or starts a worker.
#
# ONE exception to "writes nothing": --log-pulse appends a pulse line to each
# reported plan (see below). That is a LOG, not state — deleting the whole log
# changes no behaviour, because the next run re-derives everything. The flag
# defaults OFF precisely so internal callers (plot-implement, plot-dispatch,
# which invoke --next) can never amend a plan as a side effect of asking what
# to work on; /plot-fleet, the human-facing command, passes it every run.
#
# Wave eligibility (the one rule this script encodes):
#   A wave is ELIGIBLE when every non-deferred branch in every PRIOR wave is
#   merged into the main branch. Prior waves outstanding → BLOCKED. All of a
#   wave's own non-deferred branches merged → COMPLETE.
# Deferred branches never count as outstanding work — that is what the
# `<!-- deferred: -->` annotation is for.
#
# Claim state comes from git, not from the plan file. A branch whose only
# commits beyond main are `plot: claim ...` markers is a CLAIM: a dispatcher
# pushed it to take the work. The marker commit is what makes the claim
# exclusive — a branch merely pointing at main does not diverge from it, so a
# second push would succeed and both sides would think they held it.
# The plan's `<!-- claimed: -->` annotation is a reflection for humans and the
# board; where the two disagree, git wins. The one exception is the reaper in
# plot-reconcile-scan.sh, which reads the annotation to tell a deliberately
# abandoned claim from a dead worker.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

do_fetch=1
next_only=0
list_all=0
loose=0
log_pulse=0
as_json=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-fetch|--offline) do_fetch=0 ;;
    --loose) loose=1 ;;
    --log-pulse) log_pulse=1 ;;
    --next) next_only=1 ;;
    --list-eligible) next_only=1; list_all=1 ;;
    --json) as_json=1 ;;
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

# --loose promises "the prior wave's PRs are green and ready", which needs the
# git host. An earlier version accepted ANY pushed commit — strictly weaker
# than promised, and dangerous: red CI or a draft PR would open the next wave,
# so it built on a seam that was not merely unlanded but possibly broken.
#
# Readiness must be VERIFIED, never assumed. Without a host CLI, --loose
# degrades to strict and says so: an unverifiable claim of readiness is not
# readiness.
loose_verifiable=0
if [ "$loose" = 1 ]; then
  if [ "$do_fetch" = 1 ] && "$script_dir/plot-host.sh" backend >/dev/null 2>&1 \
     && [ "$("$script_dir/plot-host.sh" backend 2>/dev/null)" != "none" ]; then
    loose_verifiable=1
  fi
fi

# Is this branch's PR ready to merge — open, not draft? Unknown counts as NO.
pr_ready() {
  local br="$1" js
  js=$("$script_dir/plot-host.sh" pr-state "$br" </dev/null 2>/dev/null) || return 1
  printf '%s' "$js" | grep -q '"state":"OPEN"' || return 1
  printf '%s' "$js" | grep -q '"draft":false'
}

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
  # --next/--list-eligible must stay silent and exit 1: "nothing to start" is
  # the same answer whether the plans are all claimed or there are no plans at
  # all. Exiting 0 here would hand a caller an EMPTY branch name as if it were
  # valid work.
  [ "$next_only" = 1 ] && exit 1
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

branch_state() {
  local br="$1"
  if ! git show-ref -q --verify "refs/remotes/origin/$br" </dev/null 2>/dev/null; then
    echo "open"; return
  fi
  # A CLAIM is a branch whose only commits beyond main are claim commits —
  # empty markers a dispatcher pushed to take the work. They must be real
  # commits, not a bare pointer at main: two branches pointing at the same
  # commit do not diverge, so the second push would succeed and both sides
  # would think they held the claim (see plot-dispatch.sh, "THE CLAIM").
  ahead=$(git rev-list --count "origin/$MAIN..origin/$br" </dev/null 2>/dev/null || echo 0)
  if [ "$ahead" -gt 0 ]; then
    real=$(real_commits_beyond_main "$br")
    [ "${real:-0}" = "0" ] && { echo "claimed"; return; }
    # Has real work: merged only if that work already landed.
    git merge-base --is-ancestor "origin/$br" "origin/$MAIN" </dev/null 2>/dev/null \
      && { echo "merged"; return; }
    echo "wip"; return
  fi
  # Nothing of its own. NOT a claim: that shape is indistinguishable from
  # merged work, which is exactly why claims carry a commit.
  echo "merged"
}

# Prose is suppressed by BOTH alternate output modes. --json accumulates the
# same derivation into a document instead of printing it; the arithmetic below
# is untouched, which is what keeps the human report byte-identical.
quiet=0
[ "$next_only" = 1 ] && quiet=1
[ "$as_json" = 1 ] && quiet=1
HEAD_SHORT=$(git rev-parse --short HEAD 2>/dev/null)
json_plans=""

# Emit a JSON string with the six characters JSON forbids escaped. Branch names
# and claim notes are user data: a plan may legitimately carry a quote or a
# backslash, and an unescaped one would produce a document nothing can parse.
json_str() {
  printf '%s' "$1" | LC_ALL=C sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    -e 's/\t/\\t/g' -e 's/\r/\\r/g' -e 's/\x08/\\b/g' -e 's/\x0c/\\f/g'
}

if [ "$next_only" != 1 ] && [ "$as_json" != 1 ]; then
  banner="plot-fleet pulse — $HEAD_SHORT on origin/$MAIN"
  if [ "$loose" = 1 ]; then
    if [ "$loose_verifiable" = 1 ]; then banner="$banner (loose eligibility)"
    else banner="$banner (--loose cannot verify PR readiness without a git host — using strict)"
    fi
  fi
  echo "$banner"; echo
fi

n_plans=0 n_waves=0 n_branches=0 n_claimed=0 n_eligible=0 n_blocked=0 n_deferred=0
claimable=()
plan_files=()

for plan in "${plans[@]}"; do
  # Per-plan reset. State that survives into the next iteration is how the
  # plan parser once leaked a `## Branches` flag across files — same shape of
  # bug, so the accumulator is cleared where the plan loop begins.
  json_waves=""
  meta=$("$script_dir/plot-plan-meta.sh" "$plan" --prefixes "$PREFIX_RE" 2>/dev/null) || continue
  [ -n "$meta" ] || continue
  n_plans=$((n_plans + 1))
  plan_target=$(readlink "$plan" 2>/dev/null && echo "" || true)
  plan_files+=("$plan")

  # One awk pass over the parsed JSON would need a JSON parser; instead the
  # wave walk below is driven by plot-plan-meta.sh's own output via a tiny
  # python shim (present wherever the board's toolchain is).
  [ "$quiet" = 1 ] || echo "== $(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")") =="

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

  [ -n "$wave_lines" ] || { [ "$quiet" = 1 ] || { echo "  (no branches)"; echo; }; continue; }

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
      # strict (default): only a merged branch is settled.
      # loose: pushed work counts too — buys throughput, pays in rebase risk.
      case "$st" in
        merged) ;;
        wip)
          # Loose only counts pushed work as settled when its PR is verifiably
          # ready. Unverifiable → treat as outstanding (i.e. behave as strict).
          if [ "$loose_verifiable" = 1 ] && pr_ready "$br"; then :; else
            outstanding=$((outstanding + 1))
          fi ;;
        *) outstanding=$((outstanding + 1)) ;;
      esac
    done <<< "$states"

    if [ "$outstanding" -eq 0 ]; then verdict="complete"
    elif [ "$prior_ok" -eq 1 ]; then verdict="eligible"
    else verdict="blocked"; fi

    [ "$quiet" = 1 ] || echo "  ${wname:-(unnamed)} — $verdict"
    json_branches=""
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
      if [ "$verdict" = "eligible" ] && [ "$st" = "open" ]; then
        n_eligible=$((n_eligible + 1))
        claimable+=("$br")
      fi
      [ "$quiet" = 1 ] || echo "      $br — $note"
      if [ "$as_json" = 1 ]; then
        # The INTERNAL state ($st), never the prose label ($note): the board
        # must not parse a string that exists for humans to read.
        json_branches+="${json_branches:+,}{\"branch\":\"$(json_str "$br")\""
        json_branches+=",\"state\":\"$st\",\"deferred\":$deferred"
        json_branches+=",\"claimed\":\"$(json_str "$claim")\"}"
      fi
    done <<< "$states"

    if [ "$as_json" = 1 ]; then
      json_waves+="${json_waves:+,}{\"name\":\"$(json_str "$wname")\""
      json_waves+=",\"verdict\":\"$verdict\",\"branches\":[$json_branches]}"
    fi

    n_waves=$((n_waves + 1))
    [ "$verdict" = "complete" ] || prior_ok=0
    [ "$verdict" = "blocked" ] && n_blocked=$((n_blocked + 1))
  done
  if [ "$as_json" = 1 ]; then
    plan_base=$(basename "$(readlink "$plan" 2>/dev/null || echo "$plan")")
    json_plans+="${json_plans:+,}{\"file\":\"$(json_str "$plan_base")\""
    json_plans+=",\"waves\":[$json_waves]}"
  fi
  [ "$quiet" = 1 ] || echo
done

# --next: name ONE branch a worker may claim, or stay silent with exit 1.
# "Nothing to start" is a normal state, not a failure — the exit code is what
# distinguishes it from a name, so callers can branch on it without parsing.
if [ "$next_only" = 1 ]; then
  [ ${#claimable[@]} -gt 0 ] || exit 1
  if [ "$list_all" = 1 ]; then
    printf '%s\n' "${claimable[@]}"
  else
    printf '%s\n' "${claimable[0]}"
  fi
  exit 0
fi

# --log-pulse: append ONE line per plan, clean pulses included. Without a
# record of quiet pulses an idle fleet and a dead fleet are indistinguishable.
# This is a LOG, not state: deleting it changes no behaviour, because the next
# pulse re-derives everything from git.
if [ "$log_pulse" = 1 ]; then
  stamp=$(date -u +%Y-%m-%dT%H:%MZ)
  line="<!-- pulse: $stamp — waves=$n_waves eligible=$n_eligible claimed=$n_claimed blocked=$n_blocked deferred=$n_deferred -->"
  for pf in ${plan_files[@]+"${plan_files[@]}"}; do
    real=$(cd "$(dirname "$pf")" && readlink "$(basename "$pf")" 2>/dev/null || true)
    target=$([ -n "$real" ] && echo "$(dirname "$pf")/$real" || echo "$pf")
    [ -f "$target" ] || continue
    if grep -q '^## Notes' "$target" 2>/dev/null; then
      awk -v ln="$line" '
        /^## Notes/ && !done { print; print ""; print ln; done=1; next }
        { print }
      ' "$target" > "$target.tmp" && mv "$target.tmp" "$target"
    else
      printf '\n## Notes\n\n%s\n' "$line" >> "$target"
    fi
  done
fi

# --json: the same derivation as the prose above, rendered for machines. It is
# an OUTPUT MODE and nothing more — it composes with --offline/--no-fetch/
# --loose rather than implying any of them, so the board's data depends on what
# it asked for, not on how it asked. --next wins over it (handled above): that
# is a different question with a one-line answer.
if [ "$as_json" = 1 ]; then
  printf '{"main":"%s","head":"%s","plans":[%s],' \
    "$(json_str "$MAIN")" "$(json_str "$HEAD_SHORT")" "$json_plans"
  printf '"summary":{"plans":%d,"waves":%d,"branches":%d,"claimed":%d,' \
    "$n_plans" "$n_waves" "$n_branches" "$n_claimed"
  printf '"eligible":%d,"blocked":%d,"deferred":%d}}\n' \
    "$n_eligible" "$n_blocked" "$n_deferred"
  exit 0
fi

echo "Pulse complete. This report is derived — nothing was changed."
echo "summary: plans=$n_plans waves=$n_waves branches=$n_branches claimed=$n_claimed eligible=$n_eligible blocked=$n_blocked deferred=$n_deferred main=$MAIN"
