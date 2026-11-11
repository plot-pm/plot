# The desk monitors nap and probe liveness without a process

> `plot_monitor_wait` naps with `read -t` on a held FIFO instead of an external `sleep 1`, and `processesShell.isAlive` asks `process.kill(pid, 0)` instead of starting `bash -c "kill -0 <pid>"`.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** nothing-runs
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3238 merged
- **Delivered:** 2026-11-08
- **Released:** 2026-11-11, v2.32.0

## Changelog

- The AgentMonitor beside every agent no longer starts a `sleep` process each second; it waits with a shell builtin. fleetd and the board check whether a recorded pid is alive with a system call instead of a `bash` process.

Board impact: none on the plan format, the template or `docs/plans`. `plot-monitor-subject.sh` is a helper script; its contract (`starting`, `alive`, `gone`) does not change.

## Motivation

On 2026-11-05 a 20-second census of the plot repository's board, fleetd and desks counted about 1,800 new processes, 315 of them `sleep`: the largest single item (story, Why Now and Phase 6). Each new image costs a `syspolicyd` check on macOS, which ran at about 80 % CPU that day.

The `sleep` comes from `plot_monitor_wait` (`skills/plot/scripts/plot-monitor-subject.sh:193-203`). It naps `sleep 1` per second for the AgentMonitor's whole life (`plot-agent-monitor.sh:565`), one per agent. `plot_monitor_subject` (`:102-154`) already uses only builtins (`read`, `kill -0`, `printf`) since `the-agent-reporter-starts-a-sleep` (#3024), so the `sleep` is the one external start left in the nap.

That plan kept the `sleep 1`: "No builtin wait with a bound exists in `dash` or bash 3.2". The claim holds for `dash` and for a `sleep` builtin, but `plot-agent-monitor.sh` runs under `#!/usr/bin/env bash`, and bash 3.2's `read -t` is a bounded builtin wait. Measured 2026-11-08 with macOS `/bin/bash` 3.2.57: after `mkfifo`, `exec 9<>"$fifo"` and removal of the FIFO path, three `read -t 1 -u 9 _` calls took 3 s, each returned 1, and started no process.

The second item runs under fleetd and the board. `processesShell.isAlive` (`packages/domain/src/adapters/processes/processes-shell.ts:158-161`) starts `bash -c "kill -0 <pid>"` per question. fleetd asks it per desk per pass (`packages/fleet/src/server/entry/registryd-main.ts:584`, `:995`), and the board's reaper and the worker loop ask it too (`packages/board/src/server/entry/reap.ts:471`, `packages/fleet/src/server/entry/worker-loop.ts:1120`, `:1266`). `processProbeSystem` (`packages/domain/src/adapters/process-probe/process-probe-system.ts:8-18`) already answers the same question with `process.kill(pid, 0)` and no process.

## Design

This plan depends on `process-census-gate`. Slice *Builtin nap* turns its **P1** row (an AgentMonitor over one live, idle desk starts 0 `sleep` per minute) into a required pass. Slice *Liveness syscall* turns its **P2** row (an idle fleetd pass over a desk with a live pid file starts 0 `bash -c kill -0 …`) into a required pass.

### Approach

**Slice 1: the nap waits on a held FIFO.**

- On its first call, `plot_monitor_wait` makes a FIFO beside the pid file (`${pid_file%/*}/.plot-worker.monitor.nap`), opens it read-write on a fixed descriptor (`exec 9<>"$fifo"`), and removes the path. The descriptor stays open for the monitor's life, and no process writes to it.
- `sleep "$nap"` becomes `read -t "$nap" -u 9 _`. The nap is a whole number of seconds already (`remaining` is an integer and `nap` is 1 or `remaining`), which bash 3.2's `read -t` requires. bash 3.2 returns 1 on a timeout and bash 4 or later returns a status above 128; the loop ignores the status of the wait.
- A failed `mkfifo` or open is not fatal: the function falls back to `sleep "$nap"`, as today, and the monitor's answers do not change. The fallback costs one `sleep` per second and runs only where the FIFO cannot be made.
- The per-monitor cost becomes two starts for its life (`mkfifo`, `rm`) instead of one per second. With 6 agents over the 28,800 s `Worker bound`, that is 12 starts instead of up to 172,800.
- `.gitignore` gets `.plot-worker.monitor.nap` beside `:67` (`.plot-worker.reporter.fifo`). `scripts/check-desk-markers.sh` and `scripts/check-temp-paths.sh` pass: the FIFO lives in the desk, not under a temp directory.
- `scripts/check-shell-lines.sh pr` must read zero or fewer. The slice removes as many counted lines from shipped shell as it adds, and never joins lines to pass.
- `scripts/check-bash32-syntax.sh` passes: no `{fd}` redirection, no `read -t` fraction.

**Slice 2: `isAlive` asks the kernel.**

- `processesShell.isAlive` calls `process.kill(pid, 0)` through the `signalZero` mapping that `process-probe-system.ts:8-18` already holds: `ESRCH` → `false`, `EPERM` → `true`, any other error → an unanswered result. The mapping moves into one shared arrow function in `packages/domain/src/adapters/` that both adapters import, so the two answers cannot drift.
- A non-integer or non-positive pid answers `false` without a call, as `processProbeSystem.alive` does.
- **One answer changes.** bash's `kill -0` on a pid owned by another user exits 1 ("Operation not permitted"), so `isAlive` answers `false` for it today; `process.kill` throws `EPERM`, which the mapping answers `true`. Measured 2026-11-08 on macOS: `kill -0 1` exits 1, `process.kill(1, 0)` throws `EPERM`. `true` is the safe direction for every caller: fleetd reads an unanswerable question as alive (`registryd-main.ts:584-588`, `:995-1000`) and withholds work, and the reaper withholds a reap. The slice adds a row for it.
- The change stays inside `packages/domain/src/adapters/`, so the CI step *One place reaches a process* counts one `spawn` site fewer and no new one.

**Order.** The slices share no file. Each is its own wave by the `### heading` rule, so slice 2 waits for slice 1's merge; that order has no technical reason.

### Open Questions

- [ ] The comment at `plot-monitor-subject.sh:95-98` says a pid we do not own "answers EPERM rather than ESRCH, which `kill -0` still reports as success". The probe above shows bash's `kill -0` exits 1 on `EPERM`. Slice 1 corrects the comment; a person confirms that no caller of `plot_monitor_subject` relies on `alive` for a foreign pid.
- [ ] Does the CI shell (`ubuntu-latest`) run `plot-agent-monitor.sh` under bash 5? The rows run on Linux CI and on the `macos-shell-contract` job (`.github/workflows/ci.yml:413`), which covers bash 3.2.

## Done when

| Claim | Check | Slice |
|---|---|---|
| An idle AgentMonitor starts no `sleep` | census P1 is `it` and reads 0 per minute; `test/reconcile/agentmonitor.test.mjs` shim row: 0 `sleep` lines over 5 s against a live pid (on `origin/main`: 5) | Builtin nap |
| The monitor still leaves within one nap | a row ends the subject and asserts `plot_monitor_wait` returns 1 within 2 s | Builtin nap |
| A failed FIFO falls back | a directory at the FIFO path: the wait still naps with `sleep`, and the answers do not change | Builtin nap |
| bash 3.2 runs it | the rows pass in the `macos-shell-contract` job | Builtin nap |
| The shipped shell does not grow | `scripts/check-shell-lines.sh pr` passes | Builtin nap |
| `isAlive` starts no process | census P2 is `it` and reads 0 per pass; a unit row with a spawn spy records no call | Liveness syscall |
| The answers hold | unit rows: own live pid → `true`; a reaped pid → `false`; pid 1 as non-root (`EPERM`) → `true`; `0` and `-1` → `false` | Liveness syscall |
| The two adapters share one mapping | `processesShell.isAlive` and `processProbeSystem.alive` import one function | Liveness syscall |

## Slices

### Builtin nap

- `bug/monitor-nap-builtin-wait` — `skills/plot/scripts/plot-monitor-subject.sh`: the FIFO nap with the `sleep` fallback and the corrected `EPERM` comment; `.gitignore`; rows in `test/reconcile/agentmonitor.test.mjs`; census P1 flipped to `it`; a changeset for `plot` <!-- builds: a process-free nap in plot_monitor_wait --> → #3259

### Liveness syscall

- `bug/is-alive-without-a-process` — `packages/domain/src/adapters/processes/processes-shell.ts`: `isAlive` through a shared `signalZero` arrow function also used by `process-probe-system.ts`; unit rows; census P2 flipped to `it`; a changeset for `plot` <!-- builds: a shared signalZero liveness mapping in the domain adapters --> → #3258

## Notes

- Phase 2 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `process-census-gate`.
- Line numbers checked against `origin/sprint/nothing-runs` on 2026-11-08. `plot-monitor-subject.sh:193-203` holds. The story cites `processes-shell.ts:158-159`; `isAlive` spans `:158-161`.
- Related: `the-agent-reporter-starts-a-sleep` (#3024, released 2.30.0) removed `cat` and `tr` from the same loop and kept the `sleep`.
- Definition of Done: docs/definition-of-done.md.
