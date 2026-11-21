# Fleet state is read whole and from one home

> `plot-ask.mjs merge` and `repair-pr` read `.plot/state` from the main checkout when they run in a linked worktree, and refuse by name where they cannot find it; the board's worker log, dispatch and implement routes read a partial pulse as partial; and fleetd's main repair stops waiting on the first red commit's re-run after `Checks wait`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3207, #3136, #3208
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-ask.mjs merge` and `plot-ask.mjs repair-pr`, run from a linked worktree, read the repair record and the default-branch reading of the main checkout. A merge from a worktree on a red default branch now refuses `default-branch-red`; before, it read no reading and merged.
- `plot-ask.mjs merge` and `plot-ask.mjs repair-pr` refuse `state-home-unread` where git cannot name the main checkout, instead of reading an empty directory.
- The board's worker log, dispatch and implement routes answer `pulse-partial` for a branch or a plan that an unfinished scan has not reached, instead of `no-worktree` or an unknown plan.
- fleetd's main repair waits at most `Checks wait` for the re-run of the first red commit. Past that bound, it starts a repair.
- fleetd's main repair starts a repair when a later commit settles red with a different failure than the first red commit.

<!-- Board impact: the board server changes in slices 1, 2, 3, 5 and 6 (merge-ports.ts, estate.ts, entry/main.ts, worker-log.ts, dispatch.ts, implement.ts, agent-panel.ts). No plan format, template, helper script or docs/plans layout changes. No rendered state changes except the refusal words. A builder runs `pnpm build:board` locally to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

The plan answers three independent defect families. Each family has its own slices, and no slice of one family waits on a slice of another, so the fleet can run the three families in parallel. **#3207 is the most dangerous defect and its slices come first**: a merge gate that opens silently when the caller runs in a linked worktree.

**#3207, the merge gate opens in a worktree.** `contextFrom` sets `repoRoot: process.env.PLOT_REPO_ROOT ?? process.cwd()` (`packages/board/src/server/entry/main.ts:111`). The file adapters join `.plot/state/…` onto that root with no resolution: `repairRecordPath` (`packages/domain/src/adapters/repair-record/repair-record-file.ts:10-11`), `defaultBranchPath` (`packages/domain/src/adapters/default-branch/default-branch-file.ts:13-14`), and the base-branch paths in the same module (`:67`, `:71`). The merge path reads both files through those adapters: `repair: repairRecordFile(opts.repoRoot)` (`packages/board/src/server/entry/merge-ports.ts:62`, `main.ts:218`) and `defaultBranch: defaultBranchFile(opts.repoRoot)` (`packages/board/src/server/estate.ts:88`). A linked worktree has no `.plot/state`, so the read answers "no file", and `MergeReadings.defaultBranch` is `null` (`packages/domain/src/workflows/merge.ts:75`), which holds nothing. Measured 2026-11-06 from `.worktrees/scratch-sprint-add`: `plot-ask.mjs repair-pr 3199` answered `{"named":false,"reason":"no-open-episode"}` and the same call from the main checkout answered `{"named":true,"pr":3199}`; every `plot-ask.mjs merge` from the worktree that day returned `"defaultBranchRead":false`.

The estate already resolves the main checkout in several places, each on its own:

| Resolver | Where | On failure |
|---|---|---|
| `mainRootOf` | `packages/domain/src/adapters/main-checkout.ts:20`, used by `bridgePath` (`fleet-state/fleet-state-file.ts:35`), the fleetd heartbeat, the processes files and `pulse-log.ts:75` | falls back to `repoRoot` silently (`main-checkout.ts:29-30`) |
| `Trees.mainRoot` | port `packages/domain/src/ports/trees.ts:694`, adapter `trees/trees-git.ts:776` | answers a failure |
| `mainRootOf` (private) | `packages/board/src/server/entry/approve.ts:1390` over `Trees.mainRoot` | falls back to `repoRoot` |
| `processAnswers.absoluteCommonDir` | `packages/board/src/server/entry/review.ts:664`, `packages/fleet/src/server/entry/registryd-main.ts:2978` | returns `null` |
| `processAnswers.commonDir` | `packages/board/src/server/entry/reap.ts:343` | per caller |

So the fleet bridge follows a worktree to the main checkout, and the repair record and the default-branch reading beside it do not.

**#3136, readers take a partial pulse as whole.** `pulseBranchReading` (`packages/domain/src/rules/pulse-branch.ts:30`) tells a partial pulse from a complete one for restart, continue and the agent panel. Three board readers still look a branch or a plan up in the raw `pulseFor(opts)`: `workerLog` calls `worktreeForBranch(pulseFor(opts), branch)` (`packages/board/src/server/worker-log.ts:176`) and answers `no-worktree` for a branch the scan has not reached; the dispatch route calls `startReadingFromPulse(pulseFor(o), planSlug, br)` (`packages/board/src/server/dispatch.ts:388`) and the implement route calls the same (`packages/board/src/server/implement.ts:284`), defined at `packages/fleet/src/shared/dispatch-command.ts:122`. `deliver.ts:397` is the precedent: it reads `pulseFor`, `pulseCompleteFor` and `lastCompletePulseFor` through `deliveryPulse`. The lookup itself lives outside the domain: `lookupBranch` (`packages/fleet/src/shared/continue-command.ts:37`), `branchFromPulse` (`:66`), `continueBranch` (`:132`), `restartBranch` (`packages/fleet/src/shared/restart-command.ts:136`) and the `ContinueRefusal` union (`packages/fleet/src/shared/continuation.ts:102`); `packages/board/src/server/agent-panel.ts:70-71` imports and re-exports `branchFromPulse` from the fleet package, and `worker-log.ts:114` holds a third copy of the walk. The bridge `.plot/state/last-pulse.json` carries no completeness field: `BRIDGE_VERSION = 1` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:28`), and the writer stores `version`, `at`, `pulse`, `ages`, `branchUrlBase`, `approvedAt`, `ideaPlans`, `prError` and `attempt` (`:157-167`).

**#3208, the repair waits on a re-run with no bound.** On 2026-11-06 the episode opened at 10:18Z on `35539a20c` (a runner failure); the re-run of its CI completed `success` at 10:32:53Z; from about 10:43Z the head `501d32861` read red for a new, deterministic failure. fleetd logged `repair awaiting-rerun` on every tick, held 34 PRs for about two hours and started no repair, until a person opened #3199 at about 13:25Z. `rerunSettledOf` answers `pending` where `runs === null`, with no bound (`packages/domain/src/rules/repair-start.ts:34`). `redMainStep` answers `await-rerun` for `pending` and `none` (`packages/domain/src/rules/repair.ts:242-246`) and compares no failure of the settled commit with the first red's. The fleet holds part of the decision: `repairStartTick` builds `rerunSettled` from a `runsForSha` ask inside a host slot (`packages/fleet/src/shared/repair-start.ts:106-110`), where a failed or budget-skipped ask becomes `null`, and maps `await-rerun` to `awaiting-rerun` where `record.rerun !== 'none'` (`:136`). `redMainStep` answers `start-repair` for `rerunSettled: 'green'` on a settled commit after `firstRedSha` (`repair.ts:243`), so on 2026-11-06 `rerunSettled` reached it as `pending` or `none`; the log does not say which.

## Design

### Approach

The layering rule holds in every slice: a controller or an entry calls the domain, the domain reads readings as values, and only an adapter reaches git or the file system.

**Slice 1, the merge path reads the main checkout's state (#3207):**

- **One rule for the state home.** `stateHomeOf(repoRoot, mainRoot)` in `packages/domain/src/rules/state-home.ts` takes the `PortResult<string>` that `Trees.mainRoot(repoRoot)` answers and returns `{ home: string }` or `{ unread: true }`. It never falls back to `repoRoot`: a worktree that falls back reads an empty directory, which is the defect. The approach reuses the existing `Trees.mainRoot` port rather than adding a `StateHome` port; see Open Questions.
- **The file adapters take the home, not the root.** `repairRecordFile`, `baseRepairFile`, `defaultBranchFile` and `baseBranchFile` keep their signatures and receive the resolved home from their callers. Their callers on the merge path change: `merge-ports.ts:62` and `main.ts:218` (repair record), `estate.ts:88` (default-branch reading), and the base-branch reads `mergeAt` makes. Each resolves the home once per command through the `trees` port that `merge-ports.ts:44` already builds.
- **No behaviour change in the main checkout.** `Trees.mainRoot` answers the path itself for a main checkout, so the file paths there do not change.
- **Tests:** `packages/domain/test/state-home.test.ts` (a main checkout answers its own path; a worktree answers the main checkout; a failed read answers `unread`, never `repoRoot`). `packages/board/test/unit/ask-merge-from-a-worktree.test.ts` builds a real repository with one linked worktree in a `mkdtempSync` directory, writes a repair record and a red default-branch reading under the main checkout's `.plot/state`, and asserts: `repair-pr <pr>` answers the same from the worktree and from the main checkout; `merge <pr> <sha>` from the worktree refuses `default-branch-red`; `merge` from the main checkout answers as before.

**Slice 2, a named refusal where the home is not found (#3207):**

- `MergeReadings` gains `stateHome: 'read' | 'unaskable'` (`packages/domain/src/workflows/merge.ts`). Where it is `unaskable`, `mergeAt` refuses `state-home-unread` for a PR into the default branch and for a PR into a `sprint/*` base, before it reads the default-branch reading: the reading, the repair record and the base reading all live under the home. `holdsApply` does not change.
- `plot-ask.mjs repair-pr` refuses `state-home-unread` on the same answer, before it reads the record.
- The refusal adds one word to `MergeRefusal` (`merge.ts:39-59`) and to the CLAUDE.md paragraph that lists the merge refusals (*A Decision Reads The Index*).
- **Tests:** `packages/domain/test/workflows-merge.test.ts` cells: `stateHome: 'unaskable'` refuses `state-home-unread` into the default branch and into `sprint/x`; `stateHome: 'read'` with a `null` reading answers as today. `packages/board/test/unit/ask-repair-pr.test.ts`: a `trees` fixture whose `mainRoot` fails refuses `state-home-unread`.

**Slice 3, every state reader asks one home (#3207):**

- The other resolvers in the Motivation table move onto `stateHomeOf` over `Trees.mainRoot`: `mainRootOf` in `main-checkout.ts` and its users, `approve.ts:1390`, `review.ts:664`, `reap.ts:343` and `registryd-main.ts:2978`. fleetd's own writers of the two files (`registryd-main.ts:1166`, `:3036`, `:3517-3518`, `:3832`, `:3845`) read the same home, so a fleetd started in a worktree writes where `plot-ask.mjs` reads.
- Where a caller today falls back to `repoRoot`, it keeps that behaviour only where the caller writes nothing a gate reads; the slice names each such caller in its PR.
- **Tests:** `packages/domain/test/one-state-home.test.ts` counts the sites under `packages/*/src` that pass `--git-common-dir` to git or join `'.plot', 'state'` onto a root not produced by `stateHomeOf`, and fails where the count is not 0 outside `adapters/trees/`. The existing tests of each moved caller pass unchanged.

**Slice 4, the bridge holds only whole pulses (#3136):**

- fleetd writes the bridge only through `writeScan` after `scanOnce` returns (`packages/fleet/src/shared/fleet-scan.ts:1120-1150`, called from `fleet-clock.ts:203`), and `recordAttempt` rewrites only the `attempt` field over the last whole pulse (`fleet-clock.ts:164-168`). The header of `skills/plot/scripts/plot-fleet-scan.sh:222` still names a `write_bridge` function that no script defines.
- The slice proves the property with a contract test rather than adding a field; see Open Questions. `packages/fleet/test/unit/fleet-clock-bridge.test.ts`: a scan that throws leaves the bridge byte-identical except `attempt`; a refused write leaves it byte-identical; a `recordAttempt` never changes `pulse`. The existing `fleet-scan.test.ts:95` cell stays.
- The board-free commands that read the bridge (`packages/fleet/src/server/entry/continue-command.ts:60`, `restart-command.ts:51`, `dispatch-command.ts:116`) pass `liveComplete: true` to `pulseBranchReading` explicitly, with a comment citing the test.
- The slice corrects the `plot-fleet-scan.sh:222` comment to name `writeScan`; it adds no shell lines (`scripts/check-shell-lines.sh`).

**Slice 5, the three readers read a partial pulse (#3136):**

- `pulsePlanReading(live, liveComplete, lastComplete, slug)` in `packages/domain/src/rules/pulse-branch.ts` is the plan-level variant of `pulseBranchReading`, with the same four answers and the same order.
- `workerLog` (`worker-log.ts:176`) reads the branch through `pulseBranchReading(pulseFor(opts), pulseCompleteFor(opts), lastCompletePulseFor(opts), branch)` and answers `pulse-partial` or `no-pulse` by name. The dispatch route (`dispatch.ts:388`) and the implement route (`implement.ts:284`) read the plan through `pulsePlanReading` and pass the chosen pulse to `startReadingFromPulse`.
- **Tests:** `packages/domain/test/pulse-branch.test.ts` gains the `pulsePlanReading` cells (null live; live lists the plan; complete live without the plan; partial live, last complete lists it; partial live, neither lists it). `packages/board/test/unit/worker-log.test.ts`, and the dispatch and implement unit tests, each gain one partial-pulse cell that answers `pulse-partial` today's code answers otherwise.

**Slice 6, the lookup moves into the domain (#3136):**

- `lookupBranch`, `branchFromPulse`, `PulseBranch` and `BranchLookup` move from `packages/fleet/src/shared/continue-command.ts:10-70` to `packages/domain/src/rules/pulse-branch.ts`, and the `ContinueRefusal` union moves from `continuation.ts:102` to `packages/domain/src/entities/`. `worker-log.ts:114` `worktreeForBranch` becomes a mapper over `lookupBranch`. `agent-panel.ts:70-71` imports from `@plot-pm/domain`.
- `continueBranch` and `restartBranch` stay in `@plot-pm/fleet/shared` as the workflows that call ports; their decisions read the domain rules. The slice changes no behaviour.
- **Tests:** `packages/domain/test/pulse-branch.test.ts` gains the `lookupBranch` cells moved from the fleet tests; `packages/fleet/test/unit/continue-command.test.ts` and `restart-command.test.ts` pass unchanged.

**Slice 7, the repair-start decision moves into the domain (#3208):**

- `repairStartAction(input)` in `packages/domain/src/rules/repair-start.ts` takes `redMainStep`'s answer, the record, whether a reading exists, the PR reading and the run reading, and answers one of `ask-rerun`, `awaiting-rerun`, `start-repair`, `record-pr`, `awaiting-repair` or `none`. It also answers why a re-run is still awaited: `rerun-unanswered` where the runs ask returned no answer, `rerun-unconcluded` where a run is still going, `rerun-grace` inside `RERUN_GRACE_MS`.
- `rerunSettledOf` gains that reason as a second output, so a `null` runs answer is a named reading rather than `pending`.
- `repairStartTick` (`packages/fleet/src/shared/repair-start.ts:87-161`) keeps only the port calls and the writes: it dispatches on `repairStartAction`'s answer and logs `repair awaiting-rerun (<reason>)`, so the next episode measures what the 2026-11-06 log could not.
- **Tests:** `packages/domain/test/repair-start.test.ts` holds the current answers for each branch of `repairStartTick` (`:135-157`), including `awaiting-rerun` for the 2026-11-06 inputs with `runs: null`. `packages/fleet/test/unit/repair-start.test.ts` passes unchanged except for the log line.

**Slice 8, the re-run wait has a bound (#3208):**

- The bound is `Checks wait` (Plot Config, 3600 s in this repository), measured from `record.at` when `record.rerun === 'asked'`. It is the bound `lastGreenRerunOverdue` already uses for the pre-revert re-run (`repair-start.ts:87-95`, read in `packages/fleet/src/shared/revert-start.ts:225-229`).
- `rerunSettledOf` answers `overdue` past the bound where it would answer `pending`. `redMainStep` reads `overdue` as `start-repair`: the re-run gave no answer in time, so the episode needs a repair agent, and `Main repair bound` still bounds the repair and leads to the revert.
- **Tests:** `packages/domain/test/repair.test.ts` and `repair-start.test.ts` with the 2026-11-06 readings (`at: 2026-11-06T10:20:27Z`, runs `null`, head `501d32861` settled red): at 11:19Z the answer is `awaiting-rerun`; at 11:21Z it is `start-repair`, and that cell fails on today's code. A cell at exactly `record.at + Checks wait` fixes the boundary. A re-run that settles `green` or `red` inside the bound answers as today.

**Slice 9, a new failure starts a repair (#3208):**

- The repair record gains `firstRedFailing`, the sorted failing check names of `firstRedSha`, written once where the refresh opens the episode (`packages/fleet/src/shared/default-branch-refresh.ts`) from the reading's `failingRuns` (`packages/domain/src/entities/default-branch.ts:61-62`). A record without the field compares nothing and answers as today.
- `redMainStep` answers `start-repair` in `idle` or `rerun` where the settled commit is after `firstRedSha`, is red, and its failing check names differ from `firstRedFailing`, whatever `rerunSettled` reads.
- **Tests:** `packages/domain/test/repair.test.ts`: a different failing name on a later settled commit with `rerunSettled: 'pending'` answers `start-repair`; the same failing name answers `await-rerun`; a record without `firstRedFailing` answers `await-rerun`. `packages/domain/test/repair-record.test.ts` round-trips the field.

### Open Questions

- [ ] #3207: the approach reuses the existing `Trees.mainRoot` port (`ports/trees.ts:694`) for the state home, behind the `stateHomeOf` rule. Should the plan add a separate `StateHome` port, as the issue proposes, instead?
- [ ] #3136: the bridge's only writer is `writeScan` after a whole scan, so slice 4 proves it with a test and adds no `complete` field. Should the bridge carry a `complete` field with `BRIDGE_VERSION` 2 anyway? A bump makes every older reader read `null`, which restart and continue answer `no-pulse`.
- [ ] #3208: `failingRuns` names a declared check, not a job, and this repository declares one, `CI/validate` (Plot Config, *Default branch checks*). Both 2026-11-06 failures may fold under that one name, so slice 9's comparison may not fire for them; slice 8's bound answers that case alone. Should slice 9 compare job names, which needs `runsForSha` job entries in the record, or the run URL, or ship as written?
- [ ] #3208: `RepairRecordSchema` is strict and `REPAIR_RECORD_VERSION` is 1 (`packages/domain/src/entities/repair-record.ts:8`). An older fleetd reads a record holding `firstRedFailing` as unreadable, and `repairStartTick` then answers `none` (`repair-start.ts:97`). Is that acceptable for one fleetd restart, or should slice 9 bump the version?

## Slices

### Merge state home

- `bug/merge-reads-the-main-checkouts-state` — `stateHomeOf` over `Trees.mainRoot`, the merge path's repair record, default-branch reading and base readings resolved under the main checkout, and the worktree fixture test for `merge` and `repair-pr` <!-- builds: stateHomeOf, the state home of a checkout -->

### Unfound state home

- `bug/merge-refuses-an-unfound-state-home` — `MergeReadings.stateHome`, the `state-home-unread` refusal in `mergeAt` and `repair-pr`, and the tests <!-- builds: state-home-unread, the merge refusal for an unfound state home --> <!-- waits: bug/merge-reads-the-main-checkouts-state -->

### One state home

- `bug/every-state-reader-asks-one-state-home` — `mainRootOf`, `approve.ts`, `review.ts`, `reap.ts` and fleetd's state writers read `stateHomeOf`, with the count test <!-- builds: one-state-home.test.ts, the count of state-home resolvers --> <!-- waits: bug/merge-reads-the-main-checkouts-state -->

### Whole bridge

- `bug/the-bridge-holds-only-whole-pulses` — the contract test that only a whole scan reaches the bridge, the board-free commands passing `liveComplete: true`, and the corrected `plot-fleet-scan.sh` comment <!-- builds: fleet-clock-bridge.test.ts, the whole-pulse bridge contract -->

### Partial-pulse readers

- `bug/the-board-routes-read-a-partial-pulse` — `pulsePlanReading`, and the worker log, dispatch and implement routes reading through `pulseBranchReading` and `pulsePlanReading` <!-- builds: pulsePlanReading, the plan-level partial-pulse lookup -->

### Domain pulse lookup

- `bug/the-pulse-lookup-moves-into-the-domain` — `lookupBranch`, `branchFromPulse` and `ContinueRefusal` in the domain, `worktreeForBranch` and the agent panel as mappers, no behaviour change <!-- builds: lookupBranch in the domain, the one pulse walk --> <!-- waits: bug/the-board-routes-read-a-partial-pulse -->

### Repair-start decision

- `bug/the-repair-start-decision-moves-into-the-domain` — `repairStartAction` with the awaited re-run's reason, `repairStartTick` dispatching on it, and the tests that hold today's answers <!-- builds: repairStartAction, the repair-start decision -->

### Re-run bound

- `bug/the-first-red-rerun-wait-ends-at-checks-wait` — `rerunSettledOf` answering `overdue` past `Checks wait`, `redMainStep` reading it as `start-repair`, and the 2026-11-06 cells <!-- builds: the overdue re-run reading, the bound on the first red re-run --> <!-- waits: bug/the-repair-start-decision-moves-into-the-domain -->

### New main failure

- `bug/a-new-failure-on-main-starts-a-repair` — `firstRedFailing` on the repair record, and `redMainStep` starting a repair where a later settled red fails differently <!-- builds: firstRedFailing, the first red commit's failing checks --> <!-- waits: bug/the-first-red-rerun-wait-ends-at-checks-wait -->

## Notes

- Written 2026-11-21 from a triage of #3136, #3207 and #3208 against `origin/main` at `b21961602`. Every file:line above was re-read there.
- **Order.** The three families share no file except `packages/domain/src/rules/repair-start.ts` (#3208 only) and `pulse-branch.ts` (#3136 only), so no slice waits across families. Within #3207, slice 1 is the fix and slices 2 and 3 both wait on it and run in parallel. #3207 comes first because its defect opens a merge gate.
- **`plot-deliverable-search.sh` results.** `stateHome`, `state home`: nothing named. `mainRoot`: the existing `Trees.mainRoot` and `approve.ts:1390`'s private `mainRootOf`, which slice 1 reuses and slice 3 folds in. `pulsePlanReading`, `plan-level pulse lookup`: nothing. `lookupBranch`: only `packages/fleet/src/shared/continue-command.ts:37`, which slice 6 moves. `repairStartAction`: nothing. `rerunOverdue`: `packages/fleet/src/shared/revert-start.ts:225`, a bound on the pre-revert re-run over the domain's `lastGreenRerunOverdue`; slice 8 follows it. `failing runs changed`: nothing.
- **Parts of the issues that no longer hold on `b21961602`.**
  - #3207's *Done when* asks that no entry file under `packages/*/src/server/entry/` calls `--git-common-dir` itself. That already holds: the only `'--git-common-dir'` literals sit in `adapters/main-checkout.ts:25` and `adapters/git-dirs/git-dirs.ts:209,238,245`. The entries reach git through `processAnswers` or `Trees.mainRoot`, each resolving on its own; slice 3 counts resolvers, not git calls.
  - #3207's list of five entries (`pr-index-lookup.ts:32`, `review.ts:583`, `verify.ts:838`, `design.ts:280`) is out of date: `pr-index-lookup.ts:32` is a comment, and the resolvers are now the ones in the Motivation table.
  - #3136's line numbers moved: the bridge writer is `fleet-state-file.ts:157-167`, not `:140-150`; dispatch is `dispatch.ts:388` and implement `implement.ts:284`; `branchFromPulse` is `continue-command.ts:66` and `continueBranch` `:132`; `restartBranch` is `restart-command.ts:136`; `ContinueRefusal` is `continuation.ts:102`; the agent panel import is `agent-panel.ts:70-71`.
  - #3208's *Done when* asks for a test with "first red re-run green, head red on a different job" that answers `start-repair` and fails on today's code. With `rerunSettled: 'green'` and a settled commit after `firstRedSha`, today's `redMainStep` already answers `start-repair` (`repair.ts:243`), so that test passes today. The failing cell is the one with `runs: null` past the bound (slice 8).
  - The `plot-fleet-scan.sh:222` comment names a `write_bridge` function that no script under `skills/plot/scripts/` defines; slice 4 corrects it.
- `packages/fleet/src/shared/revert-start.ts:225-229` makes the same kind of decision in the fleet for the pre-revert re-run (`rerunOverdue`). This plan leaves it out: no issue names it.
