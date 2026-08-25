#!/usr/bin/env bash
# Plot helper: worker loop — implements then asks for the next wave.
# Usage: plot-worker-loop.sh
# Environment: PLOT_BRANCH, PLOT_WORKTREE, PLOT_SLUG, PLOT_MANIFEST_FILE (from dispatcher)
#
# This is the looping shell the Worker command calls. After each branch
# completes, it asks `--next` for another claimable branch OF THE SAME PLAN,
# claims it, creates its worktree, and loops. Exit 1 from `--next` is
# "nothing to start" and breaks the loop cleanly.
#
# THE PROMPT is read from `.plot/worker-prompt.sh` in the repo root. That file
# contains the literal `claude -p "..."` invocation the loop runs each
# iteration. Keeping it in a file rather than a Plot Config key avoids the
# parser stripping `$(...)` constructs, and lets the prompt be as long as
# needed without making CLAUDE.md unreadable.
#
# THE CLAIM is the same ref push dispatch uses: an empty commit titled
# `plot: claim <branch>`, which diverges from any other claim attempt so only
# one push succeeds. A failed push means another worker won the race; the loop
# removes that worktree and tries `--next` again.
#
# A worker that hops takes NO NEW SLOT: the cap counts sessions, and a hopping
# worker is one session continuing, not a second one spawning. This is why the
# cap can be enforced without stalling the fleet — at the cap, work continues
# through the workers already running.
#
# THE MANIFEST IS UPDATED ON EACH HOP. When a worker moves to a new branch,
# the manifest's `branch` and `worktree` fields are updated, and `wavesCount`
# is incremented. This keeps the registry accurate: a reader sees where the
# worker IS, not where it started. The `session` and `pid` stay fixed — it is
# the same worker, in a new place.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root="."

cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

# THE BOUND ON A SINGLE PROMPT RUN, in seconds. A worker whose agent process
# hangs — the `Error: No messages returned` rejection inside the CLI, which
# leaves the process alive but never returning — otherwise holds the loop
# forever: 11 such workers were measured on 2026-08-25, one for 10 hours.
#
# THE DEFAULT IS MEASURED, NOT GUESSED. Honest PR-creation-to-merge runs on this
# estate were 9–29 min (#414, #417, #419, #416) against hangs of up to 10 hours
# — two orders of magnitude of separation, so ~1 h never truncates real work. A
# project whose waves are genuinely longer sets its own value (Principle 5).
#
# A NON-NUMERIC OR EMPTY VALUE FALLS BACK to the default rather than becoming a
# `sleep` argument that errors — the same guard `plot-fleet-scan.sh` applies to
# `Claim stale after`. `0` is preserved as written: a project that sets the
# bound to 0 has explicitly disabled it, and the run below treats non-positive
# as "no bound".
WORKER_BOUND_SECONDS=$(cfg "Worker bound" "3600")
case "$WORKER_BOUND_SECONDS" in (*[!0-9]*|'') WORKER_BOUND_SECONDS=3600 ;; esac

# Update the manifest when the worker hops to a new branch.
#
# The manifest already carries `session`, `pid`, `startedAt` — these stay fixed.
# This function updates `branch`, `worktree`, and increments `wavesCount`.
#
# WHY THE MANIFEST UPDATE IS NECESSARY. The registry synthesizes from manifests.
# A worker that moved branches without updating the manifest would still appear
# on its starting branch — the thing this whole wave exists to fix. The update
# is made HERE rather than in dispatch because dispatch starts workers; this
# script is the one that moves them.
#
# USES NODE because JSON manipulation in portable shell is brittle (BSD sed
# interprets escape sequences differently, awk quoting varies), and node is
# guaranteed present — the Worker command itself requires it. The one-liner
# reads, updates, and writes atomically through a temp file.
update_manifest_on_hop() { # $1=manifest $2=new_branch $3=new_worktree
  local manifest="$1" new_branch="$2" new_worktree="$3"
  [ -f "$manifest" ] || return 0

  local tmp="$manifest.plot-hop-tmp"
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    manifest.branch = process.argv[2];
    manifest.worktree = process.argv[3];
    manifest.wavesCount = (manifest.wavesCount || 1) + 1;
    fs.writeFileSync(process.argv[4], JSON.stringify(manifest, null, 2) + "\n");
  ' "$manifest" "$new_branch" "$new_worktree" "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }

  mv -f "$tmp" "$manifest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# Read the prompt from the dedicated file. A file rather than a config key
# because plot-config.sh strips `(...)` as prose, and the prompt legitimately
# contains shell constructs like ${PLOT_BRANCH##*/}.
prompt_file="$repo_root/.plot/worker-prompt.sh"
if [ ! -f "$prompt_file" ]; then
  echo "plot-worker-loop: no prompt file at $prompt_file" >&2
  echo "  Create it with the inner claude -p invocation, e.g.:" >&2
  echo "    claude -p \"You are implementing the branch \$PLOT_BRANCH...\" --permission-mode bypassPermissions" >&2
  exit 1
fi

# Determine the main branch for worktree creation.
main_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -z "$main_branch" ] && main_branch=main

# ---------------------------------------------------------------------------
# The bound on a single prompt run — bash alone, no timeout(1)
# ---------------------------------------------------------------------------
#
# THE MECHANISM WAS SPIKED BEFORE IT WAS CHOSEN. The obvious phrasing,
# `timeout $B . "$prompt_file"`, does not exist: line 108 sources a file, and
# `. ` is a shell BUILTIN that runs in the loop's own process — `timeout(1)`
# execs a new process and cannot wrap it. `timeout(1)` is also not assumable:
# measured here it resolves to `/opt/homebrew/bin/timeout` (coreutils), and a
# mac without Homebrew has neither `timeout` nor `gtimeout`. Plot's helpers
# assume nothing beyond POSIX tools and git, so the bound is BASH ALONE.
#
# SO THE PROMPT RUNS IN A CHILD, NOT THE LOOP'S SHELL. `bash -c '. "$f"'` still
# SOURCES the prompt file — `$PLOT_BRANCH` and friends expand at runtime exactly
# as before — but now inside a process that can be killed. The dispatcher sets
# those variables as an exported prefix assignment (plot-dispatch.sh), and the
# loop re-exports them on each hop (below), so they survive the child.
#
# A WATCHDOG, NOT A HANDLER FOR THE ERROR. The `No messages returned` rejection
# happens inside the CLI's own process and never yields an exit code — that IS
# the defect. There is nothing to catch. A wall-clock bound catches the next,
# unseen hang too; matching the log for that one string would recognise only the
# hang already measured.
#
# THE WATCHDOG SIGNALS, IT DOES NOT RACE ON `wait -n`. An earlier version raced
# the prompt against a watchdog `sleep` with `wait -n` and read the loser from
# the survivor's liveness. Measured: on macOS's stock `/bin/bash` (3.2), which
# has no `wait -n`, that builtin errors and returns instantly — the bound read
# every prompt as an honest finish and never fired. The exact system this gate
# is FOR — a mac with no Homebrew, hence no `timeout(1)` — is also the one with
# only bash 3.2, so a bash-4.3 dependency would disable the bound precisely
# where it is needed. So instead: a background watchdog sends SIGALRM to the
# loop after the bound, a trap sets a flag and kills the prompt, and the loop
# merely `wait`s on the prompt (a builtin every bash has). Works on 3.2 and 5.x.
#
# CLEANUP IS ON EVERY EXIT PATH. `run_bounded` tracks the prompt child and its
# watchdog in file-scope variables, and a single EXIT trap reaps BOTH — so a
# normal finish, a timeout, a Ctrl-C, and an outright kill of the loop all leave
# no orphaned sleep and no stray child. A bound that outlived its worker would
# be a new leak inside the fix for a leak.
_prompt_child=""
_watchdog_pid=""
_timed_out=0

# Kill a process and any descendants it spawned. The prompt child is
# `bash -c '. "$f"'`, which itself launches the agent CLI as a grandchild;
# killing only the immediate child would orphan that CLI, which is the very
# thing being bounded.
#
# THE ROOT DIES FIRST, then its descendants — but the descendants are SNAPSHOT
# before the root is killed. Two failures were measured and both are avoided:
#
#   * Reaping children BEFORE the root leaves a window in which the root shell —
#     the sourced prompt — sees `sleep` die and runs its NEXT line before the
#     kill reaches it (a `git push`, say, on a worktree the bound just declared
#     unmeasured). Measured: "SHOULD NOT PRINT" printed.
#   * Killing the root and THEN asking `pkill -P $root` finds nothing: SIGKILL
#     reparents the orphaned grandchild to init, so it no longer matches the
#     dead root's PID. Measured: the `sleep` leaked.
#
# So the child PIDs are collected first (`pgrep -P`), the root is killed to stop
# it spawning or advancing, then the snapshot is killed. The agent CLI the
# prompt had already launched is in that snapshot.
_kill_tree() { # $1 = root pid
  local root="$1" kid
  [ -n "$root" ] || return 0
  local kids
  kids=$(pgrep -P "$root" 2>/dev/null || true)
  kill -KILL "$root" 2>/dev/null || true
  for kid in $kids; do
    _kill_tree "$kid"
  done
}

# The bound fired: a background watchdog sent SIGALRM. Record it and end the
# prompt (and the agent CLI it spawned). The flag is what `run_bounded` reads
# after `wait` returns to tell a fired bound from an honest finish.
_on_alarm() {
  _timed_out=1
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
}
trap _on_alarm ALRM

_cleanup_bound() {
  [ -n "$_watchdog_pid" ] && _kill_tree "$_watchdog_pid"
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
  _watchdog_pid=""
  _prompt_child=""
}
trap _cleanup_bound EXIT

# Run the prompt under the bound. Returns 0 if it finished on its own (whatever
# its own exit status), or 124 — timeout(1)'s convention — if the bound fired.
# A bound of 0 (explicitly disabled) runs the prompt with no watchdog at all.
run_bounded() {
  _timed_out=0

  if [ "$WORKER_BOUND_SECONDS" -le 0 ]; then
    # shellcheck source=/dev/null
    bash -c '. "$1"' _ "$prompt_file"
    return 0
  fi

  # shellcheck source=/dev/null
  bash -c '. "$1"' _ "$prompt_file" &
  _prompt_child=$!

  # The watchdog: after the bound, signal the loop's own PID. A compound
  # subshell (`sleep; kill`) rather than `sleep && kill` so a killed sleep still
  # cannot fire, and so `$$` inside it is the loop, not the subshell.
  ( sleep "$WORKER_BOUND_SECONDS"; kill -ALRM "$$" 2>/dev/null ) &
  _watchdog_pid=$!

  # Block on the prompt. If the bound fires first, _on_alarm kills the prompt
  # and this `wait` returns (interrupted); if the prompt finishes first, `wait`
  # returns normally and the watchdog is still counting down. Either way, read
  # the flag — set only by the alarm trap — to tell which happened.
  wait "$_prompt_child" 2>/dev/null

  # Stop the watchdog (a no-op if it already fired) and reap its sleep.
  _kill_tree "$_watchdog_pid"
  wait "$_watchdog_pid" 2>/dev/null || true
  _watchdog_pid=""
  _prompt_child=""

  [ "$_timed_out" = 1 ] && return 124
  return 0
}

while true; do
  # Run the worker prompt in the current worktree, under the bound.
  # The prompt file is sourced (inside a child) so $PLOT_BRANCH etc. expand at
  # runtime. If the bound fires the worker EXITS rather than hopping: a hung
  # agent has left the worktree in a state nobody measured, and starting a
  # second branch on top of that guess is worse than stopping.
  if ! run_bounded; then
    echo "plot-worker-loop: prompt exceeded the ${WORKER_BOUND_SECONDS}s bound on ${PLOT_BRANCH:-?} — ending worker without hopping" >&2
    exit 124
  fi

  # Ask for the next claimable branch of the same plan.
  next_branch=$("$script_dir/plot-fleet-scan.sh" --next "$PLOT_SLUG" 2>/dev/null) || break

  # Create worktree for the next branch.
  wt_root=$(dirname "$PLOT_WORKTREE")
  suffix=$(printf '%s' "$next_branch" | tr '/' '-')
  new_wt="$wt_root/plot-wt-$suffix"

  git worktree add -b "$next_branch" "$new_wt" "origin/$main_branch" 2>/dev/null || \
    git worktree add "$new_wt" "$next_branch" 2>/dev/null || break

  # Claim the branch with an empty commit.
  git -C "$new_wt" commit --allow-empty -m "plot: claim $next_branch" 2>/dev/null

  # Push the claim — if it fails, another worker won the race.
  if ! git -C "$new_wt" push -u origin "$next_branch" 2>/dev/null; then
    git worktree remove --force "$new_wt" 2>/dev/null || true
    continue
  fi

  # Update the manifest to reflect the hop.
  # The manifest tracks where the worker IS, so it must update before the worker
  # starts on the new branch. Without this, the registry would show the worker
  # on its starting branch forever.
  if [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ]; then
    update_manifest_on_hop "$PLOT_MANIFEST_FILE" "$next_branch" "$new_wt"
  fi

  # Move to the new worktree and update environment for the next iteration.
  cd "$new_wt" || break
  export PLOT_BRANCH="$next_branch"
  export PLOT_WORKTREE="$new_wt"
done
