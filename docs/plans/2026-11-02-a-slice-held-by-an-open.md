# A slice held by an open wait reads as eligible

> A slice whose every unsettled branch is held by an open `waits:` annotation reads `eligible` on the board and offers a dispatch; the dispatch then starts a brief run that cannot succeed.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3049
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-02, Jan Wloka, plan-PR #3050 merged
- **Started:** 2026-11-02, Jan Wloka, `feature/dispatch-refuses-a-plan-with-nothing-startable`

## Changelog

- A slice whose every unsettled branch waits on an unmerged branch reads `waiting` on the board, shows the branch's own `waits for …` note, and offers no dispatch and no brief. The dispatch and implement controllers refuse such a plan with `nothing-startable` before a brief run starts. A missing or stale fleet reading keeps today's behaviour.

<!-- Board impact: yes, in packages/board only. The slice row's status word, note, tone and dispatch gates change, and the branch menu loses *Write the brief* for a held branch. The plan format, the template, the helper scripts, the pulse schema and the /api/fleet schema do not change, so the board artifact contract is unchanged. -->

## Motivation

On 2026-11-02 the board showed the Fleet index slice of `every-plan-reference-shows-its-issue` (#2993, #3040) as `eligible`, with the note *approved — nobody has taken it*, in the *Not started* section. The slice cannot start: its branch `feature/the-fleet-payload-indexes-its-plans` carries `<!-- waits: feature/the-panels-name-a-plan-one-way, feature/the-scan-script-is-a-launcher, bug/an-issue-reads-its-plan-from-main -->`, and `feature/the-scan-script-is-a-launcher` (plan `the-plan-walk-moves-into-the`, #2980, PR #3048) has not merged.

The pulse holds both answers (`.plot/state/last-pulse.json`): the slice reads `"verdict":"eligible"`, and its one branch reads `"state":"waiting"`, `"own_state":"open"`, `"held":false`, with `waits_on` naming the three branches. The scan folds the `waits:` verdict into the branch `state` (`waiting` or `blocked`, `packages/domain/src/entities/fleet.ts:54-63`). The pulse field `held` is a different fact: a boolean for a local worktree lock (`entities/fleet.ts:337`, set at `workflows/plan-walk-assembly.ts:495`). This plan reads the branch `state` and never reads `held`.

Two readers ignore the branch `state`:

- **The branch rule.** `startabilityVerdict` (`packages/domain/src/rules/verdict.ts:48-71`) tests `wip|claimed`, `merged|deferred`, `draft`, the slice verdict and the brief. It never tests `waiting` or `blocked`, so a held branch in an `eligible` slice answers `needs-brief` (brief missing) or `start-work` (brief present). The server stores it as `row.startability` (`packages/board/src/server/fleet.ts:6523`) and derives `briefWriter` from it (`fleet.ts:6705`). The client reads it in `isStartable` (`packages/board/src/app/lib/agent-rows/row-identity.ts:116`) and `needsBrief` (`row-identity.ts:135`), which gate *Start work* (`menus.tsx:554`) and *Write the brief* (`menus.tsx:565`) and the brief note on the row (`rows.tsx:1648`). `isStartable` also requires `state === 'open'`, so *Start work* is hidden today; *Write the brief* is not. The comment at `row-identity.ts:110` says `start-work` is returned only for `open` branches, which is false for `waiting`.
- **The slice row.** `SliceRow` computes its tone (`rows.tsx:1122`, `eligible` → `you`), its note (`rows.tsx:1163`, `approved — nobody has taken it`) and its two dispatch gates (`rows.tsx:937` sole-slice plan menu, `rows.tsx:1469` `SliceActions`) from `group.verdict` alone. Slot 5 of the tuple row prints the verdict word (`packages/board/src/app/lib/tuple-row.ts:1546-1549`). A *Not started* slice row receives no `soleRow` (`AgentList.tsx:1889`), so the verdict sentence wins over the branch's correct `waits for …` note.

The section is already right. `classify` puts a `waiting` or `blocked` branch in `not-started` with the note `waits for <list>` or `waits for <list>, which has no pull request` (`fleet.ts:4772-4794`), and `waitingOnFor` gives it tone `time` (`fleet.ts:3452`). `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts` pins both. `sliceSection` (`sections.ts:104-117`) moves only a merged-plus-unfinished slice and returns `null` for this one, so it does not decide this row.

The controller already knows the answer and ignores it. `plot-dispatch-command.mjs` (`packages/fleet/src/server/entry/dispatch-command.ts:115`) and `POST /api/dispatch` (`packages/board/src/server/dispatch.ts:348`) both call `startDispatch` (`packages/fleet/src/shared/dispatch-command.ts:89`). It takes the brief branch from `briefBranchFromPulse` (`dispatch-command.ts:75-76`), which is `startableBranches(pulse, slug, ∅)[0] ?? null` (`packages/domain/src/rules/auto-dispatch.ts:581`). `startableBranches` admits only `dispatchable` branches (`open` or `wip`, no held ref, `auto-dispatch.ts:275`), so for this plan the answer is `null`, and `startImplement` runs a branchless brief (`packages/fleet/src/shared/implement-run.ts:585`). `null` also means "no pulse": `fleetStateFile.readSync` returns `null` for a bridge older than 15 min (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:17,80`), and `startableBranches` returns `[]` for a plan the pulse does not hold or reads as not approved. `POST /api/implement` (`packages/board/src/server/implement.ts:255`) has the same null-brief path.

Cost, measured 2026-11-02: `plot-dispatch-command.mjs every-plan-reference-shows-its-issue` started the brief writer three times. Two runs ended at `IMPLEMENT_TIMEOUT_MS` (5 min, `implement-run.ts:126`) with exit 124, and the row read *brief failed*. The third run read the plan, found the unmerged wait and wrote no brief. Machine load was about 4 throughout. Auto-dispatch never started this slice: it counts with `dispatchable` (`auto-dispatch.ts:546-560`). The cost came from the manual controller only.

## Design

### Approach

1. **The branch rule answers no start for a held branch.** `startabilityVerdict` returns `null` for `state` `waiting` or `blocked`, before the slice-verdict test. `null` is already a documented return value, so `StartabilityVerdictSchema` does not change. This removes `needs-brief`, `start-work` and `briefWriter` for a held branch, and with them *Write the brief* in the branch menu and the brief note on the row. The comment at `row-identity.ts:110` is corrected. `unknown` keeps today's answer (see Notes).
2. **One domain function reads a slice over that rule.** `sliceHold(verdict, branches)` in `packages/domain/src/rules/verdict.ts` takes the slice verdict and, per branch, its `state` and its `startability` (the `startabilityVerdict` answer). It answers `null` (no hold; the verdict speaks as today) or `{ blocked: boolean, held: string[] }`. A slice is held when all of these are true: the verdict is `eligible`; at least one unsettled branch (not `merged`, not `deferred`) is `waiting` or `blocked`; and no unsettled branch has a non-null startability (no `start-work`, `needs-brief` or `someone-is-on-it`). `blocked` is true when any held branch is `blocked`; it outranks `waiting`, the same order `waitVerdict` uses (`eligible.ts:257`). It is not a sixth spelling of "startable": it reads `startabilityVerdict` and adds only the hold.
3. **The board derives the slice reading at the consumer.** A new pure module `packages/board/src/app/lib/agent-rows/slice-reading.ts` calls `sliceHold` over `group.verdict` and `group.rows[]` (`state`, `startability`, which the row already carries) and returns the slice word, note, tone and dispatch gate. `SliceRow` (`rows.tsx:937`, `:1122`, `:1163`, `:1469`) and `tupleFromSlice` (`tuple-row.ts:1546`) read it. For a held slice: the word is `waiting` (slot 5); the note is the held branch row's own server note (`fleet.ts:4772-4794`), joined with `; ` where several branches are held; the tone is `time` for a `waiting` hold and `you` for a `blocked` hold; no `SliceActions` and no sole-slice dispatch. The held arm precedes the grouped-count arm (`groupedCount`), so a multi-branch held slice reads `waiting` too. The row stays in *Not started*. No field is added to `AgentRow`, the pulse or `/api/fleet`, and the scan and `plan-walk-assembly.ts` are not edited, so the plan does not collide with PR #3048.
4. **One domain answer separates "no reading" from "nothing startable".** `dispatchReading(pulse, slug)` in `packages/domain/src/rules/auto-dispatch.ts`, beside `startableBranches`, answers one of four kinds:
   - `no-reading` — the pulse is `null` (missing, older than 15 min, or a cold board cache), the pulse does not hold the plan, or it reads the plan at a phase `dispatchPhase` rejects (a pulse older than the approval).
   - `branch` — `startableBranches` names a branch; it carries the first one, as `briefBranchFromPulse` does today.
   - `held` — no branch is startable, at least one slice is `eligible`, and `sliceHold` holds for every eligible slice (startability computed with `startabilityVerdict(state, phase, verdict, 'unknown')`). It carries each held branch with its `state` and `waits_on`.
   - `no-branch` — the pulse holds the plan and names no startable branch for any other reason (all claimed, a held ref). It keeps today's behaviour: a branchless brief run.
5. **One guard refuses in the controller, on positive evidence only.** `DispatchInput.briefBranch` becomes `startReading: (slug) => DispatchReading`. `startDispatch` refuses a `held` answer with `{ kind: 'refused', status: 409, reason: 'nothing-startable' }` before `startImplement`. The detail names each held branch and its prerequisites with the `classify` sentences (`waits for X` or `waits for X, which has no pull request`). `no-reading`, `no-branch` and `branch` start exactly as today. `POST /api/implement` (`implement.ts:255`) reads the same `dispatchReading` and refuses `held` with the same reason and a 409. Both controllers call one domain function, so they cannot disagree.

The board reading (step 3) and the controller (steps 4-5) share `sliceHold`. One unit test feeds one pulse fixture to both and asserts they agree.

Readers that answer correctly today and do not change: `/api/attention` (`attention.ts:320`, `waitingOn === 'click' && state === 'open'`), auto-dispatch's count (`auto-dispatch.ts:546-560`), the counts at `fleet.ts:1160` and `board.ts:1333`, and `classify` and `waitingOnFor` in `fleet.ts`.

### Decisions on the cases

- **One branch, `waiting`:** held. Word `waiting`, note `waits for <list>`, tone `time`, no dispatch. The controller refuses `nothing-startable`.
- **One branch, `blocked`:** held. Word `waiting`, note `waits for <list>, which has no pull request`, tone `you`, because only a plan edit clears it. The controller refuses `nothing-startable`, and the detail carries the no-pull-request sentence.
- **One `merged` branch and one `waiting` branch:** held. The merged branch is settled and does not count.
- **One `deferred` branch and one `waiting` branch:** held.
- **One held branch and one `open` branch:** not held. The slice reads `eligible` and offers a dispatch; `startableBranches` takes the open branch and `plot-dispatch.sh` claims only that one. The held branch's own row keeps its `waits for …` note.
- **One `claimed` (or `wip`) branch and one `waiting` branch:** not held, because `startabilityVerdict` answers `someone-is-on-it`. The slice keeps today's reading; its note is a separate defect (see Notes).
- **One `waiting` and one `blocked` branch:** held, `blocked` true. Tone `you`, both notes shown.
- **Every branch `deferred`, or every branch `merged`:** not held; the verdict speaks as today.
- **Any verdict other than `eligible`:** not held; the verdict speaks as today.

### Open Questions

- [x] Does a slice with one held branch and one open branch read `eligible` or a mixed state? — `eligible`, with a dispatch. The open branch is real work, and `startableBranches` and `plot-dispatch.sh` take only that branch. Hiding the control would stall the fleet. A unit test pins the case.
- [x] Does the scan emit the slice `verdict` as `waiting`, or does the domain derive the reading at the consumer? — The consumer derives it, through `sliceHold`, from the branch `state` and `startability` the pulse and the row already carry. A new `SliceVerdictSchema` member (`entities/fleet.ts:102`) would make every reader with an older bundle reject the whole pulse, would break `corpus/eligible.corpus.test.ts`, and would edit the walk PR #3048 moves. No pulse, `/api/fleet` or scan change.
- [x] Does the board word `blocked` and `waiting` differently at slice level? — Yes, in the note and tone, not in the word. The slot-5 word is `waiting` for both, because the slice verdict `blocked` already means "an earlier slice has to land first" (`rows.tsx:1164`). The note reuses the branch sentences from `fleet.ts:4772-4794`. A `waiting` hold takes tone `time`; a `blocked` hold takes tone `you`, because a merge never clears it.

## Test table

Every row is a unit test with no browser. Each decision is asserted where it is made.

| Case | Expected | Test file |
|---|---|---|
| `startabilityVerdict('waiting', 'approved', 'eligible', 'missing')` | `null` | `packages/domain/test/verdict.test.ts` |
| `startabilityVerdict('waiting', 'approved', 'eligible', 'present')` | `null` | `packages/domain/test/verdict.test.ts` |
| `startabilityVerdict('blocked', …)` with brief `missing` and `present` | `null` | `packages/domain/test/verdict.test.ts` |
| `startabilityVerdict('open', 'approved', 'eligible', 'missing')` | `needs-brief` (unchanged) | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — one `waiting` branch, verdict `eligible` | `{ blocked: false, held: [branch] }` | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — one `blocked` branch | `{ blocked: true, held: [branch] }` | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — `merged` + `waiting` | held, `held` names only the waiting branch | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — `deferred` + `waiting` | held | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — `open` + `waiting` | `null` | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — `claimed` + `waiting` | `null` | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — `waiting` + `blocked` | `{ blocked: true }`, both named | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — all `deferred`; all `merged` | `null` | `packages/domain/test/verdict.test.ts` |
| `sliceHold` — verdict `blocked`, `unapproved`, `complete` with a `waiting` branch | `null` | `packages/domain/test/verdict.test.ts` |
| `dispatchReading(null, slug)` | `no-reading` | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — pulse without the plan | `no-reading` | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — pulse reads the plan as `draft` | `no-reading` | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — the Fleet index fixture (one `waiting` branch, `held: false`, three `waits_on`) | `held`, names the branch and all three prerequisites | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — an `open` branch with `held: true` (desk lock) and no wait | `branch`, never `held` | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — `open` + `waiting` | `branch` naming the open branch | `packages/domain/test/auto-dispatch.test.ts` |
| `dispatchReading` — all branches `claimed` | `no-branch` | `packages/domain/test/auto-dispatch.test.ts` |
| One fixture: `dispatchReading` and `sliceHold` over the same slice | both say held, or both say not held | `packages/domain/test/auto-dispatch.test.ts` |
| `startDispatch` with a `held` reading | `{ kind: 'refused', status: 409, reason: 'nothing-startable' }`, detail names branch and prerequisites; no `startImplement`, no `scripts.start`, no receipt | `packages/fleet/test/unit/dispatch-command.test.ts` |
| `startDispatch` with a `blocked` held reading | `nothing-startable`, detail carries `which has no pull request` | `packages/fleet/test/unit/dispatch-command.test.ts` |
| `startDispatch` with `no-reading` and with `no-branch` | `started`, branchless brief (today's behaviour) | `packages/fleet/test/unit/dispatch-command.test.ts` |
| Entry tests at `dispatch-command.test.ts:73`, `:84`, `:94` (`pulse: () => null`) | outcome unchanged: they read `no-reading` and start, exit 1, or refuse `no-implement-command` as today | `packages/fleet/test/unit/dispatch-command.test.ts` |
| `startDispatch` test at `dispatch-command.test.ts:227` (`briefBranch: () => null`) | input changes to `startReading: () => ({ kind: 'no-reading' })`; outcome unchanged (`started`, then `implement-running`) | `packages/fleet/test/unit/dispatch-command.test.ts` |
| `POST /api/implement` with a `held` reading | 409, `nothing-startable`, no spawn | `packages/board/test/unit/dispatch-brief-branch.test.ts` |
| `POST /api/implement` and `POST /api/dispatch` with a `null` pulse | start as today | `packages/board/test/unit/dispatch-brief-branch.test.ts` |
| `sliceRowReading` — held `waiting` slice | word `waiting`, note = the branch row's note, tone `time`, `dispatch: false` | `packages/board/test/unit/slice-reading.test.ts` |
| `sliceRowReading` — held `blocked` slice | word `waiting`, note ends `which has no pull request`, tone `you`, `dispatch: false` | `packages/board/test/unit/slice-reading.test.ts` |
| `sliceRowReading` — `open` + `waiting` slice | word `eligible`, note `approved — nobody has taken it`, tone `you`, `dispatch: true` | `packages/board/test/unit/slice-reading.test.ts` |
| `sliceRowReading` — `blocked` and `unapproved` verdicts | today's notes and tones, `dispatch: false` | `packages/board/test/unit/slice-reading.test.ts` |
| `tupleFromSlice` — held slice | slot 5 reads `waiting` | `packages/board/test/unit/tuple-row.test.ts` |
| Held branch row on the server | `startability` `null`, `briefWriter` absent | `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts` (new case) |
| Existing cases at `a-slice-with-no-work-waits-in-not-started.test.ts:44-48`, `:56-64` | unchanged: `not-started`, `waits for …`, tone `time` | `packages/board/test/unit/a-slice-with-no-work-waits-in-not-started.test.ts` |

The browser test `packages/board/test/integration/slice-head-says-its-verdict.browser.test.ts:145` keeps asserting the `eligible` note for an eligible slice with an open branch. No new browser test is added: the decisions move out of `SliceRow` into `slice-reading.ts`.

## Slices

### Held start refusal

- `feature/dispatch-refuses-a-plan-with-nothing-startable` — `startabilityVerdict` answers `null` for `waiting` and `blocked`; `sliceHold` and `dispatchReading` in the domain; `startDispatch` and `POST /api/implement` refuse `held` with `nothing-startable` and start as today on `no-reading` and `no-branch`; the domain, fleet and implement-route rows of the test table <!-- builds: sliceHold and dispatchReading, the domain answer for a slice and a plan with nothing startable -->

### Slice reading

- `feature/a-held-slice-reads-as-waiting` — `slice-reading.ts` maps `sliceHold` to the slice word, note, tone and dispatch gate; `SliceRow` (`rows.tsx:937`, `:1122`, `:1163`, `:1469`) and `tupleFromSlice` read it; the board rows of the test table <!-- builds: sliceRowReading, the slice row's word, note, tone and dispatch gate as one pure function -->

## Notes

- **Slice order.** The refusal ships first because it stops the measured cost (5-minute brief runs per click), and it carries the domain functions both surfaces read. The board slice depends on `sliceHold`, and the wave order already puts it second, so no `waits:` annotation is needed. The refusal does not depend on the board slice.
- **Out of scope.** `startabilityVerdict` keeps its answer for `unknown`: `classify` already words it (`fleet.ts:4788`), and no evidence shows a dispatch cost from it. `nextWork` (`waiting.ts:81-110`) answers `none` for a plan whose only unsettled slice is a held eligible slice; `firstBrieflessBranch` (`auto-dispatch.ts:657-672`) can name a waiting branch on a mixed slice; `skippedPlans` reports a held plan as `no-eligible-wave` (`auto-dispatch.ts:769`); and the fleet log lines at `packages/fleet/src/shared/auto-dispatch.ts:256,295` gate on `verdict === 'eligible'`. None of them starts a run. Each can read `sliceHold` in a follow-up plan. A `claimed` + `waiting` slice also reads `approved — nobody has taken it` today; that is a separate defect.
- **Fixture.** PR #3048 merging removes the live case, so the tests use a fixture copied from the 2026-11-02 pulse row.
- Related, delivered: `a-slice-waits-on-every-branch-it-names` (#1153) made the parser keep every `waits:` entry; `a-blocked-wave-is-not-eligible` made a blocked wave read blocked. Neither covers the slice verdict reading `eligible` over a branch held by an open wait.
- Panel round 1: `.plot/panels/a-slice-held-by-an-open/panel.md`.
- Refs #2993, #2980.
