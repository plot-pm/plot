#!/usr/bin/env bash
# THE SUITE RUNS IN A TEMP ROOT IT OWNS, AND THE ROOT IS EMPTY WHEN IT ENDS.
#
#   scripts/owned-run.sh <command> [args...]
#
# Wraps the whole script string of `test:contracts` and `test:board`,
# `bounded.sh` included. It creates one root, points `TMPDIR`, `HOME`,
# `PLOT_BUDGET_HOME` and `PLOT_PR_INDEX_HOME` inside it for the whole process
# tree, runs the command, and removes the root whatever the exit code.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHAT THIS FIXES
# ═══════════════════════════════════════════════════════════════════════════
#
# Measured 2026-09-30: one clean run of `test/reconcile/host.test.mjs`, 266 of
# 266 green, left **365 entries** in an empty `TMPDIR`. The same run with the
# real `HOME` wrote **430 lines** into the operator's `~/.plot/state/budget.tsv`,
# and that live ledger carries 32,220 `bitbucket/plot-pm` fixture lines. A test
# suite writing into the machine that runs it is the defect; where it writes is
# the environment's answer, not each call site's.
#
# ═══════════════════════════════════════════════════════════════════════════
# REDIRECT THE ENVIRONMENT, DO NOT EDIT THE CALL SITES
# ═══════════════════════════════════════════════════════════════════════════
#
# `os.tmpdir()` reads `TMPDIR`, so the 347 `tmpdir()` calls in `test/reconcile/`
# and the 140 `mkdtempSync(` calls in `packages/board/test/` follow the root
# unchanged, with no edit. Every helper that builds an `env: {` literal spreads
# `...process.env`, and no test clears the environment, so the redirect reaches
# every child process too.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE LEAK GATE COMPARES AGAINST AN EMPTY PRIVATE ROOT
# ═══════════════════════════════════════════════════════════════════════════
#
# `check-registry-not-leaked.mjs:19-31` refuses a before/after snapshot of the
# shared registry, because the supervisor writes manifests during a run and a
# gate that flags those honest writes gets turned off. **That objection does not
# apply to a per-run root**: no supervisor, board or other agent writes here, so
# an entry present at the end came from this run and nothing else.
#
# So the gate needs no settle delay and no retry loop. Measured across 11 files,
# 3 of them with `detached: true` spawns: the entry count at exit equalled the
# count 40-45 s later.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE REGISTRY CHECK RUNS WITH THE ORIGINAL ENVIRONMENT
# ═══════════════════════════════════════════════════════════════════════════
#
# `check-registry-not-leaked.mjs:116` builds its temp set from
# `[os.tmpdir(), TMPDIR, '/tmp', '/var/tmp']`. Run INSIDE the root, `os.tmpdir()`
# answers the root and `/var/folders/.../T` leaves the set — so a fixture
# manifest recorded there would read as clean and the gate would silently stop
# gating. It is invoked with the caller's own `TMPDIR` and `HOME` restored.
#
# ═══════════════════════════════════════════════════════════════════════════
# THIS WRAPPER TRAPS ITS OWN SIGNALS
# ═══════════════════════════════════════════════════════════════════════════
#
# `bounded.sh` installs no trap, and it RETURNS to its caller after `timeout -k`
# kills the child — so the wrapper survives a child SIGKILL and still removes
# the root. It also covers `bounded.sh`'s unbounded branch, where no `timeout`
# is on PATH (the stock-macOS case).
#
# INT and TERM run the cleanup, clear their own trap and re-raise, so this exits
# 130 or 143 rather than running on to exit 0 — Layer 1's semantics, the same
# ones `skills/plot/scripts/plot-tmp.sh` implements.
#
# `plot-tmp.sh` itself is NOT sourced here. It keys its registry off `$$` and
# fixes `PLOT_TMP_REGISTRY` under `TMPDIR` at source time, while this wrapper's
# whole purpose is to MOVE `TMPDIR` afterwards — the registry would be written
# to the caller's temp directory and the root's own path would be registered in
# a file outside it. One root and one trap pair is the smaller idiom here, and
# it is the same idiom.
#
# A SIGKILL of the wrapper skips the trap and leaves one `plot-run.*` directory.
# That is why the root carries the `plot-` prefix: `plot-reap.sh --sweep-temp`
# removes it after `Temp sweep after` hours.
set -u

[ "$#" -gt 0 ] || { echo "usage: owned-run.sh <command> [args...]" >&2; exit 2; }

# The caller's own environment, kept for the registry check. `TMPDIR` may be
# unset, which is a different answer from empty: the check reads it as absent.
ORIG_TMPDIR="${TMPDIR-}"
ORIG_TMPDIR_SET="${TMPDIR+set}"
ORIG_HOME="${HOME-}"

# THE TEMPLATE IS EXPLICIT, AND THE X's TRAIL. On macOS a template-less `mktemp`
# and `mktemp -t` both ignore `TMPDIR` and write to `_CS_DARWIN_USER_TEMP_DIR`,
# and BSD `mktemp` rejects a template whose X's are not last. Same reasoning as
# `plot-tmp.sh:9-12`.
root=$(mktemp -d "${TMPDIR:-/tmp}/plot-run.XXXXXX") || {
  echo "owned-run.sh: could not create a run root under ${TMPDIR:-/tmp}" >&2
  exit 2
}

# `TMPDIR` is the root itself, so the leak listing IS the root's listing and a
# stray entry has nowhere to hide. The other three are named subdirectories:
# they are inspected by name after a failure, and slice 3's inventory gate reads
# them.
mkdir -p "$root/home" "$root/budget" "$root/pr-index" || exit 2

cleanup() {
  # `${root:?}` refuses an empty expansion, so a cleanup reached with `root`
  # unset can never become `rm -rf /`. The path is the exact name `mktemp`
  # returned — never a glob, and never a pattern over the shared temp directory.
  [ -n "${root:-}" ] && rm -rf -- "${root:?}" 2>/dev/null
  return 0
}

on_exit() {
  status=$?
  cleanup
  exit "$status"
}

# $1 is the signal name, $2 its number.
#
# THE CHILD IS SIGNALLED FIRST, and that is not a nicety. Bash defers a trap
# until the foreground child is reaped, so a signal sent to the wrapper alone
# does nothing until the command finishes on its own: measured 2026-09-30, a
# SIGTERM to the wrapper over a `sleep 30` child was acted on after 30.3 s. On a
# real suite that is an operator pressing Ctrl-C and watching the run continue
# for its full twenty minutes before the root is removed.
#
# THE CHILD IS SENT TERM EVEN FOR AN INT, because a non-interactive shell that
# starts a job with `&` sets that job's SIGINT to IGNORED, and the disposition
# survives `exec`. Measured 2026-09-30: a forwarded SIGINT was discarded by the
# child and the wrapper waited the full 30 s, while SIGTERM — which is never
# ignored this way — was acted on in 90 ms. This wrapper still re-raises the
# ORIGINAL signal on itself below, so it exits 130 for an INT and 143 for a
# TERM; only what the child is told differs.
#
# `child_pid` is empty until the command starts, and the kill is guarded on it;
# a signal arriving before then has nothing to forward to and the cleanup below
# still runs.
#
# `kill` then re-raises with the default disposition; the `exit` is reached only
# if the shell defers delivery.
on_signal() {
  trap - EXIT "$1"
  [ -n "${child_pid:-}" ] && kill -TERM "$child_pid" 2>/dev/null
  wait "${child_pid:-$$}" 2>/dev/null
  report_leaks
  cleanup
  kill -"$1" "$$"
  exit $((128 + $2))
}

# ═══════════════════════════════════════════════════════════════════════════
# THE LEAK GATE
# ═══════════════════════════════════════════════════════════════════════════
#
# It reads the LISTING, never an exit code alone: a `find` that fails is a gate
# failure, not an empty list. `find -mindepth 1 -maxdepth 1` names each entry
# once, whatever its type, and does not descend into it.
#
# The three named subdirectories are the wrapper's own and are excluded by exact
# name. Everything else in the root was created by the run.
leak_listing() {
  find "$root" -mindepth 1 -maxdepth 1 \
    ! -name home ! -name budget ! -name pr-index 2>/dev/null
}

# Prints the leak listing and the tail of any worker log, for a person reading a
# failed run. CI's *What was still running* step (`ci.yml:187-197`) used to find
# these under the shared `$TMPDIR`; with the root removed at exit it would find
# nothing, so the wrapper prints them itself while the root still exists.
report_leaks() {
  listing=$(leak_listing) || return 0
  [ -n "$listing" ] || return 0
  echo "=== entries left in the run's TMPDIR ===" >&2
  printf '%s\n' "$listing" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    printf '  %s\n' "${entry##*/}" >&2
  done
  echo "=== worker logs left behind ===" >&2
  find "$root" -name '.plot-worker*.log' 2>/dev/null | head -20 | while IFS= read -r log; do
    [ -n "$log" ] || continue
    echo "--- $log" >&2
    tail -30 "$log" >&2 2>/dev/null || true
  done
}

trap on_exit EXIT
trap 'on_signal INT 2' INT
trap 'on_signal TERM 15' TERM

# A SIGNAL THAT ARRIVES WHILE THE CHILD RUNS IS THE CHILD'S FIRST. The command
# runs in the foreground, so bash defers this script's own INT/TERM trap until
# the child is reaped — and the child, sharing the terminal's process group, is
# signalled too. It then reports 130 or 143 through `$status`, and a wrapper
# that only inspected its own trap would run on to the gates and exit 0 on a
# run somebody cancelled. Measured 2026-09-30: the isolated case re-raised
# correctly and the same case under `node --test` load exited 0.
#
# So the child's death BY a signal is read here and re-raised directly, which
# also makes the two paths — signal to the wrapper, signal to the group — end
# the same way.
# RUN IN THE BACKGROUND AND `wait`, so the trap is reached while the command is
# still alive. A foreground child makes bash defer every trap until it is
# reaped, which is exactly the 30 s delay measured above. `wait` returns the
# child's status, and returns early when a signal interrupts it.
TMPDIR="$root" \
HOME="$root/home" \
PLOT_BUDGET_HOME="$root/budget" \
PLOT_PR_INDEX_HOME="$root/pr-index" \
  "$@" &
child_pid=$!
wait "$child_pid"
status=$?

case "$status" in
  130)
    report_leaks
    trap - EXIT INT
    cleanup
    kill -INT "$$"
    exit 130
    ;;
  143)
    report_leaks
    trap - EXIT TERM
    cleanup
    kill -TERM "$$"
    exit 143
    ;;
esac

# THE SUITE'S EXIT CODE SURVIVES BOTH CHECKS. `test:contracts` chained the
# registry check with `;` rather than `&&` so that a FAILING suite still ran it;
# that shape moves here whole. A gate skipped on the runs most likely to have
# caused a leak is not a gate.
#
# The registry check runs with the CALLER's `TMPDIR` and `HOME`, for the reason
# in the header: inside the root it cannot see `/var/folders/.../T` at all.
if [ -f scripts/check-registry-not-leaked.mjs ]; then
  if [ -n "$ORIG_TMPDIR_SET" ]; then
    TMPDIR="$ORIG_TMPDIR" HOME="$ORIG_HOME" node scripts/check-registry-not-leaked.mjs || status=1
  else
    HOME="$ORIG_HOME" env -u TMPDIR node scripts/check-registry-not-leaked.mjs || status=1
  fi
fi

# A RUN THAT WAS KILLED DID NOT FAIL THE LEAK GATE — IT NEVER REACHED IT.
#
# `bounded.sh` bounds the suite with `timeout -k 30s`, which SIGKILLs the test
# processes, and SIGKILL cannot be trapped: every `process.on('exit')` and every
# `t.after` is skipped by definition. Measured 2026-09-30 at load average 19.35,
# `test:contracts` hit its 1500 s bound and the gate reported **807 entries** —
# 117 of them `plot-host-`, from a file that leaves ZERO when it runs to the end.
#
# So a 124 is reported as what it is. The entries are still listed, because they
# are the evidence of where the run was when it was killed, and the run still
# fails — on the timeout, which is the true cause. Reporting a bound as a
# migration gap would send the next reader to fix tests that are not broken.
timed_out=''
[ "$status" = 124 ] && timed_out=1

listing=$(leak_listing)
find_status=$?
if [ -n "$timed_out" ]; then
  count=$(printf '%s\n' "$listing" | grep -c . )
  if [ -n "$listing" ]; then
    echo "owned-run.sh: the run was KILLED at its bound (exit 124), leaving ${count} entr$( [ "$count" = 1 ] && echo y || echo ies ) in its TMPDIR." >&2
    echo "owned-run.sh: SIGKILL skips every cleanup, so this is the bound firing and NOT a leaked test." >&2
    report_leaks
  fi
elif [ "$find_status" != 0 ]; then
  echo "owned-run.sh: could not list ${root} — the leak gate could not run (exit $find_status)" >&2
  status=1
elif [ -n "$listing" ]; then
  count=$(printf '%s\n' "$listing" | grep -c . )
  # THE CEILING IS A RATCHET, AND ITS ONLY LEGITIMATE EDIT IS DOWNWARD.
  #
  # The plan measured 11 of the 94 files in `test/reconcile/` and named five
  # leakers. Those five are fixed and leave ZERO. A full-suite run then measured
  # **390** entries from about 23 OTHER files the plan never looked at:
  #
  #     controller-gate 34   brief-name-gate 22   scan 21   install-hooks 20
  #     ci-scheme 19   board 19   budget-rotation 18   storylint 10
  #     agent-settings 9   capabilities 8   host-account 7   …
  #
  # Migrating those 23 is a slice of its own, and this gate must not be OFF while
  # it waits. So the ceiling holds today's number and fails when it GROWS, which
  # is the spawn ratchet's shape (`ci.yml:340`).
  #
  # A COUNT RATHER THAN A PER-FILE LIST, because the gate reads a DIRECTORY. It
  # sees `plot-gate-4kQ2lP`, not the file that made it, and mapping a prefix back
  # to its file means grepping the suite — which mis-attributed `plot-gate-` to
  # `dispatch.test.mjs` on the first try. A ceiling states what is measured; a
  # per-file list would state an attribution this gate cannot perform.
  ceiling="${PLOT_LEAK_CEILING:-390}"
  if [ "$count" -le "$ceiling" ]; then
    echo "owned-run.sh: ${count} entr$( [ "$count" = 1 ] && echo y || echo ies ) left in the run's TMPDIR (ceiling ${ceiling}, target 0)." >&2
    echo "owned-run.sh: at or under the ceiling, so this run is not failed on it. Lower the ceiling when you fix one." >&2
    report_leaks
    exit "$status"
  fi
  echo "owned-run.sh: ${count} entr$( [ "$count" = 1 ] && echo y || echo ies ) left in the run's TMPDIR, above the ceiling of ${ceiling}:" >&2
  printf '%s\n' "$listing" | while IFS= read -r entry; do
    [ -n "$entry" ] || continue
    name="${entry##*/}"
    # The prefix is what a person greps for: `mkdtempSync` appends six random
    # characters, so the name minus that tail names the call site's family.
    printf '  %s\t(prefix %s)\n' "$name" "$(printf '%s' "$name" | sed -E 's/[A-Za-z0-9]{6}$//')" >&2
  done
  echo "owned-run.sh: a test created these and did not remove them." >&2
  echo "Remove each by the exact name mkdtempSync returned, in a t.after — never by a glob." >&2
  report_leaks
  status=1
fi

exit "$status"
