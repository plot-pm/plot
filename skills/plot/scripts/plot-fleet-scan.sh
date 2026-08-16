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
#             summary: plans=1 waves=3 branches=5 claimed=1 eligible=2 blocked=1 deferred=1 merge_detect=pr-merge main=main
#         merge_detect names how merged-and-deleted branches were detected:
#         pr-merge (exhaustive), truncated (capped walk), none (no conforming
#         merge commits — a squash/rebase repo, where `open` says nothing about
#         merging).
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

# ---------------------------------------------------------------------------
# Merged-and-deleted branches: the evidence that survives the ref
# ---------------------------------------------------------------------------
#
# A branch merged by PR usually has its ref deleted at merge, and nothing local
# survives it — `git reflog show origin/<br>` fails outright and for-each-ref
# finds nothing. What DOES survive is the merge commit on the default branch.
#
# Asking the host for merged PRs (as plot-reconcile-scan.sh does) is not
# available here: this scan is git-only on its default path, which is exactly
# why the board can poll it every 5 s. One board already costs 80 GraphQL
# calls/hour; a metered scan on a 5-second timer would dwarf that.
#
# The candidate set is what is REACHABLE from the default branch, matched by an
# ANCHORED subject:
#
#     ^Merge pull request #<n> from <owner>/<branch>$
#
# The anchoring is the whole mechanism. A name-only grep reads a BACKWARD merge
# — `Merge remote-tracking branch 'origin/main' into <branch>` — as evidence
# that <branch> landed, when it means the opposite: main was pulled INTO the
# branch. That inversion reports unfinished work as finished and opens the next
# wave on an unlanded seam, which is strictly worse than the bug this fixes. A
# backward merge opens with a different sentence, so it cannot match.
#
# TWO STRUCTURAL FILTERS WERE MEASURED AND REMOVED. Do not reintroduce either;
# see docs/plans/2026-08-16-fleet-sees-merged-branches.md for the numbers.
#   * A FIRST-PARENT filter looked convincing at "119 merges → 109 on the
#     chain". Measured against the right baseline — the anchored pattern, not
#     raw merges — it scores 108 to 108: it catches NOTHING extra, because
#     backward merges cannot match the anchored pattern anyway. And it breaks
#     GitFlow: a feature merged into `develop`, where `develop` later merges to
#     the default branch, is not on the first-parent chain and would read
#     `open` while its work is an ancestor.
#   * A SECOND-PARENT counter-check does not discriminate: PR merges and
#     backward merges both have a distinct second-parent tip.
#
# Reachability does not over-report either: a PR merged into a long-lived
# branch that was then abandoned is not reachable from the default branch at
# all. Reachability is itself an ancestry claim, so it cannot see work that
# never arrived.
#
# The walk is bundled — ONE `git log` per run, not one per branch. branch_state
# runs per branch and the board polls every 5 s, so the naive shape is
# O(history × branches) where O(history + branches) is available (measured:
# 197 ms vs 79 ms on a 2000-merge fixture). Same bundling rule
# plot-reconcile-scan.sh applies to PR lists, with local data.
#
# The cap guards against a pathological history rather than buying time — the
# walk is local and nearly free (cap 500: 7.7 ms, no cap: 11.8 ms at 2000
# merges). It is therefore set high, and SATURATION IS REPORTED. A blind cap
# re-creates this very bug: at 300 against 2000 merges an early merge is not
# found and reads `open`, hitting precisely the long-hanging plans most likely
# to suffer it.
#
# PLOT_MERGE_SCAN_LIMIT exists so the test suite can force saturation against a
# small fixture — a cap of 2000 is otherwise unreachable in a test. It is a
# seam, not a knob: nothing in Plot sets it, and lowering it in real use buys
# nothing but the silent misses described above.
MERGE_SCAN_LIMIT=${PLOT_MERGE_SCAN_LIMIT:-2000}
MERGE_SUBJECTS=$(git log "origin/$MAIN" --merges \
  --max-count="$MERGE_SCAN_LIMIT" --pretty=%s </dev/null 2>/dev/null || true)
MERGE_SCAN_TRUNCATED=0
if [ -n "$MERGE_SUBJECTS" ] \
   && [ "$(printf '%s\n' "$MERGE_SUBJECTS" | grep -c .)" -ge "$MERGE_SCAN_LIMIT" ]; then
  MERGE_SCAN_TRUNCATED=1
fi

# merge_detect names the detection source in the footer, the way
# plot-reconcile-scan.sh names pr_source. `open` must stop meaning both "never
# started" and "I could not tell" — that ambiguity is the defect this fix
# exists to remove, and it would otherwise reappear one level up.
#   pr-merge  — conforming merge commits were found and examined exhaustively
#   truncated — the walk hit its cap; a branch merged before that point may
#               still read `open`. Its own value, not folded into pr-merge: a
#               capped walk detected, but not exhaustively.
#   none      — the default branch carries no conforming merge commits at all
#               (a squash/rebase repo), so `open` says nothing about merging.
if printf '%s\n' "$MERGE_SUBJECTS" | grep -qE '^Merge pull request #[0-9]+ from [^/]+/.+$'; then
  MERGE_DETECT=$([ "$MERGE_SCAN_TRUNCATED" = 1 ] && echo truncated || echo pr-merge)
else
  MERGE_DETECT=none
fi

# Did this branch land on the default branch? Positive evidence only — absence
# keeps today's answer.
#
# The branch name is INTERPOLATED INTO AN ERE, so every metacharacter it may
# legally contain is escaped first. Git allows `+`, `(`, `)`, `?`, `{`, `}` and
# `.` in ref names, and unescaped each one changes what the pattern means —
# `feature/v.1` would match `feature/vX1`, and `bug/a+b` would fail to match
# its OWN merge subject. Both directions are wrong, and the second is the
# quieter one: a branch that silently never matches simply keeps reading
# `open`, which is this plan's own bug wearing a different hat.
merged_by_subject() { # $1=branch → 0 when a conforming merge names it
  printf '%s\n' "$MERGE_SUBJECTS" \
    | grep -qE "^Merge pull request #[0-9]+ from [^/]+/$(printf '%s' "$1" | sed 's/[][\.*^$+?(){}|\/]/\\&/g')\$"
}

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

# A branch is merged when its remote ref is an ancestor of origin/<main>, or —
# once the ref is gone — when the default branch carries a conforming PR-merge
# commit naming it (see "the evidence that survives the ref" above). An absent
# ref with no such commit means the work has not been taken yet.
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
  # THE REF CHECK STAYS IN FRONT. DO NOT HOIST THE MERGE LOOKUP ABOVE IT.
  #
  # A branch name can be reused: merge `bug/flaky`, delete it, then recreate it
  # for a second attempt — a normal thing when work is reopened. The FIRST
  # attempt's merge subject is still on the default branch, and it is now stale
  # evidence: it describes work that landed, while the branch of that name
  # carries new work that has not.
  #
  # The merge lookup is safe only BY PLACEMENT — it lives in the no-ref arm,
  # and a recreated branch has a ref, so it never reaches the lookup and takes
  # the ancestry path below instead. Moving the lookup to the top reads like a
  # cheap early answer and would silently report in-flight work as `merged`,
  # opening the next wave on it. A test in fleet.test.mjs pins this ordering.
  if ! git show-ref -q --verify "refs/remotes/origin/$br" </dev/null 2>/dev/null; then
    # No ref carries two meanings and this used to answer `open` for both: a
    # branch never started, and a branch merged with its ref deleted at merge.
    # The wave arithmetic reads `open` as OUTSTANDING, so a finished wave never
    # completed and --next named finished work as the next thing to start.
    #
    # `merged` is already the state that settles a wave, so the arithmetic does
    # not change and no new state enters the vocabulary. Where no evidence
    # exists — squash merges, a hand-rewritten subject, a branch genuinely
    # never started — today's `open` stands. The fix may only move a branch
    # from `open` to `merged`, and only on positive evidence.
    merged_by_subject "$br" && { echo "merged"; return; }
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
  printf '"eligible":%d,"blocked":%d,"deferred":%d,"merge_detect":"%s"}}\n' \
    "$n_eligible" "$n_blocked" "$n_deferred" "$MERGE_DETECT"
  exit 0
fi

# A saturated merge walk is STATED, never silent. A branch merged before the
# cap reads `open`, which is acceptable only while the scan says it stopped
# looking — a silent cap would make the report lie in the one direction this
# check was written to stop.
if [ "$MERGE_SCAN_TRUNCATED" = 1 ]; then
  echo "  note: merge scan hit its limit of $MERGE_SCAN_LIMIT — older merges were not"
  echo "        examined; a branch merged before that point may still read as open."
fi
echo "Pulse complete. This report is derived — nothing was changed."
echo "summary: plans=$n_plans waves=$n_waves branches=$n_branches claimed=$n_claimed eligible=$n_eligible blocked=$n_blocked deferred=$n_deferred merge_detect=$MERGE_DETECT main=$MAIN"
