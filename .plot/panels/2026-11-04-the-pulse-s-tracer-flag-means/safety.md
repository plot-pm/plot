# Safety juror — the-pulse-s-tracer-flag-means

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal rather than a guess?

Position: amend

## Findings

1. **The plan's claims about the four cited sites are true on origin/main (`e54e53815`).** `fleet.ts:713-720` documents `Tracer: yes`; `plan-walk-assembly.ts:337-338` counts spike markers, `:391` sets `tracer: planSpikes > 0`, `:552` writes it; `plot-plan-meta.sh:806` emits the key and `:1284` reads the line; `PlanRecord` has no tracer field; `auto-deliver.ts:293-294` and `:281` hold a tracer plan.

2. **The plan counts two readers; origin/main has at least seven, and they already split along the same line.** The parser's `tracer` key is read through the board's own meta by `packages/board/src/server/board.ts:1457`, `:2637`, `:2673`, `:2731`, and the domain rules that consume it are `rules/phase.ts:80` (`proven` vs `deliverable`), `rules/workflow-phases.ts:149`, `rules/auto-verify.ts:165` (refuses `tracer`) and `rules/verification-record.ts:129` (`unverified`). The pulse's spike-derived value is read by `auto-deliver.ts:294` and by `packages/board/src/server/fleet.ts:6616` (`phaseOfPlan(..., { tracer: plan.tracer })`). So today the board's card column and the fleet row's column can disagree for one plan. The plan does not name this, and the slice brief "the walk, the schema doc and the parser" leaves `fleet.ts:6616` out of the test.

3. **Option B's bullet "the parser's `tracer` key and the `Tracer: yes` line have no reader and are removed" is false and is the unsafe branch.** Removing the key turns `auto-verify.ts:165`'s `tracer` refusal off, so the fleet starts a verify run on a tracer plan that D5/D14 say never reads in Testing, and `phase.ts:80` turns `proven` into `deliverable`, which offers delivery. A Sonnet agent following Option B as written removes a refusal silently.

4. **Option A changes one live plan's delivery from held to automatic.** `git grep` over `docs/plans/` on origin/main finds zero plans with `Tracer: yes` and five with a `<!-- spike -->` marker; four are Released and one, `2026-11-03-registry-never-hands-out-an-approved.md`, is Approved. Under Option A that plan stops reading as a tracer plan, and `planAutoDeliver` names it on the first pass after all its slices merge. That is the intended outcome of D15, but it is an irreversible phase flip the plan does not mention; a person should know it before approving.

5. **The existing test `packages/domain/test/plan-walk-assembly.test.ts:215-230` asserts "marks a spike plan a tracer" (`tracer === true`).** Option A must invert it. The plan does not name it, so an agent may read its failure as a regression and "fix" the code back.

6. **Option A's adapter step is unnamed.** The parser key reaches `PlanRecord` only through `packages/domain/src/adapters/plan-store/plan-store-shell.ts` (beside `:168`, `spike_approved_raw`) and the fixture `plan-store-fixture.ts:42`. A missing mapping defaults to `false`, which is the silent answer: every `Tracer: yes` plan then auto-delivers with no dependent. The two-plan test catches this only if it runs through the shell adapter or a corpus fixture, not through a hand-built `PlanRecord`.

7. **The open question is a gate the plan states as prose.** "The choice between the two options is the reviewer's" (Notes) has no mechanism: if the plan is approved with the box unticked, the unattended agent picks. No refusal is named for that case.

8. Failure modes that already end in a named answer: `schema` default `false` for an older pulse (documented at `fleet.ts:716`); auto-deliver's gate set is unchanged. No change here deletes a ref, merges a PR or writes a `State:` line directly.

## Required amendments

1. Close the open question in the plan text before approval: Option A, with the B section removed or marked rejected. Add one line that the slice agent writes a `PLOT-BLOCKED` marker and stops if the plan it reads still lists both options.
2. Name every reader in the Motivation and the slice: `board.ts` (meta), `phase.ts`, `workflow-phases.ts`, `auto-verify.ts`, `verification-record.ts` (all `Tracer: yes` today, unchanged), and `fleet.ts:6616` plus `auto-deliver.ts:294` (pulse, changed). State that after the slice the pulse and the board meta give the same value for one plan.
3. Name the adapter mapping (`plan-store-shell.ts`, `plan-store-fixture.ts`) and require the two-plan test to go through the shell adapter or a corpus fixture over real `plot-plan-meta.sh` output, so a dropped key fails the test instead of reading `false`.
4. Name `plan-walk-assembly.test.ts:215-230` as a test the slice inverts, with the reason.
5. Add a Notes line: after merge, `2026-11-03-registry-never-hands-out-an-approved` stops being held and auto-delivers once its slices merge; the approver confirms that or adds `Tracer: yes` to it in the same change.
6. Add one `fleet.ts:6616` test: a spike-marked plan with no `Tracer:` line and all slices merged reads `deliverable`, not `proven`, on the fleet row.

## Decisions for a person

- Option A or Option B (I recommend A; B needs findings 3 fixed first and a verify-refusal replacement).
- Whether `2026-11-03-registry-never-hands-out-an-approved` should auto-deliver (A without change) or carry `Tracer: yes`.

## Ran versus read

Ran (read-only): `git show`/`git grep`/`git log` on origin/main `e54e53815` over the cited files, all `tracer` readers under `packages/` and `skills/plot/scripts/`, and `docs/plans/` for `Tracer: yes` and `<!-- spike -->`; `gh issue view 3102`. Read only: the plan, the issue. Ran no test, build, host write, fleet or board command.
