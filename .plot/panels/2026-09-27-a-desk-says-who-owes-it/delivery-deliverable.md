# Delivery panel: Deliverable lens

Position: supported
Evidence: executed

## Done-when items found in the merged diff (PR #1034, merged 2026-09-28, its merge commit is an ancestor of main HEAD ad03441e)

- **Headroom reason on the row, read from the tick.** `registryd-main.ts` `reportFor` / `writeSupervisionReport` (+94 lines) writes each tick's `{branch, worktree, verdict, cause}` through `supervisionReportFile`. `supervision-report-reading.ts` (new) reads that file. `fleet.ts` `rowsFromPulse` sets `supervisionCause: reportedCause(...)`, and `tuple-row.ts` `statusWithCause` renders `no-headroom` as "waiting for room".
- **Cause on every judged desk, with a one-producer test.** `reportFor` maps every `decision.detail.agents` row, including `leave`. The server emits `supervisionCause: null` explicitly on PR-map and ref-list rows. `a-desk-says-who-owes-it.test.ts:142` is the one-producer test: a board-side write throws, and an empty report gives null. No production `supervise(` call exists in `packages/board/src`; grep finds the word only in comments.
- **Mapping table in code, with its argument, and a named `no-progress` test.** `packages/domain/src/rules/supervision-debt.ts` holds `OWES_A_PERSON` as a total `Record<SupervisionCause, boolean>`, and each entry carries its reason. `supervision-debt.test.ts:70` is "does not charge a person for no-progress, and does for budget-spent".
- **Citations and chosen shape.** The PR body names shape (2), a sibling field. The `schema.ts` `supervisionCause` docstring cites `quietKind` ("FORWARDED, NEVER RE-DERIVED") and `isBrokenState`. The PR body cites `working-agents.ts` (`brokenAgentRows` / `workingAgentRows`).
- **No section change.** `isBrokenState` and `working-agents.ts` are absent from the diff. The tests at `a-desk-says-who-owes-it.test.ts:296-347` assert the same group, state and worker with and without a cause.

## Absent, partial or contradicted

- **Stale promises in the plan's own text, which no Done-when item requires.** The Changelog says "only the third appears in WAITING ON YOU". The Design's "The rule" says WAITING ON YOU "admits only the desks that owe a person". The slice line says "place the sections by it". The diff changes no placement. The amended Design ("default to (2)", "does not move any row on today's evidence") and Done-when item 5 forbid that change, so the delivery follows the binding text. The Changelog line and the slice line now over-claim and need correction before release. The shipped changeset states "No row changes section" correctly.
- **`owesAPerson` has no production caller.** It is referenced in `packages/*/src` only in docstrings. That meets "in the code as the rule", but nothing reads the rule yet.

## Executed

- `npx vitest run` (Node 24), domain: `supervision-debt`, `supervision-report-file`, `supervision-report`. 3 files, 39/39 pass.
- `npx vitest run` (Node 24), board: `a-desk-says-who-owes-it`, `registryd-main`. 2 files, 72/72 pass.
- A grep over `packages/*/src` for `owesAPerson` / `OWES_A_PERSON` / `supervise(`.
- A grep of the built artifacts: `board-server.mjs` and `plot-registryd.mjs` both carry `supervisionCause` and `supervision.json`.
- `git merge-base --is-ancestor <mergeCommit> HEAD`: true.

## Read only

- The plan, `gh pr view/diff 1034` (the body, the changeset, the diffs of `tuple-row.ts`, `schema.ts`, `fleet.ts`, `registryd-main.ts` and `supervision-report-reading.ts`), `supervision-debt.ts`, and `supervisor-reading.ts` `reportedCause`.
- Not run: a live daemon and board pair producing `/api/fleet` with the field. The PR body claims an end-to-end check, which this juror did not reproduce.
