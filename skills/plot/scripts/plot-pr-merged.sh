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
# THREE CALLERS SINCE 2026-09-04. `plot-dispatch.sh` joined them: its
# `held_worktree` asked ancestry whether a worktree's branch had landed, and on
# this estate that day ancestry disagreed with the host on TEN OF TEN merged
# branches. It fails in the cheap direction — a landed leftover reads as a held
# desk, so dispatch refuses a branch that is free — but it is the same
# substitution, and a fourth implementation of one question is the thing this
# file exists to prevent.
#
# WHY IT WAS EXTRACTED. `plot-reap.sh` and `plot-release-refs.sh` gate on the
# SAME fact — has this branch's work landed — and they must never disagree
# about it. The reaper removes a checkout, which is re-creatable with
# `git worktree add`; ref deletion is not re-creatable at all. A second
# implementation that drifted toward permissive would therefore fail in the
# direction that cannot be undone. One function, two callers, no drift.
#
# `merged` IS READ, NEVER `state`. A merged PR reports state CLOSED, and
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

# Did the host merge ANY PR for this branch?
#
# Returns 0 (merged) / 1 (not merged, or the host cannot be asked). The failure
# direction is deliberate and load-bearing: an unreachable host, an unauthed
# `gh`, a missing CLI all answer "not merged", so every caller KEEPS what it
# was considering removing. Silence is never permission.
pr_merged() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || return 1
  out=$(gh pr list --head "$br" --state all --limit 100 --json mergedAt 2>/dev/null) || return 1
  case "$out" in *'"mergedAt":"'*) return 0 ;; *) return 1 ;; esac
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
pr_open() {
  local br="$1" out
  command -v gh >/dev/null 2>&1 || return 1
  out=$(gh pr list --head "$br" --state open --limit 1 --json number 2>/dev/null) || return 1
  case "$out" in *'"number"'*) return 0 ;; *) return 1 ;; esac
}
