## Implementation brief — a-delivery-follows-the-merge

- **Plan (canonical):** `docs/plans/2026-11-16-a-delivery-follows-the-merge.md` on `main`
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Branch:** `bug/a-delivery-follows-the-merge` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This plan has one slice and no wave ordering. It builds on `deliverabilityOf` (Released in v2.24.1) and on `deliveryPulse` (Released); neither is changed.

### What to build

`POST /api/deliver` judges a merge from the board's in-memory pulse alone. Measured 2026-11-16 (#3472): PR #3467 merged at 18:51:16Z, and the route answered `not-deliverable` ("has a branch that is not merged") at least three times until about 18:56Z. In the same window `plot-ask.mjs deliverable` answered `deliverable: true, merged: 1, unmerged: []`. The PR index held #3467 as OPEN until 18:54:06Z, and the board's pulse read it `merged` at 18:55:09Z. A delivery waited about 4 minutes for one PR index write and one later pulse.

The fix has three parts, all in the board's deliver controller and one domain rule:

1. **Domain rule.** `confirmedLanding` in `packages/domain/src/rules/deliverable.ts`, an arrow function with a factual TSDoc block, exported from `packages/domain/src/index.ts` (it already has `export * from './rules/deliverable.js'` at `:50`, so confirm the export lands rather than adding a line). It takes the pulse's `DeliveryLanding` and, where the caller asked, the host answer's `{ deliverable, reason, unmerged }`. It returns `merged` where the pulse reads `merged` or the host answer is deliverable; `merge-unconfirmed` where the host answer refuses `cannot-tell`; `not-merged` carrying the host's `unmerged` names where the host refuses for an open branch; and the pulse's own answer where no host answer was read.
2. **Controller.** In `deliverability` (`packages/board/src/server/deliver.ts:364`, the `switch` at `:418`), where `deliveryLanding` answers `not-merged` or `merge-unconfirmed`, call `deliverabilityOf` and pass both readings to `confirmedLanding`. The ports come from a new optional `DeliverDeps.ports` (`deliver.ts:545`), defaulting to `realEstate({ repoRoot, scriptsDir })` (`estate.ts:81`). `scan-incomplete` and `already-delivered` keep their paths, and `deliverabilityOnBranch` is unchanged.
3. **Refusal text.** The `not-merged` verdict (`Deliverability` union, `deliver.ts:313`) gains the branch names, and the `not-deliverable` detail at `deliver.ts:701-707` reads "plan `<slug>` has a branch the host reads open: `<branch>`". The `merge-unconfirmed` detail at `:690-697` stays as written.

One mismatch to read before wiring: `deliverability(opts, slug, branch?)` takes `BuildBoardOptions`, and `DeliverDeps.check` has that same signature. `deps.ports` is a `handleDeliver` dependency, so it must reach `deliverability` — either through `opts` or by building the default `check` as a closure over `deps.ports`. Pick one and keep `check`'s existing signature, because `deliver-route.test.ts` injects it.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Option A, decided 2026-11-16 by Jan Wloka: re-ask through `deliverabilityOf` and refuse only on the host's answer.** Option B (keep the pulse as the only reading and change only the sentence) removes the false statement but keeps the minutes of refusal #3472 reports. Option C (also re-ask on `scan-incomplete`) widens the change to the cold-start path, where `phaseAtRef(opts, judging?.read_ref ?? null, file)` at `deliver.ts:404` has no pulse to read from. Do not add a `scan-incomplete` re-ask; file it separately if it shows.

**The pulse stays the first reading.** A plan the pulse reads as `merged` costs zero host calls, and a test holds that (*"a landed pulse asks the host nothing"*). Do not call `deliverabilityOf` unconditionally.

**The PR index is not changed and not asked directly.** `deliverabilityOf` reads `MERGED` rows from the store and asks `Host.prMerged` only for the other branches (`mergedBranches`, `deliverability.ts:163`). This is *A Decision Reads The Index*: the index supplies `MERGED` and never `none`, so a stale OPEN row costs one host call and never a false refusal. Do not read `.plot/state/index/github.json` from the route, and do not shorten fleetd's PR beat (`prRefreshMsFor`, `pr-refresh.ts:680`) — that cadence protects the host budget.

**A host that cannot answer is `merge-unconfirmed`, never `not-deliverable`.** `deliverabilityOf` returns `reason: 'cannot-tell'` for an `unknown` branch (`deliverability.ts:330`). Map exactly that reason to `merge-unconfirmed`. Any other refusal with no `unmerged` names (for example `plan-unparseable`) is not evidence that a branch is open: keep the pulse's own answer, so the route never states a merge fact the host did not give.

**The route may now accept a plan before its card shows Deliver.** That is safe: `/plot-deliver` re-asks the host for every slice before it writes anything, so an early accept cannot deliver unmerged work.

**Rules carried over unchanged.** Absent is not false: an index with no row and a host that did not answer means *ask again*, not *unmerged*. Read the exit code and the verdict, not the emptiness of the output. The controller calls ports and never spawns — the route reaches the host only through the `Host` port, so the CI spawn ratchet (`allowed=28`) does not move. The change adds no shell/domain duplicate and no corpus row.

### Done when

The plan's `## Done when` table is the specification. The assertions that exist because a naive implementation would pass without them:

- *"a stale pulse delivers from the PR index's MERGED row"* asserts **zero host calls**. A naive implementation that always asks the host still returns `deliverable`; the call count is what catches it.
- *"a landed pulse asks the host nothing"* catches the unconditional re-ask above.
- *"a branch the host reads open is named in the refusal"* asserts the branch name in `detail`. A naive implementation keeps the old sentence, which names none.
- *"a host that cannot answer refuses merge-unconfirmed"* asserts the refusal is not `not-deliverable`. Make the fixture host answer `unknown`, not throw, so the `cannot-tell` path is the one under test.
- The `confirmedLanding` table test in `packages/domain/test/deliverable.test.ts` (`describe('confirmedLanding')`) covers every pulse answer against every host answer, including the pulse `merge-unconfirmed` plus a deliverable host answer. Make the fixtures disagree, so an arm that ignores one input fails.
- `deliver-route.test.ts` and `delivery-reads-the-last-finished-scan.test.ts` stay green unchanged. Pass fixture ports so no test spawns `plot-host.sh`.

New tests live in `packages/board/test/unit/delivery-follows-the-merge.test.ts` and the existing domain test file. Every function you write is an arrow, including test helpers.

Plus: a `plot` patch changeset in `.changeset/a-delivery-follows-the-merge.md`, description first and the `bumps:` block last, with `plan: docs/plans/2026-11-16-a-delivery-follows-the-merge.md` and `plot-deliver: patch` inside the block (see `.changeset/a-deferred-slice-keeps-its-branch.md` for the shape). The changelog text is the plan's `## Changelog` line.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to pay. `deliver.ts` is not a generated bundle, so do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/deliverable.ts`, its export, `packages/domain/test/deliverable.test.ts`, `packages/board/src/server/deliver.ts`, `packages/board/test/unit/delivery-follows-the-merge.test.ts` and the changeset. Do not edit `packages/board/src/server/controllers/deliverability.ts` — the route reuses it as it is.

Verified at dispatch: the other plans in sprint `bug-fixes-2-35-0` (`the-unblocker-reads-a-blocked-desk`, `an-exhausted-episode-admits-its-repair-pr`, `the-s6-census-row-counts-one-change`, `red-hold-reads-the-pr-base`) and `jenkins-reads-in-process` name no `deliver.ts` or `rules/deliverable` path in their plan text, so no collision is known. If you find something the plan did not anticipate, report it rather than improvising outside scope.
