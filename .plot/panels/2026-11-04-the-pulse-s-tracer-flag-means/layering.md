# Layering juror — the-pulse-s-tracer-flag-means

Position: amend

## Lens

Layering: controller → domain → port ← adapter, rules in the domain, index over bought answers, lifecycle through controllers, shell growth.

## Findings

1. Every motivation claim checks out on origin/main at `e54e53815`. `fleet.ts:714-720` documents `Tracer: yes`. `plan-walk-assembly.ts:338` sums `planSpikes`, `:391` sets `tracer: planSpikes > 0`, `:552` writes it to the row. `plot-plan-meta.sh:806` emits the key, `:1284` reads the line. `ports/plan-store.ts` `PlanRecord` (`:10-63`) has no tracer field; `PlanRecordBranch.spike` (`:97`) is the only marker reading. `auto-deliver.ts:281,293-294` match. `45ae8a839` is on main and introduced the walk.

2. Option A is layering-clean. The parser stays the one parser of plan files; the plan-store adapter maps its `tracer` key into `PlanRecord` exactly as it already maps `spike` (`adapters/plan-store/plan-store-shell.ts:95`) and `spike_approved_raw` (`:168`); the walk workflow reads a value and spawns nothing. No port gains runtime code, no rule leaves the domain, no host answer is involved, and no lifecycle action is touched. It adds zero shell lines, so `check-shell-lines.sh` is unaffected.

3. Option B shrinks the shell (the parser's tracer branch at `:806` and `:1284` goes), but it moves a meaning against every other domain reader, not only the walk. The plan counts three readers (schema, walk, parser). origin/main has at least seven more that already use `Tracer: yes`: `rules/phase.ts:45,80` (`proven`), `rules/workflow-phases.ts:131,149`, `rules/auto-verify.ts:119,165` (refuses `tracer`), `rules/verification-record.ts:18,129`, `packages/fleet/src/shared/auto-verify.ts:214-231` (reads the parser key directly), `packages/board/src/contract/schema.ts:167-168`, and `packages/board/src/server/board.ts:1457,2637,2673,2731`. The walk is the single outlier. The code base has already chosen Option A; the plan should say so and narrow the person's decision to confirming it.

4. The "Board impact: none" note is not true today, and it matters for the test plan. `packages/board/src/server/fleet.ts:6616` computes `phaseOfPlan(phaseMap, { state: plan.phase, tracer: plan.tracer })` from the pulse plan row, so the walk's spike meaning already reaches a rendered column (`phase.ts:80` returns `proven` instead of `deliverable`). Under the "every rendered state is a domain property" rule this is a domain reading with a rendered consequence, and the fix changes what that board row shows. The plan must name it and the test should assert it through `phaseOfPlan` on the walk's output, not only through `planAutoDeliver`.

5. Option A names `PlanRecord` but not the adapters that build it. `PlanRecord` is constructed by `plan-store-shell.ts` (`planOf`), reused by `plan-store-ref.ts:10`, and by `plan-store-fixture.ts`; `board/src/server/entry/approve.ts`, `needs-design.ts` and `mock-fleet.ts` also reference the type. A required field breaks each at typecheck; an optional one silently reads false in a fixture. An unattended agent needs that choice stated.

6. No duplicate rule is created. The parser stays the only reader of the `Tracer:` line; no corpus pair is needed under Option A. Under Option B, `packages/fleet/src/shared/auto-verify.ts:231` reads the parser JSON directly and would read a removed key as false, a silent wrong answer rather than a refusal.

## Amendments required

- A1. Replace the three-reader list with the full reader set in finding 3, and state that the walk is the only reader using the spike meaning. Recommend Option A as the code's existing answer; the person confirms rather than chooses from scratch.
- A2. Correct the board-impact note: `fleet.ts:6616` routes the pulse `tracer` through `phaseOfPlan`, so a spike-only plan currently renders `proven`. Add a test that the walk's row for a spike-only plan yields `deliverable` through `phaseOfPlan`, and `proven` for a `Tracer: yes` plan.
- A3. Under Option A, name the adapters that build `PlanRecord` (`plan-store-shell.ts` `planOf`, `plan-store-ref.ts`, `plan-store-fixture.ts`) and state the field shape: `tracer?: boolean`, absent where the parser omits the key, mirroring `spike` at `plan-store-shell.ts:95`.
- A4. If Option B is chosen anyway, the slice must also change the seven readers in finding 3 and `fleet/src/shared/auto-verify.ts:231`, and the plan must say how a plan file with `Tracer: yes` is migrated; that is a different, larger plan.

## Decision for a person

- Confirm Option A. The evidence above makes Option B a cross-cutting semantic change, not a fix.

## Ran versus read

Ran: `git show origin/main:<file> | grep` over the five named files, `git grep` for `tracer`, `PlanRecord`, `plot-plan-meta` and spike markers across `packages/*/src` and shell, `git log`/`merge-base --is-ancestor` on `45ae8a839`. Read: `plan-store.ts`, `plan-store-shell.ts` and `plan-store-ref.ts` excerpts, `fleet/src/shared/auto-verify.ts:200-235`, `board/src/server/fleet.ts:6605-6618`. Did not run any test or typecheck, and did not read issue #3102 beyond the plan's summary.
