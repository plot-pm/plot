# Cost lens: desk-probes-in-domain

Position: amend

Lens: does each slice remove the process starts it claims, measured against the census rows S4 (3 desks), S5 and S6 of CI run 42595561157 (`census-report-head`, `census-head.jsonl`), and what new costs does it add.

## The census, re-read

I downloaded the artifact and diffed the S4 GitHub 0-desk row (1124.5 per pass) against the 3-desk row (2585.5). Recorded counts are two passes; the figures below are per pass.

- The desk share is 1461 per pass. The plan's table names about 540 of it.
- The largest desk item is `grep`: 392 per pass (176 at 0 desks, 568 at 3). The plan's table does not list it. Its sources are the manifest loop (`plot-worker-state.sh:257`, one `grep` and one `sed` per manifest file per call, so the cost grows with desks squared), the three manifest field reads (`:289-291`) and the four-stage dirt filter (`:562-566`).
- Other desk items the table omits: `tr` 88, bare `git` 69, `sed` without capture 67, `bash` 64, `awk` (config) 61, `cat` 33, `rm` 30.
- About 80 per pass of the desk share is the host chain: `bash plot-host.sh` 6, `gh pr` 6, `mktemp plot-host-err` 6, `jq` 6, `mv` 6, `dirname budget.tsv` 6, plus their `rm`, `mkdir` and `awk`. No slice of this plan touches it.
- If slices 1 to 3 remove every source of `plot-worker-state.sh` from fleetd's pass, I estimate about 1150 to 1200 of the 1461 go. The residual is about 70 `git` (one status and one rev-list per desk per reader) plus the host chain.
- Bitbucket with 3 desks records 26 `dirname plot-worker-state.sh` per pass against 56 on GitHub. The plan's per-desk split holds for GitHub only.
- S5 and S6 run the GitHub 3-desk fixture with tolerance ratio 0.1 plus 2, so they follow S4.
- The census desks carry a live stub pid, a one-line manifest with `startedAt` and no `pidStartedAt`, and no `.plot-worker.wrapper.pid` (`packages/fleet/test/census/sandbox.ts:301-315`). So the census never runs `agentAlive`, and slice 4's agent loop never runs under the census.

## Open Questions

1. Port in the workflow. Recommend: `readWorkerReadings` takes values (the shared table, the desk's file readings, and `dirty`/`unpushed` from the caller), and the `processesFiles` adapter gathers them. Reason (cost): `readDeskReadings` already calls `trees.dirtyPaths` and `trees.unpushedCommits` for each desk in the same `Promise.all` (`plan-walk-desks.ts:91-99`). A `readWorkerReadings` that calls them again doubles one `git status` and one `git rev-list` per desk per scan. Values also match the CLAUDE.md shape rule.
2. The 21 pid checks and 55 sources. The plan must trace them before slice 1 merges, not in its PR. The census desks have no wrapper file, so all 7 `ps` per desk are `plot_pid_is_current` calls, and 7 evaluations per desk per pass means about 7 `workerState`/`bashLiveness` calls per desk per pass. That count decides the `table()` design (see the main change).
3. `lstart` parsing. Recommend: run `ps` under `LC_ALL=C` and `TZ` unset, and hold `Date.parse` against `_plot_lstart_epoch` in corpus rows on both runners. `processesShell.startedAt` (`processes-shell.ts:200-210`) already uses `Date.parse` on `lstart` in production, which is evidence that it works on macOS. No process cost either way.
4. `childOnCore`. Recommend: read the log first and take one CPU sample from `table()` only when the log reads `idle`. A working log costs 0 processes; an idle check costs 1 `ps` instead of 2 today. The whole worker tree writes to `.plot-worker.log` (`plot-dispatch.sh:1546`), and `claude -p` holds its text output until the turn ends, so a long agent turn can leave the log still. A false `idle` lets `idleNow` end a working agent, and a restart costs far more than one `ps`.
5. Delete `plot_worker_activity`. Recommend: keep it in this plan. fleetd does not call it, so deleting it removes 0 census processes. Its only gain is shell-line headroom, and it breaks `plot-quiet-stretch.sh:120`.
6. `PLOT_AGENT_PROCESS`. Only `plot-worker-state.sh` reads it; no script or TypeScript file sets it. A fleetd started by launchd does not inherit an operator's shell export. Recommend: the TypeScript copy uses the default `claude` and the same environment read, and a corpus row with the variable unset. No process cost.

## Leftovers

- Port import: handled as an open question; change as answered in item 1.
- 21 pid checks and 55 sources not traced: not handled; slice 1 cannot state its `ps` target without the trace. Move the trace before the slice-1 design is fixed.
- `Date.parse` on both platforms: handled by the corpus rows; add `LC_ALL=C` to the adapter's environment explicitly.
- Slice 4 and `childOnCore`: not resolved; adopt item 4.
- Deleting `plot_worker_activity`: keep it; state that the deletion has no census effect.
- `PLOT_AGENT_PROCESS` in fleetd: state that nothing sets it today.

## What would fail or mislead

1. One `ps` per pass is not reachable as written. Slice 1 says "a pass reads the table once and shares it across every desk" and "the six callers keep their signature" (`workerState(worktree, hasPr)`). With that signature, each call takes its own `table()`, so 21 calls per pass give 21 `ps -A`, the same count as today. The Done-when row "1 `ps` per pass" then fails. The plan must name the sharing: a pass-scoped table memo in `processesFiles` with a bound, or a table read once per scan and passed to every reader.
2. Slice 1 can add `bash` starts before slice 2 lands. In the shell, `plot_worker_state` asks for dirt and unpushed only for an exited worker (`plot_worker_task_state`, through `:1305`, `:1328`, `:1361`). The plan reads `dirty` and `unpushed` through `Trees` for every desk. Until slice 2, `treesGit.dirtyPaths` is a `bash -c . plot-worker-state.sh` (`trees-git.ts:326-330`). So a live desk gains one sourced `bash` in slice 1, and the spawn-spy row "0 `bash` from `workerState`" fails. Read `dirty` and `unpushed` only where liveness is not `live`, as the shell does, or land slice 2 first.
3. The manifest directory. `plot_manifest_dir_for` costs one `bash plot-config.sh` plus its `awk` per call (61 + 61 per pass). The plan does not say how `readWorkerReadings` finds the `Agent registry` directory. It must resolve it once per process as a fixed answer, or the config share stays.
4. `restart-command.ts:77` calls `processesShell(context).workerState` directly, not through an injected port. Slice 1 must change that construction, or one caller keeps the old probe.
5. The S4 claim "below the merge base" passes on a fall of 1 process. Give the number.
6. Slice 4 has no census row. Its saving (2 `ps` per idle check, desk side) is real but S4, S5 and S6 do not see it. State that, and add a spawn-spy assertion on `idleVerdict`.

## New costs the plan adds

- `ps -A` reads the whole process table: one process, larger output. That is acceptable if it runs once per pass, not per call.
- `readdirSync`, `statSync` and file reads per desk: no process; allowed by the story's 2026-11-05 decision.
- One more corpus test per copied rule. CI cost only.
- The registry `execFile` stays for `plot-config.sh` (`registry.ts:510`); no change.

## The one change that matters most

Specify how one `table()` reading serves every `workerState` call in a pass, and how `dirty`/`unpushed` come in as values read only for a non-live desk. Then replace "S4 falls below the merge base" with a number: the S4 GitHub 3-desk row minus the 0-desk row falls from 1461 to at most about 300 per pass, and `grep`, `cut`, `date`, `sed \1`, `dirname plot-worker-state.sh` and `ps` fall to their 0-desk figures.
