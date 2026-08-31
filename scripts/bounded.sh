#!/usr/bin/env bash
# Run a command under a wall-clock bound, so a hung suite fails instead of
# hanging forever.
#
#   scripts/bounded.sh <seconds> <command> [args...]
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY A LOCAL BOUND, WHEN CI ALREADY HAS ONE
# ═══════════════════════════════════════════════════════════════════════════
#
# Every CI job in `.github/workflows/ci.yml` carries `timeout-minutes`, so a
# hung run there is killed at 12-25 minutes and reported as a failure. **A
# local run has no outer bound at all**, and that is where the damage happens:
#
# Measured 2026-08-31 — two `vitest` processes asleep at **0% CPU for 33 and 47
# minutes**, two build shells beside them, and an orphaned `board-server.mjs`
# holding 135 MB. Load average 6.03 on a machine that should have been idle;
# the operator's own board was answering `/api/fleet` in 8-17 s and eventually
# died. Every one of them came from an agent's `pnpm test:board` that stopped
# making progress and was never killed, because nothing was watching.
#
# `--test-timeout` and vitest's `testTimeout` bound a TEST. Neither bounds a
# RUN: a suite that hangs between cases, in a `beforeAll`, or during teardown
# passes every per-test limit and never returns.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT SAYS WHEN IT CANNOT BOUND, RATHER THAN PRETENDING
# ═══════════════════════════════════════════════════════════════════════════
#
# `timeout(1)` is GNU coreutils and is NOT on a stock macOS; here it exists only
# through Homebrew, as `timeout` and `gtimeout`. This repo already asserts that
# the worker bound still fires with both ABSENT from PATH
# (`test/reconcile/...`), so nothing may depend on them being installed.
#
# When neither is present this runs the command unbounded and **says so on
# stderr**. A wrapper that silently ran unbounded would be a rule wearing a
# gate's clothes: the operator would believe they were protected on exactly the
# machines where they are not.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE EXIT CODE DISTINGUISHES A TIMEOUT FROM A FAILURE
# ═══════════════════════════════════════════════════════════════════════════
#
# `timeout` exits **124** when it fires — the same code Plot's own `Worker
# bound` produces, and for the same reason. A caller that reads 124 knows the
# command did not finish, which is different information from "the tests
# failed", and the message says which.
set -u

bound="${1:-}"
shift 2>/dev/null || true

case "$bound" in
  '' | *[!0-9]*)
    echo "usage: bounded.sh <seconds> <command> [args...]" >&2
    exit 2
    ;;
esac

[ "$#" -gt 0 ] || { echo "bounded.sh: no command given" >&2; exit 2; }

# `timeout` first, then GNU's prefixed name. Both are the same program; which
# one exists depends on how coreutils was installed.
runner=""
for candidate in timeout gtimeout; do
  if command -v "$candidate" >/dev/null 2>&1; then runner="$candidate"; break; fi
done

if [ -z "$runner" ]; then
  echo "bounded.sh: no timeout(1) on PATH — running UNBOUNDED (install coreutils to bound it)" >&2
  "$@"
  exit $?
fi

# `-k` sends SIGKILL 30s after the SIGTERM, for a child that ignores the first
# signal. A hung node process usually takes SIGTERM; one wedged in a syscall
# does not, and leaving it alive would defeat the whole point.
"$runner" -k 30s "$bound" "$@"
status=$?

if [ "$status" = 124 ]; then
  echo "bounded.sh: TIMED OUT after ${bound}s — the run did not finish (exit 124)" >&2
  echo "bounded.sh: check for leftover processes: ps -eo pid,etime,args | grep -E 'vitest|board-server'" >&2
fi

exit "$status"
