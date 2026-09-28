# Delivery juror — Changelog lens

Position: refuted
Evidence: executed

## Finding

The plan's `## Changelog` entry claims a placement change that PR #1034 did not build, and that the PR's tests explicitly forbid. The plan entry reads: "Only the third asks for a person, and only the third appears in WAITING ON YOU." The shipped changeset (`.changeset/a-desk-says-who-owes-it.md`, PR diff) says the opposite: "No row changes section: placement still reads `AgentState` through `isBrokenState`, which is untouched." The two published texts disagree, and the code sides with the changeset.

## What the diff delivers (matches the changeset)

- Cause transport: daemon writes a per-tick report (`packages/domain/src/adapters/supervision-report/supervision-report-file.ts`, `packages/board/src/server/entry/registryd-main.ts` +94), board reads it (`packages/board/src/server/fleet.ts:6907` `supervisionCause: reportedCause(...)`), field on the row (`packages/board/src/contract/schema.ts:3118`).
- Mapping as a total record: `packages/domain/src/rules/supervision-debt.ts:21` `OWES_A_PERSON`, `no-progress: false` with its own test.
- Row words: `supervisionCauseWord` (`supervision-debt.ts:75`) and `statusWithCause` (`packages/board/src/app/lib/tuple-row.ts:551`) — "waiting for room", "restarting", "out of attempts".

## What the plan's changelog claims and is absent

1. "only the third appears in WAITING ON YOU" — placement is unchanged. `packages/board/src/app/lib/agent-rows/working-agents.ts:85` still filters by `isBrokenState(agent.state)`; its last commit is `1bed32ee` (#1016), which predates PR #1034. `packages/board/test/unit/a-desk-says-who-owes-it.test.ts:296-347` (`describe('no section changes')`) asserts the SAME group with and without a cause, for both `no-headroom` and `budget-spent`.
2. `owesAPerson` / `OWES_A_PERSON` has zero production callers: outside its own file it appears only in docstrings (`schema.ts:3111`, `ports/supervision-report.ts:28`). Nothing uses "owes a person" to decide anything.
3. Consequence: the sentence is false in both directions on today's code. A `stalled` desk whose cause is `no-progress` (the fleet's to answer, rendered "restarting") still lands in WAITING ON YOU through `isBrokenState`. A `budget-spent` desk whose AgentState is not broken does not land there.
4. "genuinely stuck" does not match the delivered vocabulary. The words for the person-owed causes are "out of attempts", "blocked, asked you", "declaration missing/unreadable".

## Mitigation (why this is a changelog defect, not an implementation defect)

The plan's own Design ("It does not move any row on today's evidence") and its last `Done when` item ("No row changes section without a payload reading") both require NO placement change. The PR follows the Design. The `## Changelog` line was not amended after round 1 and still describes the pre-amendment intent. Under this lens the plan's changelog claims something not built, so the position is refuted. The fix is a one-line amendment to the plan's `## Changelog` before release. The changeset text is accurate and needs no change.

## Executed vs read

Executed:
- `npx vitest run test/unit/a-desk-says-who-owes-it.test.ts` in packages/board (Node 24): 21/21 pass, including the three "no section changes" tests.
- `npx vitest run test/supervision-debt.test.ts` in packages/domain: 14/14 pass.
- `grep` for `owesAPerson|OWES_A_PERSON` across packages/board/src and packages/domain/src: no non-comment caller outside the defining file.
- `git log -- working-agents.ts`: last change #1016, before PR #1034.

Read only: the plan, `gh pr view 1034` (body, files), `gh pr diff 1034` (changeset), `supervision-debt.ts`, `working-agents.ts:55-92`, test file lines 296-347.
