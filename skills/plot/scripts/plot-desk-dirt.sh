#!/usr/bin/env bash
# Plot helper: the uncommitted paths in a desk that count as unlanded work.
#
# SOURCED, NOT RUN. `. "$script_dir/plot-desk-dirt.sh"` defines `desk_dirt`,
# `bundle_paths` and `exclude_bundle_paths`, and does nothing else on load,
# the shape `plot-pr-merged.sh` has for the same reason.
#
# FOUR READERS, not three. `plot_worker_dirty_filter` (`plot-worker-state.sh`)
# decides `stalled`, `desk_is_resettable`, and the `--restart`/`--release`
# refusals; `desk_dirt` below serves the reaper and reconcile §21;
# `bashCleanliness` (`packages/board/src/server/registry.ts`) serves the
# board's drop rule; and the raw porcelain reads in `plot-dispatch.sh` and
# `plot-fleetctl.sh`. All four must read one desk the same way: a desk the
# reaper removes and section 21 keeps for `uncommitted-changes` is two answers
# about one tree, and the same is true of a rebuilt bundle read as unlanded
# work by one reader and excused by another.
#
# THIS IS A READING, NOT A RULE. `reapable.ts` refuses on uncommitted changes
# because uncommitted work exists in exactly one place. The paths below are
# files the estate writes itself, or bundles `main` rebuilds on its own, so the
# filter lives here and the rule does not change.
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
#   ?? .plot-worker.continue.md
#                             the board writes it (`CONTINUATION_NAME`,
#                             `continue.ts`) for a hop between passes, and a
#                             merged desk that holds only this file has nothing
#                             left for an agent to read. Matched the same way as
#                             `PLOT-CORRECTION.md` above, whole line and
#                             untracked form only, so `docs/.plot-worker.continue.md`
#                             still counts.
#   each generated bundle     `main` rebuilds and pushes every one of them
#                             (`bug/main-builds-its-bundles`, #1249), so a desk
#                             that locally rebuilt one to test holds nothing an
#                             agent put there. Excused PATH BY PATH, read from
#                             `packages/board/build.mjs`'s own declarations —
#                             never the directory, which also holds the
#                             hand-written `README.md` and `plot-monitor.mjs`.
#
# `PLOT-BLOCKED*` is NOT here. A blocked desk owes a person an answer, and each
# caller reads that marker separately.

# bundle_paths <worktree> — the generated board bundle paths, one per line,
# derived from that worktree's own `packages/board/build.mjs`. The SAME
# `shipped[A-Za-z]* = path.join(...)` reading `check-bundle-attributes.sh`,
# `scripts/main-bundles.sh` and `scripts/check-no-bundle-diff.sh` already
# share, so a fifth derivation can never name a different set.
#
# PRINTS NOTHING ON ANY FAILURE — no worktree, no build file, no declaration
# found — so a desk this cannot read is excused from nothing rather than
# everything. Always returns 0.
bundle_paths() { # $1=worktree
  local wt="$1" build
  [ -n "$wt" ] && [ -d "$wt" ] || return 0
  build="$wt/packages/board/build.mjs"
  [ -f "$build" ] || return 0
  grep -aoE "shipped[A-Za-z]* = path\.join\([^)]*'[^']*'\)" "$build" 2>/dev/null \
    | sed -E "s|.*'\.\./\.\./([^']*)'.*|\1|" \
    | sort -u || true
}

# exclude_bundle_paths <worktree> — drops any porcelain line WHOSE PATH (column
# 4 on) is a generated bundle. Reads the set fresh per call: a desk's
# `build.mjs` may differ from `main`'s (an agent mid-edit on the build itself),
# and the paths that desk would rebuild are what its OWN tree declares.
#
# `bundles.generated.ts` and `.gitattributes` are NEVER in this set — they are
# not generated paths themselves, and `check-no-bundle-diff.sh`'s reason holds
# here too: a change to either is real work on the desk, not a rebuilt bundle.
#
# stdin is full porcelain lines (`XY path`), not paths alone, so a caller can
# pipe `git status --porcelain` straight through. Prints the input unfiltered
# when the set cannot be read — a desk this cannot read is excused from
# nothing rather than everything.
exclude_bundle_paths() { # $1=worktree, stdin=porcelain lines
  local wt="$1" input patterns
  input="$(cat)"
  patterns="$(bundle_paths "$wt")"
  if [ -z "$patterns" ]; then
    [ -n "$input" ] && printf '%s\n' "$input"
    return 0
  fi
  printf '%s\n' "$input" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    if printf '%s\n' "$patterns" | grep -qxF "${line:3}"; then
      continue
    fi
    printf '%s\n' "$line"
  done
}

# desk_dirt <worktree> — print the counted `git status --porcelain` lines.
# Prints nothing for a clean desk, and nothing for a path git cannot read.
# Always returns 0.
desk_dirt() {
  git -C "$1" status --porcelain 2>/dev/null \
    | grep -v 'tiny-garden/\.plot/state' \
    | grep -vxFf <(printf '%s\n' '?? PLOT-CORRECTION.md' '?? .plot-worker.continue.md') \
    | exclude_bundle_paths "$1" \
    || true
}

# real_commits <git-dir> <range> — print how many commits in <range> are not
# empty claim markers, as `rules/empty-claim.ts`'s `realCommits` counts them
# through `board/plot-empty-claim.mjs`. Prints `0` for an empty range and
# `unknown` when the bundle gives no answer for a non-empty one, so a caller
# never reads a missing bundle as "nothing to land".
real_commits() {
  local n
  [ "$(git -C "$1" rev-list --count "$2" </dev/null 2>/dev/null || echo 0)" = 0 ] && { echo 0; return 0; }
  n=$(git -C "$1" log --boundary --format='r%x09%m%x09%H%x09%T%x09%P%x09%s' "$2" -- </dev/null 2>/dev/null \
    | node "$(dirname "${BASH_SOURCE[0]}")/board/plot-empty-claim.mjs" 2>/dev/null | cut -f2)
  echo "${n:-unknown}"
}
