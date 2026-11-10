# Triggers replace the tick

> fleetd arms directory watches through the `Watch` port and re-reads only the readings a trigger names. The 5 s scan, its `git fetch --prune` and the 60 s supervision tick stop on an idle repository. Deadlines wake fleetd on in-process timers that re-check the wall clock after a sleep or a clock jump. A full read every 10 minutes logs each change the triggers missed.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches

## Changelog

- An idle fleetd starts no process. fleetd watches the repository's refs, each desk's git state and files, the agent registry and `CLAUDE.md`, and reads again only what changed. It fetches from the remote only when the git host reports a new default-branch head, a merged pull request or a new or deleted branch, and on a full read every 10 minutes. That full read logs each change the watches missed. fleetd measures the machine only when it decides to start an agent.

Board impact: the board reads the snapshot and the heartbeat as before. The heartbeat's observer fields (`watchesWanted`, `watchesArmed`, `lastEventAt`, `lastSafetyNetAt`) carry real values, and the rule that reads a loop as late changes for the loops that wait on triggers. The plan format, the plan template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

Phase 8 of the story [*Nothing changed, nothing runs*](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md) (#3170). Phases 1 to 6 removed every per-pass source that a cheaper read could replace. The rest of an idle fleetd pass is the schedule itself: the scan runs on every 5 s beat and the supervision tick runs every 60 s, whether something changed or not.

**The census.** CI run 42874101153 on the sprint PR #3380 (`sprint/desk-probes-and-liveness` at `38411b761`, 2026-11-10) against its merge base with `main`:

| Row | Fixture | HEAD | merge base (`main`) | Target |
|---|---|---|---|---|
| S4 | GitHub, 0 desks, 5 open PRs | 516 `execve` per pass | 1103.5 | 0 |
| S4 | GitHub, 3 desks, 5 open PRs | 839 | 2552.5 | 0 |
| S4 | Bitbucket, 3 desks, 5 open PRs | 1879 | 2519 | 0 (see Open Questions) |
| S5 | GitHub, 3 desks, one desk commit | 844 `execve` per change | 2554 | measured, then held |
| S6 | GitHub, 3 desks, one PR's CI turns green | 863 `execve` per change | 2658 | measured, then held |
| safety-net pass | — | no row | no row | measured, then held |

The PR into the sprint branch, #3381 (CI run 42869810773, head `9cb59bd9b`), reads the same figures against the sprint head: S4 516, 838 and 1873; S5 843; S6 862. The largest images in S4 on GitHub with 3 desks are `git` 316, `grep` 292, `awk` 222, `sed` 194 and `bash` 180. S5 and S6 cost what an idle pass costs: a change triggers nothing that the schedule does not already run.

**What one idle pass starts.** fleetd's direct children per pass, recorded through the census entry's `CENSUS_SPAWN_LOG` on macOS at `38411b761` (GitHub, 3 desks, 5 open PRs; the census suite with `trace: false`, so no `strace` and no grandchildren):

| Direct children per pass | Image and arguments | Source |
|---|---|---|
| 54 | `bash plot-config.sh get <key>` (`Plan directory` 16, `Active index`, `Delivered index`, `Branch prefixes`, `State branch`, `Main branch` 5 each) | the scan's walk, once per scan, and the tick |
| 36 | `git --no-optional-locks -C <desk> status` (12 per desk) | the walk's desk readings and the tick |
| 25 | `git log --boundary --format=%m\|%H\|…` | the walk |
| 30 | `git -C <desk> rev-list` and `git -C <desk> log` (10 per desk) | the walk's branch readings |
| 10 | `git rev-parse --git-dir` | the machine probe, 5 samples (`machine-system.ts:9`) twice per tick |
| 8 | `bash plot-plan-meta.sh --prefixes …` | the walk |
| 7 | `git remote get-url origin` | the walk |
| 6 | `bash plot-host.sh pr-merged <branch>` (2 per desk) | the tick |
| 5 | `git -C <repo> fetch -q --prune …` | the walk, once per scan (`fleet-scan.ts:832`) |
| 10, 8 | `git log main --merges` and `--diff-filter=AR`; `git rev-parse --short main` and `HEAD` | the walk |
| 1–3 | `bash plot-host.sh spend-rate` | the listing read, the PR reader and the tick line (`fleet-scan.ts:327`, `pr-refresh.ts:715`, `registryd-main.ts:494`) |
| 1 each | `node plot-state-sync.mjs --forward`, `node plot-merger-token.mjs --check`, `git ls-remote origin main`, `ps -A -o pid=,ppid=,lstart=,time=,comm=`, `git hash-object --stdin-paths` | state sync (`state-sync-tick.ts:48`), the Merger App check (`merger-app-shell.ts:7`), `refs-remote-git.ts:81`, the process table (`processes-files.ts:567`), the plan parser hash (`fleet-scan.ts:850`) |

The two idle passes read 214 and 216 direct children; the desk commit (S5) and the CI change (S6) read 220 each. A census pass advances the manual clock by 24 beats at once, and the scan's in-flight guard (`fleet-clock.ts:88-104`) drops the beats that arrive while a scan runs, so a census pass holds 5 scans. In wall time the scan runs 24 times per 120 s. The source column groups by call order in the log; the *Tick waits* slice confirms each attribution with `CENSUS_SPAWN_CALLER=1`.

**What exists.** `the-snapshot-entity` delivered the pieces this plan connects, and none of them has a caller in fleetd yet:

- the `Watch` port (`packages/domain/src/ports/watch.ts`, 46 lines) and its `fs.watch` adapter `watchFs` (`packages/domain/src/adapters/watch/watch-fs.ts`, 66 lines), which arm directories only and re-arm after a rename;
- `SnapshotChange` and `staleReadings` (`packages/domain/src/rules/snapshot-stale.ts:9-79`), one change kind per row of the story's trigger table;
- the heartbeat's observer fields `watchesWanted`, `watchesArmed`, `lastEventAt` and `lastSafetyNetAt` (`packages/domain/src/entities/fleetd-heartbeat.ts:70-77`), which fleetd writes as `0`, `0`, `null` and `null` (`packages/fleet/src/shared/fleetd-heartbeat.ts:92-95`).

`liveness-token` delivered the trigger "a worker ends without a record": the token's end-of-file.

## Design

This plan depends on the sprint `desk-probes-and-liveness` (PR #3380) reaching `main`: every line number below is read on `origin/sprint/desk-probes-and-liveness` at `38411b761`, and `sprint/triggers-and-connectors` is cut from a `main` that does not yet hold that code. It covers no connector: Bitbucket, Jira and Jenkins reads move in-process in the Phase 7 plans. It shares `registryd-main.ts`, `fleet-scan.ts` and `fleet-clock.ts` with no other Phase 8 plan.

### Approach

**The trigger set.** fleetd arms one watch per source through `watchFs`. Each event goes through a new pure domain rule, `changeOf(event, layout)` in `packages/domain/src/rules/snapshot-change.ts`, which maps a `WatchEvent` to one `SnapshotChange` or to none. `staleReadings` then names the readings to read again. fleetd keeps the named readings in one pending set.

| Watch | Recursive | Change it raises |
|---|---|---|
| the common git dir's `refs/` | yes | `refs` |
| the common git dir itself (`packed-refs`) | no | `refs` for `packed-refs`; none for every other name |
| `<common git dir>/worktrees/<desk>/` (`HEAD`, `index`) | no | `desk-git` for that desk |
| each desk root (`PLOT-BLOCKED`, `PLOT-CORRECTION.md`, `.plot-worker.*`) | no | `desk-files`; `worker-log` for `.plot-worker.log` |
| the `Agent registry` directory | no | `registry` |
| the main checkout's root (`CLAUDE.md`) | no | `config` for `CLAUDE.md`; none for every other name |

fleetd never watches `.git/` recursively: `objects/` alone holds 256 directories (story, *Failure modes*). A desk added or removed re-arms the desk set. The token's end-of-file raises `worker-gone`.

**Plans come from a ref.** The walk reads plans from `origin/<main>` (`fleet-scan.ts:841`), not from the checkout. A refs change therefore covers plan, sprint and story content. `staleReadings` names `sprints` and `stories` for a refs change and not `plans` (`snapshot-stale.ts:43-53`); Open Question 1 asks whether the refs change names `plans` too and whether any plan-directory watch remains.

**Self-caused events, by content.** fleetd's own `git status` and `git fetch` write files that fleetd watches. A refs event whose `RefsValue.digest` equals the held digest changes nothing; an index event whose checksum equals the last read changes nothing. fleetd never ignores events for a time window, because a real change in that window would go missing (story, *Self-caused events*).

**The pending set drains on the next beat.** The fleet clock keeps its 5 s pulse as an in-process timer. A beat with an empty pending set, no degraded watch and no due safety net starts nothing. A beat with a non-empty set runs one scan over the named readings and reuses the held ones. Open Question 6 asks whether the drain waits for the beat or runs on the event.

**The fetch leaves the walk.** `walkOnce` runs `git fetch --prune` on every scan (`fleet-scan.ts:832`; the story cites `:32` and `:713` on an older `main`). The fetch moves to two places: a `remote` change, which the listing read raises when its answer names a new default-branch head, a newly merged PR or a branch that appeared or went away; and the safety net. A claim pushed from another machine with no PR appears within one safety-net interval, and the remote still refuses a second claim push (`refs-remote-git.ts:79`).

**Deadlines are timers.** A new domain rule `nextDeadline(readings, bounds, now)` in `packages/domain/src/rules/next-deadline.ts` returns the earliest wall time at which any deadline rule can change its answer, with the rule's name. The bounds are the ones the story names: `Claim stale after` (`plot-reconcile-scan.sh:374`; no file under `packages/` reads the key today), `Slice idle after` (`registryd-main.ts:1101`, `slice-idle.ts:141`), `Worker bound` (`fleet-run.ts:59`), `Checks wait` (`registryd-main.ts:851`), the fixer bound (`FIXER_BOUND_SECONDS`, `fixer-attempts.ts:8`), the default-branch re-ask at half `Checks wait`, the issue read (`ISSUE_REFRESH_MS`, `cadence.ts:400`) and the PR beat (`PR_READ_BEAT_MS`, `pr-status.ts:116`). fleetd sets one in-process timer to the earliest one. A deadline names no readings (`snapshot-stale.ts:69-70`): the rule that owns it runs over the readings already held.

**Wake and clock jumps.** The `Clock` port (`ports/clock.ts`) answers `now()` and `schedule(intervalMs)` today. It gains a monotonic reading and a one-shot timer, and `clockSystem` and `clockManual` (`adapters/clock/clock-system.ts:13`, `:61`) implement both. A new domain rule `clockDrift(previous, current)` compares elapsed wall time with elapsed monotonic time between two fleet beats (`REFRESH_MS`, 5 s, `fleet-scan.ts:45`). Above a bound (Open Question 4) it reads a wake or a jump, and fleetd re-checks every deadline against the wall clock and runs one full read. The rule reads both clocks only through the port. The census entry moves `Date.now()` by 120 s per pass while the process's monotonic clock moves about one second (`fleetd-census-entry.ts`, `offsetMs`); a rule that read `Date.now()` and `performance.now()` directly would read a jump on every census pass and S4 could never reach 0. `clockManual` advances both readings together.

**The safety net.** Every 10 minutes, at start and after a wake, fleetd runs a full read: every reading key (`staleReadings({ kind: 'safety-net' })`), one `git fetch --prune` and one `git --no-optional-locks status` per desk. A new domain rule `missedChanges(held, fresh, named)` in `packages/domain/src/rules/missed-changes.ts` names each reading key, and each desk for a per-desk key, whose fresh answer differs from the held one while no trigger named it since the last full read. fleetd writes one log line per difference, `plot-fleetd: safety net: <key> [<desk>] changed with no trigger`, and stamps `lastSafetyNetAt`. Until the *Scan on trigger* slice lands, every 5 s scan is a full read, so the rule runs on every scan and measures the watches' coverage on running fleets before any beat stops.

**A waiting loop reads late by the heartbeat's age.** `lateLoops` reads `scan` as late 180 s after its last pass and `tick` 300 s after (`FLEETD_LOOP_BOUND_MS`, `fleetd-live.ts:17-22`, `:85-89`). The board trusts the snapshot only while no loop reads late (`observerFresh`, `board-watch.ts:108`), and it runs `plot-fleetctl.sh --status` when a loop reads late. An idle scan under triggers passes once per safety-net interval, so the bound as written would send the board back to its own reader and turn S3 from 0. Decided by jwloka on 2026-11-10 (Open Question 5): fleetd writes its heartbeat on every 5 s fleet beat (`REFRESH_MS`, `fleet-scan.ts:45`), also on a beat that starts no scan, in place of the 10 s heartbeat timer (`FLEETD_HEARTBEAT_MS`, `fleetd-live.ts:5`). `lateLoops` reads `scan` and `tick` as late when the heartbeat's `beatAt` is older than the loop's bound, not when the last finished pass is. The bound stays 180 s for `scan`, so a dead fleetd still reads late within today's bound. The heartbeat is a file write from an in-process timer and starts no process. The *Scan on trigger* slice makes this change, so it lands with the first slice that lets a scan wait on triggers and S3 stays 0.

**A degraded watch polls.** `watchFs` sets `degraded` when a directory cannot be armed or a re-arm fails (`ports/watch.ts:24`). The source of a degraded watch goes back to a read on every beat, and the heartbeat's `watchesArmed` stays below `watchesWanted` so readers can see it. Open Question 3 asks what `--interval` means then.

**The fleet size is measured on a dispatch decision.** `readTick` asks `world.headroom()` before it reads any agent (`supervisor.ts:157`), and the tick asks `fleetCapForRepo` (`registryd-main.ts:1447-1453`, passed at `:3345`) whenever `--start-agents` is set. Each asks `machine.measure(MACHINE_SAMPLES)`, 5 `git rev-parse --git-dir` forks. Both move behind the decision that reads them: supervision asks the headroom only for an agent whose verdict would relaunch it, and the hand-over asks the cap only when the queue holds a startable slice. A tick that starts nothing measures nothing.

**The beat readers start nothing on an idle beat.** The PR reader and the issue reader stay on their in-process timers: they buy host answers, and a host answer that differs is a trigger. Three of their neighbours still start a process per beat:

- `plot-host.sh spend-rate` (`fleet-scan.ts:327`, `pr-refresh.ts:715`, `registryd-main.ts:494`) reads the budget ledger `budget.tsv`; the `Budget` port's file adapter (`adapters/budget/budget-file.ts`) answers the same rate in-process, and a corpus row holds the two to agreement.
- `plot-state-sync.mjs --forward` (`state-sync-tick.ts:48`) runs every twelfth beat; it runs on a refs change that moves the state branch or the default branch, and on the safety net.
- `plot-merger-token.mjs --check` (`merger-app-shell.ts:7`) runs once per process lifetime, on a change of the key file's directory, and before a merge.

**The tick waits.** The supervision loop waits in `pause` on `sleep(args.intervalMs)` (`registryd-main.ts:3280-3284`). It waits instead on the first of: a scan that drained a non-empty pending set, a `registry`, `desk-files` or `worker-gone` change, and `nextDeadline`. The tick's own reads (`pr-merged` per agent, the desks' `status`, `madeProgress`) then run only on a tick that a trigger started. Every destructive decision still re-asks its evidence immediately before it acts (story, *Re-ask before acting*), and an action is itself a trigger outside the idle count.

**The census pass.** A census pass ends on `reportTick`'s log line today, because the tick waits on the entry's `sleep` seam (`fleetd-census-entry.ts`, `pass`). Once the tick waits on triggers, a pass advances the manual clock by 120 s and ends when no direct child has run for `QUIET_MS` (300 ms). S5 and S6 keep their windows: the change lands between two marks, and its triggered reads fall inside them.

**Layering.** `changeOf`, `nextDeadline`, `clockDrift` and `missedChanges` are pure rules in `packages/domain/src/rules/` over readings as values; none imports a port. The domain owns the `Watch` and `Clock` ports; `watchFs` and `clockSystem` stay the only places that reach `fs.watch` and the timers. fleetd's composition root (`registryd-main.ts`) arms the watches, holds the pending set and calls the rules; `packages/fleet/src/shared/` gains no decision.

**Census rows.** The plan adds four rows to `census-rows.ts` and to the *Retired and added rows* table of `docs/process-census.md`:

| Row | Claim | Target | Slice |
|---|---|---|---|
| P7 | an idle fleetd pass starts no `git rev-parse --git-dir` | zero | Fleet size |
| S8 | a safety-net pass | measured, 10 % + 2 | Safety net |
| P8 | an idle fleetd pass starts no `git fetch` | zero | Scan on trigger |
| P9 | an idle fleetd pass starts no `plot-host.sh spend-rate`, `plot-state-sync.mjs` or `plot-merger-token.mjs` | zero | Quiet beats |

S4 is written as `it.fails` naming `triggers-replace-the-tick`, Phase 8 (`census-rows.ts:54-60`). The *Tick waits* slice adds its slice name and `green: true`.

**What each slice moves.** Every slice keeps the census gate green: a zero row it adds is green when it merges, and every count it does not target stays within 10 % + 2 of its merge base. Expected moves on the GitHub 3-desk fixture, from the direct-child table above:

| Slice | Row it turns green or adds | S4 | S5, S6 |
|---|---|---|---|
| Fleet size | P7 | −10 direct children per pass | −10 each |
| Deadlines | none; S4 held | unchanged | unchanged |
| Watches arm | none; S4 held | unchanged | unchanged |
| Safety net | S8 added | unchanged | unchanged |
| Quiet beats | P9 | −3 to −5 direct children per pass | unchanged or lower |
| Scan on trigger | P8 | every scan child of an idle pass | a desk commit reads one desk; a CI change runs no fetch |
| Tick waits | S4 green on GitHub | 0 | measured, then held |

The *Scan on trigger* slice records its S4, S5 and S6 figures in its PR and in the story's Measures table; this plan states no number for them before the slice measures it.

### Open Questions

- [ ] **1. A refs change and plan content.** The walk reads plans from `origin/<main>` (`fleet-scan.ts:841`), and `staleReadings` names `walk`, `sprints` and `stories` for a refs change but not `plans` (`snapshot-stale.ts:43-53`). Options: (a) a refs change also names `plans`, and fleetd arms no watch on the plan, sprint or story directories; (b) keep the `plan-content` change and arm those directories in the main checkout. **Recommendation: (a).** fleetd reads no plan from the checkout, so a directory watch there raises changes that no reading takes, and every edit an operator makes in the main checkout would start a scan.
- [ ] **2. S4 on Bitbucket.** The Bitbucket listing still reads through `bb` on its 60 s cadence (`LISTING_REFRESH_MS`, `fleet-scan.ts:66`) until Phase 7's `bitbucket-reads-in-process`, so a 120 s census pass on Bitbucket starts host processes after this plan. Options: (a) split S4 by host: the *Tick waits* slice turns the GitHub fixtures green, and the Bitbucket fixture stays `it.fails` naming `bitbucket-reads-in-process`; (b) S4 stays one row and turns green only after Phase 7. **Recommendation: (a).** Each fixture then names the plan that turns it green, and Phase 8 does not wait on a connector plan.
- [ ] **3. `--interval` after the tick waits.** fleetd's `--interval` sets the tick's sleep (`TICK_INTERVAL_MS`, 60 s, `registryd.ts:89`). Options: (a) it sets the tick's cadence only while a watch is degraded; (b) it is removed; (c) it stays an upper bound on the wait. **Recommendation: (a).** A degraded watch needs a cadence, and an upper bound in (c) runs an idle tick every 60 s, which S4 counts.
- [ ] **4. The wake and jump bound.** `clockDrift` reads a wake or a jump when elapsed wall time and elapsed monotonic time between two heartbeat beats differ by more than a bound. **Recommendation: two fleet beats, 10 s.** A smaller bound reads a loaded machine's late timer as a jump and runs a full read; a larger one leaves a deadline unchecked for longer after a wake. A person decides.
- [x] **5. When a waiting loop reads late.** The rule decides when the board stops trusting fleetd's snapshot and runs `plot-fleetctl.sh --status`; a wrong rule either sends every idle board back to its own reader (S3 turns from 0) or keeps a board on a wedged fleetd. **Decided 2026-11-10, jwloka: fleetd writes its heartbeat on every 5 s beat, also when it starts no scan, and the board reads the heartbeat's age, not the last finished scan or tick. A dead fleetd is still seen within today's bound (180 s).** The *Scan on trigger* slice changes `lateLoops` to match (*A waiting loop reads late by the heartbeat's age*).
- [ ] **6. Drain on the beat or on the event.** Options: (a) the pending set drains on the next 5 s beat; (b) it drains on the event, after a short in-process debounce. **Recommendation: (a).** The latency stays at today's 5 s, the scan keeps its in-flight guard and its 90 s budget, and a burst of events (a rebase writes many refs) costs one scan.
- [ ] **7. Where a missed change is shown.** `missedChanges` writes a log line per difference. Options: (a) the log line only; (b) the log line and a count in the heartbeat; (c) also a board notice. **Recommendation: (b).** A count in the heartbeat lets the census and an operator see drift without reading the log, and a board notice needs a design this plan does not carry.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A tick that starts nothing measures nothing | census P7 reads 0 on every fixture; a supervisor test: `headroom()` is not called when no verdict relaunches, and `fleet()` is not called when the queue holds no startable slice | Fleet size |
| A dispatch still reads the machine | test: a queue with a startable slice and free slots asks `fleetCapForRepo` once; a relaunch verdict asks `headroom()` once per tick | Fleet size |
| Every deadline has a timer | `nextDeadline` rows: one per bound in *Deadlines are timers*, each returning that rule's next change time; an empty estate returns none | Deadlines |
| A wake re-checks every deadline | test on `clockManual`: the monotonic clock stands still while the wall clock moves 30 minutes; `clockDrift` reads a wake, every deadline is checked against the wall clock, and one full read runs | Deadlines |
| The census clock is not a jump | test: the census entry's pass moves both readings of `clockManual`; `clockDrift` reads no jump; census S4 holds within tolerance | Deadlines |
| A second commit still triggers | test: two commits in one desk raise `desk-git` twice through `watchFs` | Watches arm |
| A rewritten `packed-refs` triggers | test: `git pack-refs --all` raises `refs`; a `FETCH_HEAD` write raises nothing | Watches arm |
| A self-caused event changes nothing | test: fleetd's own `git status` and `git fetch` with no ref move leave the pending set empty | Watches arm |
| A missing directory is visible | test: a desk root that cannot be armed reads `degraded`, and the heartbeat's `watchesArmed` is below `watchesWanted` | Watches arm |
| The heartbeat carries real observer fields | test: after start, `watchesWanted` and `watchesArmed` equal the armed set and `lastEventAt` moves on an event | Watches arm |
| The safety net logs what the watches missed | test: a reading changed with its watch closed produces one `plot-fleetd: safety net:` line naming the key and the desk; a change a trigger named produces none | Safety net |
| The safety net has a measured cost | census S8 recorded on every fixture and held within 10 % + 2 | Safety net |
| The beat readers start nothing on an idle beat | census P9 reads 0 on the GitHub fixtures; a corpus row holds the `Budget` port's rate to `plot-host.sh spend-rate` | Quiet beats |
| State sync follows the refs | test: a refs change that moves the state branch runs `plot-state-sync.mjs --forward` once; an idle beat runs it zero times | Quiet beats |
| An idle pass fetches nothing | census P8 reads 0 on every fixture; a test: a listing answer that names a new default-branch head runs one fetch, and a CI change runs none | Scan on trigger |
| A change reads only what it names | test: a desk commit re-reads that desk's status and no other desk's; census S5 and S6 read below their merge base, and the slice records both figures | Scan on trigger |
| An idle board keeps trusting fleetd | census S3 and S7 read 0 | Scan on trigger |
| A quiet fleetd reads live | test on `clockManual`: fleetd starts no scan for 10 minutes and writes a heartbeat on every 5 s beat; `fleetdLiveness` reads `live` and `lateLoops` names no loop throughout | Scan on trigger |
| A dead fleetd reads late within the bound | `lateLoops` rows: a heartbeat whose `beatAt` is older than 180 s names `scan`; one 179 s old names none | Scan on trigger |
| A claim from another machine appears | test: a claim ref pushed to the remote with no PR appears in the snapshot after one safety-net pass | Scan on trigger |
| An idle fleetd pass starts nothing | census S4 reads 0 on the GitHub fixtures; the row carries `green: true` and the slice name | Tick waits |
| A deadline still fires | test on `clockManual`: a slice past `Slice idle after` produces its finding on the timer, with no trigger | Tick waits |
| A destructive action re-reads its evidence | the re-ask tests of `plot-ask.mjs merge`, the worktree removal and the claim release pass unchanged | Tick waits |
| fleetd restarts with a full read | test: a fleetd start runs one full read and re-derives every desk's finding | Tick waits |

## Slices

### Wave 1

- `feature/triggers-replace-the-tick-fleet-size` — supervision asks `headroom()` only for a relaunch verdict, and the hand-over asks `fleetCapForRepo` only for a startable slice; census row P7 <!-- builds: a machine reading asked on a dispatch decision only -->
- `feature/triggers-replace-the-tick-deadlines` — `nextDeadline` in `rules/next-deadline.ts`; `clockDrift` in `rules/clock-drift.ts`; the `Clock` port's monotonic reading and one-shot timer in `clockSystem` and `clockManual`; the census entry moves both readings; fleetd logs the next deadline on the tick line and runs a full read on a wake <!-- builds: nextDeadline, the earliest wall time a deadline rule can change its answer -->
- `feature/triggers-replace-the-tick-watches` — fleetd arms the watch set through `watchFs`; `changeOf` in `rules/snapshot-change.ts`; the pending set; self-caused events by content; the heartbeat's observer fields; the scan still runs on every beat and clears the set <!-- builds: changeOf, a watch event mapped to a snapshot change -->

### Wave 2

- `feature/triggers-replace-the-tick-safety-net` — the 10-minute full read with one fetch and one desk status per desk; `missedChanges` in `rules/missed-changes.ts` runs on every full scan; the log line and `lastSafetyNetAt`; census row S8 and a census command that runs a safety-net pass <!-- builds: missedChanges, the readings a full read found changed with no trigger -->
- `feature/triggers-replace-the-tick-quiet-beats` — `spend-rate` through the `Budget` port with a corpus row; state sync on a refs change of the state or default branch; the Merger App check once per process and before a merge; census row P9 <!-- builds: a beat that starts no process -->

### Wave 3

- `feature/triggers-replace-the-tick-scan` — the scan runs only on a non-empty pending set, a degraded watch or a due safety net, and re-reads only the named readings; the fetch leaves the walk for a `remote` change and the safety net; fleetd writes its heartbeat on every 5 s beat and `lateLoops` reads `scan` and `tick` by the heartbeat's age; census row P8 <!-- builds: a scan started by a trigger -->

### Wave 4

- `feature/triggers-replace-the-tick-tick` — the supervision loop waits on a drained scan, a registry, desk-files or worker-gone change, and `nextDeadline`; the census pass ends on quiet instead of `reportTick`; S4 green on the GitHub fixtures; the story's Measures table <!-- builds: a supervision tick started by a trigger or a deadline -->

## Notes

- Phase 8 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); candidate plan `triggers-replace-the-tick`. The story estimates 4–5 slices; this plan holds 7, because the census rows P7, P8 and P9 each need a slice that turns them green alone.
- Census row numbering: this plan adds P7, P8, P9 and S8. The Phase 7 plan (#3389) numbers its rows P10 and P11.
- Depends on `board-reads-the-channel`, `refs-from-files`, `desk-probes-in-domain`, `github-reads-in-process` and `liveness-token`, all delivered on `sprint/desk-probes-and-liveness` (PR #3380, open on 2026-11-10).
- Census figures: `census-compare` of CI run 42874101153 (PR #3380, `38411b761`, against `main`) and of CI run 42869810773 (PR #3381, `9cb59bd9b`, against the sprint head). The top-image counts come from the `census-head` job logs of the same runs.
- Direct-child figures: one local run of the census suite's fleetd entry with `CENSUS_SPAWN_LOG`, `trace: false`, on macOS, Node v26.13.0, at `38411b761`, GitHub fixture with 3 desks and 5 open PRs, passes 2 and 3 idle, pass 4 after one desk commit, pass 5 after one PR's CI turned green. The suite file was a scratch file and is not part of this plan.
- Deliverable search (`plot-deliverable-search.sh`) for `nextDeadline`, `safetyNet`, `triggerSchedule`, `wallClockJump`, `fetchOnRemote` and `armWatches` found no existing deliverable. It found the heartbeat's observer fields (`fleetd-heartbeat.ts:92-95`), which this plan fills, and unrelated uses of "deadline", "trigger" and "fetch".
- Line numbers checked on `origin/sprint/desk-probes-and-liveness` at `38411b761`, 2026-11-10.
- Definition of Done: docs/definition-of-done.md.
