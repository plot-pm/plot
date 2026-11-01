# The agent reporter starts a sleep process every 50 ms

> The reporter that the continue and restart controllers start beside every agent polls the agent's pid with a new `sleep` process 20 times per second. The reporter learns that the agent ended without starting a process per poll.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3024
- **Review:** pr
- **Impl:** own branches

## Changelog

- A continued or restarted agent no longer costs one process start per 50 ms for its whole run. The reporter detects the agent's end without a `sleep` per poll, and still writes the exit record and the `WorkerMonitor` line once, after the agent ends.

Board impact: none. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

`packages/fleet/src/shared/continuation.ts:1398` builds the agent's `sh -c` command. Its reporter part is:

    ( trap '' TERM; while kill -0 "$agent" 2>/dev/null; do sleep 0.05; done; ${reporterTail} ) &

- One reporter starts 20 `sleep` processes per second. An agent that runs for the `Worker bound` of 28800 s costs up to 576,000 process starts for this loop alone.
- Measured 2026-11-01 at 22:15: a 10 s `ps` sample found 49 `sleep 0.05` starts under one restarted agent's `sh -c` wrapper (pid 24682). Every continued or restarted agent runs one such loop.
- On the measuring machine every process start costs a `syspolicyd` check. A `syspolicyd` log over 68 s shows checks on 17,435 distinct processes (about 256 per second) at 80 to 85 % CPU. Each process start cost 50 to 300 ms, and fleetd's auto-dispatch held back new agents (`spawn cost 131.0 ms against a clear reading under 10 ms`).
- This loop is one of several sources. The others are the board's request path (#3017, plan `the-board-starts-processes-on-the`) and the fleet scan. This loop is the one whose cost grows with the number of continued agents and with their run time.

## Design

### Approach

The reporter must stay a **sibling** of the agent, never its parent. A parent that `wait`s on the agent is the agent's ppid for as long as it waits, which fails the ppid-1 test the comment block above the command (`continuation.ts:1280` onward) documents. So `wait` on the agent is not available to the reporter, and the fix replaces only the polling step.

Requirements:

1. The reporter learns that the agent ended without starting a process per poll.
2. The reporter still writes the exit record and the `WorkerMonitor` line once, after the agent ends. The race fixes in d4bc9b8fc, ad509c157 and 6b0ac7188 stay in force: the agent self-reports its exit in its own subshell, and the reporter fills in `137` only when no exit file exists after a `SIGKILL`.
3. The reporter keeps `trap '' TERM`, so a group `SIGTERM` from `--stop` does not end it before it writes the finding.
4. A test counts the processes the reporter starts while the agent runs, and fails when that count grows with the agent's run time.

Candidate mechanisms (the Open Questions decide):

- **Bounded builtin poll.** `kill -0` is a shell builtin, so only `sleep` starts a process. A poll at an interval of at least one second that waits with a builtin removes the process starts. The cost is up to one interval of delay before the finding is written.
- **Held descriptor.** The agent subshell holds the write end of a pipe or FIFO; the reporter blocks on a read from it. When the agent ends by any signal, including `SIGKILL`, the kernel closes the descriptor and the read returns EOF. This needs no polling and no interval.

### Open Questions

- [ ] Does a blocking read on a descriptor held only by the agent subshell return EOF on `SIGKILL` of that subshell on both macOS and Linux, given that the agent's own child (`( ${cmd} )`) inherits the descriptor and can outlive the subshell? The child must not hold the write end.
- [ ] If the bounded poll is chosen: which builtin waits without a process start in `sh` on macOS (`/bin/sh` is bash 3.2 in POSIX mode) and on Linux (`dash`)? `read -t` is not POSIX.
- [ ] How does the test count processes? Candidates: a `PATH` shim named `sleep` that logs each start, and a process-table sample of the wrapper's children. The count must be independent of machine load.

## Slices

### Reporter wait

- `feature/the-agent-reporter-starts-a-sleep` — the reporter detects the agent's end without a process start per poll, and a test fails when the reporter's process count grows with the agent's run time <!-- builds: the reporter's process-free wait on the agent in continuation.ts -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/3024
- Files: `packages/fleet/src/shared/continuation.ts` (the `sh -c` command near line 1398 and `reporterTail`).
- Related: `the-board-starts-processes-on-the` (#3017) covers the board's request path, a different source of the same load.
