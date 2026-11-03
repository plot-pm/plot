# Panel moderation: board-files-rows-in-the-wrong

Plan: `docs/plans/2026-11-03-board-files-rows-in-the-wrong.md` (issue #3096, plan PR #3098). Round 1, four jurors: layering, safety, testability, seams. The jurors read `origin/main` at `ee678d5c8`. The moderator re-checked every adopted line number at `origin/main` `33403a3de`; no file the findings cite changed between the two commits.

## Positions

| Juror | Position |
|---|---|
| layering | amend |
| safety | amend |
| testability | amend |
| seams | amend |

All four answered amend. No juror answered reject or proceed.

## Agreement of all four

- **Wrong files.** The board-impact comment names `sections.ts` and `tuple-row.ts`. The section comes from `classifyGroup` (`packages/board/src/server/fleet.ts:3784`) and `withHandOver` (`fleet.ts:6018`), and `/api/fleet`'s `group` must change.
- **Two settled rules reversed without a name.** A claimed branch with no known worker goes to NOT STARTED by #362 (`ce27834f9`, `every-section-has-one-subject` slice Inverted; comment at `fleet.ts:4707`). `abandoned` goes to WAITING ON YOU by #1758 / #1902 (`53a010f69`) through `quietPlacement` (`packages/domain/src/rules/quiet.ts:196`). The plan described the second as a rule the section ignores; the rule itself answers `waiting-on-you`.
- **The invariant mixes vocabularies.** `abandoned` is a `QuietKind`, not a `StartabilityVerdict`. As written, the case-2 half passes on main.
- **Too big as one slice.** A single domain function for every section arm rewrites the ~30-argument `classifyGroup`. An unattended Sonnet agent cannot do that safely from the plan.

## Findings of some jurors only

- **A row lands in no section** (safety F1 HIGH, seams 3). WORKING draws live registry entries only (`AgentList.tsx:1572-1600`, `working-agents.ts:40-54`), and its count is `registry + planLevel.working` (`plan-level-row.tsx:131-148`). A branch row with `group: 'working'` and no live agent is drawn nowhere.
- **A hidden double hand-out** (safety F2 HIGH). `withHandOver` rewrites only `not-started` rows and the orphaned claim (`fleet.ts:6022-6023`). A claimed row moved to `working` first would skip the `handed to N agents at once` report.
- **Menu loss** (safety F4). `offersOpen` answers true for `waiting-on-you` only (`menus.tsx:120-122`). An abandoned row in QUIET loses its Open item.
- **The §19 reporter gap** (safety F4). `/plot-reconcile` §19 reports only branches no plan names. A plan-named abandoned branch has no other reporter than the board.
- **Wider case 1** (layering 3, testability 2, seams 2). `startabilityVerdict` answers `someone-is-on-it` for every `claimed` and `wip` branch (`packages/domain/src/rules/verdict.ts:56`), so fresh `wip` rows and local-activity rows carry the same contradiction.
- **A decision in a component** (layering 4). `startableNote` (`packages/board/src/app/lib/agent-rows/rows.tsx:1597`) blanks the note for `someone-is-on-it`.
- **`quietNeedsPerson` follows `quietPlacement`** (layering 2, testability 3). It is defined as `quietPlacement === 'waiting-on-you'` (`quiet.ts:219`).
- **The browser fixture carries the old answer** (testability 4). `row-placement-quiet-and-ended-desk.browser.test.ts:101-113` hard-codes `group: 'waiting-on-you'` and stays green after a server fix.

## Disagreements

- **The plan row** (seams 6, safety F6). Both said the plan head stays in NOT STARTED because `deriveSlices` gives a slice only `done` or `not-started` (`fleet.ts:3655`). The moderator checked the render: NOT STARTED builds its plan heads from the rows in the section (`groupByPlan`, `sectionTally` at `sections.ts:484`), and `Slice.section` is read only as done or not done (`sliceGroupsFor`, `sections.ts:261-301`). The head follows its row. The plan records that answer.
- **Scope of the orphaned claim.** Safety asked to keep the orphaned claim in WAITING ON YOU. Testability and seams asked for a decision. The operator moved it to QUIET (decision B).

## Ran versus read

All four jurors only read. Each ran read-only `git fetch`, `git show origin/main:<file>`, `git grep` and `gh issue view`; none ran a test, a build, the board or the fleet. Every fail-before claim rests on reading the arms, not on a run.

## Shared blind spot

Nobody rendered the board. The finding that a `working` branch row with no registry entry is drawn nowhere rests on source and TSDoc. The rows-in-one-section test of slice 2 is the first execution of that claim.

## Operator decisions

Jan Wloka decided on 2026-11-03, after reading this summary:

- **A.** A claimed or `wip` branch with no known worker, fresh or with local activity, goes to WORKING as a new drawable row kind. This reverses #362. The panel recommended the other option: keep the row in NOT STARTED with an honest label. The operator chose WORKING against that recommendation.
- **B.** `abandoned` and `orphaned-claim` rows move from WAITING ON YOU to QUIET. This reverses #1758 / #1902 and the `quietPlacement` rule.
- **C.** The server decides. Only the arms this change touches move into a domain function.
- **D.** The plan row follows from the code.
- **E.** The `abandoned` attention verdict (`packages/board/src/server/attention.ts:236`) is out of scope.
- **F, G, H.** Typed invariant tests, two slices, and a changeset per slice.

The plan's `## Design` records each decision and the rule it supersedes.
