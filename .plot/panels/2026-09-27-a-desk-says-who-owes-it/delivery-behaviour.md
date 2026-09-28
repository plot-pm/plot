# Delivery panel — Behaviour lens

Position: supported
Evidence: executed

## Deliverables found (Done when / Design)

- **Headroom reason on the row, read from the tick.** `rowsFromPulse` forwards `reportedCause({at, cause: supervision.causes.get(b.branch)})` (`packages/board/src/server/fleet.ts`, PR hunk at ~6894); `statusWithCause` qualifies slot 5 in `packages/board/src/app/lib/tuple-row.ts` (both `base.status` and the agent arm). Test: `statusWithCause('', 'no-headroom')` is `waiting for room`.
- **Cause reaches the payload for every judged desk, with one producer.** `AgentRow.supervisionCause` in `packages/board/src/contract/schema.ts:~3118`, a nullable nine-value enum. The two non-desk loops emit `null` explicitly. The daemon is the only writer: `writeSupervisionReport` in `registryd-main.ts:~840` writes `<git-common-dir>/.plot/state/supervision.json`. The board test `produces no cause of its own when the report has none` uses a store that throws on write.
- **Mapping in code with its argument, `no-progress` named by a test.** `OWES_A_PERSON` is a total `Record<SupervisionCause, boolean>` in `packages/domain/src/rules/supervision-debt.ts:21`. It matches the plan table entry for entry. Test: `does not charge a person for no-progress, and does for budget-spent` (`supervision-debt.test.ts:70`).
- **Shape stated, three mechanisms cited.** Shape (2), a sibling field. The schema docstring cites `quietKind` and `isBrokenState`. `working-agents.ts` is cited only in the PR body, not in code. That matches "cited by the slice" if the PR counts as the slice.
- **No row changes section.** `isBrokenState` and `working-agents.ts` are untouched in the diff. Three tests under `no section changes` assert the same group, `state` and `worker` with and without a cause.

## Absent, partial or in tension (none refutes a Done-when item)

- `owesAPerson` and `OWES_A_PERSON` have **no production consumer**. `git grep` finds only the definition and docstring mentions. The rule exists in code, but nothing on the board reads it.
- The Changelog line "only the third appears in WAITING ON YOU" and the Design sentence "WAITING ON YOU admits only the desks that owe a person" are not implemented. The plan's own Design and Done-when gate placement on evidence, so this follows the plan and does not contradict it. The Changelog still overstates what shipped.
- The `worker-alive` comment "never reaches the report" is true only for stdout. The report file does carry `worker-alive` rows, as the PR body states.

## Executed

- `npx vitest run` (domain) on `supervision-debt`, `supervision-report`, `supervision-report-file`: 3 files, **39 passed**.
- `npx vitest run` (board) on `test/unit/a-desk-says-who-owes-it.test.ts`, `test/unit/registryd-main.test.ts`: 2 files, **72 passed**.
- `node skills/plot/scripts/board/plot-registryd.mjs --once --dry-run`: exit 0, `agents=0 ... defer=0 ... held=303`. The report was rewritten to `{"v":1,"at":1790573385884,"rows":[]}`. The live daemon (pid 5167) writes the same file, with an empty registry. **Live consequence:** no agent is registered on this machine, so no live `no-headroom` row could be observed end to end. The positive-path evidence is the tests, plus the PR body's claimed live run.
- `git grep` for the consumers of `owesAPerson`.

## Read only

- The plan, the PR body, and the diffs of `tuple-row.ts`, `schema.ts` and `fleet.ts`, plus `registryd-main.ts:815-855` and the test sources.
