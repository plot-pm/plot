# Seams juror — board-files-rows-in-the-wrong (#3096, plan PR #3098)

Position: amend

The defect is real and worth fixing: the payload does carry `group: not-started` beside `startability: someone-is-on-it`. But the plan places the fix in the wrong files and names the cause wrongly. It sends rows to a section that cannot draw them. It also reverses two settled placement decisions without naming them. An unattended Sonnet agent cannot build the slice from the plan as written.

## Findings

### 1. The section is decided on the server, not in `sections.ts` or `tuple-row.ts`

- `group` is computed by `classifyGroup` in `packages/board/src/server/fleet.ts:3784` and rewritten after that by `withHandOver` (`fleet.ts:6017-6035`). The client only re-sections a split slice (`sections.ts` `rowsBySection`, `sliceSection`). `tuple-row.ts:1131-1138` only turns `quietKind` into a word.
- The plan's Board impact comment names `packages/board/src/app/lib/agent-rows/sections.ts` and `tuple-row.ts`. A change there would give the client a second section answer that disagrees with `/api/fleet`'s `group`, and that disagreement is the kind of defect the plan sets out to remove. Open Question 2 is answered by the code: the server-side `group` has to change. `GROUP_ORDER` (`fleet.ts:5791`) and the row sort at `fleet.ts:7447` read it.
- The abandoned placement belongs to the domain rule `quietPlacement` (`packages/domain/src/rules/quiet.ts:199-209`), which returns `waiting-on-you` for `abandoned` and `orphaned-claim`. `classifyGroup` calls it at `fleet.ts:4883`.

### 2. The Motivation misstates the mechanism for case 1

- The plan says "the section comes from a second reading that asks only whether an agent manifest names the branch". That is not what the code does. For a claimed branch, `classifyGroup` reads the scan's `worker` field (`fleet.ts:4674-4724`). A fresh claim with no `running` or `waiting` worker returns `{ group: 'not-started', note: 'claimed, no known worker' }` (`fleet.ts:4723`). After that, `withHandOver` lifts the row to `working` only when a registry manifest names the branch (`fleet.ts:6017-6035`). A hand-started worker writes no pid file (`fleet.ts:4682-4685`), and #3092 means no manifest exists, so both readings miss it.
- `0 manifests, 6 synthesized` comes from the registry badge in `FleetControls.tsx:303-305`, not from WORKING's header.
- The label is not a second reading of the claim. `startabilityVerdict` (`packages/domain/src/rules/verdict.ts:56`) returns `someone-is-on-it` for every `wip` and every `claimed` branch, whatever the worker reads. So the same contradiction also holds for a fresh `wip` branch with no known worker (`fleet.ts:4845-4846`, `not-started` plus `last commit N ago`), and the plan does not name that case. Abandoned rows (`wip`) and orphaned claims (`claimed`) carry `someone-is-on-it` too, so an abandoned row moved to QUIET still reads "someone is on it" in its startability slot.

### 3. A branch row with `group: 'working'` is not drawn

- WORKING renders registry agents, not branch rows. `AgentList.tsx:1159-1176`: "WORKING RENDERS FROM THE REGISTRY, so its body, its count and its fold are the AGENTS, not the branch rows". `workingAgentRows` (`working-agents.ts:39-53`) keeps only live registry entries. `sections.ts:292` returns no slice rows for `working`. The `withHandOver` TSDoc says it directly: "the moved row is not drawn itself" (`fleet.ts:5964-5967`).
- So the plan's "claimed, nobody watching" state in WORKING would take the `mat-spiel-durchstich` row out of NOT STARTED and draw it nowhere. That is worse than the defect. The slice needs a new render path and a count rule (`sectionCount` at `AgentList.tsx:1170-1177` counts `registry` and `planLevel` for WORKING, never branches). The plan does not mention either. Open Question 1 cannot be "wording and icon" only.

### 4. Two settled decisions are reversed without being named

- `docs/plans/2026-08-20-every-section-has-one-subject.md:40-48` and `:151-155` settle that "no branch appears in WORKING without an agent holding it". `fleet.ts:4706-4709` and `:4829-4832` cite it ("WORKING IS ABOUT AGENTS, NOT BRANCHES", from #362, `ce27834f9`). `docs/board-domain-model.md:1042-1052` lists `worker: running` as WORKING's only allowed worker value. A claimed row with no known worker in WORKING breaks all three.
- `quietPlacement` placing `abandoned` in WAITING ON YOU is the decision of #1758 / #1902 (`53a010f69`, 2026-10-16), which moved `quiet` to QUIET and kept `abandoned` in WAITING ON YOU on purpose ("revive it, or drop it", `quiet.ts:14-17`, `fleet.ts:4851-4858`). The plan's Approach says "the section assignment honours it" as if the rule already answered QUIET. It does not. The rule answers `waiting-on-you`, and the plan reverses it.
- Both reversals can be right. But a person must make them, and the plan must name the decision it replaces so that the agent updates its comments, the domain model doc and the tests rather than fight them.

### 5. Orphaned claims are left undecided

- A claimed branch past the quiet window with no worker goes to WAITING ON YOU as `orphaned-claim` (`fleet.ts:4730-4770`, #1090). `withHandOver` keeps that reading ("Absence is not falsehood", `fleet.ts:5996-6000`). The plan says "a claimed branch with no manifest or live process" moves to WORKING. Read literally, every orphaned claim moves there too, including 45-minute-old claims on other machines (`a-handed-slice-reads-as-taken.test.ts:60`). The plan must say if only the fresh arm (`fleet.ts:4722-4724`) moves.
- `elsewhere` versus `none` (`fleet.ts:4693-4694`) means two different things for a claim. A claim made on another machine is not "nobody watching" on that machine.

### 6. The plan row (Open Question 3) is answered by the code

- `deriveSlices` gives a slice only `done` or `not-started` (`fleet.ts:3655`), and NOT STARTED counts plans (`sections.ts:490`, `AgentList.tsx:1235`). The plan row `mat-spiel-auf-der-404 · 1 slice` stays in NOT STARTED whatever happens to its branch row, unless `deriveSlices` changes. `sliceElsewhereCount` (`sections.ts:800-821`) then reports the slice as elsewhere. The slice has to decide this, or the plan head stays in NOT STARTED beside a row that left it.

### 7. A second unnamed constraint: NOT STARTED is Development-only

- `docs/board-domain-model.md:1071-1080` says NOT STARTED allows plan phase Development only and branch state `open` only. The case-1 plan is in Design (an approved spike, `approvedSpike` in `draftPlacement`, `fleet.ts:4717-4720`). The plan should say if a spike's claim follows the same rule.

### 8. Open Question 4 is answered by the code

- `attention.ts:236` and `:249` give the verdict `abandoned` for a worker that is `failed` or `ended`, with `list: 'needsAgent'`. That is the attention list, not `quietKind` and not the row's `group`. It is out of scope and stays. The plan should close the question instead of passing it to the agent.

### 9. Tests, docs and fixtures that assert the opposite

The plan names only a new invariant test. These existing assertions encode the current placement and must change, each one with a stated reason:

- `packages/domain/test/quiet.test.ts:214-217` — "keeps abandoned and orphaned-claim in waiting-on-you".
- `packages/board/test/unit/a-quiet-row-lands-in-quiet.test.ts:8`, `:33-36` — "keeps an abandoned row in waiting-on-you".
- `packages/board/test/integration/row-placement-quiet-and-ended-desk.browser.test.ts:104` (an `abandoned` fixture).
- `packages/board/test/unit/fleet.test.ts:1625` and the other claimed-arm cases. `packages/board/test/unit/agent-list.test.ts:1064-1081` and `activity-mark.browser.test.ts:572-733` use "claimed, no known worker" fixtures.
- `packages/board/test/unit/a-handed-slice-reads-as-taken.test.ts` (`withHandOver` with orphaned claims).
- `docs/board-domain-model.md:1018-1080` (section tables). `sections.ts:43` NOT STARTED hint, `quiet.ts:195-209` TSDoc, `fleet.ts:4706-4709`, `:4829-4832`, `:4851-4858` comments.
- The mock fleet (`packages/board/src/server/mock-fleet.ts`) has no `claimed` row and no `abandoned` row, so the mock board cannot show either change. The slice should add one of each.

### 10. The invariant test as written mixes two enums

- "Every startability label maps to the allowed sections only … and `abandoned` never to `waiting-on-you`". `abandoned` is a `QuietKind` (`schema.ts:3381`), not a `StartabilityVerdict` (`schema.ts:1802`). The test needs two tables: startability × group and quietKind × group. Its input domain must be the output of `rowsFromPulse` (after `withHandOver`), or a row lifted by the hand-over escapes it.
- Each named test fails before and passes after only if it runs over `rowsFromPulse` with a fresh claimed row and a stale `wip` row with `prState: 'none'`. A unit test of a new mapping function alone passes before the wiring exists.

### 11. "One domain function" is too large for one Sonnet slice

- `classifyGroup` takes about 30 positional arguments (`fleet.ts:3784-4000`; its own comment records six tests broken by one insertion). Moving it into `packages/domain` as one `{section, label}` function is a rewrite of the board's central classifier, not a one-branch fix. The smaller change that fixes both observed rows is: (a) `quietPlacement` answers `quiet` for `abandoned`, and (b) the fresh-claim arm (and, if decided, the fresh-wip arm) answers the section a person picks, plus a payload-level invariant test over `rowsFromPulse`. Extracting the mapping can be a later slice.

### 12. Overlap and the changeset

- No file overlap with `the-interrogation-rounds-badge-is-hidden` (card-controls.ts, PlanCard.tsx, interrogate.ts, index.ts). That plan reads `working-agents.ts` and does not edit it. #3095 (registry hands out the spike) removes the trigger of case 1 when it lands, because `withHandOver` then lifts the row. The hand-started-without-pid case stays, so this plan is still needed. #3095's plan states no board impact.
- The plan names no changeset. The change touches `@plot-pm/board` and `packages/domain`. The changeset needs package `@plot-pm/board` (`check-changeset-packages.sh` admits `plot` and `@plot-pm/board`), and the description first.
- No shell, bash 3.2 or Bitbucket seam: the change is TypeScript only. The shell-lines ratchet is not touched.

## Required amendments

1. Replace the Board impact comment's file list with `packages/board/src/server/fleet.ts` (`classifyGroup` claimed and wip arms, `withHandOver`) and `packages/domain/src/rules/quiet.ts` (`quietPlacement`, `quietNeedsPerson`). State that the server-side `group` changes, and close Open Question 2.
2. Correct the Motivation: the section reads the scan's worker pid and then the registry manifest. The label reads branch state alone (`verdict.ts:56`). Name the fresh-`wip` case as the same defect, or exclude it with a reason.
3. Name the two decisions reversed (`every-section-has-one-subject`, #362, and #1758/#1902's `abandoned` placement), and list the docs and comments to update with them.
4. For "claimed, nobody watching": give the section, the render path and the count, because a `working` branch row is not drawn today. Say if only the fresh-claim arm moves, and what `elsewhere` versus `none` shows.
5. Settle Open Question 3 (`deriveSlices` keeps `not-started` for the slice, or it changes) and close Open Question 4 (out of scope, `attention.ts` is a different list).
6. Write the invariant test as two tables (startability × group, quietKind × group) over `rowsFromPulse` output after `withHandOver`. List the existing tests in finding 9 that change, and add a `claimed` row and an `abandoned` row to the mock fleet.
7. Narrow the slice: move the mapping extraction out of this slice, or split it into a second slice after the placement fix.
8. Name the changeset package (`@plot-pm/board`).

## Decisions that need a person

- Where a claimed branch with no known worker belongs: WORKING (which reverses `every-section-has-one-subject` and needs a branch-row render path), WAITING ON YOU (a person may need to check a live claim nobody sees), or NOT STARTED with the contradicting label removed. The plan's issue wording ("e.g.") leaves this open, and it is a product decision.
- Whether `abandoned` leaves WAITING ON YOU. This reverses #1902's explicit "revive or drop" placement. If yes, decide if `orphaned-claim` follows it, because `quietPlacement` places the two together.
- Whether a fresh `wip` branch with no known worker is in scope.

## What I ran versus what I read

- Ran (read-only): `git fetch`, `git show origin/main:<file>` for `fleet.ts`, `sections.ts`, `quiet.ts`, `verdict.ts`, `working-agents.ts`, `AgentList.tsx`, `rows.tsx`, `tuple-row.ts`, `attention.ts`, `mock-fleet.ts`, `docs/board-domain-model.md`, `docs/plans/2026-08-20-every-section-has-one-subject.md`, `the-interrogation-rounds-badge-is-hidden` and the #3095 plan branch. Also `git grep` across `packages/`, `git log -S` for the origin of the two placements, `gh issue view 3096` and `gh issue view 1758`, and `gh pr list`.
- Read only, not executed: the behaviour of `rowsFromPulse` and of the WORKING render path. The finding that a `working` branch row is not drawn comes from source and TSDoc (`AgentList.tsx:1159-1176`, `fleet.ts:5964-5967`). I did not render the board or run a test.
