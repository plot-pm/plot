## Implementation brief — fleetd-scan-cost-and-read-cadence (slice 5 of 5)

- **Plan (canonical):** [docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md](../../docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md) on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1862 merged
- **Branch:** `bug/the-issue-index-writes-at-on-an-answer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot-review` GitHub App, required on `main`

This slice is independent of the plan's other four branches (cold scan convergence, the registryd tick, the settled walk, the design-commit key) — it touches only `packages/domain/src/entities/issue-index.ts`, `packages/fleet/src/shared/issue-refresh.ts` and `packages/fleet/src/server/entry/registryd-main.ts`. Nothing here waits on those branches and nothing there waits on this one.

### What to build

Tracking issue #1845, finding #1652, names two separate defects in the issue index's read path — fix both:

1. **`IssueIndexSchema.at` is `z.string()` (required) but a failed first-ever pass writes it anyway.** `refreshIssueIndex` in `packages/fleet/src/shared/issue-refresh.ts:422-435` builds the failure-path write. Line 426 reads:
   ```ts
   at: sameHeld ? held.at : failedAt,
   ```
   `sameHeld` is false whenever there is no prior held index, or the held index's `source`/`connector` differs from this pass's (`issue-refresh.ts:350`). In that branch `at` is set to `failedAt` — a timestamp for a read that **did not answer**. The field's own doc comment at `issue-index.ts:137` says `at` "moves only on an answered read," and the schema does not allow it to say anything else: `at` has no way to express "never answered." Make `at` nullable (or optional — pick whichever reads better against the rest of the schema's `.optional()` fields; `closed.at` at `issue-index.ts:84` is already optional for the same reason) in `IssueIndexSchema`, and change `issue-refresh.ts:426` so a first failure with no held state writes "no answer yet" rather than inventing a timestamp.

2. **A failed `backend()` call falls back to `'github'` with no warning.** `packages/fleet/src/server/entry/registryd-main.ts:2086-2089`:
   ```ts
   gitHost: await (async () => {
     const answer = await hostShell({ repoRoot, scriptDir: scriptsDir }).backend();
     return answer.ok ? answer.value : 'github';
   })(),
   ```
   This feeds `IssueWorld.gitHost` (`issue-refresh.ts:56`), which `issueSource` and `unaskableReason` (`issue-refresh.ts:267`) both trust as ground truth. On a Bitbucket repository whose host probe fails, this silently tells the issue pass it's talking to GitHub — the issue index's `connector` field (`issue-index.ts:128`) and every downstream cadence read (`cadenceRateOf`, the PR pass's backoff comparison) are then keyed wrong. `warn` is already threaded into `fleetIssues` two lines below (`registryd-main.ts:2098`) but this IIFE runs before that call and has no access to it. Route the failure through `warn` (or restructure so the fallback happens inside `fleetIssues`'s own construction, where `warn` is already in scope) instead of resolving silently.

### Decisions already settled — do not re-derive them

- **`at` becomes nullable, not optional-with-a-default.** A `.default()` is explicitly forbidden on this schema (`issue-index.ts:32-34`): "A default is how a cold store stops being byte-identical to no store." The fix must preserve round-tripping — a store with no answered read ever should decode the same whether `at` is `null`/absent or whatever form is chosen; it must never synthesize a value a reader would mistake for a real answer.
- **`sameHeld` is the key to the first-failure case, and it is already computed.** `issue-refresh.ts:350` — don't add a second comparison; branch on the existing `sameHeld` (or lack of a prior `held` at all) to decide whether a legitimate previous `at` exists to carry forward.
- **The exit-4 sentence from `unaskable` is out of scope for this slice.** The plan's open question names `feature/the-tracker-lists-closed-issues` as a prerequisite; that branch does not exist (checked `git branch -a` and `git ls-remote --heads origin` on 2026-10-16 — neither shows it). Drop that line from scope rather than blocking on a branch that was never cut.
- **One writer, unchanged.** `refreshIssueIndex` (`issue-refresh.ts:320`) stays the only caller of the store's write path — this slice does not add a second writer of `issues.json`. `decodeIssueIndex`/`encodeIssueIndex` (`issue-index.ts:180-202`) are the only read/write surface to touch beyond the schema and the fallback above.

### Done when

The plan's `## Done when` is implicit in its Changelog line — this slice's share of it is: *a failed first pass no longer claims to have answered, and a failed host probe no longer misreports which connector answered.* Concretely:

- `IssueIndexSchema.at` accepts no-answer-yet without inventing a timestamp, and `decodeIssueIndex`/`encodeIssueIndex` round-trip that state losslessly (extend `packages/domain/test/issue-index.test.ts` and/or `issue-index-file.test.ts`).
- A test in `packages/fleet/test/unit/issue-refresh.test.ts` pins: a first-ever failed pass (no held index) writes `at` as "never answered," not `failedAt`. A failed pass **with** a held index of the same source/connector still carries the held `at` forward unchanged (the existing `sameHeld` branch) — don't regress that case while fixing the other.
- The `backend()` fallback at `registryd-main.ts:2086-2089` surfaces a warning when the probe fails, verified by a test on the `fleetIssues`/`readIssues` wiring (or wherever the fallback ends up living) rather than by reading the code.
- `packages/domain/src/entities/issue-index.ts`'s TSDoc for `at` still matches what the code does once nullable — the doc already says the right thing ("moves only on an answered read"); make the type agree with it rather than editing the comment.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the tests related to the files you changed plus the relevant `tsc --noEmit` and gate scripts. The suites under the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`, the domain vitest coverage run, `node --test test/reconcile/*.test.mjs`) run in CI on every PR; don't run them locally as a matter of course (see CLAUDE.md § Testing) — a failure there comes back as a correction, not a blocker now. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to ratchet against.

### Bookkeeping

- Open the PR through the controller once the branch has its first real commit: `../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). Do not run `gh pr create` by hand.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md`, the `bug/the-issue-index-writes-at-on-an-answer` line) and push that to the plan's branch (`main`, since this plan's `Impl:` answer is `own branches` and it lives directly on the default branch).
- Push the first real commit as soon as it exists — the claim push alone is not visible progress.

### Scope guard

This branch owns:
- `packages/domain/src/entities/issue-index.ts` (schema)
- `packages/domain/test/issue-index.test.ts`, `packages/domain/test/issue-index-file.test.ts` (and the adapter at `packages/domain/src/adapters/issue-index/issue-index-file.ts` only if the schema change requires touching it)
- `packages/fleet/src/shared/issue-refresh.ts` and `packages/fleet/test/unit/issue-refresh.test.ts`
- `packages/fleet/src/server/entry/registryd-main.ts`, narrowly at the `backend()` fallback (lines ~2082-2099) and its wiring

The plan's other four branches touch disjoint files: `packages/fleet/src/shared/fleet-scan.ts` (cold scan), the registryd tick's port factory and `commitBeyondClaim`/`prOpen` ordering (`#1374`), `default-branch.ts`'s ancestor walk (`#1582`), and `design-work.ts`/`auto-design.ts`/`design.ts` (`#1685`, `#1673`). None of those were confirmed as started (no local or remote refs existed for any plan branch as of 2026-10-16, including this one) — if a sibling has since claimed its branch and it shows overlap with the files above, treat that as new information and report it rather than improvising around it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
