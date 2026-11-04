# Testability juror — the-pulse-s-tracer-flag-means

Position: amend

Lens: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **The plan's claims about the code hold on `origin/main` (e54e53815).** `fleet.ts:713-720` documents `Tracer: yes`; `plan-walk-assembly.ts:337-338` counts spike markers and `:391` sets `tracer: planSpikes > 0`; `:552` writes it to the row; `plot-plan-meta.sh:806` emits `"tracer":true`, read at `:1284`; `PlanRecord` (`ports/plan-store.ts:10`) has no tracer field; `auto-deliver.ts:281` and `:293-294` say what the plan says.

2. **The `planAutoDeliver` test as written cannot fail before the change.** `planAutoDeliver` reads `plan.tracer` from a pulse, and the existing fixture builds that boolean directly (`packages/domain/test/auto-deliver.test.ts:104-112`, `tracer: x.tracer ?? false`). A test that feeds "a plan with a marker" and "a plan with `Tracer: yes`" to `planAutoDeliver` must first turn those plans into a pulse. If the fixture sets `tracer` by hand, the test asserts the fixture, passes on main, and proves nothing. Only a test that starts from a `PlanRecord` (or a plan file) and runs through `assemblePlanWalk` → `planRow` → `FleetReadingSchema.parse` → `planAutoDeliver` discriminates.

3. **The walk test discriminates in both directions, which is good.** Under Option A, the marker-only plan reads `true` on main and must read `false`; the `Tracer: yes` plan reads `false` on main and must read `true`. Both assertions fail before and pass after. The natural home is `packages/domain/test/plan-walk-assembly.test.ts`, which already drives `assemblePlanWalk` from record values: pure, synchronous, no fleet, no launchd, no port 7777. The plan names neither the file nor the fixture shape.

4. **The corpus already names `tracer` as uncarried, and Option A must change that list.** `packages/domain/corpus/plan-store.corpus.test.ts:77` lists `tracer` in `KNOWN_UNCARRIED` with the comment "no PlanStore reader decides on it". Under Option A the walk becomes that reader, so the key moves to the carried pairs, and the corpus test then runs the real `plot-plan-meta.sh` against a `Tracer: yes` fixture and asserts the `PlanRecord` field. That is the script-contract half of the test and the plan does not mention it. The corpus runs with no host token (`no-host-token.ts`), so it stays off the operator's machine state.

5. **Two more readers decide on the flag, and the plan names neither.** Each reads a different source today:
   - `packages/board/src/server/fleet.ts:6616` passes the pulse's `plan.tracer` (marker meaning) to `phaseOfPlan`, which returns `proven` instead of `deliverable` (`rules/phase.ts:80`). `board.ts:2637` and `:2673` pass the parser's `meta.tracer` (`Tracer: yes` meaning) to the same rule. So the fleet view and the board card can render one plan in two columns. This is a rendered state; it is assertable on `phaseOfPlan` plus the walk without a browser, and the plan carries no test for it.
   - `packages/fleet/src/shared/auto-verify.ts:231` reads `raw.tracer` from the parser (`Tracer: yes`), and `:441` feeds `verifyStart`, which refuses `tracer` (`rules/auto-verify.ts:165`). Under Option B this reader keeps the old meaning unless the slice changes it.
   The plan's "Board impact: none" comment is false for the fleet view's phase column.

6. **The data makes the two options differ more than the plan says.** No plan on `origin/main` carries a `Tracer: yes` status line (`grep -c 'Tracer:** yes'` reads 0 on all six plans that carry a spike marker). Six plans carry markers: `the-fleet-writes-the-design`, `tickets-and-stories-have-lanes`, `a-desk-started-by-plot-dispatch`, `design-work-proves-the-path`, `the-fleet-verifies-what-it-delivered`, `registry-never-hands-out-an-approved` (Approved). So Option B's migration question answers "none", and Option A turns the auto-deliver hold into a rule with no live subject until somebody writes the line. Both facts belong in the plan, because they decide which test fixtures reflect real plans.

7. **Isolation holds for every test the plan can name.** `assemblePlanWalk`, `planRow`, `phaseOfPlan`, `planAutoDeliver` and `verifyStart` are pure domain; the corpus runs a shell script against fixtures. None needs fleetd, launchd, a board or port 7777. No browser test is needed.

## Amendments required

1. Record the chosen option in `## Design` before approval. An unattended agent cannot pick between A and B; the plan says so itself (`## Notes`).
2. Replace "`planAutoDeliver` gets a test for the same two plans" with one end-to-end domain test: two `PlanRecord` fixtures → `assemblePlanWalk` → `planRow` → `FleetReadingSchema.parse` → `planAutoDeliver`, asserting which plan is held. Forbid a fixture that sets `tracer` by hand.
3. Name the walk test's file (`packages/domain/test/plan-walk-assembly.test.ts`) and state the expected `tracer` value for each of the two plans under the chosen option, so the reviewer can confirm both assertions fail on main.
4. Option A: move `tracer` out of `KNOWN_UNCARRIED` in `plan-store.corpus.test.ts:77`, carry it on `PlanRecord`, and add a corpus fixture with `Tracer: yes` whose `PlanRecord.tracer` reads `true`.
5. Name the `phaseOfPlan` readers (`fleet.ts:6616` against `board.ts:2637`/`:2673`) and the auto-verify reader (`auto-verify.ts:231`/`:441`), and add one test that asserts the fleet row's phase and the card's phase agree for both plans. Correct the "Board impact: none" comment.
6. State the six marker plans and the zero `Tracer: yes` plans in `## Motivation`, and say what each option does to the Approved plan `2026-11-03-registry-never-hands-out-an-approved`.

## Decisions for a person

- Option A or Option B. Under A, nothing on main is a tracer plan, so the auto-deliver hold holds nothing until a plan opts in; under B, every plan with a spike marker waits for a dependent or for a person.

## Ran versus read

Ran: `git show`/`git grep` on `origin/main` (e54e53815) over the files above, and a count of `Tracer:** yes` and `spike -->` in the six marker plans. Read only: `auto-deliver.test.ts`, `plan-store.corpus.test.ts`, `auto-verify.ts`, `phase.ts`. Ran no test suite and no fleet or board command.
