# Operator lens: desk-probes-in-domain

Juror: operator. Question: what does a person see on the board and in `/plot-fleet --status` when a desk's state is read wrong, and can the person recover without reading code?

Position: amend

## Open Questions

1. **Port in the workflow.** Recommend: keep `readWorkerReadings` in the workflow layer, as `readDeskReadings` does (`plan-walk-desks.ts:68-120` already awaits `Trees`, `Agents`, `Processes`). For the operator, the placement matters less than the failure contract: `readDeskReadings` turns any unreadable desk into `failed` for the whole beat (`plan-walk-desks.ts:107`, `:118`). The new reader must keep that contract and must not answer a partial reading. Amend the CLAUDE.md "no workflow imports a port" sentence in the same slice, so that the rule and the code agree.
2. **21 pid checks, 55 sources.** Recommend: accept the plan's measurement step, and add one row: the split must name which caller reads `ended` or `orphaned` for a desk. An untraced caller that keeps the shell path gives the operator two answers for one desk (see Finding 3).
3. **`Date.parse` against `_plot_lstart_epoch`.** Recommend: do not rely on a person confirming it. `_plot_lstart_epoch` (`plot-worker-state.sh:301-304`) tries `date -j -f "%a %b %d %H:%M:%S %Y"`, then `%c`, then `date -d`. Add corpus rows that feed recorded `lstart` strings from both platforms (a single-digit day pads with a space on macOS) to both parsers. A parse failure in the shell reads `stale`, and `stale` reads `ended` (`agent-state.ts:109`). A silent parse failure in TypeScript turns every running desk on one platform into `ended` on the board.
4. **Slice 4 and `childOnCore`.** Recommend: keep one CPU reading from the shared `table()` beside the log reading. Evidence: `childOnCore` is the last guard in `idleNow` before `idle` (`rules/sample.ts:179`), and `idle` ends the worker with exit 124 by default (`worker-loop.ts:1602`, `:1963-1968`, `PLOT_MONITOR_ENDS_WORKER` defaults to `1` at `:2600`). The window is 900 s (`IDLE_WINDOW_SECONDS`, `worker-loop.ts:121`). One tool call longer than 900 s with commits on the desk then ends the agent. `.plot-worker.log` is the loop's output (`plot-dispatch.sh:1133`); the plan does not show that it moves while one tool call runs. The operator sees exit 124, which is the same code as a `Worker bound` timeout, and has no reading that names "ended as idle while CPU moved". Ship the log reading as an extra `working` signal, not as a replacement, or measure log growth during a long tool call first.
5. **Delete `plot_worker_activity`.** Recommend: do not delete it in this plan. `plot-quiet-stretch.sh:120` is the operator's measuring tool for the idle question. Slice 4 changes that same question, so the operator needs the old measurement to compare against. Delete it in a later change after one week of `idle` endings is compared.
6. **`PLOT_AGENT_PROCESS` in fleetd.** Recommend: do not read it from fleetd's environment alone. The corpus test runs both sides in one process with one environment, so it cannot find a difference between the dispatcher's value and fleetd's value. If fleetd lacks a value that the project set, every running desk reads `orphaned` on the board while `/plot-fleet --status` (shell, own environment) reads `running`. Read the value from one recorded source (the manifest or `## Plot Config`), or log the value fleetd uses once at start so the operator can see it.

## Leftovers

- Port import: handled as an Open Question; needs the CLAUDE.md amendment named in item 1.
- 21/55 not traced: handled by a measurement step; needs the "which caller reads which state" row.
- `Date.parse` on macOS and Ubuntu: handled only by "a person confirms"; needs recorded-string corpus rows (item 3).
- Slice 4 `childOnCore`: not handled; the plan names the risk and ships it. Needs the CPU reading kept (item 4).
- Delete `plot_worker_activity`: not decided; recommend keep (item 5).
- `PLOT_AGENT_PROCESS`: not handled; corpus cannot catch it (item 6).

## Findings

1. **The agent grace is missing from `agentAlive`.** `plot_worker_agent_alive` answers `unaskable` for a wrapper younger than `PLOT_AGENT_GRACE_SECONDS` (default 30, `plot-worker-state.sh:977`, `:1010-1014`). The plan's `agentAlive(table, pid)` (Approach, slice 1) names only the subtree walk. Without the grace, each new dispatch reads `absent`, so `orphaned`, so the desk's task state, for up to 30 s. The operator sees a fresh agent as stalled or finished. Add the grace to `agentAlive` (the table carries `startedAt`, so the age is free) and add a constructed desk "wrapper 5 s old, no agent yet" to the corpus.
2. **The shared table is older than the pid file.** One `table()` per pass is read before the desks. A worker that starts between the table read and the pid read is absent from the table. The shell reads `ps` at check time and does not have this race. If `pidIsCurrent` copies the shell, a missing row reads `stale`, so `ended`, and the desk lands in the ended-desk rule (`rules/ended-desk.ts`) and in *Waiting on you*. Specify: a pid that `signalZero` finds alive and the table does not hold reads its start time with `processesShell.startedAt` (one `ps -p`), never `stale`. Add a test row for it.
3. **Two views read two implementations.** `/plot-fleet --status` reads `plot_worker_state` in the shell (`plot-fleetctl.sh:68`, `:930`, `:1285`, `:1321`), and `--stop` gates on it (`desk_running`, `:574`). The board reads the TypeScript copy. A disagreement that the corpus test does not cover (platform parse, environment) shows one desk in two states, and nothing names the disagreement. Add one operator-visible check: `plot-fleetctl.sh --status` prints the board's state beside its own where the board answers, or the plan states that the views can differ and how the operator finds out.
4. **A failed process table has no named answer.** The plan does not say what `readWorkerReadings` returns when `ps` fails. The shell turns that into `stale` per desk, so `ended` (`plot-worker-state.sh:345-353`). The TypeScript port can do better: answer `failed`, so the beat fails and every row keeps its last state. Specify it, and name the failure in the fleetd log line with the `ps` exit code, so the operator sees "process table unreadable" and not every desk `ended`.
5. **The registry keeps `unknown` on failure; good.** Slice 3 keeps "one failure answers an empty array and the batch reads `unknown`". Add the reason to the log, as for Finding 4.
6. **An idle ending has no name of its own.** Independent of slice 4's choice, the operator cannot tell an idle ending from a bound ending (both 124). If slice 4 ships, write the verdict inputs (log size/mtime, CPU delta if kept) into the ending record (`.plot-worker.ending.json`), so that a wrong `idle` can be found without reading code.

## The one change that matters most

Keep a CPU reading beside the log reading in slice 4 (item 4). Every other finding here shows a wrong state for one pass or one view; slice 4 as written ends a working agent after 900 s of one silent tool call, with exit 124 and no record that says why.
