# Board files rows in the wrong section: claimed slice under NOT STARTED, abandoned branches under WAITING ON YOU

> The server decides a row's section and its label from the same readings, so a label cannot contradict the section it sits in.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3096
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The board lists an `abandoned` branch and an orphaned claim under QUIET, and keeps their Open menu item there.
- The board lists a claimed or `wip` branch with no known worker under WORKING, labelled `no known worker`, drawn apart from live agents and counted in the section's header.

<!-- Board impact: changes the server's section answer. `classifyGroup` and `withHandOver` in packages/board/src/server/fleet.ts change, so the `group` field of /api/fleet changes; the client sections follow. sections.ts and tuple-row.ts decide no section. No change to the plan format, template or helper scripts. Rebuild the board artifact with pnpm build:board to test; do not commit it. -->

## Motivation

Measured 2026-11-03 on Plot 2.30.0 (marketplace checkout `820a708`), the board files two kinds of row in the wrong section.

1. **A claimed slice under NOT STARTED.** `feature/mat-spiel-durchstich` is claimed on `origin` (empty claim commit), and a hand-started worker runs in its worktree, because the registry does not hand out a Design plan's spike (#3092). The row reads `someone is on it` under NOT STARTED, and WORKING lists nothing.
2. **Abandoned branches under WAITING ON YOU.** Three branches (`feature/success-story-ewz-leg`, 291 days; `feature/aeo-retest-2026-06-28` and `feature/seo-quick-wins-2026-06-28`, 128 days) carry the label `abandoned` and `"group": "waiting-on-you"` in `/api/fleet`. WAITING ON YOU is the operator's action list. Stale branches at its top push down the rows that need a decision today, and they stay for months.

The two cases have two causes. Line numbers below are on `origin/main` at `33403a3de`.

- **Case 1.** The section and the label read different facts. `classifyGroup` reads the scan's worker reading: a fresh claim with no `running` or `waiting` worker returns `not-started` with the note `claimed, no known worker` (`packages/board/src/server/fleet.ts:4723-4725`). `withHandOver` (`fleet.ts:6018`) moves the row to WORKING only when a registry manifest names the branch. A hand-started worker writes no pid file and has no manifest, so both readings miss it. The label comes from `startabilityVerdict`, which answers `someone-is-on-it` for every `claimed` and `wip` branch and reads no worker (`packages/domain/src/rules/verdict.ts:56`). The same contradiction holds for a fresh `wip` branch (`fleet.ts:4845-4847`) and for a claimed or `wip` branch with local activity (`fleet.ts:4726-4728`, `4848-4850`). `startableNote` in a component then blanks the server's note for `someone-is-on-it` (`packages/board/src/app/lib/agent-rows/rows.tsx:1597-1599`).
- **Case 2.** A deliberate domain rule. `quietPlacement` (`packages/domain/src/rules/quiet.ts:196-208`) maps `abandoned` and `orphaned-claim` to `waiting-on-you`, and `classifyGroup` reads it at `fleet.ts:4889`. The orphaned-claim arm hard-codes the same answer (`fleet.ts:4757-4767`).

No automation reads a row's `group`: `packages/fleet/src`, `packages/domain/src` and the shell scripts read no row section. Auto-dispatch decides from claims and verdicts. The risk in case 1 is what a reader concludes, not what dispatch does.

## Design

### Operator decisions

Jan Wloka decided the following on 2026-11-03, after the panel round. They supersede the settled rules named in the next section.

- **A. WORKING holds a claimed or `wip` branch with no known worker, as a new row kind.** Scope: a fresh claim, a fresh `wip` branch, and a claimed or `wip` branch with local activity, each with no `running` or `waiting` worker and no registry hand-over. A stale claim or stale `wip` branch with no local activity follows decision B.
- **B. QUIET holds `abandoned` and `orphaned-claim` rows.** They leave WAITING ON YOU.
- **C. The server decides.** `/api/fleet`'s `group` changes and the client follows. Only the arms this change touches move into the domain.
- **D. The plan row follows its rows.** No change to `deriveSlices`.
- **E. The `abandoned` attention verdict is out of scope.** `packages/board/src/server/attention.ts:236` and `:249` answer for a `failed` or `ended` worker on a different list, and do not change.

### Superseded rules

- **#362, `every-section-has-one-subject` slice Inverted** (commit `ce27834f9`, 2026-08-23; plan `docs/plans/2026-08-20-every-section-has-one-subject.md:218-232`). That rule put a branch with no known agent in NOT STARTED: "no agent at all sitting in the section for agents". Decision A reverses it for claimed and `wip` branches. An `open` branch with local activity keeps the rule (`fleet.ts:4420-4426`). The comments that cite the rule change with the code: `fleet.ts:4707-4710`, `4830-4833`, `5188-5191`.
- **#1758 / #1902, the quiet placement** (commit `53a010f69`, 2026-10-16; plan `docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md`). That rule kept `abandoned` and `orphaned-claim` in WAITING ON YOU ("revive or drop"). Decision B reverses it. The `quietPlacement` TSDoc (`quiet.ts:184-195`) and the comments at `fleet.ts:4736-4745`, `4851-4860` and `4877-4881` change with the code.

An agent that meets a test or comment stating the old placement updates it. The placement change is intended, not a defect to repair.

### Quiet placement

Slice 1 implements decision B.

- **`quietPlacement`** answers `quiet` for `abandoned` and `orphaned-claim`. Its return type becomes `'done' | 'quiet'`.
- **`quietNeedsPerson`** (`quiet.ts:219-220`) is defined as `quietPlacement === 'waiting-on-you'`, so it would answer `false` for every kind. No code calls it; four comments in `fleet.ts` name it (`:4738`, `:6452`, `:7249`, `:7284`). Slice 1 deletes the function and its tests (`packages/domain/test/quiet.test.ts:142`, `:176-204`), and rewrites the four comments and the one in `packages/board/test/unit/a-landed-branch-leaves-waiting.test.ts:90` to name `quietPlacement`.
- **The orphaned-claim arm** (`fleet.ts:4757-4767`) takes its group from `quietPlacement(claimedReadings(…))`, not a literal. The note does not change.
- **`withHandOver`** (`fleet.ts:6022`) reads the orphaned claim as `state === 'claimed'`, `group === 'quiet'`, `pr === null`. Without this change a handed orphaned claim stays in QUIET, and a double hand-out on it never reaches WAITING ON YOU.
- **The menu.** `offersOpen` (`packages/board/src/app/lib/agent-rows/menus.tsx:120-122`) also answers true for a `quiet` row whose `quietKind` is `abandoned` or `orphaned-claim`. The comment at `menus.tsx:642-647` names the wider scope. The row keeps its Open item, its `quietKind` word and its note.
- **The reporter gap.** `/plot-reconcile` §19 reports only branches no plan names. A plan-named abandoned branch has no other reporter. QUIET still shows it with the word `abandoned`, the note `commits, no PR ever opened — last commit N ago` and the Open item, and QUIET's header counts it. It leaves the action list; the operator accepts that.

### Claims without a worker

Slice 2 implements decision A.

- **The domain rule.** A new file `packages/domain/src/rules/unworked-branch.ts` holds three arrow functions:
  - `unworkedPlacement({ state, workerLive, fresh, local })` answers `{ group: 'working', startability: 'no-known-worker' }` for a `claimed` or `wip` branch with no live worker that is fresh or local, and `null` otherwise.
  - `rowStartability(base, workerLive)` answers `no-known-worker` where `base` is `someone-is-on-it` and no worker is live, and `base` otherwise.
  - `noteShown(startability)` answers false for `someone-is-on-it` only. It replaces the body of `startableNote` (`rows.tsx:1597-1599`), which calls it.
- **The new startability value.** `no-known-worker` joins `StartabilityVerdictSchema` in `packages/domain/src/rules/verdict.ts:18-20` and in the board contract `packages/board/src/contract/schema.ts:1801-1803`. `startabilityWord` (`packages/board/src/app/lib/tuple-row.ts:1098-1106`) renders it as `no known worker`. `stateStatus` (`tuple-row.ts:1160-1162`) reads `quietKind` before a `no-known-worker` startability, so a QUIET row still reads `abandoned` or `unclaimed`.
- **`startabilityVerdict` does not change.** `auto-dispatch.ts:656` and `sliceHold` (`verdict.ts:106-109`) read it, and `slice-reading.ts:35` passes the row's startability to `sliceHold`, which reads only `!== null`. `rowsFromPulse` (`fleet.ts:6557`) wraps it in `rowStartability` with the row's worker reading.
- **The arms replaced in `classifyGroup`.** Four arms take their group from `unworkedPlacement` and keep their note: the fresh claim (`fleet.ts:4723-4725`, note `claimed, no known worker` or `claimed elsewhere`), the claimed local activity (`fleet.ts:4726-4728`), the fresh `wip` (`fleet.ts:4845-4847`, note `last commit N ago`), and the `wip` local activity (`fleet.ts:4848-4850`). `localActivity` (`fleet.ts:5203`) keeps its notes and its `not-started` answer for the `open` arm (`fleet.ts:4425`). The draft-placement checks before each arm (`fleet.ts:4717-4722`, `4839-4844`) answer first and do not change. Every other arm of `classifyGroup` stays where it is.
- **The hand-over.** `withHandOver` (`fleet.ts:6018-6036`) also takes a row whose startability is `no-known-worker` as a candidate. One live session moves it to WORKING with `HANDED_NOTE` and `someone-is-on-it`. Two or more send it to WAITING ON YOU with `handed to N agents at once`.
- **The render.** WORKING draws live registry entries only (`packages/board/src/app/components/AgentList.tsx:1572-1600`, `working-agents.ts:40-54`). A new selector `claimedWithoutWorkerRows(rows)` in `packages/board/src/app/lib/agent-rows/working-agents.ts` selects rows with `group === 'working'` and `startability === 'no-known-worker'`. `AgentList.tsx` draws them below the registry rows with the branch row renderer, and the empty-section check counts them.
- **The count.** The rows count in WORKING's header. `sectionCount` (`packages/board/src/app/lib/agent-rows/plan-level-row.tsx:131-148`) adds them to `registry + planLevel.working`. A header that omits drawn rows breaks the board's count rule: a count beside a section is derivable from the section's rows (`sectionTally`, `sections.ts:438-440`).
- **Not live.** `isLive` (`packages/board/src/app/lib/agent-rows/stuck.ts:32-34`) answers false for a `no-known-worker` row, so it carries no pulse. `showsWorkerLog` (`menus.tsx:68-70`) answers false for it, because no process exists to log.
- **The plan row (decision D).** NOT STARTED builds its plan heads from the rows in the section (`groupByPlan`, `sectionTally` at `sections.ts:484-500`). A plan whose only row moves to WORKING therefore has no head in NOT STARTED. `deriveSlices` (`fleet.ts:3649-3659`) keeps `complete ? 'done' : 'not-started'`, because `sliceGroupsFor` reads `Slice.section` only as done or not done (`sections.ts:261-301`) and returns no slice groups for WORKING.

### Tests

Each test fails on `origin/main` and passes after its slice.

**Slice 1:**

- In `packages/board/test/unit/classifier-is-total.test.ts`, a typed invariant over `withHandOver(rowsFromPulse(…), agents)`: no row whose `quietKind` is `abandoned` or `orphaned-claim` has `group: 'waiting-on-you'`. Main fails on the stale `wip` and stale claim fixtures.
- A `withHandOver` case: an orphaned claim in QUIET with two live sessions reads `waiting-on-you` and `handed to 2 agents at once`; with one session it reads `working`.
- `offersOpen` cases: an `abandoned` and an `orphaned-claim` row in QUIET offer Open; a `quiet` kind row does not.
- Mock fleet: `packages/board/src/server/mock-fleet.ts` gains an `abandoned` row, so the mock board shows QUIET's new rows.
- Assertions that flip from `waiting-on-you` to `quiet`:
  - `packages/domain/test/quiet.test.ts:214-216` (renamed to say QUIET); `:142`, `:176-204` deleted with `quietNeedsPerson`.
  - `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts:33-36`.
  - `packages/board/test/unit/a-landed-branch-leaves-waiting.test.ts:96-100`.
  - `packages/board/test/unit/an-idle-branch-says-how-long.test.ts:146`, `:149`.
  - `packages/board/test/unit/branch-with-work-is-seen.test.ts:140`, `:162`.
  - `packages/board/test/unit/classifier-is-total.test.ts:353`, `:366`.
  - `packages/board/test/unit/fleet.test.ts:269`, `:280`, `:291`, `:300` (the `45, 30` case), `:308`, `:395-396`, `:498-499`, `:1655`, `:3246`.
  - `packages/board/test/unit/a-handed-slice-reads-as-taken.test.ts`: the orphaned-claim fixtures at `:59`, `:121`, `:181` carry `group: 'quiet'`.
  - `packages/board/test/integration/row-placement-quiet-and-ended-desk.browser.test.ts:101-113`: the `feature/left-behind` fixture carries `group: 'quiet'`, and the assertion finds it under Quiet and not under Waiting on you.
  - `packages/board/test/integration/quiet-kinds-render.browser.test.ts:56`, `:61`: the fixtures carry `group: 'quiet'`, and the section assertions follow.

**Slice 2:**

- `packages/domain/test/unworked-branch.test.ts` covers every arm of the three functions. The domain package holds 100% lines, branches, functions and statements over `src/!(adapters)/**/*.ts` (`packages/domain/vitest.config.ts:71`).
- In `classifier-is-total.test.ts`, a typed invariant over `withHandOver(rowsFromPulse(…), agents)`: no row with startability `someone-is-on-it` or `no-known-worker` has `group: 'not-started'`. Main fails on the fresh claim, fresh `wip` and local-activity fixtures.
- In `packages/board/test/unit/every-row-lands-in-one-section.test.ts`: over a fixture pulse and registry, each row is selected by exactly one of `rowsBySection` plus the per-section `group` filter, `workingAgentRows`, and `claimedWithoutWorkerRows`. It includes a `no-known-worker` row. Main fails: that row is selected by none.
- The case-1 fixture: `state: 'claimed'`, age 5 minutes inside the quiet window, `worker: 'none'`, no registry entry, plan phase `design` with an approved spike. A second fixture uses an approved plan. Both read `group: 'working'`, `startability: 'no-known-worker'`, note `claimed, no known worker`.
- The double hand-out: the case-1 fixture with two live sessions naming the branch reads `waiting-on-you` and `handed to 2 agents at once`.
- `sectionCount`, `isLive` and `showsWorkerLog` cases for a `no-known-worker` row.
- Mock fleet: `mock-fleet.ts` gains a claimed row with no worker.
- Assertions that flip from `not-started` to `working`: `packages/board/test/unit/fleet.test.ts:289`, `:300` (the `45, 60` case), `:382`, `:468`, `:700`, `:1654`, `:1656`, `:3244`, `:3245`, and every other `classify('claimed' | 'wip', …)` case with a fresh age or local activity and no live worker.
- `packages/board/test/integration/claimed-slice-says-someone-is-on-it.browser.test.ts`: the `not-started` claimed and `wip` fixtures at `:92`, `:103`, `:125` carry `group: 'working'` and `startability: 'no-known-worker'`, and the assertions find the word `no known worker` under Working. `a-handed-slice-reads-as-taken.browser.test.ts` changes only where it fixes a claimed row in `not-started`.

### Docs

- `docs/board-domain-model.md:1042-1056` (WORKING): the worker column admits the `no-known-worker` row kind beside `running`.
- `docs/board-domain-model.md:1091-1106` (QUIET): branch state admits `claimed`, and a PR may be absent.
- `docs/board-domain-model.md:1071-1089` (NOT STARTED) states `state: open only`; slice 2 makes that true and the section says so.
- The `GROUPS` hints in `packages/board/src/app/lib/agent-rows/sections.ts:25-50` stay as they are.

### Changesets

Each slice adds one changeset, description first, then the comment block:

```markdown
---
'@plot-pm/board': patch
'plot': patch
---

<one-paragraph description of the slice's behaviour>

<!--
plan: docs/plans/2026-11-03-board-files-rows-in-the-wrong.md
-->
```

`plot` is named because the domain package changes. Add a `bumps:` block only where a skill changes; none does. `./scripts/check-changeset-packages.sh` checks the file.

### Open Questions

None. The panel round closed the four earlier questions; the sections above give the answers.

## Slices

### Quiet placement

- `feature/board-files-rows-in-the-wrong` — `quietPlacement` answers `quiet` for `abandoned` and `orphaned-claim`; delete `quietNeedsPerson`; the orphaned-claim arm reads `quietPlacement`; `withHandOver` reads the orphaned claim in QUIET; `offersOpen` covers both kinds in QUIET; add the QuietKind invariant, the hand-over and menu cases and the mock row; flip the listed assertions and the QUIET doc table.

### Claims without a worker

- `feature/working-shows-claims-without-a-worker` <!-- waits: feature/board-files-rows-in-the-wrong --> — add `unworked-branch.ts` and the `no-known-worker` startability; four `classifyGroup` arms read `unworkedPlacement`; `rowsFromPulse` reads `rowStartability`; `withHandOver` takes `no-known-worker` rows; WORKING draws and counts them, never as live; `startableNote` calls `noteShown`; add the startability invariant, the one-section test, the case-1 and double hand-out fixtures and the mock row; flip the listed assertions and the WORKING and NOT STARTED doc tables.

## Notes

- Created from tracker issue #3096.
- Panel round 1: `.plot/panels/2026-11-03-board-files-rows-in-the-wrong/panel.md` holds the moderation, and the four verdict files beside it hold the findings.
- Related: #3092 (the registry hands out no Design-plan spike, which caused the hand start in case 1).
