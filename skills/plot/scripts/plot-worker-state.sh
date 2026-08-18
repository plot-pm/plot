#!/usr/bin/env bash
# Plot helper: the ONE answer to "is a worker running in this worktree?"
#
# SOURCED, NOT RUN. `. "$script_dir/plot-worker-state.sh"` defines
# `plot_worker_state`; the file does nothing else on load, which is what makes
# sourcing it safe and is why this logic could not simply live in
# plot-dispatch.sh. That file PARSES `$@` and `exit 1`s on a missing slug at
# load time, so sourcing it from the scan would run the dispatcher's argument
# parser against the scan's arguments.
#
# WHY A THIRD FILE AND NOT A SUBPROCESS. Every other cross-script call in the
# fleet shells out (`"$script_dir/plot-config.sh" get …`), and that idiom is
# deliberate elsewhere. It is wrong here: the scan asks this question once per
# branch inside a loop, and the answer is three fields that the caller then
# formats two different ways. Shelling out would fork per branch to serialize
# three values across a pipe so the caller could immediately parse them back —
# and re-parsing a packed string is the shape this merge exists to remove.
#
# THE CALLERS WANT DIFFERENT RENDERINGS OF ONE COMPUTATION.
# `plot-dispatch.sh --status` prints prose for a person (`failed 1234 (exit 3)`)
# and `plot-fleet-scan.sh --json` emits tab-separated fields for a machine
# (`failed\t1234\t3`). Both are real interfaces with tests pinning their bytes,
# so this function returns the FACTS — state, pid, exit code — and renders
# nothing. Each caller formats what it owns.
#
# Six states, unchanged by this file: running, finished, failed, ended, none,
# elsewhere. `elsewhere` is answered by the caller BEFORE this function is
# reached: it means "this machine has no worktree to look in", which is a
# question about the worktree list rather than about anything inside a worktree.
# plot-dispatch iterates worktrees it found on disk and so can never produce it.

# Classify the worker in a worktree.
#
# $1 = worktree path
# Prints "state\tpid\tcode" — pid and code empty where they do not apply.
# Never fails; an unreadable worktree is `none`, which is the honest answer.
plot_worker_state() { # $1=worktree → "state\tpid\tcode"
  local wt="$1" pid code
  [ -n "$wt" ] && [ -f "$wt/.plot-worker.pid" ] || { printf 'none\t\t'; return; }
  pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  [ -n "$pid" ] || { printf 'none\t\t'; return; }
  # `kill -0 0` signals the whole process GROUP and succeeds, so pid 0 would
  # read as running forever. It is never a real worker pid. Non-numeric junk is
  # rejected with it: `kill -0` would error on it anyway, and "running" is the
  # one reading a garbled pid must never produce.
  case "$pid" in 0|*[!0-9]*) printf 'none\t\t'; return ;; esac
  if kill -0 "$pid" 2>/dev/null; then printf 'running\t%s\t' "$pid"; return; fi

  # `kill -0` only separates running from not-running. Whether a stopped worker
  # finished its job or crashed is gone unless the exit code was recorded — and
  # reporting a completed worker as "dead" reads as a crash, which is how a
  # healthy fleet looks broken. The wrapper in start_worker writes the code.
  if [ -f "$wt/.plot-worker.exit" ]; then
    code=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
    case "$code" in
      0)           printf 'finished\t%s\t0' "$pid"; return ;;
      # READ THE EXIT CODE, NOT THE EMPTINESS. An exit file that exists but says
      # nothing usable is `ended`, never `finished`: guessing success from an
      # unreadable record is the same mistake in the other direction, and
      # `finished` is the one answer that tells a reader to stop looking.
      #
      # A NON-NUMERIC CODE IS `ended` HERE, AND THAT RESOLVES A REAL
      # DISAGREEMENT. Before this merge the two copies split on it: the scan
      # answered `ended`, plot-dispatch answered `failed (exit abc)`. Both
      # cannot be kept, so the scan's wins on its own stated principle — an
      # unreadable record licenses no verdict, and "failed with code abc" is as
      # much an invention as "finished" would be. The scan's suite already
      # pinned `ended`; plot-dispatch's pinned only 0, 3, and an absent file, so
      # nothing that was asserted before is asserted differently now.
      ''|*[!0-9]*) printf 'ended\t%s\t' "$pid"; return ;;
      *)           printf 'failed\t%s\t%s' "$pid" "$code"; return ;;
    esac
  fi
  # No exit file: a worker started before the code was recorded, or one killed
  # outright. Unknown is its own answer — guessing "finished" would be the same
  # mistake in the other direction.
  printf 'ended\t%s\t' "$pid"
}
