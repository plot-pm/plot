# Delivery panel: a-desk-says-who-owes-it

- **Caller:** `/plot-deliver`, 2026-09-28, unattended
- **Subject:** `docs/plans/2026-09-27-a-desk-says-who-owes-it.md`
- **Evidence:** PR #1034 (`bug/a-desk-says-who-owes-it`), merged 2026-09-28T00:30:14Z, merge commit `d330ddd8`
- **Commitment:** `Position: supported|refuted`, `Evidence: executed|read`
- **Reconcile:** `divided	supported=deliverable,behaviour	refuted=changelog`

## Verdicts

| Lens | Position | Evidence | What it ran |
|---|---|---|---|
| Deliverable | supported | executed | domain vitest 39/39, board vitest 72/72, grep for callers and artifacts |
| Behaviour | supported | executed | same 111 tests, `plot-registryd.mjs --once --dry-run` (exit 0, `agents=0`, report written with `rows: []`) |
| Changelog | refuted | executed | board test 21/21, domain test 14/14, grep for `owesAPerson`, `git log` of `working-agents.ts` |

## The disagreement

The panel disagrees on one question: does the plan's `## Changelog` line describe what shipped?

The plan's `## Changelog` reads: *"Only the third asks for a person, and only the third appears in WAITING ON YOU."* PR #1034 changed no placement. `working-agents.ts` and `isBrokenState` are untouched, and the three `no section changes` tests (`a-desk-says-who-owes-it.test.ts:296-347`) assert that group, state and worker are the same with and without a cause. The shipped changeset states *"No row changes section"*, and that text is correct.

All three jurors found this fact. The Deliverable and Behaviour jurors judged it against the `## Done when` list. Item 5 of that list forbids a placement change, so they read the Changelog line as a stale over-claim and not as a missing deliverable. The Changelog juror judged the line itself, and the line claims behaviour that was not built. The two readings do not conflict on the facts. They disagree on whether a false changelog line blocks delivery.

Two more sentences in the plan make the same over-claim:
- Design › *The rule*: "WAITING ON YOU admits only the desks that owe a person."
- The slice description: "…and place the sections by it."

## Shared findings (all three lenses)

- `OWES_A_PERSON` / `owesAPerson` (`packages/domain/src/rules/supervision-debt.ts:21`) is in code with its argument, and `no-progress` is named by a test (`supervision-debt.test.ts:70`). It has **no production caller**: outside its file it appears only in docstrings. The plan asks for the rule to be "in the code as the rule", and the code meets that. Nothing reads the rule yet.
- The cause travels tick → `<git-common-dir>/.plot/state/supervision.json` → `fleet.ts` `rowsFromPulse` → `AgentRow.supervisionCause` → `tuple-row.ts` `statusWithCause` ("waiting for room", "restarting", "out of attempts"). A one-producer test asserts that the board writes nothing.

## Shared blind spot

No juror saw a live `no-headroom` row end to end. The registry on this machine holds zero agents, so the dry-run tick wrote an empty report. Every positive-path claim rests on unit tests, plus the PR body's statement of a live run that no juror reproduced.

## What clears it

Amend the plan's `## Changelog` line (and optionally the Design rule sentence and the slice line) to state what shipped: every desk the tick judged carries its supervision cause on its row, and placement is unchanged pending a payload reading. Then re-run `/plot-deliver`. The implementation needs no change.
