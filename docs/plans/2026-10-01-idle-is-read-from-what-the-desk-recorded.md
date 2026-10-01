# Idle is read from what the desk recorded

> `idle` needs two samples today, so a process must hold the first one. Every condition behind it is a duration the desk already records, so one sample answers it: the WorkerMonitor process goes, the supervisor stays stateless, and the finding stays.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1041
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The worker's `idle` finding is judged from one reading of the desk: transcript silence, the age of the newest tree change, the CPU of the agent's children, and commits on the branch. No process keeps a previous sample.
- A dispatched agent runs one resident monitor instead of two. The agent's own loop reports `idle`, and the wrapper that already waits for the agent reports `gone`.

## Motivation

#1041 asks where `idle` goes when the WorkerMonitor's findings move off the WorkerMonitor. It names three options and each breaks a stated property:

| Option | What it breaks | Where the property is stated |
|---|---|---|
| 1. A state file or manifest field per agent per tick | The supervisor holds nothing between ticks; recovery and normal operation are one code path | `packages/board/src/server/entry/registryd.ts:178-197` |
| 2. Keep the WorkerMonitor for `idle` alone | Fleet control at `1 + 3N`, not `1 + 2N` | `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md:31`, `:78` |
| 3. Drop `idle` | Observation; *"the cheapest topology is no monitors at all, and it is worthless"* | `DESIGN-process.md` §0 |

All three assume `idle` needs two samples. It does today: `sample(previous, current)` (`packages/domain/src/rules/sample.ts:106-117`) returns `idle` only when the previous pass was also quiet and the tree fingerprint did not change between passes (`:113-114`). The monitor holds that previous pass in memory (`skills/plot/scripts/plot-worker-monitor.sh:491-492`, `:617-618`).

**The assumption no longer holds.** Since 2026-09-02 the quiet reading is not a CPU snapshot but transcript silence past a 900 s window (`plot-worker-monitor.sh:27-62`): a duration the filesystem records as the transcript's mtime. The only condition that still needs a comparison is "the tree did not change between passes", and the desk records that too: HEAD's commit time, the mtime of each dirty path, and the mtime of each dirty path's parent directory, which moves when a file is added, removed or renamed. "No tree change for at least the window" is one reading, and a stronger one than "no change between two passes 30 s apart".

**So a fourth option exists: `idle` becomes a one-sample rule.** Then no process holds state for it. The loop's existing watcher subshell (`skills/plot/scripts/plot-worker-loop.sh:1700-1712`, started when `MONITOR_ENDS_WORKER=1`, the default at `:178`) can judge it, the WorkerMonitor process is no longer started, and the supervisor is not touched.

**`gone` needs no monitor either.** It is a one-sample fact: the agent pid names no live process. The wrapper starts the agent, records its pid and `wait`s for it (`skills/plot/scripts/plot-dispatch.sh:1502-1535`), so it knows the instant the agent ends, and it outlives the agent by construction (`plot-worker-monitor.sh`, *"WHY IT IS THE WRAPPER'S CHILD"*). The supervisor already reads the same fact as `workerAlive` (`packages/domain/src/rules/supervision.ts:61`, `:274`).

## Design

### Approach

**The rule.** `rules/sample.ts` gains `idleNow(reading, window)`, a pure function of one reading. A reading carries:

| Field | Meaning | Source |
|---|---|---|
| `pid` | `alive` \| `dead` \| `unrecorded` (unchanged) | the pid file |
| `spoken` | whether this worker's conversation has written yet (#1074's reading) | `monitor_conversation_spoken`, `plot-worker-monitor.sh:404` |
| `silenceSeconds` | seconds since the newest transcript line, already clamped by #1141's usage-limit rule | the transcript mtime |
| `childOnCore` | whether a child of the agent is burning CPU, sampled inside the pass | `monitor_activity`, `plot-worker-monitor.sh:373` |
| `treeQuietSeconds` | seconds since the newest of: HEAD's committer time, each dirty path's mtime, each dirty path's parent directory's mtime | new reading, below |
| `commits` | `yes` \| `no` \| `unanswerable` (unchanged) | the local `origin/<default>` ref |

`idleNow` answers `gone` when `pid` is `dead`; `idle` when `pid` is `alive`, the conversation has spoken, `silenceSeconds ≥ window`, no child is on a core, `treeQuietSeconds ≥ window` and `commits` is `yes`; otherwise `silent`. An unreadable value (`unrecorded`, no transcript, no tree) answers `silent`, as today: a failure to observe is not evidence. `publication(published, verdict)` (`sample.ts:133`) is unchanged; the published finding is read from the findings file, which already records it.

**The tree reading.** `treeQuietSeconds` comes from the same dirty-path list the fingerprint uses today (`monitor_tree_fingerprint`, `plot-worker-monitor.sh:429-444`, filtered through `plot_worker_dirty_filter`), so the monitor's own findings file and the desk's own records stay excluded. One `git log -1 --format=%ct` for HEAD, one `stat` call over the dirty paths and their parent directories. A clean tree reads HEAD's time alone.

**Why one reading is not the hazard the comment warns about.** *"A single idle reading is a process caught between syscalls"* (`plot-worker-monitor.sh`, *"TWO SAMPLES, NEVER ONE"*) was written about a CPU snapshot. In this rule the CPU is a veto, not the verdict, and each other condition is already a span of at least `window` seconds. A process caught between syscalls has no 900-second silence and no 900-second-old tree.

**Who asks.** The rule is asked through the existing bundle `skills/plot/scripts/board/plot-monitor.mjs` (`packages/board/src/server/entry/monitor.ts`), which already takes one reading per line on stdin. It is asked once per agent per pass, so the cost rule (`docs/shell-and-domain.md` §1) applies: the bundle stays one long-lived call per run, as `entry/monitor.ts` already does, not a `node` start per pass.

### What moves where

| Finding | Today | After |
|---|---|---|
| `idle` | WorkerMonitor process, two samples | the loop's watcher subshell, one sample per pass, every `PLOT_MONITOR_INTERVAL` (30 s) |
| `gone` | WorkerMonitor process | the wrapper, one line after `wait "$agent"` returns with a non-zero status |
| findings file | `.plot-worker.monitor.worker.jsonl` | unchanged name and line shape, so the board's reader (`packages/board/src/server/findings.ts:39-43`) and `attention.ts:94-95` read it as before |

The wrapper stops starting the WorkerMonitor (`plot-dispatch.sh:1452`, `:1496`, `:1502`). `workerMonitorPid` stays in the manifest schema with its `''` default (`packages/board/src/contract/schema.ts:3510`, `packages/board/src/server/manifest-stamp.ts:52`, `:117`), so manifests written by older desks still parse. Per agent the resident processes become the worker and the AgentMonitor: `1 + 2N`.

### What this does NOT do

- **It does not give the supervisor state.** `registryd.ts:178-197` stays true as written.
- **It does not change what `idle` means.** The four conditions are the ones `plot-worker-monitor.sh:63-77` argues; only how the tree condition is read changes.
- **It does not move the usage-limit wait.** `docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md` owns `.plot-worker.limited` and the clamp on silence; this plan reads the clamped silence and depends on that branch.

### Open Points

- [ ] A file an agent rewrites in place with the same content and a preserved mtime does not move `treeQuietSeconds`. The two-sample fingerprint misses it too (paths, not content), so this is no regression; it is stated, not fixed.
- [ ] Between prompts the watcher does not run, so no `idle` is judged while the loop itself is between slices. Today's monitor judges then too, but `idle` needs commits on a branch and a live conversation, so nothing it could publish there is lost. A slice-2 test asserts no finding is published between prompts.

## Slices

### Idle is one reading (Branch: bug/idle-is-one-reading)

`idleNow` in `packages/domain/src/rules/sample.ts` with unit cases for each condition (each one false alone answers `silent`; `dead` answers `gone`; every unreadable value answers `silent`), at 100% branch coverage. `entry/monitor.ts` takes the one-sample reading. `plot-worker-monitor.sh` fills `treeQuietSeconds` and stops comparing `prev_tree` (it keeps running as a process in this slice, so the slice ships alone). A contract test on a scratch desk: a tree untouched for the window with commits and a silent transcript publishes `idle` on the FIRST pass; a renamed file inside the window publishes nothing. <!-- builds: idleNow, a one-sample idle rule -->

### The loop reports idle and the wrapper reports gone (Branch: bug/the-loop-reports-idle) <!-- waits: bug/idle-is-one-reading --> <!-- waits: bug/the-loop-waits-out-a-usage-limit -->

The watcher subshell judges `idle` itself every `PLOT_MONITOR_INTERVAL` and publishes into the same findings file; the wrapper appends `gone` after a non-zero `wait`; the wrapper no longer starts the WorkerMonitor; `plot-worker-monitor.sh` is removed with its callers and its tests rewritten (`test/e2e/monitors-attached.test.mjs`, `packages/board/test/unit/monitors.test.ts`). It also waits on `bug/the-loop-waits-out-a-usage-limit`, because that branch changes the silence reading this one moves. Tests: a dispatched agent shows two resident per-agent processes; a stalled prompt with commits is ended by the watcher within one window plus one interval; an agent killed with SIGKILL produces one `gone` line; no finding is published between prompts. <!-- builds: the loop's idle watcher and the wrapper's gone line -->

## Done when

- `rules/sample.ts` has no two-sample path, and `idleNow` is covered at 100% branches.
- A dispatched agent runs the worker and the AgentMonitor, and no WorkerMonitor (`ps` in the contract test).
- `.plot-worker.monitor.worker.jsonl` still receives `idle`, `clear` and `gone`, and the board's attention list shows them as before.
- `packages/board/src/server/entry/registryd.ts` is unchanged by this plan.

## Notes

#1041 records that a question should be decided before a plan. This plan's decision is the fourth option above: each of the three listed options assumes a two-sample rule, and the reading that made a second sample necessary was replaced on 2026-09-02.
