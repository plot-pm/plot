#!/usr/bin/env bash
# Append a slice's PR number to its line in the plan that names it — and do the
# write and the commit in the SAME tree, which is the whole defect this exists
# to close.
#
#   plot-record-pr.sh <branch> <pr-number>
#
# THE BUG THIS REPLACES. `.plot/worker-prompt.sh` used to tell a dispatched
# agent, in prose, to edit the plan file in the MAIN checkout and commit it
# there — "check git branch --show-current is main before that edit". An agent
# session can run a Write/Edit tool call against an absolute path regardless of
# what a prior `cd` did, so an edit landing in the main checkout's working tree
# and a commit landing somewhere else were never guaranteed to be the same
# operation. Measured 2026-10-23: a plan file's bytes were written into the
# main checkout directly while an identical change was separately committed
# and pushed from another tree, leaving the main checkout permanently dirty.
#
# THE FIX IS write_started_record's SHAPE, applied to a different line. A
# disposable branch is cut from `origin/<default>`, the plan file is read,
# edited and committed INSIDE that one worktree, pushed, and the worktree is
# removed — so the bytes on disk and the bytes in the commit are provably the
# same bytes, because nothing else touches that directory. The main checkout
# is never opened.
#
# WHICH PLAN NAMES THE BRANCH is answered the way `plot-open-pr.sh` answers it:
# grep candidates, parse each with `plot-plan-meta.sh`, and take the one whose
# `waves[].branches[].branch` matches. That read happens against `origin/<main>`,
# through the disposable worktree, never against the possibly-dirty main
# checkout.
#
# THE LINE EDITED is the branch's own existing bullet under `## Slices` or
# `## Branches` — `- \`<branch>\` — <description>` — with ` → #<number>`
# appended to its end. This is an append onto an existing line, not an insert
# of a new one, which is why it is a different awk recipe from
# `append_started_line` in plot-dispatch.sh.
#
# A BRANCH ALREADY CARRYING AN ANNOTATION REFUSES. Re-running this for a
# branch whose line already holds `→ #N` would silently produce `→ #N → #M`,
# which `plot-plan-meta.sh`'s `malformed_prs` would then flag — so this stops
# first and names the conflict instead.
set -uo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$script_dir/plot-desk-root.sh"
. "$script_dir/plot-tmp.sh"

branch="${1:-}"
pr="${2:-}"
[ -n "$branch" ] && [ -n "$pr" ] || { echo "usage: plot-record-pr.sh <branch> <pr-number>" >&2; exit 2; }
case "$pr" in *[!0-9]*|'') echo "plot-record-pr: <pr-number> must be numeric, got '$pr'" >&2; exit 2 ;; esac

git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-record-pr: not a git repository" >&2; exit 1; }

repo_root=$(plot_repo_root)
MAIN=$(bash "$script_dir/plot-config.sh" get "Main branch")
[ -n "$MAIN" ] || MAIN=$(bash "$script_dir/plot-host.sh" default-branch 2>/dev/null)
[ -n "$MAIN" ] || MAIN=main

git -C "$repo_root" fetch -q origin "$MAIN" 2>/dev/null

wt_root=$(plot_desk_root "$repo_root") || exit 3
plot_exclude_desk_root "$repo_root"

slug_part="${branch##*/}"
bookbr="plot/record-pr-$slug_part"
tmpwt="$wt_root/.plot-record-pr-$slug_part.$$"

plot_record_pr_cleanup() { git -C "$repo_root" worktree remove --force "$tmpwt" 2>/dev/null || true; git -C "$repo_root" branch -D "$bookbr" >/dev/null 2>&1 || true; }
plot_on_exit plot_record_pr_cleanup

git -C "$repo_root" worktree add -q -B "$bookbr" "$tmpwt" "origin/$MAIN" 2>/dev/null || { echo "plot-record-pr: could not prepare a booking worktree at $tmpwt" >&2; exit 1; }

# WHICH PLAN NAMES THIS BRANCH — read from inside the disposable worktree, so
# the search sees origin/<default>'s plan directory and nothing a dirty main
# checkout might be holding.
plan_dir=$(cd -- "$tmpwt" && bash "$script_dir/plot-config.sh" get "Plan directory" "docs/plans/")

found=$(plot_plan_for_branch "$tmpwt" "$plan_dir" "$branch") || { echo "plot-record-pr: no plan in $plan_dir names branch '$branch'" >&2; exit 1; }
plan_file="${found%%$'\t'*}"

# APPEND ` → #<number>` TO THE BRANCH'S OWN BULLET LINE — the pure transform
# lives in packages/domain/src/rules/slice-pr-annotation.ts and is asked
# through this bundle rather than duplicated here in awk, per "A Shell Script
# Asks The Domain": this script runs once per PR, not once per agent per pass.
node "$script_dir/board/plot-slice-pr-annotation.mjs" "$plan_file" "$branch" "$pr" || exit 1

rel="${plan_file#"$tmpwt"/}"
git -C "$tmpwt" add -- "$rel" 2>/dev/null
git -C "$tmpwt" commit -q -m "plot: record PR #$pr for $slug_part" 2>/dev/null || { echo "plot-record-pr: nothing to commit in $tmpwt — $rel may already carry PR #$pr" >&2; exit 1; }

"$script_dir/plot-push-main.sh" "$bookbr" "$MAIN"
