# The desk probes read from files

> fleetd and the board read each desk's worker state, dirt and activity with TypeScript readers behind the `Processes` and `Trees` ports, and decide with the domain rules that exist today. No per-desk `bash -c . plot-worker-state.sh` probe remains in `packages/*/src`; each reader that copies a shell reading is a declared duplicate with a corpus test against `plot-worker-state.sh`.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd and the board read a desk's worker state, uncommitted files and activity from files and one process-table read per pass, instead of one `bash` probe per desk per question. An idle fleet with 3 desks starts fewer processes per pass. The agent rows, states and findings stay the same.

Board impact: the board server's agent registry (`packages/fleet/src/shared/registry.ts`) reads liveness and cleanliness through the new readers instead of two inline `bash` programs. The page, the plan format, the template and the `docs/plans` layout do not change. `skills/plot/scripts/plot-worker-state.sh` keeps every function that a shell script sources (`plot-dispatch.sh:188`, `plot-fleetctl.sh:68`, `plot-quiet-stretch.sh:108`); no shell line is added.

## Motivation

The census counts what desks cost an idle fleetd pass. On CI run 42595561157 (PR #3277, 2026-11-09), S4 on GitHub reads 1124.5 `execve` per pass with 0 desks and 2585.5 with 3 desks: 1461 per pass, about 487 per desk, come from desks. Bitbucket with 3 desks reads 2676. S5 (one desk commit) reads 2587 and S6 (one PR turns green) 2696, both with 3 desks.

The census report names commands, not callers. Per pass, these commands appear only when desks exist (half of the two recorded passes in `census-report-head`):

| Command | 0 desks | 3 desks | Source in `plot-worker-state.sh` |
|---|---|---|---|
| `dirname plot-worker-state.sh` | 1 | 56 | load time, `:98` and `:196`: one per `source` |
| `bash plot-config.sh` | 86 | 147 | `plot_manifest_dir_for` (`:178`) at load time |
| `sed` with a `\1` capture | 0 | 126 | manifest field reads (`:257`, `:289-291`) |
| `date` | 0 | 105 | `_plot_lstart_epoch` (`:301-304`) and the manifest epoch (`:368`); up to 5 per call on Linux |
| `cut` | 1 | 103 | the reading splits in `plot_worker_state` (`:1216-1218`, and `:1423-1425` in `plot_worker_readings`) |
| `ps` | 0 | 21 | `plot_pid_is_current` (`:352`) |
| `grep ^PLOT-BLOCKED`, `ls` | 0 | 6, 6 | `plot_worker_blocked` (`:445`) |

So fleetd sources the script about 55 times per pass for 3 desks and evaluates the pid reading about 21 times, 7 per desk. The TypeScript callers that source it per desk:

- `processesShell.workerState` (`packages/domain/src/adapters/processes/processes-shell.ts:168`), reached from `readDeskReadings` (`packages/domain/src/workflows/plan-walk-desks.ts:94`) on every scan, from the unblock world (`packages/fleet/src/server/entry/registryd-main.ts:1258`), from `release-claim-reader.ts:63`, `restart-command.ts:77`, `auto-fixer.ts:372` and the board's `reap.ts:401`.
- `treesGit.dirtyPaths` (`packages/domain/src/adapters/trees/trees-git.ts:326`) and `treesGit.quietSeconds` (`:365`), both `bash -c . plot-worker-state.sh`, reached from `readDeskReadings` (`plan-walk-desks.ts:97-98`), `registryd-main.ts:618`, `:1489`, `:2150` and the agent's own loop (`packages/fleet/src/server/entry/worker-loop.ts:646`, `:1274`).
- `bashLiveness` (`packages/fleet/src/shared/registry.ts:1147`), one sourced batch per registry read, and `bashCleanliness` (`:1319`), one inline `bash` program per batch that runs `git status`, `grep` ×5, `sed`, `cut` and `git rev-list` per desk. The board passes it at `packages/board/src/server/fleet.ts:3202`; both run through `execFile` at `registry.ts:510`.

The decision is already in the domain: `agentState` (`packages/domain/src/rules/agent-state.ts`) takes the readings `plot_worker_readings` prints, and `packages/domain/corpus/agent-state.corpus.test.ts` holds it against `plot_worker_state`. `deskManifest` and `deskWaitsFree` are domain rules with corpus tests too. What stays in the shell is the gathering: the manifest and pid files, the start-time check, the agent-alive table walk, the `PLOT-BLOCKED*` glob, the dirty filter and the exit record.

This is the paused Phase 4 of `the-shell-holds-no-behavior` (archived 2026-11-09), whose per-desk scripts the story took over.

## Design

This plan depends on `the-snapshot-entity` (delivered): every reading lands in the snapshot's `workers` and `deskFiles` keys through `recordReading`. `liveness-token` depends on the *Worker readings* slice, because it replaces the start-time column that slice reads. `triggers-replace-the-tick` depends on this plan. `refs-from-files` (this sprint) changes `treesGit` for `Trees.list` and ref reads; the *Dirt* slice changes `dirtyPaths` and `quietSeconds` in the same file, `trees-git.ts`, so whichever merges second rebases. `one-cat-file-batch`, `github-reads-in-process`, `node-worker-wrapper` and `sprint-prs-run-ci` share no file with this plan.

### Approach

**Placement under *The Layering Rule*.** The readers are adapters; the rules that copy a shell reading live in `packages/domain/src/rules/`; the workflow that gathers one desk's readings follows `readDeskReadings`, which already takes the `Trees`, `Agents` and `Processes` ports. Each copied reading is a declared duplicate under *A Shell Script Asks The Domain*: `plot_worker_state` runs once per desk per shell pass in `plot-dispatch.sh` and `plot-fleetctl.sh`, so the shell keeps its copy and a corpus test holds the pair. On a disagreement the branch stops.

**Slice 1: worker readings (largest share: the sources, `sed`, `date`, `cut`, `ps`).**

- `Processes` (`packages/domain/src/ports/processes.ts:37`) gains `table()`: one process-table reading per call, rows of `pid`, `ppid`, `startedAt` (epoch ms), `comm` and CPU time. A new adapter `packages/domain/src/adapters/processes/processes-table.ts` implements it with one `ps -A -o pid=,ppid=,lstart=,time=,comm=` under `LC_ALL=C`. A pass reads the table once and shares it across every desk; the start-time check needs it until `liveness-token`.
- `pidIsCurrent(recorded, startedAtMs)` in `packages/domain/src/rules/pid-current.ts` copies `plot_pid_is_current` (`plot-worker-state.sh:347`): within 3 s of `pidStartedAt` on either side, else at or after `startedAt` less 3 s, else nothing to check. `agentAlive(table, pid)` in the same file copies `plot_worker_agent_alive` (`:1002`): `present`, `absent` or `unaskable` from the subtree's `comm` against `PLOT_AGENT_PROCESS`.
- `readWorkerReadings(ports, worktree, table)` in `packages/domain/src/workflows/worker-readings.ts` gathers the `AgentStateReadings` fields with no process: the manifest through `deskManifest`, the `.plot-worker.pid` and `.plot-worker.pid.startedAt` fallback, `.plot-worker.wrapper.pid`, `.plot-worker.exit` (absent `null`, unreadable `''`), `.plot-worker.freewait` through `deskWaitsFree`, the `PLOT-BLOCKED*` marker through the `Desk` port, `signalZero` for `kill -0`. `dirty` and `unpushed` come from `Trees` (`dirtyPaths`, `unpushedCommits`).
- `processesShell.workerState` is replaced by `processesFiles` (`packages/domain/src/adapters/processes/processes-files.ts`), whose `workerState` calls `readWorkerReadings` and `agentState`. The six callers above keep their signature. `processesShell` keeps `childrenOf`, `uptimeSeconds` and `startedAt` for the callers that need one pid.
- `packages/domain/corpus/worker-readings.corpus.test.ts` compares `readWorkerReadings` with `plot_worker_readings` field by field on every desk of this estate (`production.ts`, `readDesks`) and on constructed desks: no manifest, a reused pid, a wrapper file with no agent, an exit file holding `abc`, a free-wait record. A second block holds `pidIsCurrent` against `plot_pid_is_current` over 12 recorded start-time pairs.

**Slice 2: dirt (the `bash`, `grep` and `cut` per desk).** `deskDirtFilter(porcelain, worktree, bundlePaths)` in `packages/domain/src/rules/desk-dirt-filter.ts` copies `plot_worker_dirty_filter` (`plot-worker-state.sh:543`) with the three patterns `PLOT_WORKER_RECORD`, `PLOT_EDITOR_LEFTOVER` (`:391`) and `PLOT_TOOL_SCRATCH` (`:409`) and the root `?? PLOT-CORRECTION.md` exemption. `treesGit.dirtyPaths` and `treesGit.quietSeconds` run one `git --no-optional-locks -C <desk> status --porcelain` (with `-uall` for `quietSeconds`) and filter in process. `treesGit.markers` (`trees-git.ts:304`, `bash -c ls | grep`) reads the directory with `readdirSync`. The corpus test `packages/domain/corpus/desk-dirt-filter.corpus.test.ts` holds the filter against `plot_worker_dirty` on every desk of this estate and on a constructed porcelain corpus (renames, quoted paths, nested `PLOT-CORRECTION.md`, each scratch directory).

**Slice 3: the registry path.** `bashLiveness` (`registry.ts:1147`) becomes one `readWorkerReadings` per worktree over one shared `table()`, and keeps its contract: one failure answers an empty array and the batch reads `unknown`. `bashCleanliness` (`:1319`) becomes `deskClean(dirty, unpushed)` in `packages/domain/src/rules/desk-clean.ts` over `deskDirtFilter` with the bundle paths from `packages/board/build.mjs` read once per process, and `Trees.unpushedCommits`. A worktree that cannot be read stays `false`, as today. The `execFile` at `registry.ts:510` then serves `plot-config.sh` alone. A parity test runs the old inline program and the new rule over the same 20 constructed worktrees before the program is deleted, in the same PR.

**Slice 4: activity from the worker log.** `Processes.activity` (`processes-shell.ts:225`) samples `ps -o pid=,ppid=,time= -ax` twice, 400 ms apart, per call; its one production caller is the agent's own loop (`worker-loop.ts:1273`, `childOnCore`). `logActivity(before, after)` in `packages/domain/src/rules/log-activity.ts` answers `working` when `.plot-worker.log`'s size or mtime moved between two readings and `idle` when neither moved, as the story decides (2026-11-05: "The working/idle activity reading comes from file events on the worker log"). Until Phase 8 arms the watch, the reading is a `statSync` at each idle check, with the previous reading held in the loop. This is a behaviour change, not a duplicate, so `activity.corpus.test.ts` is retired with it and the plan records why.

### Open Questions

- [ ] `CLAUDE.md` says no rule or workflow imports a port, while `readDeskReadings` (`plan-walk-desks.ts:68`) already takes three. `readWorkerReadings` follows `readDeskReadings`. A person decides whether it does, or whether the gathering moves into the `processesFiles` adapter and only `pidIsCurrent`, `agentAlive` and `agentState` stay in the domain.
- [ ] The census shows about 21 pid readings and 55 sources per pass for 3 desks. The call sites above explain at most 4 sources per desk per scan. Slice 1 records the split with full argv under the census driver, as `refs-from-files` does for `rev-parse`, and states it in the PR. A person confirms that a split which differs from this plan's table changes no slice.
- [ ] `ps -o lstart=` prints a local time that `Date.parse` reads; `process-probe-system.ts:25` and `pr-reader.ts:106` parse it the same way. The shell parses it with `date -j -f` and then `date -d`. A person confirms that `LC_ALL=C` and `Date.parse` agree with `_plot_lstart_epoch` on the operator's macOS and on the Ubuntu runner, or slice 1's corpus rows show a disagreement and the branch stops.
- [ ] Slice 4 changes what `childOnCore` means: a long build that writes nothing to `.plot-worker.log` reads `idle`. `an-idle-agent-is-not-a-stalled-one` exists because CPU and transcript disagreed. A person decides whether slice 4 keeps one CPU sample from the shared `table()` beside the log reading, or ships the log reading alone as the story decided.
- [ ] `plot_worker_activity` and `plot_worker_cpu_centis` (`plot-worker-state.sh:864-1095`) have one shell caller, `plot-quiet-stretch.sh:120`, a measuring tool. Deleting them lowers the shell count (`plot-worker-state.sh` counts 684 commands on `11a270538`) and breaks that tool. A person decides whether slice 4 deletes them.
- [ ] `PLOT_AGENT_PROCESS` (default `claude`, `plot-worker-state.sh:921`) names the agent's process for `agentAlive`. The TypeScript copy reads the same environment variable. A person confirms that fleetd's environment carries the value the dispatcher used.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The TypeScript readings equal the shell's | `worker-readings.corpus.test.ts`: every field of `readWorkerReadings` equals `plot_worker_readings` on every desk of the estate and on 5 constructed desks; a disagreement names the desk and both answers | Worker readings |
| The start-time rule equals the shell's | `pidIsCurrent` equals `plot_pid_is_current` on 12 recorded pairs, including a reused pid and a missing `pidStartedAt` | Worker readings |
| A pass reads the process table once | `--once` spawn-spy test with 3 desks: 1 `ps` and 0 `bash` from `workerState` per pass | Worker readings |
| No TypeScript path sources the script | `grep -rn "plot-worker-state.sh" packages/*/src` finds only comments and `registry.ts`'s constant until slice 3, and comments only after it | Registry |
| S4 falls on every fixture with desks | census S4 (GitHub 3 desks, Bitbucket 3 desks), S5 and S6 read below their merge base; `dirname plot-worker-state.sh`, `date` and the `sed` capture reads fall to at most their 0-desk figure; the gate holds the new figures | Worker readings, Dirt |
| The dirt filter equals the shell's | `desk-dirt-filter.corpus.test.ts` passes on the estate and the constructed porcelain corpus | Dirt |
| A desk's dirt costs one `git` | spawn-spy: `dirtyPaths` and `quietSeconds` each start 1 `git` and 0 `bash`; `markers` starts none | Dirt |
| The registry keeps its contract | registry tests: a reader failure answers `unknown` for the batch; an unreadable worktree reads not clean; the parity test over 20 worktrees passes before the inline programs go | Registry |
| The agent loop reads activity from the log | `logActivity` rows: size moved → `working`; size and mtime still → `idle`; no log → `''`; the loop's idle check starts no `ps` | Activity |
| No shell grows | `scripts/check-shell-lines.sh pr` passes on every slice | every slice |

## Slices

### Worker readings

- `feature/desk-probes-in-domain-readings` — `Processes.table()` and `processes-table.ts`; `pidIsCurrent` and `agentAlive` in `rules/pid-current.ts`; `readWorkerReadings` in `workflows/worker-readings.ts`; `processesFiles` replaces `processesShell.workerState` for its six callers; `worker-readings.corpus.test.ts`; the measured call-site split <!-- builds: readWorkerReadings, worker-state readings from desk files and one process table per pass -->

### Dirt

- `feature/desk-probes-in-domain-dirt` — `deskDirtFilter` in `rules/desk-dirt-filter.ts`; `treesGit.dirtyPaths`, `quietSeconds` and `markers` with no `bash`; `desk-dirt-filter.corpus.test.ts` <!-- builds: deskDirtFilter, the desk dirt filter as a domain rule with a corpus test -->

### Registry

- `feature/desk-probes-in-domain-registry` — `bashLiveness` and `bashCleanliness` in `registry.ts` become `readWorkerReadings` and `deskClean`; the parity test; a changeset for `@plot-pm/board` <!-- builds: deskClean, the registry's cleanliness rule over the dirt filter -->

### Activity

- `feature/desk-probes-in-domain-activity` — `logActivity` in `rules/log-activity.ts`; the agent loop's idle check reads `.plot-worker.log` instead of `Processes.activity`; `activity.corpus.test.ts` retired <!-- builds: logActivity, working/idle from the worker log -->

## Notes

- Phase 5 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), candidate plan `desk-probes-in-domain`; takes over Phase 4 of [`the-shell-holds-no-behavior`](../stories/archived/the-shell-holds-no-behavior/STORY-the-shell-holds-no-behavior.md).
- The story says `plot_worker_activity` "runs `sleep 0.4` per running desk per probe under fleetd". On this worktree the shell function has one caller, `plot-quiet-stretch.sh:120`; the TypeScript `processesShell.activity` waits on an in-process timer (no `sleep` process) and two `ps` reads, and its one production caller is the agent's own loop (`worker-loop.ts:1273`), not fleetd. Slice 4 still removes the two `ps` reads per idle check.
- The script is 1,480 lines on this worktree (`wc -l`); the story cites 1,506.
- Deliverable search (`plot-deliverable-search.sh`) for `desk-probes-in-domain`, `worker readings`, `plot_worker_state`, `processesNode`, `workerReadings`, `deskDirtyFilter` and `logActivity` found no existing deliverable. It found `workerReadings` as a local variable in `registry.ts:869` (manifest readings, a different thing) and the existing rules `agentState`, `deskManifest` and `deskWaitsFree`, which this plan reuses.
- Census figures: `census-report-head` artifact of CI run 42595561157 (PR #3277, 2026-11-09). The report records two passes per S4 row; the per-pass figures above are half the recorded counts.
- Line numbers checked on `idea/batch-refs-from-files` at `11a270538`, 2026-11-09.
- Definition of Done: docs/definition-of-done.md.
