# Testability juror

Position: amend

## Summary

The queue slice is testable as planned: its central test fails on main and passes after the fix. The comparison test is not well defined as written, the hold-word question has no test target, and the restart slice names no test at all and claims an outcome its own controller cannot give.

## Findings

### 1. The Design-plan spike test fails on main and passes after the fix

- `planQueue` (`packages/domain/src/rules/queue.ts:928-936`) passes only `outstanding`, `phase` and `branches` to `sliceVerdicts`. For `phase: 'design'`, `sliceVerdict` returns `unapproved` (`packages/domain/src/rules/eligible.ts:132-135`), so every `QueuedBranch.claimable` is `false`. A test that asserts one claimable item therefore fails on main with 0 claimable.
- `packages/domain/test/queue.test.ts` holds no `design` or `spike` case (grep: zero hits), so no existing test covers this path. The `plan()` fixture there (`queue.test.ts:104-112`) casts to `PlanRecord` without `spikeApprovedRaw` or `spike`, so the new test must set both explicitly.
- The fixture must put the spike in slice 0. A spike in a later slice behind an unfinished slice reads `blocked` (`eligible.test.ts:307`), and the test then passes with 0 claimable for the wrong reason or fails confusingly.
- The fleet reaches `planQueue` through `queueEntries` (`packages/fleet/src/shared/queue-reading.ts:269`), and the shell plan store carries both fields (`plan-store-shell.ts:95` for `spike`, `:168` for `spikeApprovedRaw`). A domain test on `planQueue` therefore covers the decision the fleetd tick makes. No end-to-end proof of `handed=1` is named, and none is needed for the rule.

### 2. The "same verdict across phases" test is not well defined

- `planQueue` returns no verdict. It returns `claimable` per branch, and only for branches that are neither claimed nor merged (`queue.ts:951`). `assemblePlanWalk` returns a verdict per slice and a `claimable` list filtered by `isClaimable(verdict, state)` (`plan-walk-assembly.ts:351`). The plan does not say which output of each side is compared.
- The two inputs differ in kind. `planQueue` takes `claimed` and `merged` sets; `assemblePlanWalk` takes per-branch readings (`readingOf`) and derives `outstanding` from `branchState`, with an extra loose-readiness rule for `wip` branches (`plan-walk-assembly.ts:320-328`). The two `outstanding` counts agree only on a fixture where every branch is open (no ref, no PR) or every merged branch is merged on both sides. The plan keeps the two `outstanding` rules apart on purpose (`Design > Approach`), so a fixture that varies landings compares the two rules, not the shared field set, and its disagreements are expected rather than defects.
- `assemblePlanWalk` drops `released`, `rejected` and `superseded` (`plan-walk-assembly.ts:19, 302`) but keeps `draft`, `design` and `approved`, so the three named phases are reachable on both sides.
- "Corpus-style" is misleading here. The corpus tier (`packages/domain/corpus/`) compares a rule with a shell over the real estate (`slice-chain.corpus.test.ts:10-24`). This comparison is two TypeScript callers over a synthetic fixture. On the real estate there may be no Design plan with an approved spike, so a corpus test would pass vacuously.
- On main, the comparison fails in exactly one cell: `design` + approval record + spike in slice 0. All other cells agree today. The test is useful as a regression guard, but the cells that carry the fix are the spike-shaped ones, and the plan lists only phase × approval.

### 3. The shared builder needs its own unit test to hold 100 % coverage

- `packages/domain/vitest.config.ts:71-72` holds `src/!(adapters)/**/*.ts` at 100 % lines, branches, functions and statements. A new file under `src/rules/` must reach 100 % from tests alone.
- The builder carries at least these branches: `spikeApprovedRaw` undefined, `''`, and non-empty (`plan-walk-assembly.ts:334` tests `!== undefined && !== ''`, and test fixtures cast past the required `string` type, so `undefined` reaches it); `spikeSliceOf` answering a slice, and `undefined` for zero or two spikes (`spike.ts`). Tests that go only through `planQueue` and `assemblePlanWalk` can miss one arm, and CI's coverage suite then fails the PR.
- The signature in the plan ("taking `PlanRecord`, `spikeSliceOf` and the `outstanding` count per slice") passes a function that is an import. An agent can read this as a parameter to inject. The plan should name the signature.

### 4. The hold-word open question has no test target

- Open Question 3 says the queue "must agree" with the scan's `unapproved`. `QUEUE_HOLDS` (`queue.ts:465-475`) has no `unapproved` word; an unapproved slice reads `not-claimable`. Agreement means either a new hold word (changes `QUEUE_HOLDS`, `holdCounts`, the fleetd tick line and its tests) or acceptance that the queue keeps `not-claimable`. The plan leaves this open, so no test can be written for it, and an unattended agent can widen the scope without a person's decision.

### 5. The restart slice names no test and promises an outcome the controller cannot give

- `restartBranch` refuses `unknown-branch` only where the pulse lacks the branch AND no worktree is known (`packages/fleet/src/shared/restart-command.ts:115-118`; `packages/fleet/src/server/entry/restart-command.ts:35-36, 86-88`). In the issue's scenario no agent ever started, so no desk exists. With the pulse fixed, the same call answers `no-worktree` (`restart-command.ts:120-122`), not a restart. The changelog line "restarts the worker of an approved spike of a Design plan" is therefore not what slice 2 can deliver for the issue's case; restart starts a new agent on a claimed slice whose worker is dead.
- The existing tests (`packages/fleet/test/unit/restart-command.test.ts:49-66`) inject `pulse` and `worktree`. A test that a Design-plan spike is found needs a pulse fixture produced by the real scan for a Design plan. A hand-built `FleetReading` that lists the branch passes before and after any fix, so it proves nothing about the cause.
- The cause is unread: `plot-fleet-scan.sh:66` scans "all active plans" by default, and whether a Design plan sits in the active index decides the answer. The plan says "the first slice answers this", but the restart question belongs to slice 2.

### 6. `known-pr.ts` cannot take the proposed builder unchanged

- `blockingBranches` (`packages/domain/src/rules/known-pr.ts:193-205`) takes `phase` and raw slice lines, not a `PlanRecord`, and passes no spike fields. A builder keyed on `PlanRecord` does not fit it. The plan names the check but no test for it; for a Design-plan spike, `blockingBranches` returns `[]` today, and a test should state whether that is intended.

## Required amendments

1. Name the comparison test's subject: for each branch `planQueue` returns, its `claimable` equals membership in `assemblePlanWalk`'s `claimable` list, over a fixture where every branch is open on both sides. Place it in `packages/domain/test/`, not `corpus/`.
2. Add the spike-shaped cells to that matrix: spike in slice 0, spike in slice 1 behind an open slice 0 (`blocked`), a spike slice with a sibling branch (`branches: 2`), two spikes in one plan, and `spikeApprovedRaw` undefined, `''` and set.
3. Add a direct unit test of the shared builder in `packages/domain/test/` that covers every branch above, and state its signature (for example `sliceReadingsOf(plan: PlanRecord, outstanding: readonly number[]): SliceReadings[]`).
4. In the queue spike test, fix the spike in slice 0 and assert by branch name: the spike branch `claimable: true`, every other branch `claimable: false`. Add the negative case: the same plan without `spikeApprovedRaw` yields zero claimable.
5. Close Open Question 3 in the plan: either the queue keeps `not-claimable` for an unapproved Design plan (no test change), or a person approves a new hold word and the plan names the tests it changes.
6. Rewrite slice 2's goal and changelog line: after the fix, `plot-restart-command.mjs` on a desk-less spike answers `no-worktree`, not `unknown-branch`; on a spike desk whose worker died it restarts. Name one failing-before test built from a real scan reading of a Design plan, or move slice 2 to its own plan once the cause is read. Fix "the first slice answers this" to name the restart slice.
7. Name the expected `blockingBranches` answer for a Design-plan spike and the test that holds it, or state that `known-pr.ts` stays out of scope.

## Decisions for a person

- Open Question 3: a new `unapproved` queue hold word, or `not-claimable` stays.
- Whether slice 2 stays in this plan while its cause is unread.

## What I ran and what I read

- Ran: `git fetch origin main`, confirmed the worktree's `queue.ts`, `eligible.ts` and `plan-walk-assembly.ts` match `origin/main`; `grep` over `packages/domain`, `packages/fleet`, `packages/board` and `skills/plot/scripts`; `gh issue view 3092`.
- Read: `eligible.ts:100-200`, `queue.ts:870-1000`, `plan-walk-assembly.ts:19, 300-360`, `spike.ts`, `known-pr.ts:190-205`, `queue.test.ts:1-140`, `eligible.test.ts:284-307`, `plan-walk-assembly.test.ts` spike cases, `vitest.config.ts` thresholds, `restart-command.ts` (shared and entry), `continue-command.ts:20-45`, `restart-command.test.ts` test names, `plan-store-shell.ts` spike fields, `board/.../verdicts.ts` spike handling.
- Not run: no test suite; the fail-before claims are derived from reading the code, not from a test run.
