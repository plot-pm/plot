#!/usr/bin/env bash
# Plot helper: the ONE answer to "did the host merge ANY PR for this branch?"
#
# SOURCED, NOT RUN. `. "$script_dir/plot-pr-merged.sh"` defines `pr_merged` and
# `pr_open`; the file does nothing else on load. That is what makes sourcing it
# safe, and it is the same shape — and the same reason — as
# `plot-worker-state.sh`: the logic could not simply stay in `plot-reap.sh`,
# because that file parses `$@` and `exit 2`s on an unknown argument at load
# time, so sourcing it would run the reaper's argument parser against its
# caller's arguments.
#
# FOUR CALLERS. `plot-reap.sh`, `plot-release-refs.sh`, `plot-dispatch.sh`, and
# `plot-quiet-stretch.sh` — the last sourcing it guarded and calling it behind
# `command -v pr_merged`, so it still works with this file absent.
#
# WHY IT WAS EXTRACTED. `plot-reap.sh` and `plot-release-refs.sh` gate on the
# SAME fact — has this branch's work landed — and they must never disagree
# about it. The reaper removes a checkout, which is re-creatable with
# `git worktree add`; ref deletion is not re-creatable at all. A second
# implementation that drifted toward permissive would therefore fail in the
# direction that cannot be undone. One function, one answer, no drift.
#
# THIS FILE IS NOW THE ADAPTER, AND THE DECISION IS THE DOMAIN'S. The two
# functions still ask the host, because the host is asked in shell; what they no
# longer do is decide. Each turns its lookup into one of three READINGS —
# `found`, `none`, `unaskable` — and hands the pair to
# `board/plot-landed.mjs`, which bundles `rules/landed.ts`. The layering runs
# one way: caller → this adapter → the rule.
#
# WHAT MOVED IS THE COUPLING. `pr_merged` and `pr_open` fail in the SAME
# direction and to OPPOSITE effect — an unreachable host makes the first refuse
# a removal and the second release its veto — so neither is safe alone and the
# pair is. That was a comment in this file and could not be checked. It is now
# `mayRemove` in the rule, asserted over all nine combinations of the two
# readings, and exactly one of them permits a removal.
#
# `mergedAt` IS READ, NEVER `state`. A merged PR reports state CLOSED, and
# trusting `state` would refuse every squash-merged branch — which is the whole
# population these scripts exist for. Squash-merge rewrites the commits, so the
# branch stays "ahead of main" forever and ancestry alone can never clear it.
#
# AND THE QUESTION IS "ANY", NOT "THE NEWEST". This asked with `--limit 1`
# until 2026-08-27, which returns only the most recent PR — so a newer,
# unmerged PR sitting in front of the real merge reported `no merged PR` about
# a branch whose work was on main. Measured that day against the live host:
#
#   an-unreachable-host-says-so         newest #473 null → real merge #446
#   the-scan-sees-a-stale-sprint-tally  newest #464 null → real merge #463
#   a-plan-cites-a-jira-key             newest #476 null → real merge #447
#
# The masking PRs were ones the fleet opened ITSELF on already-merged waves,
# which closes a loop: a leftover worktree lets auto-dispatch adopt a merged
# branch, its worker opens a duplicate, the duplicate is newer, the reaper
# keeps the worktree — the input to step one. Reading only the newest PR is the
# SAME error as reading `state`, one level out: the newest PR is not the merge,
# just as the state is not the merge.
#
# 100 rather than unbounded: `gh` has no "all" sentinel, and this runs on paths
# where the estate may hold dozens of branches. A branch carrying more than 100
# PRs whose only merge is the oldest would still be missed — a far narrower
# window than "any duplicate at all", and it fails SAFE, toward keeping.

# Where the rule lives, resolved from THIS file rather than from the cwd.
#
# Both callers run with their cwd wherever the operator invoked them, and the
# reconcile suite runs them against sandbox repos in the temp directory. The
# artifact sits beside this script in the plot checkout and in the published
# npm package alike, which is why both are vendored together.
_plot_landed_mjs="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/board/plot-landed.mjs"

# Ask the rule about one branch's two lookups.
#
# $1=merged reading, $2=open reading, both `found`/`none`/`unaskable`.
# Prints the rule's two words; returns non-zero when it could not be asked at
# all, which every caller below reads as the refusing direction.
_plot_landed() {
  [ -f "$_plot_landed_mjs" ] || return 1
  printf '%s\t%s\n' "$1" "$2" | node "$_plot_landed_mjs" 2>/dev/null
}

# What the host says about ANY PR on this branch: found / none / unaskable.
#
# A MISSING CLI, AN UNAUTHED ONE AND A NETWORK FAILURE ARE ALL `unaskable`, and
# they are not `none`. The whole rule turns on that difference — a lookup that
# ran and matched nothing is the host speaking, while a lookup that did not run
# is silence, and silence is never permission.
_plot_merged_lookup() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || { echo unaskable; return; }
  out=$(gh pr list --head "$br" --state all --limit 100 --json mergedAt 2>/dev/null) \
    || { echo unaskable; return; }
  case "$out" in *'"mergedAt":"'*) echo found ;; *) echo none ;; esac
}

# What the host says about an OPEN PR on this branch: found / none / unaskable.
_plot_open_lookup() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || { echo unaskable; return; }
  out=$(gh pr list --head "$br" --state open --limit 1 --json number 2>/dev/null) \
    || { echo unaskable; return; }
  case "$out" in *'"number"'*) echo found ;; *) echo none ;; esac
}

# Did the host merge ANY PR for this branch?
#
# Returns 0 (merged) / 1 (not merged, or the host cannot be asked). The failure
# direction is deliberate and load-bearing: an unreachable host, an unauthed
# `gh`, a missing CLI all answer "not merged", so every caller KEEPS what it
# was considering removing. Silence is never permission.
#
# The rule answers `unknown` on that silence and this function reports it as a
# refusal, which is the same contract the four callers were written against —
# `plot-reap.sh:385` says so explicitly. A rule that cannot be reached at all
# refuses here too, for the same reason.
pr_merged() {
  local answer
  answer=$(_plot_landed "$(_plot_merged_lookup "$1")" none) || return 1
  case "$answer" in landed*) return 0 ;; *) return 1 ;; esac
}

# Does the branch have an OPEN PR right now?
#
# A DIFFERENT question from `pr_merged`, and it exists for a case measured by
# hand on 2026-08-28. `changeset-release/main` is merged — repeatedly — and
# Changesets RECREATES and reuses the very same branch for the next release.
# Its ref carries a live release PR while an older PR of its own has merged, so
# the merged gate alone says "delete" about a branch somebody is actively
# using.
#
# So an open PR VETOES a deletion even where an older one merged. That is
# strictly narrower than the merge gate rather than a second opinion on it: it
# can only ever keep a ref, never release one.
#
# Returns 0 when an open PR exists. An unreachable host returns 1 — and note
# that this is the SAME direction as `pr_merged`'s failure, but it has the
# OPPOSITE effect, since this answer vetoes. The safety therefore does not come
# from this function: it comes from `pr_merged` already having refused on the
# same silence, so a host that cannot be asked deletes nothing regardless.
# `mayRemove` is where that pair is now asserted rather than described.
pr_open() {
  local answer
  answer=$(_plot_landed none "$(_plot_open_lookup "$1")") || return 1
  case "$answer" in *"	open-pr") return 0 ;; *) return 1 ;; esac
}
