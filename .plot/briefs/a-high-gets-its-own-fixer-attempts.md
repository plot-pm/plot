## Implementation brief — open-plot-review-findings-from-the (wave 2: Fixer attempts)

- **Plan (canonical):** docs/plans/2026-11-03-open-plot-review-findings-from-the.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/a-high-gets-its-own-fixer-attempts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per the plan's `Review: pr`

This slice waited on `feature/fleetd-merges-as-the-merger-app`. That slice merged as PR #3085, so nothing blocks it. Red main (`bug/a-red-main-stays-acted-on`) waited on the same slice, edits the same `slice-pr-next.test.ts`, and lands in either order. Whichever merges second rebases. #3070's `feature/the-release-review-is-switched-on` sets `Auto-review: true` and should land after this slice, because from then on every slice PR can get a HIGH and the shared count of two decides live PRs.

### What to build

Four fixes to the fixer arms, all findings of the 2026-10-29 review gate (issues #2921 and #2923). Read the plan's `## Design › Fixer attempts` first: it is canonical, this is orientation.

1. **HIGH and CI-red attempts count apart.** `fixerAttemptsSpent` (`packages/domain/src/rules/fixer-attempts.ts`) counts every attempt without `start: 'failed'` against one budget of 2. A PR whose two attempts answered red CI therefore reads `exhausted` for its HIGH: `highArm` skips the fixer, `reviewStatus` (`rules/ticket.ts:54`) accepts the HIGH on a ticket, and `mergeArm` merges it. No fixer ever ran on the HIGH. Count by the existing `finding.kind` (`'high'` or `'ci'`, `entities/fixer-attempts.ts`). `FixerReading.exhausted` (`slice-pr-next.ts:22`) splits into a HIGH answer and a CI answer. `highArm` reads the HIGH one, `ciRedArm` the CI one. The callers that build it change with it: `auto-fixer.ts:377`, `auto-ticket.ts:241` and `:248`, and every test filler of `FixerReading`.
2. **A red head the fixer pushed gets a fixer.** `ciRedArm` starts a fixer only when `desk.dead` or the corrections are spent. A sealed desk whose loop went free reads `elsewhere` or `live` (`deskDeadFromWorkerState`, `auto-fixer.ts`), so the fixer's own push turns red and nothing acts. A head counts as fixer-pushed only when the attempts record proves it and no fixer is in flight. Each attempt records only the head it STARTED for (`headSha`), so the pushed head is not in the record today. Add one optional field for it, written by `settleEnded` (`auto-fixer.ts:273`), the tick that ends the attempt. The record stays at `FIXER_ATTEMPTS_VERSION` 1. `.strict()` on the attempt schema means the field must be declared there, as `optional()`. A desk that reads `elsewhere` or `live` never counts as gone by itself.
3. **Arm order.** `restatusArm` runs before `highArm` (`slice-pr-next.ts:393`). With a real verdict reading it writes the verdict file's `failure` over the `success` that `highArm` just accepted, and the two arms loop. Move it after `highArm`. Update the arm-order docstring and every arm number in the JSDoc.
4. **The re-status arm obeys the same gates as the review arm.** `restatusArm` reads neither `config.autoReview` nor the start budget. `reviewArm` reads both. Gate `restatusArm` on both.

### Decisions the plan settles — do not re-derive them

- **No version bump.** `FIXER_ATTEMPTS_VERSION` stays 1. A bump reads every existing record as `unreadable`, and `fixerInFlight` holds an unreadable record forever, so every PR with a record would stop getting a fixer. The optional field decodes on old records and on new ones.
- **Count by `finding.kind`, not by a second record.** The kind is already written on every attempt. A second counter would be a second writer of the same fact.
- **A missing or unreadable record still reads as zero spent, and still holds for in-flight.** The two defaults are opposite on purpose (see the docstrings in `fixer-attempts.ts`). Do not unify them.
- **The `slicePrNext` merge arm and the fleet's no-retry memory do not change.** A memory keyed by (PR, head) would strand a PR on a transient refusal.
- **Every caller passes `verdict: { read: 'absent' }` today**, so findings 3 and 4 are latent. The tests must feed a real verdict reading, or they pass without the fix.
- **A HIGH is `plotReview === 'failure'` bound to `row.headSha`.** A failure recorded against an older push is no HIGH. Keep that.
- **The index never says "no".** A missing field reads as unasked, never as a negative answer.

### Done when

The plan's `### Fixer attempts tests` list is the specification. Each test must fail on `origin/main` and pass with the fix:

- `packages/domain/test/fixer-attempts.test.ts`: `two CI-red attempts leave the HIGH budget unspent`, `decodes a record written by the current schema at version 1`. The second one catches a schema change that quietly needs a version bump.
- `packages/domain/test/ticket.test.ts`: `reviewStatus does not accept a HIGH whose own attempts are unspent`. It catches the merge of a HIGH nobody tried to fix.
- `packages/domain/test/slice-pr-next.test.ts`: `starts the fixer for a HIGH after two CI-red attempts`; `starts the fixer on a red head the fixer record proves fixer-pushed`; `answers none('desk-alive') for a red head the desk pushed while the desk reads elsewhere` (a head the record does NOT prove stays `desk-alive`); `the HIGH arm's accepted success survives a failure verdict file` (a combined case over both arms, with a real verdict reading); `the re-status arm answers none with Auto-review off and with the budget spent`.
- The existing re-status cases (`:127-139`) and HIGH arm block (`:181-256`) change on purpose: the arm order changes and the fixer reading splits. Any other existing test that fails is a regression.
- `packages/fleet/test/unit/auto-fixer.test.ts`: `deskDeadFromWorkerState never reads elsewhere as dead`.

Plus: add a changeset with `plot` or `@plot-pm/board` as the package, the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows. This slice touches no `.sh` file, so none is expected to move. The domain package takes arrow functions only (`export const f = (…) => …`), factual TSDoc, and no history in comments.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line under `### Fixer attempts` in the plan's `## Slices`. Push the first real commit as soon as it exists. The docs for this slice are the JSDoc arm order and arm numbers in `slice-pr-next.ts`. No `CLAUDE.md` text changes, so no `check-agents-md.sh --write`.

### Scope guard

This branch owns: `packages/domain/src/rules/slice-pr-next.ts`, `rules/fixer-attempts.ts`, `rules/ticket.ts`, `entities/fixer-attempts.ts`, `packages/fleet/src/shared/auto-fixer.ts`, `auto-ticket.ts`, and the tests named above.

In flight beside it, verified at dispatch:

- `bug/a-red-main-stays-acted-on` (same plan) edits `rules/repair.ts`, `rules/repair-pr.ts`, `revert-start.ts` and the same `slice-pr-next.test.ts`, at the `bug/revert-<n>` fixture near `:468`. Leave that fixture to it.
- `bug/the-merge-gate-bounds-an-unknown-head` (same plan, waits on #3074) edits `workflows/merge.ts`. Do not touch `mergeArm`.
- `feature/the-release-review-is-switched-on` (#3070) sets `Auto-review: true`. It adds no fixer code.

If you find something the plan did not anticipate, report it rather than improvising outside scope. If the pushed-head field in finding 2 cannot be written by `settleEnded` without a host read it does not have today, stop and report it: the plan allows one optional field and no version bump, and nothing more.
