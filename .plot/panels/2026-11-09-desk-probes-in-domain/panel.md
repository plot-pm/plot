# Panel: desk-probes-in-domain

Subject: `docs/plans/2026-11-09-desk-probes-in-domain.md`, round 1, 2026-11-09, moderated on `idea/batch-refs-from-files` at `1b7f8ec6e`.

## Reconcile

`plot-panel.mjs reconcile` answers:

```
unanimous	amend	correctness,cost,operator
```

All three jurors hold `amend`. No juror holds `reject`. The unanimity is about the position only: the jurors disagree on four of the six Open Questions (see *Disagreements*).

## What Each Juror Looked At

| Juror | Read | Ran or measured |
|---|---|---|
| correctness | `plot-worker-state.sh` (free-wait arm `:1271`, grace `:977`, `:1011-1014`, `ps` empty → stale `:352-353`), `rules/agent-state.ts`, `ports/processes.ts`, `plot-desk-dirt.sh:85-98`, `trees-git.ts:375`, `worker-loop.ts:1260-1284` | ran `LC_ALL=de_CH.UTF-8 ps -o lstart=`, `Date.parse` and `LC_ALL=de_CH.UTF-8 date -j -f "%c"` on a March date |
| cost | `plot-worker-state.sh` line sources, `plan-walk-desks.ts:91-99`, `trees-git.ts:326-330`, `processes-shell.ts:200-210`, `restart-command.ts:77`, `packages/fleet/test/census/sandbox.ts:301-315` | downloaded `census-report-head` of CI run 42595561157 and diffed the S4 GitHub 0-desk row against the 3-desk row per command |
| operator | `agent-state.ts:109`, `rules/sample.ts:179`, `worker-loop.ts:121`, `:1602`, `:2600`, `plot-fleetctl.sh:68`, `:574`, `:930`, `plan-walk-desks.ts:107`, `:118`, `plot-dispatch.sh:1133` | nothing ran; every claim is a reading |

The moderator re-checked these claims against the code: the free-wait arm (`plot-worker-state.sh:1299`, `plot_worker_waits_free` at `:1162`; `AgentStateReadings` has no free-wait field, and `agentState` sends `orphaned` to `taskState` at `agent-state.ts:144`); the 30 s grace (`:977`, `:1010-1014`); `ps` empty → stale (`:352-353`); the dispatcher's `ps -o lstart=` with no `LC_ALL` (`plot-dispatch.sh:1510`); `Date.parse("Di.  3 März 13:14:40 2026")` → `NaN` against `Date.parse("Tue Mar  3 13:14:40 2026")` → 1772540080000 (Node 26 on this machine); `quietSeconds`'s `git log -1 --format=%ct` (`trees-git.ts:373`); the per-desk `build.mjs` read (`plot-desk-dirt.sh:85-98`); `readDeskReadings` reading `dirtyPaths` and `unpushedCommits` beside `workerState` (`plan-walk-desks.ts:91-99`); `restart-command.ts:77` (path `packages/fleet/src/shared/`) and `release-claim-reader.ts:57` constructing `processesShell` directly; `PLOT_MONITOR_ENDS_WORKER` defaulting to `1` (`worker-loop.ts:2600`). Every one holds. The recorded `pidStartedAt` files on this machine read `Mon Nov  9 08:42:51 2026` (locale `en_US.UTF-8`), so the locale defect is latent here and real on a German or French machine.

## Shared Amendments

No juror contests these. Each is applied to the plan.

1. **Grace window in `agentAlive`** (correctness 2, operator 1). A wrapper younger than `PLOT_AGENT_GRACE_SECONDS` (default 30) reads `unaskable`, never `absent`. Without it every new dispatch reads `orphaned`, then `finished` or `stalled`, for up to 30 s.
2. **A pid alive with no table row never reads `stale`** (correctness 3, operator 2). The shared table is older than the pid file for some desks. Both jurors require a fresh reading and a test with a pid started after the table read; they differ only in the mechanism (see *Disagreements* 3).
3. **Localized recorded start times** (correctness, operator 3; cost recommends the same rows). Add recorded `pidStartedAt` rows from non-English locales and both platforms to the `pidIsCurrent` corpus.
4. **The table's sharing is named** (cost 1, correctness 3). With `workerState(worktree, hasPr)` unchanged, each call reads its own table, and "1 `ps` per pass" fails.
5. **The registry keeps `unknown`, and failures name a reason** (operator 4, 5). A failed process table answers `failed` for the beat, not `stale` per desk.
6. **Keep `plot_worker_activity` and `plot_worker_cpu_centis`** (all three). The deletion removes 0 census processes and breaks `plot-quiet-stretch.sh:120`.
7. **Keep a CPU reading in slice 4** (all three). The log reading alone ends a working agent after 900 s of one silent tool call with exit 124. The jurors agree that the CPU reading stays; they differ on its order (see *Disagreements* 2).

Single-juror amendments that no other juror contests, also applied: the free-agent arm and the final-state corpus (correctness 1); the dispatcher stamps `pidStartedAt` under `LC_ALL=C` with no added line (correctness); per-desk bundle paths (correctness 4); 2 `git` for `quietSeconds` (correctness 5); `dirty` and `unpushed` read only for a non-live desk (cost 2); the manifest directory resolved once per process (cost 3); `restart-command.ts` and the other direct constructions (cost 4); a number for S4 (cost 5); a spawn-spy row for slice 4 and the statement that the census does not see it (cost 6); the idle verdict inputs in the ending record (operator 6).

## Disagreements

1. **Where the gathering lives.** correctness: `readWorkerReadings` takes the ports, as `readDeskReadings` does; placement does not affect correctness. operator: keep it in the workflow and amend the *A note on shape* sentence in `CLAUDE.md` in the same slice. cost: take values (the table, the file readings, `dirty` and `unpushed`) and let the `processesFiles` adapter gather them, because `readDeskReadings` already reads `dirtyPaths` and `unpushedCommits` per desk and a port-taking reader reads them a second time (`plan-walk-desks.ts:94-98`). The cost argument is a measurement of the current code; the other two are arguments about layering. The disagreement is real: two jurors would leave a second `git status` and `git rev-list` per desk open, one would not.
2. **The order of the two activity readings in slice 4.** correctness: a CPU sample from the held `table()` on every idle check, 1 `ps` per check. cost: the log first, and a CPU sample only when the log reads `idle`: 0 `ps` while the log moves, 1 otherwise. operator: the CPU reading stays primary and the log is an extra `working` signal, or log growth during a long tool call is measured before slice 4 is designed. The three agree that the CPU reading stays and disagree on whether the log can say `working` alone.
3. **What a live pid with no table row reads.** correctness: re-read the table once, then `unaskable`. operator: read that pid's start with `processesShell.startedAt` (one `ps -p`). Both forbid `stale`. The plan states the shared rule (one fresh reading, then `unaskable`) and leaves the mechanism to the implementer.
4. **When the 21/55 trace happens.** correctness and operator: a slice 1 deliverable, named in its PR (operator adds a row naming which caller reads `ended` or `orphaned`). cost: before slice 1's design is fixed, because the call count per desk decides the `table()` design.
5. **`PLOT_AGENT_PROCESS` in fleetd.** correctness: no new risk, fleetd already sources the shell in its own environment. cost: nothing sets the variable today; use the default and a corpus row with it unset. operator: do not trust fleetd's environment alone; read it from a recorded source or log the value fleetd uses, because `/plot-fleet --status` reads its own environment and the corpus runs both sides in one environment.
6. **Two views, two implementations** (operator 3, alone). `/plot-fleet --status` and `--stop` read `plot_worker_state` in the shell while the board reads the TypeScript copy. No other juror addresses it; it needs a decision on whether the plan adds an operator-visible comparison.

## Shared Blind Spot

All three lenses read the six callers the plan lists and none counted the construction sites. `processesShell(` is constructed at 21 sites in `packages/*/src` on `1b7f8ec6e`. At least 11 of them reach `workerState`, directly or through `readDeskReadings`: `scan-walk.ts:317`, `:339`, `refs-git.ts:410` (an adapter that composes `readDeskReadings`), `fleet.ts:3323`, `reap.ts:657`, `:1724`, `registryd-main.ts:578`, `:852`, `:1253`, `:3180`, `agent-run-for.ts:82`, `auto-fixer.ts:738`, `release-claim-reader.ts:57`, `restart-command.ts:77`. Cost found one of them. A site that keeps `processesShell` keeps the per-desk `bash` probe while the corpus and the spawn-spy test pass on the sites that changed. The plan now states that `processesShell` stops implementing `workerState`, so the type checker lists every site that still passes it as `Processes`; and that the per-pass table memo belongs to whoever constructs `processesFiles`, so a site that constructs one per call (`scan-walk.ts:339`) reads one table per call.

A second, smaller blind spot: the jurors treat the locale defect as a parse problem in TypeScript alone. The shell's `%c` fallback parses in the READER's locale. fleetd started by launchd may not carry the dispatcher's locale, so the shell can read a German recorded start as stale too. The plan's corpus rows therefore run `_plot_lstart_epoch` under `LC_ALL=C` as well as under the recording locale.

## Leftovers for the person

1. **Where does the gathering live?** Options: (a) `readWorkerReadings` takes ports, as `readDeskReadings` does, and `CLAUDE.md`'s *A note on shape* is amended in the same slice (correctness, operator); (b) the `processesFiles` adapter gathers, and the domain takes values, so `dirty` and `unpushed` come from `readDeskReadings`'s own reads (cost).
2. **Slice 4: which reading leads?** Options: (a) CPU sample from the held table on every idle check, 1 `ps` (correctness); (b) log first, CPU sample only on a still log, 0 or 1 `ps` (cost); (c) CPU primary, log as an extra `working` signal, or measure log growth during a long tool call first (operator).
3. **When is the 21/55 trace due?** Options: (a) in slice 1's PR (correctness, operator); (b) before slice 1's design is fixed (cost).
4. **Where does `PLOT_AGENT_PROCESS` come from in fleetd?** Options: (a) fleetd's environment with default `claude`, as today (correctness, cost); (b) a recorded source, or fleetd logs the value at start (operator).
5. **Does the plan add a check that the shell and board views agree?** Options: (a) `plot-fleetctl.sh --status` prints the board's state beside its own (operator); (b) the plan states that the views can differ and how the operator finds out (operator's alternative); no other juror took a position.
