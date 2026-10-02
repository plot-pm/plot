# Idle is read from what the desk recorded

> `idle` needs two samples today, so a process must hold the first one. Every condition behind it is a duration the desk already records, so one sample answers it: the WorkerMonitor process goes, the supervisor stays stateless, and the finding stays. Fleet control goes from `1 + 4N` to `1 + 3N`.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1041
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Started:** 2026-10-02, Jan Wloka, `bug/idle-is-one-reading`

## Changelog

- The worker's `idle` finding is judged from one reading of the desk: transcript silence, the age of the newest tree change, the CPU of the agent's children, and commits on the branch. No process keeps a previous sample.
- A dispatched agent runs two resident monitors instead of three: the AgentMonitor and the BuildMonitor stay, and the WorkerMonitor goes. The agent's own loop reports `idle`, and the wrapper that already waits for the agent reports `gone`.
- `gone` is published only when the agent exits non-zero. An agent that exits 0 publishes `clear`, where today it publishes `gone`.

## Motivation

#1041 asks where `idle` goes when the WorkerMonitor's findings move off the WorkerMonitor. It names three options and each breaks a stated property:

| Option | What it breaks | Where the property is stated |
|---|---|---|
| 1. A state file or manifest field per agent per tick | The supervisor holds nothing between ticks; recovery and normal operation are one code path | `packages/board/src/server/entry/registryd.ts:178-197` |
| 2. Keep the WorkerMonitor for `idle` alone | Fleet control stays at `1 + 4N`: the wrapper starts three monitors per agent (`skills/plot/scripts/plot-dispatch.sh:1451-1458`) | `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md:115` |
| 3. Drop `idle` | Observation; *"the cheapest topology is no monitors at all, and it is worthless"* | `DESIGN-process.md` §0 |

All three assume `idle` needs two samples. It does today: `sample(previous, current)` (`packages/domain/src/rules/sample.ts:106-117`) returns `idle` only when the previous pass was also quiet and the tree fingerprint did not change between passes (`:113-114`). The monitor holds that previous pass in memory (`skills/plot/scripts/plot-worker-monitor.sh:491-492`, `:617-618`).

**The assumption no longer holds.** Since 2026-09-02 the quiet reading is not a CPU snapshot but transcript silence past a 900 s window (`plot-worker-monitor.sh:27-62`): a duration the filesystem records as the transcript's mtime. The only condition that still needs a comparison is "the tree did not change between passes", and the desk records that too: HEAD's commit time, the mtime of each dirty path, and the mtime of each dirty path's parent directory, which moves when a file is added, removed or renamed. "No tree change for at least the window" is one reading, and a stronger one than "no change between two passes 30 s apart".

**So a fourth option exists: `idle` becomes a one-sample rule.** Then no process holds state for it. The loop's existing watcher subshell (`skills/plot/scripts/plot-worker-loop.sh:1701-1711`) can judge it, the WorkerMonitor process is no longer started, and the supervisor is not touched.

**The watcher must start whatever `PLOT_MONITOR_ENDS_WORKER` says.** Today the loop starts it only when the flag is `1` (`plot-worker-loop.sh:1701`), and the flag's comment promises that `0` *"leaves the finding published"* (`:145-147`). After this plan the watcher is the only publisher of `idle`, so the watcher always runs and judges, and the flag gates only the `kill -USR1` to the loop.

**`gone` needs no monitor either.** It is a one-sample fact: the agent pid names no live process. The wrapper starts the agent, records its pid and `wait`s for it (`skills/plot/scripts/plot-dispatch.sh:1502-1535`), so it knows the instant the agent ends, and it outlives the agent by construction (`plot-worker-monitor.sh`, *"WHY IT IS THE WRAPPER'S CHILD"*). The supervisor already reads the same fact as `workerAlive` (`packages/domain/src/rules/supervision.ts:61`, `:274`).

**`gone` changes meaning, and the operator sees the change.** Today the WorkerMonitor publishes `gone` on any death of the watched pid, after one sample (`plot-worker-monitor.sh:583-589`). That includes a loop that ends normally (exit 0) and a loop stopped at `Worker bound` (exit 124). The board turns `gone` into *"restart it"* (`packages/board/src/server/attention.ts:94-95`). After this plan the wrapper reads the exit status of `wait "$agent"` (`plot-dispatch.sh:1535`, which already writes it to `$PLOT_EXIT_FILE`): a non-zero status (124, 137 for SIGKILL, any other) appends `gone`; status 0 appends `clear`, so a finished agent does not ask for a restart and no earlier `idle` stays the newest line.

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

`idleNow` answers `idle` when `pid` is `alive`, the conversation has spoken, `silenceSeconds ≥ window`, no child is on a core, `treeQuietSeconds ≥ window` and `commits` is `yes`; otherwise `silent`. A `dead` pid answers `silent`: after slice 2 the wrapper publishes `gone`, so `idleNow` has no `gone` arm and no caller needs one. An unreadable value (`unrecorded`, no transcript, no tree) answers `silent`, as today: a failure to observe is not evidence. `publication(published, verdict)` (`sample.ts:133`) is unchanged; the published finding is read from the findings file, which already records it.

**The tree reading.** `treeQuietSeconds` comes from the same dirty-path list the fingerprint uses today (`monitor_tree_fingerprint`, `plot-worker-monitor.sh:429-444`, filtered through `plot_worker_dirty_filter`), so the monitor's own findings file and the desk's own records stay excluded. One `git log -1 --format=%ct` for HEAD, one `stat` call over the dirty paths and their parent directories. A clean tree reads HEAD's time alone.

**The desk root directory's mtime is never read.** The loop writes its own `.plot-worker.*` records into the desk root, and `plot_worker_dirty_filter` drops them from the dirty list (`skills/plot/scripts/plot-worker-state.sh:431-439`, pattern `PLOT_WORKER_RECORD` at `:89`). Their creation and replacement still move the root directory's mtime, for example the manifest's `mv` at `plot-dispatch.sh:1535`. If a dirty root-level path contributed its parent directory, the loop's own bookkeeping would read as tree activity and `idle` would never fire. So a parent directory counts only when it is below the desk root. A root-level dirty path contributes its own mtime. The cost: a removal or a rename at the desk root alone does not move `treeQuietSeconds`. Slice 1 tests a desk where only `.plot-worker.*` files change and asserts `idle` on the first pass.

**Why one reading is not the hazard the comment warns about.** *"A single idle reading is a process caught between syscalls"* (`plot-worker-monitor.sh`, *"TWO SAMPLES, NEVER ONE"*) was written about a CPU snapshot. In this rule the CPU is a veto, not the verdict, and each other condition is already a span of at least `window` seconds. A process caught between syscalls has no 900-second silence and no 900-second-old tree.

**Who asks: a declared duplicate, not a bundle.** `skills/plot/scripts/board/plot-monitor.mjs` is committed, but no build emits it (`packages/board/src/contract/schema.ts:2116-2119`, and `packages/board/build.mjs` names no `outfile` for it) and no script calls it. The shell holds its own copy of the rule today (`plot-worker-monitor.sh:578-619`). The rule is asked once per agent per pass, and `docs/shell-and-domain.md:18` says such a caller duplicates the rule and a test holds the pair. So one shell function, `plot_worker_idle_now` in `skills/plot/scripts/plot-worker-state.sh`, holds the one-sample rule. The monitor sources that file today (`plot-worker-monitor.sh:251`) and the loop sources it (`plot-worker-loop.sh:712`), so both callers read one function. `packages/domain/corpus/sample.corpus.test.ts` pairs it with `idleNow` over every combination of the six fields, and a disagreement stops the branch (`docs/shell-and-domain.md` §3). `entry/monitor.ts` and `plot-monitor.mjs` are removed in slice 2 with the WorkerMonitor.

### What moves where

| Finding | Today | After |
|---|---|---|
| `idle` | WorkerMonitor process, two samples | the loop's watcher subshell, one sample per pass, every `PLOT_MONITOR_INTERVAL` (30 s) |
| `gone` | WorkerMonitor process, on any death of the pid | the wrapper, one line after `wait "$agent"` returns non-zero; exit 0 appends `clear` |
| findings file | `.plot-worker.monitor.worker.jsonl` | unchanged name and line shape, so the board's reader (`packages/board/src/server/findings.ts:39-43`) and `attention.ts:94-95` read it as before |

The wrapper stops starting the WorkerMonitor (`plot-dispatch.sh:1452`, `:1496`, `:1502`). `workerMonitorPid` stays in the manifest schema with its `''` default (`packages/board/src/contract/schema.ts:3510`, `packages/board/src/server/manifest-stamp.ts:52`, `:117`), so manifests written by older desks still parse. Per agent the resident processes become the worker, the AgentMonitor and the BuildMonitor: `1 + 3N`. Reaching the design's `1 + 2N` (`DESIGN-process.md:31`, `:78`) needs the AgentMonitor and the BuildMonitor merged, which is a separate change and not this plan.

### What this does NOT do

- **It does not give the supervisor state.** `registryd.ts:178-197` stays true as written.
- **It does not change what `idle` means.** The four conditions are the ones `plot-worker-monitor.sh:63-77` argues; only how the tree condition is read changes.
- **It does not move the usage-limit wait.** `docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md` owns `.plot-worker.limited` and the clamp on silence; this plan reads the clamped silence and depends on that branch.

### Open Points

- [ ] A file an agent rewrites in place with the same content and a preserved mtime does not move `treeQuietSeconds`. The two-sample fingerprint misses it too (paths, not content), so this is no regression; it is stated, not fixed.
- [ ] Between prompts the watcher does not run, so no `idle` is judged while the loop itself is between slices. Today's monitor judges then too, but `idle` needs commits on a branch and a live conversation, so nothing it could publish there is lost. A slice-2 test asserts no finding is published between prompts.
- [x] **The tree reading uses `git status --porcelain -uall`, and only this reading does.** Slice 1 measured the case this plan predicted: default porcelain collapses a wholly new untracked directory to one line, `?? brandnew/`, because once git knows the whole directory is untracked it stops descending. A directory's mtime moves when an ENTRY is added or removed and not when a file inside it is written, so a directory aged 2000 s holding a file 1 s old read `tree quiet: 2001` — a false `idle` on an agent mid-edit. `-uall` lists the file in its own right. **The fingerprint it replaced kept the default and was right to**: it asked *did these path NAMES change*, and a collapsed directory's name changes when the directory appears; this asks *when did anything move*, which the name cannot answer. The cost is one deeper status walk per pass on a desk holding large untracked directories. Measured 2026-10-02 (`test/reconcile/workeridle.test.mjs`, *"a file edited inside a wholly new untracked directory publishes nothing"*), which also asserts the collapse still happens, so the premise cannot rot silently.

## Slices

### Idle is one reading (Branch: bug/idle-is-one-reading)

`idleNow` in `packages/domain/src/rules/sample.ts` with unit cases for each condition (each one false alone answers `silent`; `dead` answers `silent`; every unreadable value answers `silent`), at 100% branch coverage. `plot_worker_idle_now` in `plot-worker-state.sh` holds the same rule, and `packages/domain/corpus/sample.corpus.test.ts` pairs the two. `plot-worker-monitor.sh` fills `treeQuietSeconds`, asks `plot_worker_idle_now`, and stops comparing `prev_tree`; it keeps its own one-sample `gone` arm until slice 2 (it keeps running as a process in this slice, so the slice ships alone). A contract test on a scratch desk: a tree untouched for the window with commits and a silent transcript publishes `idle` on the FIRST pass; a renamed file inside the window publishes nothing; a desk where only `.plot-worker.*` files change inside the window publishes `idle` on the first pass. <!-- builds: idleNow, a one-sample idle rule -->

### The loop reports idle and the wrapper reports gone (Branch: bug/the-loop-reports-idle) <!-- waits: bug/idle-is-one-reading --> <!-- waits: bug/the-loop-waits-out-a-usage-limit -->

The watcher subshell starts whatever `PLOT_MONITOR_ENDS_WORKER` says, judges `idle` itself every `PLOT_MONITOR_INTERVAL` through `plot_worker_idle_now`, and publishes into the same findings file; only its `kill -USR1` is gated by the flag. The wrapper appends `gone` after a non-zero `wait` and `clear` after exit 0. The wrapper no longer starts the WorkerMonitor. `plot-worker-monitor.sh`, `entry/monitor.ts` and `plot-monitor.mjs` are removed with their callers, their entries in `.gitattributes` and `.github/workflows/ci.yml`, and their tests rewritten (`test/e2e/monitors-attached.test.mjs`, `packages/board/test/unit/monitors.test.ts`). It also waits on `bug/the-loop-waits-out-a-usage-limit`, because that branch changes the silence reading this one moves. Tests: a dispatched agent shows three resident per-agent processes (the worker, the AgentMonitor, the BuildMonitor); a stalled prompt with commits is ended by the watcher within one window plus one interval; with `PLOT_MONITOR_ENDS_WORKER=0` the same prompt publishes `idle` and is not ended; an agent that exits 124 and an agent killed with SIGKILL each produce one `gone` line; an agent that exits 0 produces one `clear` line and no `gone`; no finding is published between prompts. <!-- builds: the loop's idle watcher and the wrapper's gone line -->

## Done when

- `rules/sample.ts` has no two-sample path, and `idleNow` is covered at 100% branches.
- `packages/domain/corpus/sample.corpus.test.ts` passes: `idleNow` and `plot_worker_idle_now` agree on every case.
- A dispatched agent runs the worker, the AgentMonitor and the BuildMonitor, and no WorkerMonitor: `1 + 3N` (`ps` in the contract test).
- `PLOT_MONITOR_ENDS_WORKER=0` still publishes `idle`.
- `gone` is published for exit 124 and SIGKILL, and not for exit 0.
- `.plot-worker.monitor.worker.jsonl` still receives `idle`, `clear` and `gone`, and the board's attention list shows them as before.
- `packages/board/src/server/entry/registryd.ts` is unchanged by this plan.

## Notes

#1041 records that a question should be decided before a plan. This plan's decision is the fourth option above: each of the three listed options assumes a two-sample rule, and the reading that made a second sample necessary was replaced on 2026-09-02.
