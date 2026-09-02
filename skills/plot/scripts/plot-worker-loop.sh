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
# THAT FILE BELONGS TO THE ADOPTING PROJECT, and Plot's contract with it is one
# environment variable. The dispatcher mints a session id and exports it as
# `PLOT_SESSION_ID`; the prompt file decides whether to pass it on:
#
#     claude -p "..." --session-id "$PLOT_SESSION_ID" --permission-mode ...
#
# Pass it and the runtime writes its transcript under the id the manifest
# records, which is what lets the board join an agent's row to its transcript
# and lets a correction be resumed into the SAME conversation. Omit it — or run
# a harness that writes no transcript — and resume reports itself UNAVAILABLE
# and a fresh worker is started instead. Nothing here requires the flag: Plot
# does not own this file, and the transcript's presence is the gate rather than
# any promise made about the invocation.
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

# THE FLOOR UNDER A SINGLE PROMPT RUN, in seconds — and a FLOOR is all it is
# as of 2026-08-30. A worker whose agent process hangs — the `Error: No messages
# returned` rejection inside the CLI, which leaves the process alive but never
# returning — otherwise holds the loop forever: 11 such workers were measured on
# 2026-08-25, one for 10 hours.
#
# IT STOPPED BEING THE VERDICT. `a-working-agent-is-not-a-hung-one` measured the
# cost of asking a clock: on 2026-08-30 seven workers exited 124 and every one
# had 3-6 commits. Not one was hung. Wall-clock time measures how long, never
# whether anything happened, so the verdict moved to the WorkerMonitor's `idle`
# finding (`monitor_watch` below) and this timer became the last resort behind
# it.
#
# THE DEFAULT IS 8 HOURS, AND THE UNIT CHANGED WITH THE JOB. At 3600 it was
# sized against honest run lengths (9-29 min, #414/#417/#419/#416) because it
# was deciding every worker's fate. It no longer decides any healthy worker's:
# the monitor ends a stall in two ~30s intervals, so the floor fires ONLY when
# the monitor itself has died — which `two-monitors-watch-the-agent` records as
# real, with one unexplained termination path and a leak that ran 152 orphans on
# this machine.
#
# So the value is sized against THAT failure instead: long enough that no honest
# agent reaches it (the longest hang ever measured here was 10 h, and honest
# runs are two orders of magnitude shorter), short enough that a monitor-less
# hang cannot burn a night unnoticed. A working day is the operator's own review
# cadence — a worker started in the morning is answered for by evening — and it
# is the value the plan asks for in as many words.
#
# A NON-NUMERIC OR EMPTY VALUE FALLS BACK to the default rather than becoming a
# `sleep` argument that errors — the same guard `plot-fleet-scan.sh` applies to
# `Claim stale after`. `0` is preserved as written: a project that sets the
# bound to 0 has explicitly disabled the FLOOR, and the run below treats
# non-positive as "no bound". It does not disable the monitor reading: that
# escape was for wall-clock kills, and reading a finding is not one.
WORKER_BOUND_SECONDS=$(cfg "Worker bound" "28800")
case "$WORKER_BOUND_SECONDS" in (*[!0-9]*|'') WORKER_BOUND_SECONDS=28800 ;; esac

# HOW OFTEN THE LOOP RE-READS THE FINDINGS FILE, in seconds. The monitor's own
# cadence is `PLOT_MONITOR_INTERVAL` (default 30) and it needs TWO passes to
# publish `idle`, so the loop reading every 5s adds at most 5s to a ~60s
# detection — under the plan's "within two monitor intervals" with room to
# spare, and cheap: one `tail` of a file that is usually empty.
#
# ENV, NOT PLOT CONFIG. This is a test seam and an implementation detail of the
# reading, not a project's declared policy — `Worker bound` is the knob a
# project sets (Principle 5), and adding a second one for the poll would ask
# operators to tune something they cannot observe.
MONITOR_POLL_SECONDS="${PLOT_MONITOR_POLL_SECONDS:-5}"
case "$MONITOR_POLL_SECONDS" in (*[!0-9]*|''|0) MONITOR_POLL_SECONDS=5 ;; esac

# WHETHER AN `idle` READING MAY END A WORKER. Default 1, which is today's
# behaviour; `PLOT_MONITOR_ENDS_WORKER=0` leaves the finding published and
# ending the worker to `Worker bound` alone.
#
# THE SEAM EXISTS BECAUSE THE READING WAS NOT THE QUESTION, and as of
# 2026-09-02 it is. `idle` used to mean the subtree burned no CPU across a 0.4 s
# sample, taken twice ~30 s apart — and an agent waiting on a model response
# burns no CPU in its subtree, so a false zero was the common reading rather
# than the rare one and the rule could not tell `stuck` from `thinking`.
#
# Measured 2026-09-01 on this estate: SEVEN desks carried `reported idle on` in
# their logs, every one of them holding real commits, and five had to be
# finished by hand. `feature/the-gates-read-what-was-left-behind` was ended
# 11 s after dispatch with 2 commits and an unwritten changeset. Eleven workers
# went this way across two days.
#
# `plot-worker-monitor.sh` now reads the agent's TRANSCRIPT and asks the CPU
# only whether a child is on a core, so the reading answers the question the
# kill was always making. The seam stays because it is cheap and because an
# operator who wants `Worker bound` alone should be able to have it — but it is
# no longer the workaround for a reading that could not be trusted.
MONITOR_ENDS_WORKER="${PLOT_MONITOR_ENDS_WORKER:-1}"
case "$MONITOR_ENDS_WORKER" in (0|1) ;; (*) MONITOR_ENDS_WORKER=1 ;; esac

# Update the manifest when the worker hops to a new branch.
#
# The manifest already carries `session`, `pid`, `startedAt` — these stay fixed.
# This function updates `branch`, `worktree`, and increments `wavesCount`.
#
# `resumeId` AND `attempts` STAY FIXED TOO, and they do so by being untouched
# rather than by being preserved: the node one-liner round-trips the whole
# object, so every field this function does not name survives verbatim. That is
# a PROPERTY WORTH STATING, because it is the answer to a question the plan
# deliberately left open — *should the resume handle follow a hop?* Today it
# does: a correction about branch C would be delivered into a conversation that
# has since moved to D. The two ids are separate FIELDS so the question can be
# asked and answered later without a migration; nothing here decides it.
#
# `attempts` is likewise carried across a hop and not reset. A hop is the same
# agent continuing, so a supervisor's budget for it is the same budget.
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

# THE DECLARATION FILE, per branch. `.plot-worker.exit`, `.plot-worker.pid`,
# `.plot-worker.log` and `.plot-worker.monitor.*.jsonl` are already the
# convention; this joins them rather than inventing a location.
DECLARATION_FILE_NAME='.plot-worker.envelope.json'

# Write the declaration for the branch that just finished.
#
# ONE PER BRANCH, NOT ONE PER WORKER, and the difference is the failure this
# whole plan exists to fix, reproduced one level up. A worker HOPS: the loop
# below asks `--next` for another branch of the same plan while `session` and
# `pid` stay fixed, so one worker may finish branches A and B before dying on C.
# A single end-of-life declaration would then be ABSENT, and A and B — genuinely
# finished, PRs open — would read as incomplete.
#
# SO IT IS WRITTEN HERE, where a BRANCH finished, and not in the EXIT trap. The
# trap fires when the WORKER ends, which is a different event and answers a
# different question. A hopping worker leaves a trail of declarations and only
# the branch it died on is missing one.
#
# ABSENCE IS LOAD-BEARING, so this runs on exactly one path: `run_bounded`
# returned 0, meaning the agent's prompt finished on its own. A worker killed by
# the `Worker bound` or ended by the WorkerMonitor exits above without reaching
# this line, and its desk is left with no declaration — which is what says the
# work did not complete, whatever the exit code says.
#
# THE AGENT MAY SPEAK FIRST. If the prompt already wrote the file, its
# `artifacts`, `pr`, `summary` and `status` are kept: the agent is the only
# party that knows what it produced, and Plot does not own the prompt that
# writes it. This fills in only what the agent could not know it needed —
# `branch`, which the loop knows and the agent may misname, and a `status` of
# `ok` where none was declared.
#
# AN UNPARSEABLE FILE IS LEFT EXACTLY AS IT IS. Overwriting it would launder
# bytes nobody can believe into a declaration that says the branch finished, and
# the domain's parse deliberately keeps *unreadable* apart from *complete* for
# that reason. A half-written file stays a half-written file, and a reader is
# told so.
seal_declaration() { # $1=worktree $2=branch
  local worktree="$1" branch="$2" file
  # NO BRANCH, NO DECLARATION. The declaration is ABOUT a branch, so one that
  # names none cannot be attributed and the domain's parse refuses it. Writing
  # an unattributable file would be worse than the absence it replaces.
  [ -n "$branch" ] || return 0
  [ -n "$worktree" ] || return 0
  [ -d "$worktree" ] || return 0
  file="$worktree/$DECLARATION_FILE_NAME"

  # USES NODE for the same reason `update_manifest_on_hop` does: JSON in
  # portable shell is brittle, and the Worker command already requires node.
  # The write goes through a temp file and a rename, so a reader never sees a
  # partial declaration — the one shape this file must never produce, since its
  # own contract says a file that exists and does not parse is not absent.
  local tmp="$file.plot-seal-tmp"
  node -e '
    const fs = require("fs");
    const [file, tmp, branch] = process.argv.slice(1);
    let declared = {};
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(3);
        declared = parsed;
      } catch { process.exit(3); }
    }
    const envelope = { ...declared, branch, status: declared.status || "ok" };
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n");
  ' "$file" "$tmp" "$branch" 2>/dev/null || { rm -f "$tmp"; return 0; }

  mv -f "$tmp" "$file" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# Read the prompt from the dedicated file. A file rather than a config key
# because plot-config.sh strips `(...)` as prose, and the prompt legitimately
# contains shell constructs like ${PLOT_BRANCH##*/}.
prompt_file="$repo_root/.plot/worker-prompt.sh"
if [ ! -f "$prompt_file" ]; then
  echo "plot-worker-loop: no prompt file at $prompt_file" >&2
  echo "  Create it with the inner claude -p invocation, e.g.:" >&2
  echo "    claude -p \"You are implementing the branch \$PLOT_BRANCH...\" --session-id \"\$PLOT_SESSION_ID\" --permission-mode bypassPermissions" >&2
  # `--session-id` is shown because this is the one place a person writes the
  # invocation, and it is the only half of the contract Plot cannot fulfil
  # itself. It stays OPTIONAL: without it the worker runs exactly as before and
  # resume reports itself unavailable, which is the honest answer rather than a
  # failure.
  echo "  Passing --session-id lets a correction resume the same conversation;" >&2
  echo "  without it resume is reported unavailable and a fresh worker is started." >&2
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
_monitor_watcher_pid=""
_timed_out=0

# WHICH READING ENDED THE WORKER. Both the floor and the monitor watcher end the
# prompt the same way — a signal into the loop's `wait` — so the flag alone
# cannot say which fired, and an operator reading `.plot-worker.log` needs to
# know: a monitor verdict says the agent stopped, the floor says nobody knows.
# `_ended_by` is set by whichever trap ran, and the message is written from it.
_ended_by=""
_ended_detail=""

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

# ---------------------------------------------------------------------------
# THE MONITOR'S READING — the verdict this loop now ends on
# ---------------------------------------------------------------------------
#
# `plot-worker-monitor.sh` answers the question the bound was guessing at, with
# four conditions that must hold together: the pid is alive, its TRANSCRIPT has
# been silent past the window with no child process burning CPU behind it across
# two consecutive passes, the tree did not change between them, and commits
# already exist on the branch. The loop READS that answer and does
# not re-derive it — a second implementation of one measurement is the drift
# this repo has already paid for, in the classification `plot-worker-state.sh`
# was extracted to hold.
#
# WHERE THE FINDINGS ARE. `plot-dispatch.sh` passes the monitor no
# `PLOT_MONITOR_FILE`, so a dispatched monitor writes to its own derived
# default. This is the SAME derivation, deliberately duplicated at one line
# rather than plumbed through: the wrapper starts the monitor, the loop is
# started BY the wrapper's command, and there is no env var travelling between
# them today. Reading `PLOT_MONITOR_FILE` first means the day the wrapper does
# pass one, this follows it without a second change.
monitor_findings_file() {
  printf '%s' "${PLOT_MONITOR_FILE:-${PLOT_WORKTREE:+$PLOT_WORKTREE/.plot-worker.monitor.worker.jsonl}}"
}

# Does the WorkerMonitor's LATEST finding say `idle`?
#
# THE LAST LINE, NEVER ANY LINE. The monitor publishes only on a CHANGE, and a
# cleared finding is a publish too — so a worktree whose agent stalled and then
# resumed carries `idle` followed by `clear`, both forever, in one file.
# Grepping the file for the word would end every worker that had ever recovered,
# which is worse than the bound it replaces: the bound at least waited an hour.
#
# THE MONITOR IS CHECKED BY NAME. The AgentMonitor writes beside this file under
# the same `.plot-worker.monitor.` prefix and its vocabulary is not this one's —
# it reports what an agent OWES, a Registry-side fact. Taking one of its
# findings as a verdict on the process is exactly the Machine/Registry confusion
# CLAUDE.md's split exists to prevent, so the match is anchored to the
# `"monitor":"WorkerMonitor"` field the monitor stamps into every line.
#
# `idle` AND ONLY `idle`. `gone` means the agent pid names no live process — and
# when that is true the prompt child has already exited, so the loop is past
# `wait` and asking `--next` on its own. Killing on `gone` would be the loop
# racing to kill something already dead, and would end a worker whose agent
# finished cleanly a moment before the monitor's next pass.
#
# GREP RATHER THAN A JSON PARSER. The line is written by `printf` in
# `plot-worker-monitor.sh:publish` with a fixed field order, so the two fields
# are at known positions in a known shape; a `node -e` per poll would fork an
# interpreter every few seconds inside a worker whose whole point is to leave
# the machine alone for the agent.
monitor_says_idle() { # → 0 idle | 1 not idle (or nothing to read)
  local f
  f=$(monitor_findings_file)
  [ -n "$f" ] && [ -s "$f" ] || return 1
  local last
  last=$(grep '"monitor":"WorkerMonitor"' "$f" 2>/dev/null | tail -n 1)
  [ -n "$last" ] || return 1
  case "$last" in (*'"finding":"idle"'*) return 0 ;; esac
  return 1
}

# A WATCHER FIRED. Either the floor's watchdog (SIGALRM) or the monitor watcher
# (SIGUSR1) sent a signal; record which, and end the prompt (and the agent CLI
# it spawned). The flag is what `run_bounded` reads after `wait` returns to tell
# an ending from an honest finish, and `_ended_by` is what the message reads to
# name the reading.
#
# TWO SIGNALS, NOT ONE SHARED FLAG. Both watchers race the same prompt and
# either may win — a monitor that publishes `idle` in the same second the floor
# expires is not a contrived case, it is what a dying monitor's last finding
# looks like. Separate signals mean the trap that ran is the one that answers,
# and no watcher has to inspect another's state to know whether it lost.
_on_alarm() {
  _timed_out=1
  _ended_by='bound'
  _ended_detail="exceeded the ${WORKER_BOUND_SECONDS}s bound"
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
}
trap _on_alarm ALRM

# The WorkerMonitor published `idle`: the agent is alive, has committed, and its
# transcript has been silent past the window with nothing burning CPU behind it,
# across two consecutive passes with the tree unchanged. That is the reading the
# bound was guessing at, and it is a verdict rather than an alarm.
_on_monitor() {
  _timed_out=1
  _ended_by='monitor'
  _ended_detail='the WorkerMonitor reported idle'
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
}
trap _on_monitor USR1

# THE MANIFEST IS REMOVED ON EVERY EXIT PATH. A worker that ends stops
# appearing in the registry the moment it exits — the board's next pulse
# will no longer see its row. The trap fires whether the loop ended normally
# (--next returned no more work), broke on a failed cd or lost claim race,
# or timed out via SIGALRM.
#
# THE SWEEP STAYS. A trap cannot run on SIGKILL, so the reconciliation sweep
# is still the thing that catches a worker killed outright (kill -9). This
# trap answers "I am leaving" — a cheaper, immediate cleanup. Reconciliation
# answers "which entries no longer correspond to anything?" — a periodic
# sweep that handles SIGKILL and orphaned manifests from crashes.
_cleanup_on_exit() {
  # Remove the manifest first — it is the externally visible registration.
  [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ] && rm -f "$PLOT_MANIFEST_FILE"

  # Then clean up the watchdog, the monitor watcher and the prompt child (if any
  # are still running). THE WATCHER IS REAPED ON EVERY PATH the watchdog is, and
  # for the same reason recorded there: a watcher that outlived its worker would
  # be a new leak inside the fix for a leak.
  [ -n "$_watchdog_pid" ] && _kill_tree "$_watchdog_pid"
  [ -n "$_monitor_watcher_pid" ] && _kill_tree "$_monitor_watcher_pid"
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
  _watchdog_pid=""
  _monitor_watcher_pid=""
  _prompt_child=""
}
trap _cleanup_on_exit EXIT

# Run the prompt under BOTH readings. Returns 0 if it finished on its own
# (whatever its own exit status), or 124 — timeout(1)'s convention — if either
# watcher ended it. `_ended_by` says which, and the caller writes the message
# from that.
#
# TWO WATCHERS, ONE MECHANISM. Both are background subshells that signal the
# loop's own PID, both are answered by a trap that sets the flag and kills the
# prompt tree, and the loop merely `wait`s. That shape was chosen for the bound
# after a `wait -n` version was measured returning instantly on macOS's stock
# bash 3.2 — reading every prompt as an honest finish and never firing — and the
# system that lacks `wait -n` is the same one that lacks `timeout(1)`, so the
# monitor watcher reuses it rather than inventing a second answer.
#
# THE MONITOR WATCHER IS ARMED EVEN WHEN THE FLOOR IS NOT. `Worker bound: 0`
# disables the wall-clock kill, which is what a project asked for when it set
# it; it never asked for an unwatchable worker, and a finding is not a clock.
run_bounded() {
  _timed_out=0
  _ended_by=""
  _ended_detail=""

  # shellcheck source=/dev/null
  bash -c '. "$1"' _ "$prompt_file" &
  _prompt_child=$!

  # The floor's watchdog: after the bound, signal the loop's own PID. A compound
  # subshell (`sleep; kill`) rather than `sleep && kill` so a killed sleep still
  # cannot fire, and so `$$` inside it is the loop, not the subshell.
  #
  # SKIPPED ENTIRELY at a non-positive bound, rather than armed with a huge
  # number: an explicitly disabled floor should leave no sleeping process behind
  # to reason about.
  if [ "$WORKER_BOUND_SECONDS" -gt 0 ]; then
    ( sleep "$WORKER_BOUND_SECONDS"; kill -ALRM "$$" 2>/dev/null ) &
    _watchdog_pid=$!
  fi

  # The monitor watcher: poll the findings file and signal on `idle`. It re-reads
  # rather than tailing because a `tail -f` down a pipe is a process to manage on
  # every exit path, and the file it watches is empty in the healthy case — the
  # monitor publishes only on a change.
  #
  # IT EXITS AFTER SIGNALLING. One verdict is all there is to deliver; a watcher
  # that kept polling would re-signal a loop already past its `wait` and into the
  # next slice, killing a prompt on the strength of the PREVIOUS branch's
  # finding. `_watch_loop_pid` is captured before the subshell so `$$` inside it
  # names the loop rather than the subshell, exactly as the watchdog does.
  local _watch_loop_pid=$$
  if [ "$MONITOR_ENDS_WORKER" = "1" ]; then
    (
      while :; do
        sleep "$MONITOR_POLL_SECONDS" || exit 0
        if monitor_says_idle; then
          kill -USR1 "$_watch_loop_pid" 2>/dev/null
          exit 0
        fi
      done
    ) &
    _monitor_watcher_pid=$!
  fi

  # Block on the prompt. If either watcher fires first, its trap kills the prompt
  # and this `wait` returns (interrupted); if the prompt finishes first, `wait`
  # returns normally and both watchers are still going. Either way, read the flag
  # — set only by a trap — to tell which happened.
  wait "$_prompt_child" 2>/dev/null

  # Stop both watchers (a no-op for one that already fired) and reap their sleeps.
  #
  # NO `wait` ON A PID WE JUST SIGKILLED. Both lines used to be
  # `_kill_tree "$p"; wait "$p" 2>/dev/null || true`, and the `wait` on the
  # WATCHDOG is where the loop hung — measured on CI, not inferred: stage
  # markers around each call stopped at "B: waiting on watchdog" and never
  # printed C, D or E (PR #563, run 33393895431).
  #
  # WHY REMOVING IT IS SAFE, INDEPENDENT OF WHY IT BLOCKED. The status neither
  # `wait` collects is read by anything — the return is swallowed by
  # `|| true`, and no branch below consults it. Their only purpose was reaping,
  # which `_kill_tree`'s SIGKILL already did. The EXIT trap
  # (`_cleanup_on_exit`) has always called `_kill_tree` on both pids with NO
  # `wait` at all, so this makes the two paths agree rather than inventing a
  # new one.
  #
  # WHY IT HUNG is still open, and deliberately not guessed at here. The
  # watchdog is `( sleep "$BOUND"; kill -ALRM "$$" )` — the subshell that just
  # fired the signal that brought us here — so the loop was waiting on a
  # process mid-signal-delivery. That is consistent with every occurrence
  # landing on a `bound: 1` fixture, the only case where the watchdog fires
  # while the loop is still inside its own `wait`. It does not reproduce on
  # macOS bash 5.3 in ~60 attempts, so the mechanism is Linux-side and the fix
  # rests on what the line DOES, not on a theory of why it blocks.
  [ -n "$_watchdog_pid" ] && _kill_tree "$_watchdog_pid"
  _kill_tree "$_monitor_watcher_pid"
  _watchdog_pid=""
  _monitor_watcher_pid=""
  _prompt_child=""

  [ "$_timed_out" = 1 ] && return 124
  return 0
}

while true; do
  # Run the worker prompt in the current worktree, watched by both readings.
  # The prompt file is sourced (inside a child) so $PLOT_BRANCH etc. expand at
  # runtime. If either watcher fires the worker EXITS rather than hopping: an
  # agent that stopped has left the worktree in a state nobody measured, and
  # starting a second branch on top of that guess is worse than stopping. That
  # is `a-hung-child-does-not-hold-the-loop`'s 2026-08-25 property, and this
  # slice changed the READING rather than the protection.
  if ! run_bounded; then
    # THE MESSAGE NAMES WHICH READING ENDED IT, because the two mean opposite
    # things about the work in the worktree. A monitor verdict says the agent
    # measurably stopped — alive, committed, no CPU, tree unchanged across two
    # passes — so the worktree holds finished-looking work worth rescuing. The
    # floor says only that time passed, and fires ONLY when the monitor itself
    # went silent, so nobody knows what state the desk is in. An operator
    # reading `.plot-worker.log` triages those differently, and before this
    # slice both printed the same sentence.
    case "$_ended_by" in
      monitor)
        echo "plot-worker-loop: the WorkerMonitor reported idle on ${PLOT_BRANCH:-?} — the agent is alive and has committed but its transcript has been silent past the window with nothing burning CPU behind it, across two passes; ending worker without hopping" >&2
        ;;
      *)
        echo "plot-worker-loop: prompt exceeded the ${WORKER_BOUND_SECONDS}s bound on ${PLOT_BRANCH:-?} — no monitor finding said why; ending worker without hopping" >&2
        ;;
    esac
    exit 124
  fi

  # THE BRANCH FINISHED, so declare it — before `--next` is asked and before any
  # hop moves `$PLOT_BRANCH`. Both orderings matter: a declaration written after
  # the hop would name the branch the worker moved TO, and one written after the
  # loop ends would never exist for any branch but the last.
  seal_declaration "${PLOT_WORKTREE:-$PWD}" "${PLOT_BRANCH:-}"

  # Ask for the next claimable branch of the same plan.
  #
  # `--offline` IS DELIBERATE, AND IT IS A TRADE. Without it, a host that
  # answers `failed` (an unauthenticated CI runner, a rate limit, a token that
  # expired mid-run) makes every unmerged branch read `unknown`, and `--next`
  # does not hand out an `unknown` branch. The hop then finds nothing and a
  # long-running agent stops taking work — silently, which is the worst shape
  # for it to fail in.
  #
  # WHAT IT COSTS: the hop claims on git alone, so it can take a branch whose
  # merge state was never verified against the host. That is the inference this
  # very scan tightened, applied one level down. It is accepted here because
  # `--offline` means *the question was never put* rather than *the answer was
  # refused* — and a claim is re-checked by the push, which is rejected if the
  # ref already exists.
  next_branch=$("$script_dir/plot-fleet-scan.sh" --offline --next "$PLOT_SLUG" 2>/dev/null) || break

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
