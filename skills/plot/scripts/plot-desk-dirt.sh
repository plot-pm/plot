#!/usr/bin/env bash
# Plot helper: the uncommitted paths in a desk that count as unlanded work.
#
# SOURCED, NOT RUN. `. "$script_dir/plot-desk-dirt.sh"` defines `desk_dirt`
# and does nothing else on load, the shape `plot-pr-merged.sh` has for the
# same reason.
#
# THREE READERS. `plot-reap.sh` reads it twice — the reap decision and the
# "dirty trees nobody owns" sweep — and `plot-reconcile-scan.sh` section 21
# reads it once. All three ask `reap()` or report beside it, so one tree must
# read the same in all three: a desk the reaper removes and section 21 keeps
# for `uncommitted-changes` is two answers about one tree.
#
# THIS IS A READING, NOT A RULE. `reapable.ts` refuses on uncommitted changes
# because uncommitted work exists in exactly one place. The paths below are
# files the estate writes itself, so the filter lives here and the rule does
# not change.
#
# EACH EXCLUSION IS NAMED. A pattern that matched one source file would delete
# that file with the worktree, so there is no glob:
#
#   tiny-garden/.plot/state   every board suite rewrites this fixture pulse,
#                             so a worker that only ran the tests would never
#                             be reapable.
#   ?? PLOT-CORRECTION.md     `plot-worker-loop.sh` (`write_correction`)
#                             writes it at the desk root, the agent reads it,
#                             and it has no value afterwards. Matched as the
#                             whole porcelain line, so `docs/PLOT-CORRECTION.md`
#                             still counts. Only the untracked `??` form is
#                             excused: the loop never stages the file, so a
#                             staged or tracked copy is somebody's decision.
#
# `PLOT-BLOCKED*` is NOT here. A blocked desk owes a person an answer, and each
# caller reads that marker separately.

# desk_dirt <worktree> — print the counted `git status --porcelain` lines.
# Prints nothing for a clean desk, and nothing for a path git cannot read.
# Always returns 0.
desk_dirt() {
  git -C "$1" status --porcelain 2>/dev/null \
    | grep -v 'tiny-garden/\.plot/state' \
    | grep -vxF '?? PLOT-CORRECTION.md' \
    || true
}
