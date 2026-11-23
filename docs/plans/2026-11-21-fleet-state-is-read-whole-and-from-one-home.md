# Fleet state is read whole and from one home

> `plot-ask.mjs merge` and `repair-pr`, and fleetd, read `.plot/state` from the main checkout when they run in a linked worktree, and refuse by name where they cannot find it. fleetd's main repair stops waiting on the first red commit's re-run after `Checks wait` and gives the repair agent its full `Main repair bound`. The board's worker log, dispatch and implement routes read a partial pulse as partial.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3207, #3136, #3208
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3609 merged
- **Started:** 2026-11-21, Jan Wloka, `bug/merge-reads-the-main-checkouts-state`
- **Started:** 2026-11-22, Jan Wloka, `bug/the-repair-start-decision-moves-into-the-domain`
- **Started:** 2026-11-22, Jan Wloka, `bug/the-first-red-rerun-wait-ends-at-checks-wait`
- **Started:** 2026-11-22, Jan Wloka, `bug/merge-refuses-an-unfound-state-home`
- **Started:** 2026-11-23, Jan Wloka, `bug/every-state-reader-asks-one-state-home`
- **Started:** 2026-11-23, Jan Wloka, `bug/the-board-routes-read-a-partial-pulse`

## Changelog

- `plot-ask.mjs merge` and `plot-ask.mjs repair-pr`, run from a linked worktree, read the repair record and the default-branch reading of the main checkout. A merge from a worktree on a red default branch now refuses `default-branch-red`; before, it read no reading and merged.
- A merge from a linked worktree now refuses `default-branch-stale` where the main checkout's reading is older than `Checks wait`, as it does in the main checkout.
- `plot-ask.mjs merge` and `plot-ask.mjs repair-pr` refuse `state-home-unread` where git cannot name the main checkout, instead of reading an empty directory.
- fleetd's main repair waits at most `Checks wait` for the re-run of the first red commit. Past that bound it starts a repair, and the repair agent gets the full `Main repair bound` from the moment it starts.
- fleetd logs why it still waits on a re-run: `rerun-unanswered`, `rerun-unmatched`, `rerun-unconcluded` or `rerun-grace`.
- The board's worker log answers "the fleet scan has not reached this branch yet" for a branch that an unfinished scan has not reached, instead of "no worktree". The dispatch and implement routes refuse `pulse-partial` for a plan that an unfinished scan has not reached, and the implement route starts no run.
- fleetd's main repair starts a repair when a later commit settles red with different failing jobs than the first red commit.
- The repair record keeps version 1 and gains two optional fields, `attempt.startedAt` and `firstRedFailing`. Restart fleetd once after these changes merge: an older fleetd reads a record that holds either field as unreadable and does not act on the episode until it restarts.

<!-- Board impact: the board server changes in slices 1, 4, 5, 6 and 7 (merge-ports.ts, estate.ts, entry/main.ts, board.ts, design.ts, verify.ts, review.ts, approve.ts, worker-log.ts, dispatch.ts, implement.ts, agent-panel.ts), and the worker-log modal gains two sentences (WorkerLogModal.tsx). No plan format, template, helper script or docs/plans layout changes. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

The plan answers three defect families. Slices run in heading order: a slice is eligible only when every earlier heading is complete (`sliceVerdicts`, `packages/domain/src/rules/eligible.ts:165-172`). **The #3207 merge fix comes first, because it is the most dangerous defect: a merge gate that opens silently when the caller runs in a linked worktree.** The #3208 decision move and bound follow, because the bound fixes a defect that held 34 PRs for two hours. The rest of #3207 and then #3136 follow. Slice 8 (#3208's job comparison) is last.

**#3207, the merge gate opens in a worktree.** `contextFrom` sets `repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd()` (`packages/board/src/server/entry/main.ts:111`). The file adapters join `.plot/state/…` onto that root with no resolution: `repairRecordPath` (`packages/domain/src/adapters/repair-record/repair-record-file.ts:10-11`), `defaultBranchPath` (`packages/domain/src/adapters/default-branch/default-branch-file.ts:13-14`), and the base-branch paths in the same module (`:67`, `:71`). The merge path reads them through those adapters: `repair: repairRecordFile(opts.repoRoot)` (`packages/board/src/server/entry/merge-ports.ts:62`, `main.ts:218`), `baseBranch` and `baseRepair` (`main.ts:219-220`), and `defaultBranch: defaultBranchFile(opts.repoRoot)` (`packages/board/src/server/estate.ts:88`). A linked worktree has no `.plot/state`, so the read answers "no file", and `MergeReadings.defaultBranch` is `null` (`packages/domain/src/workflows/merge.ts:75`), which holds nothing. Measured 2026-11-06 from `.worktrees/scratch-sprint-add`: `plot-ask.mjs repair-pr 3199` answered `{"named":false,"reason":"no-open-episode"}` and the same call from the main checkout answered `{"named":true,"pr":3199}`; every `plot-ask.mjs merge` from the worktree that day returned `"defaultBranchRead":false`.

The four adapters have 25 callers outside tests, and each passes a raw `repoRoot`: the board's merge path (`merge-ports.ts:62`, `main.ts:218-220`, `estate.ts:88`, `board.ts:472`), and fleetd's merge arm (`packages/fleet/src/shared/auto-merge.ts:371,390-391,397,413`), review arm (`auto-review.ts:215,219`), fixer (`auto-fixer.ts:703`), repair and revert worlds (`repair-start-world.ts:64,67`, `revert-start-world.ts:110,113`) and writers (`packages/fleet/src/server/entry/registryd-main.ts:1166,3036,3517-3518,3574-3575,3832,3845`). A fixed caller list breaks the next time someone adds a caller, so slice 1 gates the type instead.

**The estate has two state homes, and this plan unifies one.** The repair record, the default-branch reading, the base readings, the fleet bridge and the fleetd heartbeat live under `<main checkout>/.plot/state`. At least 14 other adapters keep their files under `<git common dir>/.plot/state` and resolve that directory themselves through `processAnswers.commonDir`: for example `pr-index-file.ts:86-95`, `issue-index-file.ts:64`, `reader-lock-file.ts:91`, `answer-record-file.ts:91`, `run-log-file.ts:111` and `slice-spend-file.ts:96`. Those adapters are already worktree-safe, `PLOT_PR_INDEX_HOME` and the `plot-pr-index-lookup.mjs` shell consumers depend on their location, and this plan does not move them.

The main-checkout home is resolved in several places, each on its own:

| Resolver | Where | Sync | On failure |
|---|---|---|---|
| `mainRootOf` | `packages/domain/src/adapters/main-checkout.ts:20`, used by `bridgePath` (`fleet-state/fleet-state-file.ts:35`), `fleetdHeartbeatPath` and `readFleetdHeartbeatSync` (`fleetd-heartbeat/fleetd-heartbeat-file.ts:18,68`), `processes-files.ts:430,505` and `recordBridge` (`packages/board/src/server/entry/pulse-log.ts:75`) | yes | falls back to `repoRoot` silently (`main-checkout.ts:29-30`) |
| `Trees.mainRoot` | port `packages/domain/src/ports/trees.ts:694`, adapter `trees/trees-git.ts:776-779` | no | a failure where git cannot answer; the input path itself where the common dir is not named `.git` |
| `mainRootOf` (private) | `packages/board/src/server/entry/approve.ts:1390`, over `Trees.mainRoot` | no | falls back to `repoRoot` |
| `resolveRepoRoot` / `machineDeps` | `packages/board/src/server/entry/design.ts:281`, `verify.ts:854`, `review.ts:664`, over `processAnswers.absoluteCommonDir` | no | the `refsGit.repoRoot()` probe (`design.ts:284-285`, `verify.ts:857-858`), or `null` |

`mainRootOf` realpaths the answer (`main-checkout.ts:27`) and `Trees.mainRoot` does not, so two resolvers can name one checkout with two different strings.

**#3208, the repair waits on a re-run with no bound.** On 2026-11-06 the episode opened at 10:18Z on `35539a20c` (a runner failure); the re-run of its CI completed `success` at 10:32:53Z; from about 10:43Z the head `501d32861` read red for a new, deterministic failure. fleetd logged `repair awaiting-rerun` on every tick, held 34 PRs for about two hours and started no repair, until a person opened #3199 at about 13:25Z. `rerunSettledOf` answers `pending` for three different readings: runs `null`, a fold of `unknown` (no run matched a declared check, `packages/domain/src/rules/default-branch.ts:97-103`), and an unconcluded run (`packages/domain/src/rules/repair-start.ts:34-36`); none has a bound. `redMainStep` answers `await-rerun` for `pending` and `none` (`packages/domain/src/rules/repair.ts:242-246`) and compares no failure of the settled commit with the first red's. The fleet holds part of the decision: `repairStartTick` builds `rerunSettled` from a `runsForSha` ask inside a host slot (`packages/fleet/src/shared/repair-start.ts:106-110`), where a failed or budget-skipped ask becomes `null`, and maps `await-rerun` to `awaiting-rerun` where `record.rerun !== 'none'` (`:136`). A re-run that concluded would fold `green` or `red`, and both answer `start-repair` (`repair.ts:243-245`), so on 2026-11-06 the reading was runs `null` or a fold of `unknown`; the log does not say which.

`Main repair bound` is measured from `record.redSince` (`repair.ts:249`, `packages/fleet/src/shared/revert-start.ts:183`). In this repository it and `Checks wait` are both 3600 s. A re-run bound measured from the ask therefore expires about when the repair bound does, and a repair started then would be overtaken on the next tick by the revert path (`repair.ts:251-252`, `revert-start.ts:254`).

**#3136, readers take a partial pulse as whole.** `pulseBranchReading` (`packages/domain/src/rules/pulse-branch.ts:30`) tells a partial pulse from a complete one for restart, continue and the agent panel. Three board readers still look a branch or a plan up in the raw `pulseFor(opts)`. `workerLog` calls `worktreeForBranch(pulseFor(opts), branch)` (`packages/board/src/server/worker-log.ts:176`) and answers `no-worktree` for a branch that the scan has not reached. The dispatch route calls `startReadingFromPulse(pulseFor(o), planSlug, br)` (`packages/board/src/server/dispatch.ts:388`) and the implement route calls the same (`packages/board/src/server/implement.ts:284`), defined at `packages/fleet/src/shared/dispatch-command.ts:122`. For implement, a plan absent from a partial pulse answers `no-reading` (`packages/domain/src/rules/auto-dispatch.ts:643`), and the route then starts a run with no branch (`implement.ts:284-295`). `deliver.ts:397` is the precedent: it reads `pulseFor`, `pulseCompleteFor` and `lastCompletePulseFor` through `deliveryPulse`. The lookup itself lives outside the domain: `lookupBranch` (`packages/fleet/src/shared/continue-command.ts:37`), `branchFromPulse` (`:66`), `continueBranch` (`:132`), `restartBranch` (`packages/fleet/src/shared/restart-command.ts:136`) and the `ContinueRefusal` union (`packages/fleet/src/shared/continuation.ts:102`). `packages/board/src/server/agent-panel.ts:70-71` imports and re-exports `branchFromPulse` from the fleet package, and `worker-log.ts:114` holds a third copy of the walk. The bridge `.plot/state/last-pulse.json` carries no completeness field (`BRIDGE_VERSION = 1`, `packages/domain/src/adapters/fleet-state/fleet-state-file.ts:28`; writer `:157-167`).

## Design

### Approach

The layering rule holds in every slice: a controller or an entry calls the domain, the domain reads readings as values, and only an adapter reaches git or the file system.

**Slice 1, every reader of the four state files reads the main checkout (#3207):**

- **A branded home.** `StateHome` in `packages/domain/src/entities/state-home.ts` is `string & { readonly __brand: 'StateHome' }`. Only `stateHomeOf` creates one.
- **One rule.** `stateHomeOf(commonDir: string | null)` in `packages/domain/src/rules/state-home.ts` takes the absolute, realpathed common git directory, or `null` where git did not answer. It returns `{ home: StateHome }` where the directory's basename is `.git` (the home is its parent), and `{ unread: true }` otherwise. It never answers the input path: that fallback (`trees-git.ts:776-779`, `main-checkout.ts:29-30`) is the defect.
- **Two adapters feed it, one async and one sync.** `stateHomeAt(repoRoot)` in `packages/domain/src/adapters/state-home/state-home-git.ts` asks `processAnswers.absoluteCommonDir` and realpaths the answer. `stateHomeAtSync(repoRoot)` in `main-checkout.ts` does the same with `execFileSync`, cached per root as `mainRootOf` is today, so the synchronous paths of slice 5 need no async change. No new port: the domain rule takes the answer as a value, and the entries already build adapters.
- **The four file adapters take a `StateHome`.** `repairRecordFile`, `baseRepairFile`, `defaultBranchFile` and `baseBranchFile` (and their `*Path` functions) change their first parameter from `repoRoot: string` to `home: StateHome`, so `tsc` refuses every caller that passes a raw `repoRoot`. The slice changes every caller `tsc` names: the 25 sites in the Motivation, in the board and in fleetd. fleetd's writers and its merge, review, fixer, repair and revert arms move in this one slice, so fleetd never writes one directory and reads another. Each process resolves the home once at start (`contextFrom` for the board entries, the registryd context for fleetd). Where it answers `unread`, the board's merge path hands the workflow `stateHome: 'unaskable'` (slice 4), and fleetd logs one line and starts none of the arms that read the four files.
- **No behaviour change in the main checkout.** The home of a main checkout is the checkout itself, so the file paths there do not change.
- **Tests:**
  - `packages/domain/test/state-home.test.ts`: `stateHomeOf` answers the parent of `/r/.git`; it answers `unread` for `/r/.bare`, for `/r/.git/modules/x` and for `null`. One `// @ts-expect-error` cell proves that `repairRecordFile('/x')` is a type error.
  - `packages/domain/test/state-home-adapter.test.ts`, over real repositories in a `mkdtempSync` directory: the main checkout answers itself; a linked worktree answers the main checkout; a directory outside any repository answers `unread`; a checkout made with `git init --separate-git-dir` answers `unread`.
  - `packages/board/test/unit/ask-merge-from-a-worktree.test.ts` runs the `merge` and `repair-pr` entries from a real linked worktree and keeps the captured-ports pattern of `ask-repair-pr.test.ts:22-31` and `merge-reads-the-estates-default-branch.test.ts:24-30`. It writes a red default-branch reading and a repair record under the main checkout's `.plot/state` and asserts that the captured `defaultBranch.read()` and `repair.read()` return them. That cell fails today, because both reads answer `null`.
  - `packages/domain/test/workflows-merge.test.ts`: the same red reading with a PR that is not the repair PR refuses `default-branch-red`.
  - `packages/fleet/test/unit/auto-merge.test.ts`: the merge arm reads the reading that fleetd's refresh wrote, from a worktree root.

**Slice 2, the repair-start decision moves into the domain (#3208):**

- `rerunSettledOf` answers its reason beside the reading: `rerun-unanswered` (runs `null`), `rerun-unmatched` (the declared checks matched no run, the `foldRuns` answer `unknown`; `unmatchedChecks`, `default-branch.ts:78-84`), `rerun-unconcluded` (a matched run is still going) and `rerun-grace` (inside `RERUN_GRACE_MS`).
- `repairStartAction(input)` in `packages/domain/src/rules/repair-start.ts` takes `redMainStep`'s answer, the record, whether a reading exists, the PR reading and the run reading. It answers `ask-rerun`, `awaiting-rerun` (with the reason), `start-repair`, `record-pr`, `awaiting-repair` or `none`.
- `repairStartTick` (`packages/fleet/src/shared/repair-start.ts:87-161`) keeps only the port calls and the writes. It dispatches on `repairStartAction`'s answer and logs `repair awaiting-rerun (<reason>)`, so the next episode measures what the 2026-11-06 log could not.
- **Tests:** `packages/domain/test/repair-start.test.ts` holds today's answer for each branch of `repairStartTick` (`:135-157`), including `awaiting-rerun` for the 2026-11-06 inputs with `runs: null`. It gains one cell per reason; the `rerun-unmatched` cell uses `runs: [run('CI', 'success')]` and `checks: ['CI/validate']`. The reason cells fail today: `rerunSettledOf` answers no reason. `packages/fleet/test/unit/repair-start.test.ts` passes unchanged except for the log line.

**Slice 3, the re-run wait has a bound and the repair keeps its time (#3208):**

- **The bound.** `rerunSettledOf` answers `overdue` where it would answer `pending` and `now ≥ record.at + Checks wait`, the same `Checks wait` value that `lastGreenRerunOverdue` reads, measured from the ask. Where `record.at` does not parse, it measures from `record.redSince`; where neither parses, it answers `overdue`, so an unreadable time never makes the wait unbounded. `record.at` stays put while the record is in `rerun`: the refresh writes it once (`packages/fleet/src/shared/default-branch-refresh.ts:311`), and `repairStartTick` rewrites it only on a state change (`repair-start.ts:142,150`).
- **The answer.** `redMainStep` reads `overdue` as `start-repair`, whether the settled red commit is `firstRedSha` itself or a later one.
- **The repair's own clock.** `RepairAttemptSchema` (`packages/domain/src/entities/repair-record.ts:43-58`) gains `startedAt`, written where `startRepair` records the attempt before the claim. One domain rule, `repairBoundReached(record, now, mainRepairBoundMs)`, measures `Main repair bound` from `attempt.startedAt` where it parses, else from `redSince` as today. `redMainStep` (`repair.ts:249`), `revert-start.ts:183` and `lastGreenRerunOverdue` (`repair-start.ts:87-95`) read it. So a repair started by an overdue re-run gets the full bound, and the revert path starts only after that.
- **Tests,** in `packages/domain/test/repair.test.ts` and `repair-start.test.ts`, with the 2026-11-06 readings (`redSince` 10:18Z, `at` 10:20:27Z, runs `null`, head `501d32861` settled red):
  - at 11:19Z the answer is `awaiting-rerun`; at 11:21Z it is `start-repair`, and that cell fails today;
  - the tick after the start, at 11:22Z with `state: 'repairing'`, `attempt.startedAt` 11:21Z and the run alive, answers `await-repair`, not the revert path; at 12:21Z it reaches the bound;
  - a cell at exactly `record.at + Checks wait`;
  - an unparseable `at` measures from `redSince`; an unparseable `at` and `redSince` answer `overdue`;
  - `overdue` with `settled.sha === firstRedSha` answers `start-repair`;
  - a write to the record in `rerun` state that leaves `at` unchanged does not restart the bound;
  - a re-run that settles `green` or `red` inside the bound answers as today;
  - a record whose attempt has no `startedAt` measures the repair bound from `redSince`, as today.

**Slice 4, a named refusal where the home is not found (#3207):**

- `MergeReadings` gains `stateHome: 'read' | 'unaskable'` (`packages/domain/src/workflows/merge.ts`). Where it is `unaskable`, `mergeAt` refuses `state-home-unread` for a PR into the default branch and for a PR into a `sprint/*` base, before it reads the default-branch reading. The merge path reads the base readings too (`main.ts:219-220`), so the refusal guards reads that the command makes. `holdsApply` does not change.
- `plot-ask.mjs repair-pr` refuses `state-home-unread` on the same answer, before it reads the record.
- The refusal adds one word to `MergeRefusal` (`merge.ts:39-59`).
- **Tests:** `packages/domain/test/workflows-merge.test.ts`: `stateHome: 'unaskable'` refuses `state-home-unread` into the default branch and into `sprint/x`; `stateHome: 'read'` with a `null` reading answers as today. The entry seam is `PLOT_REPO_ROOT` pointing at a `mkdtempSync` directory outside any repository: `stateHomeAt` answers `unread` there with no fixture, because `main.ts:205-225` and `merge-ports.ts:44` build their adapters themselves. `packages/board/test/unit/ask-repair-pr.test.ts` and `ask-merge-from-a-worktree.test.ts` gain one cell each on that seam. Both fail today: the entry reads an empty directory and refuses nothing by that name.

**Slice 5, every main-checkout resolver asks one rule (#3207):**

- The scope is the main-checkout home only. The common-dir stores (the PR index, the issue index, the reader lock and the other adapters the Motivation names) stay where they are.
- `fleetStateFile`, `bridgePath`, `fleetdHeartbeatPath` and `readFleetdHeartbeatSync` take a `StateHome` and are fed by `stateHomeAtSync`, so they stay synchronous. `mainRootOf` is deleted; its callers move onto `stateHomeAtSync` or `stateHomeAt`.
- What each caller does where the home is unread:

  | Caller | Unread home |
  |---|---|
  | bridge read (`fleet-state-file.ts:35`), `recordBridge` (`pulse-log.ts:75`) | no pulse: `answered(null)`; continue, restart and dispatch refuse `no-pulse` |
  | bridge write | `failed`; fleetd logs `bridge write refused` (`fleet-clock.ts:204`) |
  | heartbeat read (`fleetd-heartbeat-file.ts:18,68`) | no heartbeat: no live fleetd |
  | heartbeat write | `failed` |
  | `processes-files.ts:430,505` | keeps the fallback to `repoRoot`: it lists processes and reads scripts, and writes nothing a gate reads |
  | `approve.ts:1390` | keeps the fallback to `repoRoot`: it places a desk and appends `in-session-approvals.tsv`, which no gate reads |
  | `design.ts:281`, `verify.ts:854`, `review.ts:664` | keep the `refsGit.repoRoot()` probe of today, after `stateHomeAt` |

- **Tests:** `packages/domain/test/fleet-state-file.test.ts`: the bridge of a linked worktree is the main checkout's (the case `mainRootOf` covers today), and an unread home reads no pulse. `packages/domain/test/state-home.test.ts` gains one `// @ts-expect-error` cell for `fleetStateFile({ repoRoot: '/x' })`. The unread-home cells fail today, because `mainRootOf` falls back to `repoRoot`. The existing tests of each moved caller pass unchanged.

**Slice 6, the three readers read a partial pulse (#3136):**

- **Plan lookup.** `pulsePlanReading(live, liveComplete, lastComplete, slug)` in `packages/domain/src/rules/pulse-branch.ts` is the plan-level variant of `pulseBranchReading`, with the same four answers in the same order.
- **Dispatch and implement.** `startReadingFromPulses(live, liveComplete, lastComplete, slug, branch)` replaces the inline default at `dispatch.ts:388` and `implement.ts:284`, as a named pure function, so a test reaches the code that the routes run. `NamedBranchRefusal` and `DispatchReadingFor` (`auto-dispatch.ts:715-730`) gain `pulse-partial`. The dispatch route answers it with 409. The implement route with no branch answers it with 409 and starts no run.
- **Worker log.** `workerLog` takes a `deps` argument shaped like `agent-panel.ts:167-173`, and reads the branch through `pulseBranchReading`. `LogMissReason` (`worker-log.ts:64`) gains `pulse-partial` and `no-pulse`, and both answer 404, as `continue` does (`continue-command.ts:84-89`). `missWord` (`packages/board/src/app/components/WorkerLogModal.tsx:45`) gains "The fleet scan has not reached this branch yet; ask again after the scan finishes." and "There is no fleet reading to look this branch up in." The word for each reason is a domain property that the modal reads.
- **The bridge.** fleetd writes the bridge only through `writeScan` after `scanOnce` returns (`packages/fleet/src/shared/fleet-scan.ts:1120-1150`, `fleet-clock.ts:203`), and `recordAttempt` rewrites only `attempt` (`fleet-clock.ts:164-168`). `packages/fleet/test/unit/fleet-clock-bridge.test.ts` is a characterisation test of that, and the bridge keeps `BRIDGE_VERSION` 1 with no `complete` field (operator decision, 2026-11-21): a scan that throws, or a refused write, leaves every field except `attempt` unchanged. The board-free commands already default `pulseComplete ?? true` (`continue-command.ts:135`, `restart-command.ts:139`) and need no change. The slice corrects `skills/plot/scripts/plot-fleet-scan.sh:222` to name `writeScan` in place of a `write_bridge` function that no script defines, and adds no shell lines.
- **Tests:** `packages/domain/test/pulse-branch.test.ts` gains the `pulsePlanReading` cells (null live; live lists the plan; complete live without it; partial live, last complete lists it; partial live, neither lists it). `packages/domain/test/auto-dispatch.test.ts` gains a `pulse-partial` cell for `startReadingFromPulses`. `packages/board/test/unit/worker-log.test.ts` gains a partial-pulse cell through `deps` and extends the distinct-`missWord` assertion. `dispatch-brief-branch.test.ts` and `implement-route.test.ts` each gain a cell over `startReadingFromPulses`; the implement cell asserts no `startImplement` call. The partial-pulse cells fail today.

**Slice 7, the lookup moves into the domain (#3136):**

- `lookupBranch`, `branchFromPulse`, `PulseBranch` and `BranchLookup` move from `packages/fleet/src/shared/continue-command.ts:10-70` to `packages/domain/src/rules/pulse-branch.ts`. The `ContinueRefusal` union moves from `continuation.ts:102` to `packages/domain/src/entities/`. `worktreeForBranch` (`worker-log.ts:114`) becomes a mapper over `lookupBranch`. `agent-panel.ts:70-71` imports from `@plot-pm/domain`.
- `continueBranch` and `restartBranch` stay in `@plot-pm/fleet/shared` as the workflows that call ports, and read the domain rules. The slice changes no behaviour.
- **Tests:** `packages/domain/test/pulse-branch.test.ts` gains new `lookupBranch` cells (no tests of it exist today), written first against the fleet copy and green there. `packages/board/test/unit/pulse-lookup-in-domain.test.ts` asserts that no file under `packages/board/src` imports `@plot-pm/fleet/shared/continue-command` and that no file under `packages/fleet/src` declares `lookupBranch` or `ContinueRefusal`; it fails today. `continue-command.test.ts` and `restart-command.test.ts` pass unchanged.

**Slice 8, a new failure starts a repair (#3208):**

- The repair record gains `firstRedFailing`, the sorted failing **job** names of `firstRedSha`, written once where the refresh opens the episode (`default-branch-refresh.ts`). The names come from the job entries that `runsForSha` lists (`packages/domain/src/ports/build.ts:115-125`, `entities/build.ts:158-161`). A record without the field compares nothing and answers as today.
- `redMainStep` answers `start-repair` in `idle` or `rerun` where the settled commit is after `firstRedSha`, is red, and its failing job names differ from `firstRedFailing`, whatever `rerunSettled` reads.
- **Tests:** `packages/domain/test/repair.test.ts`: the two 2026-11-06 job names (`board-integration` on the first red, the job that ran `ports-real-state.test.ts` on `501d32861`) with `rerunSettled: 'pending'` answer `start-repair`, and that cell fails today; the same job names answer `await-rerun`; a record without `firstRedFailing` answers `await-rerun`. `packages/domain/test/repair-record.test.ts` round-trips the field.
- The comparison unit is job names (operator decision, 2026-11-21).

### Open Questions

- [x] #3208, slice 8: compare failing **job** names, not the declared check names that `failingRuns` holds (`default-branch.ts:111-114`). This repository declares one check, `CI/validate`, and both 2026-11-06 failures fold under it. (operator decision, 2026-11-21)
- [x] #3208, slices 3 and 8: `REPAIR_RECORD_VERSION` stays 1 (`repair-record.ts:8`). `RepairRecordSchema` is strict, so an older fleetd reads a record that holds `attempt.startedAt` or `firstRedFailing` as unreadable, and `repairStartTick` answers `none` (`repair-start.ts:97`), until fleetd restarts on the new build. One fleetd restart after the slices merge is acceptable. (operator decision, 2026-11-21)
- [x] #3136, slice 6: the fleet-state file gets no `complete` field and keeps `BRIDGE_VERSION` 1. The characterisation test of `writeScan` stays. (operator decision, 2026-11-21)

## Slices

### Merge state home

- `bug/merge-reads-the-main-checkouts-state` — `StateHome`, `stateHomeOf` and its two adapters, the four state-file adapters taking a `StateHome`, and every board and fleetd caller `tsc` names, with the worktree entry test <!-- builds: stateHomeOf, the main checkout's state home --> → #3624

### Repair-start decision

- `bug/the-repair-start-decision-moves-into-the-domain` — `repairStartAction`, the four re-run reasons including `rerun-unmatched`, and `repairStartTick` dispatching on the answer <!-- builds: repairStartAction, the repair-start decision --> → #3659

### Re-run bound

- `bug/the-first-red-rerun-wait-ends-at-checks-wait` — `overdue` past `Checks wait`, `redMainStep` reading it as `start-repair`, `attempt.startedAt` and `repairBoundReached`, and the 2026-11-06 cells <!-- builds: repairBoundReached, the repair bound from the attempt's start --> → #3666

### Unfound state home

- `bug/merge-refuses-an-unfound-state-home` — `MergeReadings.stateHome`, the `state-home-unread` refusal in `mergeAt` and `repair-pr`, and the `PLOT_REPO_ROOT` seam tests <!-- builds: state-home-unread, the merge refusal for an unfound state home --> → #3669

### One state home

- `bug/every-state-reader-asks-one-state-home` — the bridge, the heartbeat, `recordBridge`, `approve.ts`, `design.ts`, `verify.ts` and `review.ts` on `stateHomeOf`, `mainRootOf` deleted, and the unread-home cells <!-- builds: stateHomeAtSync, the synchronous state-home adapter --> → #3672

### Partial-pulse readers

- `bug/the-board-routes-read-a-partial-pulse` — `pulsePlanReading`, `startReadingFromPulses`, the worker log through `pulseBranchReading` with two new sentences, the bridge characterisation test and the corrected shell comment <!-- builds: pulsePlanReading, the plan-level partial-pulse lookup --> → #3677

### Domain pulse lookup

- `bug/the-pulse-lookup-moves-into-the-domain` — `lookupBranch`, `branchFromPulse` and `ContinueRefusal` in the domain, `worktreeForBranch` and the agent panel as mappers, and the import test <!-- builds: lookupBranch in the domain, the one pulse walk -->

### New main failure

- `bug/a-new-failure-on-main-starts-a-repair` — `firstRedFailing` from job names, and `redMainStep` starting a repair where a later settled red fails in other jobs <!-- builds: firstRedFailing, the first red commit's failing jobs -->

## Notes

- Written 2026-11-21 from a triage of #3136, #3207 and #3208 against `origin/main` at `b21961602`. The panel of round 1 read `6362b9d43`; `origin/main` was at `98a14eb77` when the amendments were written.
- **Panel round 1 (estate, testability, user: all `amend`; verdicts in `.plot/panels/2026-11-21-fleet-state-is-read-whole-and-from-one-home/`).** How each finding is resolved:
  - Parallel families (estate 5): the parallel claims are gone; slices run in heading order (`eligible.ts:165-172`), and the `waits:` annotations are removed because heading order already orders them.
  - Two state homes (estate 1): the Motivation names both, and slice 5 covers only the main-checkout home. The count test is replaced by a type gate (testability 1).
  - Callers that need the `.git` directory (estate 2): `reap.ts:343` (`repoIdentityOf`) and `registryd-main.ts:2978` (`readWatchLayout`) are out of the table and out of slice 5.
  - Missing resolvers (estate 3): `design.ts:281` and `verify.ts:854` are in the table and in slice 5.
  - Resolution pattern and sync paths (estate 4): the home resolves once per process and reaches the adapters as a branded value; `stateHomeAtSync` keeps the bridge and heartbeat paths synchronous; both adapters realpath.
  - fleetd split (testability 1): all 25 callers move in slice 1, including `auto-merge.ts:371,397`.
  - `stateHomeOf` a pass-through (testability 3): the rule takes the common dir and refuses a non-`.git` one, with an adapter test over a `--separate-git-dir` checkout.
  - Entry seams (testability 2, 8): slice 1 names the captured-ports cell; slice 4 names `PLOT_REPO_ROOT` outside any repository.
  - Re-run reasons (testability 5, user 3): slice 2 adds `rerun-unmatched`.
  - Bound boundaries (testability 6, estate 6): slice 3 adds the unparseable-time and first-red cells, says "the same `Checks wait` value, measured from the ask", and has a cell that a write in `rerun` does not restart the bound.
  - Repair overtaken by the revert (user 1): slice 3 measures `Main repair bound` from the attempt's start, with the tick-after-start test.
  - Job comparison (user 2): slice 8 stays and compares job names.
  - Slice 5 seams and words (testability 4, user 4): slice 6 names `startReadingFromPulses`, the `deps` seam, the test files, the statuses and the two sentences, and the implement route starts no run.
  - Slices with no failing-today test (testability 7): the bridge slice is folded into slice 6 as a characterisation test; slice 7 gains an import test that fails today; the dispatch-command item is removed.
  - Stale merge sentence (estate 7, user 7): see the follow-up below; the refusal of slice 4 guards base reads that the command makes.
  - `default-branch-stale` from a worktree (user 5): a Changelog line.
  - Fallback callers (user 6): slice 5's table lists them.
- **Operator decisions (2026-11-21).** Slice 8 compares failing job names. The repair record keeps `REPAIR_RECORD_VERSION` 1: an older fleetd reads a record that holds `attempt.startedAt` or `firstRedFailing` as unreadable, answers `none` for the episode until it restarts, and one fleetd restart after the slices merge is acceptable. The fleet-state file keeps `BRIDGE_VERSION` 1 with no `complete` field, and slice 6's characterisation test stays.
- **Follow-up, not in this plan:** CLAUDE.md (*A Decision Reads The Index*) says "`plot-ask.mjs merge` wires no base reading yet, so it neither holds `base-branch-red` nor admits a base repair PR". That no longer holds: `main.ts:219-220` wires `baseBranch` and `baseRepair` into the merge path. The sentence needs a correction in a separate change.
- **Conflicts to expect.** Open PR #3605 (`a-continuation-resumes-the-asking-agent`) changes `continuation.ts`, which slice 7 moves `ContinueRefusal` out of. The Approved plan `2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr` cites `packages/fleet/src/shared/repair-start.ts:214`, which slice 2 may shift.
- **`plot-deliverable-search.sh` results.** `stateHome`, `state home`: nothing named. `mainRoot`: the existing `Trees.mainRoot` and `approve.ts:1390`'s private `mainRootOf`. `pulsePlanReading`, `plan-level pulse lookup`: nothing. `lookupBranch`: only `packages/fleet/src/shared/continue-command.ts:37`, which slice 7 moves. `repairStartAction`: nothing. `rerunOverdue`: `packages/fleet/src/shared/revert-start.ts:225`, a bound on the pre-revert re-run over the domain's `lastGreenRerunOverdue`. `failing runs changed`: nothing.
- **Parts of the issues that no longer hold on `b21961602`.**
  - #3207's *Done when* asks that no entry file under `packages/*/src/server/entry/` calls `--git-common-dir` itself. That already holds: the only `'--git-common-dir'` literals sit in `adapters/main-checkout.ts:25` and `adapters/git-dirs/git-dirs.ts:209,238,245`. The entries reach git through `processAnswers` or `Trees.mainRoot`.
  - #3207's list of entries is partly out of date: `pr-index-lookup.ts:32` is a comment, and `design.ts` and `verify.ts` moved to `:281` and `:854`.
  - #3136's line numbers moved: the bridge writer is `fleet-state-file.ts:157-167`; dispatch is `dispatch.ts:388` and implement `implement.ts:284`; `branchFromPulse` is `continue-command.ts:66` and `continueBranch` `:132`; `restartBranch` is `restart-command.ts:136`; `ContinueRefusal` is `continuation.ts:102`; the agent-panel import is `agent-panel.ts:70-71`.
  - #3208's *Done when* asks for a test with "first red re-run green, head red on a different job" that answers `start-repair` and fails on today's code. With `rerunSettled: 'green'` and a settled commit after `firstRedSha`, today's `redMainStep` already answers `start-repair` (`repair.ts:243`), so that test passes today. The cells that fail today are slice 3's `runs: null` past the bound and slice 8's different-job cell.
- `packages/fleet/src/shared/revert-start.ts:225-229` makes the same kind of decision in the fleet for the pre-revert re-run (`rerunOverdue`). Slice 3 changes only the bound it reads (`repairBoundReached`); moving that decision into the domain is left out, because no issue names it.
