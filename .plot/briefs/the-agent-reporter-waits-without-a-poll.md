## Implementation brief — the-agent-reporter-starts-a-sleep (slice 1: Reporter wait)

- **Plan (canonical):** docs/plans/2026-11-01-the-agent-reporter-starts-a-sleep.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3025 merged
- **Branch:** `bug/the-agent-reporter-waits-without-a-poll` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` status, per repo convention (Review: pr)

Slice 2 (`bug/the-agent-monitor-reads-its-pid-with-a-builtin`) shares no file with this slice. Neither waits on the other.

### What to build

The reporter beside every continued or restarted agent runs `while kill -0 "$agent" 2>/dev/null; do sleep 0.05; done` (`packages/fleet/src/shared/continuation.ts`, the `sh -c` string at about :1391-1399). Measured 2026-11-01 22:15: 49 `sleep 0.05` starts in a 10 s `ps` sample under one restarted agent (about 5 per second under load, up to 20 per second idle). Each process start costs a `syspolicyd` check on the measuring machine, and fleetd's auto-dispatch held back new agents (`spawn cost 131.0 ms against a clear reading under 10 ms`).

Replace the poll with a wait on a FIFO descriptor that only the agent subshell holds. The reporter reads until EOF, which arrives when the agent dies, including by `SIGKILL`. Then it runs `reporterTail` once. The plan is canonical; this brief orients.

### Settled decisions — do not re-derive

- **The change stays inside the existing `sh -c` string.** No new shipped script (it grows shipped shell, which `scripts/check-shell-lines.sh` refuses, and adds a script crossing CI ratchets). No node reporter (keeps tens of MB per agent for the whole run and still polls `process.kill(pid, 0)`, because node cannot `wait` on a non-child). No new spawn site (`spawnFn(` is invisible to CI's spawn ratchet).
- **The reporter stays a sibling of the agent, never its parent.** The ppid-1 shape (`continuation.ts:1264` onward; `continue-route.test.ts:2730`, `:2801`; ad509c157) needs it: a waited-on process cannot have ppid 1. `start_worker`'s `wait "$agent"` is the dispatch path's different contract and is out of scope.
- **No builtin bounded wait exists.** `dash` has no `read -t` and no builtin `sleep`; bash 3.2 has no `sleep` builtin. A 1 s poll still grows with run time. The bounded poll survives only as the fallback.
- **Descriptor discipline, each rule proven by a juror probe on macOS `/bin/sh` and Linux `dash`:**
    - FIFO `.plot-worker.reporter.fifo` in the worktree, beside `.plot-worker.exit`. Add a `.gitignore` line beside `.gitignore:66`. The controller removes a stale FIFO before the spawn, as it removes `.plot-worker.wrapper.pid`.
    - The outer shell runs `mkfifo`, then opens the FIFO read-write on one descriptor (`exec 3<>"$FIFO"`) BEFORE it forks the agent or the reporter. If each side opens by path, an agent that ends first leaves the reporter blocked in `open` forever at ppid 1. The open must not be fatal: on a failed `mkfifo` or open, the agent still starts exactly once and the reporter takes the fallback.
    - The agent runs `( ${cmd} ) 3>&-`. Without the close, a `SIGKILL` finding waits for the command's last descendant (4 s and 6 s measured; unbounded with a daemon).
    - The reporter reads in a redirected compound command: `{ exec 3>&-; while read -r _; do :; done; } < "$FIFO" || fallback`. Never `exec 4<"$FIFO"`: a failed open of that kind ends the shell under both shells before it writes `WorkerMonitor` or `137`. If the reporter keeps the write end it never sees EOF, never writes, and survives `--stop` despite `trap '' TERM`.
    - The outer shell closes its write end after forking both sides. After the read ends, the reporter runs `reporterTail` and removes the FIFO by exact path.
    - Fallback is today's `kill -0` loop at a 1 s interval. It writes `137` and exactly one finding.
- **`reporterTail` keeps its text.** It and `start_worker`'s tail are a declared duplicate held by `monitors-attached` and `monitors-end`; add no third copy.
- **Move the `sh -c` string into one exported arrow function** in `continuation.ts` so a unit test can spawn it alone; `continueOnDesk` calls it. Rewrite the comment block at `:1275-1374` ("It polls `kill -0`", "the one case where polling is unavoidable") to describe the held descriptor. TSDoc states behaviour, not history.
- **Carried rules:** a `SIGKILL` to the recorded pid still leaves `( cmd )` running, as today. `.plot-worker.pid` keeps its writer and content (the AgentMonitor reads it). `plot_watched_desk` is untouched (held to `watchedDesk` by `desk-manifest.corpus.test.ts`). Read exit codes, not emptiness.

### Done when

The plan's `## Done when` table is the specification: 13 slice 1 rows in `packages/fleet/test/unit/continuation.test.ts`. Assertions that exist because a naive implementation would pass without them:

- **Count from a `PATH` shim log of every external** (`sleep`, `cat`, `tr`, `date`, `kill`, `mkfifo`, `rm`, `ps`, `dirname`), never a process-table sample (a sample saw 12 starts at 1 s and 37 at 3 s against a nominal 20 and 60) and never a shim for `sleep` alone (it passes a loop that moves to another command). Inject through `input.spawn` as a wrapper that sets `PATH` and the log path in `env`, not through `process.env`. The agent blocks on a FIFO the test holds and calls no shimmed name.
- **Zero shim lines before release, and equal tail lines after a 1 s and a 3 s agent.** Catches a poll that merely slowed down.
- **No `sleep` and no absolute path between the reporter's open and its tail** (structural arm on the string).
- **Exit file already holds the code when `kill -0` on the recorded pid first fails** (d4bc9b8fc), using a shim that delays the reporter's first command.
- **`SIGKILL` and group `SIGTERM` rows run 20 times each in one test**, so a race shows by repetition. `SIGKILL` asserts the finding while the command's pid is alive; group `SIGTERM` gives `143` and the reporter survives (6b0ac7188).
- **Descendant, instant-exit, FIFO-can't-be-made (a directory at the path), and `PLOT_SCRIPT_DIR=/nonexistent` rows**, plus "nothing left behind": no reporter in the group and no FIFO on disk after every row.
- **Mutation checks:** remove `3>&-` and the `SIGKILL` row fails; keep the write end in the reporter and the reporter row fails at its bound; restore `sleep 0.05` and the first two rows fail. Run them, and commit before mutating.
- No row asserts elapsed time, only a bound. Existing bounds stay: `monitorLines` 10 s, 5 s for the exit file after `SIGKILL` (`test/e2e/monitors-end.test.mjs:416`) and the `WorkerMonitor` line (`monitors-attached.test.mjs:349`). Every test waits on each process it started by its own pid, kills a blocked reporter in `afterEach`, and removes its FIFO and worktree by the exact name `mkdtempSync` returned.
- `exec 3<>fifo` is not POSIX: run the rows on macOS `/bin/sh` and on Linux `dash` (a `debian:stable-slim` container reproduces CI's runner). Record the local macOS run in the PR.

Plus: a changeset for package `plot` (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; CI runs the `CI suites`, and a failure there returns as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is not at stake here. Use Node 26.13.0 (`env -u PLOT_REPO_ROOT -u PLOT_UNATTENDED`).

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/continuation.ts`, `packages/fleet/test/unit/continuation.test.ts`, `.gitignore` and one changeset. The in-flight sibling, `bug/the-agent-monitor-reads-its-pid-with-a-builtin`, owns `skills/plot/scripts/plot-monitor-subject.sh` and `test/reconcile/agentmonitor.test.mjs`. Do not touch those. The board's request path (#3017) and `host_slot_take` are separate plans.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
