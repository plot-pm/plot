## Implementation brief — auto-deliver-re-delivers-a-rejected (wave 1: Rejection hold)

- **Plan (canonical):** `docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md` on `main`
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2760 merged
- **Branch:** `bug/auto-deliver-holds-a-rejected-plan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/auto-deliver-ignores-a-claim-only-slice`, waits on this wave. It adds a second hold beside the one built here, so keep the hold shape open to a second reason.

### What to build

Fleetd's auto-deliver delivers an Approved plan that a person just rejected. Measured 2026-10-26: `/plot-reject` moved `plot-host-bitbucket-pr-list-reads` back to Approved at 14:38:04 UTC (`6666041ff`), and `runAutoDeliverPass` delivered it again 43 seconds later (`c67b5cd1f`). `isDeliverable` (`packages/domain/src/rules/auto-deliver.ts:340`) has no input that separates a rejected plan from one that never delivered, because a pulse plan carries only `file`, `phase`, `tracer` and `slices`.

Build a domain rule that holds a plan at phase `approved` whose Status block carries any `Rejected:` line. `runAutoDeliverPass` (`packages/fleet/src/shared/auto-deliver.ts:496`) reads the plan file through `PlanStore.readPlan` for the candidates `planAutoDeliver` returns, and for no other plan, then passes the reading to the rule as a value. The pulse gains no field. A held candidate is a skip: no in-flight mark, no failure record, no count toward `AUTO_DELIVER_MAX_FAILURES`. Fleetd logs one line naming the plan and the reason (`rejected`, or `unknown` for an unreadable file) the first time it holds the plan. This is the plan's Approach items 1, 3, 4, 5 and 6.

Two facts shape the code. `runAutoDeliverPass` is synchronous and returns `void`, and its one caller (`packages/fleet/src/shared/auto-writes.ts:55`) already sits in an `async` function, so the pass can become async and the caller can `await` it. `PlanStore.readPlan` is async. Check whether `PlanRecord` (`packages/domain/src/ports/plan-store.ts:10`) exposes the `Rejected:` line; `TransitionPlan.rejectedRecord` in `packages/domain/src/transitions/plan.ts:64` is the existing name for it. If the port lacks the field, add it there and in the adapter rather than parsing the file in the fleet.

### Settled decisions — do not re-derive them

- **No `mergedAt` versus rejection-date comparison.** A `Rejected:` record carries a date and no time, and both precedents are same-day: `a-lifecycle-micro-pr-merged-past` (hollow PR 2026-10-16T00:40Z, rejection 01:23Z, fix PR 05:57Z) and #2400 (merge 14:19Z, rejection 14:38Z). `>` holds the first until a later day and `>=` re-delivers the second. The operator chose a hold with no lift: a rejected plan is delivered by a person.
- **"Rejected" is never "the latest Status record".** `plot-undeliver.sh:117-157` inserts `Rejected:` after `State:` and keeps the `Delivered:` line, so the last record by position is `Delivered:`. Phase `approved` plus any `Rejected:` line proves a reversal that no person has delivered since. A plan that delivers again reads `delivered` and never reaches the rule.
- **Auto-only.** The hold sits beside the `landedBranches` gate (`auto-deliver.ts:370-389`). `allSlicesMerged`, `allSlicesConfirmed`, the scan, the board's Deliver control and `/plot-deliver` stay unchanged.
- **Every `unknown` holds.** An unreadable plan file holds. Absent is not false: a failed read never means "no `Rejected:` line".
- **Out of scope:** `/plot-reject` editing the plan by hand and `plot-undeliver.sh:79`'s dead `refs-swept` check (issue #2764), `skills/ralph-plot-sprint/SKILL.md:142` and `:239`, and any board state that names a hold.

### Done when

The plan's `## Done when` content lives in its Slices entry and Tests section; slice 1's tests are the specification (`packages/domain/test/auto-deliver.test.ts` for the rule, `packages/fleet/test/unit/auto-deliver.test.ts` for the pass). The assertions that exist because a naive implementation would pass without them:

- **The `plot-undeliver.sh` layout** (`Rejected:` after `State:`, `Delivered:` kept below). A rule reading the last record by position delivers this plan.
- **Same-day timings from #2400.** A date comparison delivers or holds depending on `>` versus `>=`; the fixture pins "no lift".
- **A later real merge** (row 1's shape, 16 files, merged 2026-10-16T05:57:25Z) still holds and logs `rejected`.
- **A later `Started:` record** still holds.
- **Five held passes** leave no mark and no failure for the slug, and no "failed … consecutive deliveries" line. A hold built as a failure would pass every other test and stop the plan after three passes.
- **Opposite cases:** an Approved plan with no `Rejected:` line delivers as today, and a `delivered` plan with a `Rejected:` line is not a candidate.

Add one line to the exclusion comment in `packages/domain/corpus/deliverable.corpus.test.ts:20-35` naming this hold. No corpus pair arises.

Plus: a changeset for `plot` (`patch`), description first and the `bumps:` block last, then `./scripts/check-changeset-packages.sh`. New domain code and new fleet helpers are arrow functions, with factual TSDoc and no decision history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI. This slice adds no shell; if you touch a `.sh` file, `scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/auto-deliver.ts`, `packages/fleet/src/shared/auto-deliver.ts`, the one-line caller change in `packages/fleet/src/shared/auto-writes.ts`, the `PlanStore` port and adapter only if `PlanRecord` lacks the `Rejected:` line, their tests, the corpus exclusion comment and the changeset. Wave 2 owns `packages/board/src/server/controllers/deliverability.ts` and the carried-work rule; do not touch them.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
