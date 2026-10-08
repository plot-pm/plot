## Implementation brief — delivery-reads-one-source (wave 2: Deliver reads the PR index first)

- **Plan (canonical):** `docs/plans/2026-10-07-delivery-reads-one-source.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/deliver-reads-the-pr-index-first` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the second of two waves. Wave 1, `bug/deliver-reads-the-plan-at-the-pulse-ref`, merged as #1350; nothing waits on this branch.

### What to build

`POST /api/deliver` counts a slice as merged only when `host.prMerged` answers `merged`, and it asks once per branch (`packages/board/src/server/controllers/deliverability.ts`, `mergedBranches`). An `unknown` answer counts as not merged. A 12-slice plan on Bitbucket sends about 60 requests, gets 12 `unknown` answers under a 429, and the refusal reports the plan as unmerged (#1165).

The change: `mergedBranches` reads the PR store's rows through the `PrIndexStore` port first and asks `host.prMerged` only for the branches the store does not answer. A branch with a `MERGED` row is merged with no host call. Any branch the host answers `unknown` for refuses the delivery as `cannot-tell`, names the host's words, and reports the real merged count. The plan is canonical; this brief adds what it leaves out.

### The decisions the plan settles — do not re-derive them

**Only a terminal `MERGED` row answers.** `OPEN`, `CLOSED` and draft rows are stale in either direction and carry no SHA to revalidate, so the host gets the last word on them. `entry/pr-index-lookup-answer.ts` holds this rule already (`TERMINAL`, `rowByNumber`, `mergedRowByHead`) for the shell consumers. Reuse its decision rather than writing a third copy, or, if a controller cannot import from `entry/`, move the pure function to where both can reach it and leave the entry file calling it. Never read the store with `jq` or by hand: `decodePrIndex` owns the version check.

**The index never says no.** The store supplies `merged`, never `not-merged`. A missing store, a missing row, a wrong-version or unparseable store (`read` returns `ok: false` or `null`) all mean *ask the host*. Measured 2026-08-27, an empty result read as "no PRs" refused four fully-merged plans. A test pins each of those arms.

**The controller reads a port and never the disk.** `controllers/deliverability.ts` takes `DeliverabilityPorts` (`planStore`, `host`, `refs`). Add `prIndex: PrIndexStore` to it and wire it at `entry/deliver.ts:390`; the adapter is `prIndexFile()` from `@plot-pm/domain/adapters`. Measure whether the request context already holds a `PrIndexStore` before adding one. The connector name is the host's backend (`github` or `bitbucket`), the same string `pr-index-lookup.ts` takes.

**This slice reads and never writes.** `fleet.ts` is the only caller of `foldPrIndex`. A second writer races: `rename` makes each write atomic, not the read-fold-write sequence around it. Do not fold the host's answers back.

**`unknown` is not `not-merged`.** `Host.prMerged` returns `'merged' | 'not-merged' | 'unknown'`. Today `unknown` falls into the not-merged set, which is the defect. `cannot-tell` is not a reason the `deliver` workflow knows (`packages/domain/src/workflows/deliver.ts` lists `plan-not-found`, `plan-unparseable`, `state-terminal` and the branch reasons). Decide where the refusal is produced: either the controller returns `reason: 'cannot-tell'` itself before asking `deliver`, or the workflow gains the reason. Pick one, state it in the PR, and keep `allSlicesConfirmed`'s three-way mapping (`rules/deliverable.ts`) untouched — #1113 measured why.

**Rules carried over unchanged.** Absent is not false. A failed port call (`!answer.ok`) is `unknown`, not `not-merged`. `carriedWorkOf` is asked only for merged, non-deferred branches; a branch answered from the store still needs its merge commit, and `host.prMergeCommit` is a host call. Say in the PR whether the zero-host-call claim covers that read, and measure it: the plan's Done-when says zero host calls for 12 `MERGED` rows, so either the store row supplies the merge commit or `carriedWork` stays `unknown` for store-answered branches. Check the row's fields before choosing; do not let the finding silently change. `emptySlices` is a finding, not a refusal.

**Domain style.** Arrow functions for anything you write. The domain takes readings as values. A TSDoc block states what the export does, not the history.

### Done when

The plan's `## Done when` list is the specification. Each test fails on `origin/main` today.

- A 12-branch plan whose store holds 12 `MERGED` rows is deliverable with zero host calls.
- A host `unknown` for one branch refuses as `cannot-tell` with `merged: 11`.

Assertions that exist because a naive implementation passes without them:

- **The host double throws on any call in the 12-row test.** A counter that is read after the fact passes when the double swallows the call.
- **A store row that is `OPEN` gives the host the last word.** Without it, matching any state widens the store's answer past the host's.
- **A missing store, a missing row and a wrong-version store each ask the host.** Without them, `null` read as "no PR" refuses a finished plan.
- **The `unknown` test has 11 merged rows and one `unknown`, and asserts `merged: 11`.** With `merged: 0` in the refusal, the count is still the defect.
- **Mutation-test both fixes**: revert the store read and the `unknown` arm in place, one at a time, and confirm the matching test fails.

Plus: a changeset for `'@plot-pm/board'` as `patch`, description first and the `bumps:` block last, with a `plan: docs/plans/2026-10-07-delivery-reads-one-source.md` line inside that block (`./scripts/check-changeset-packages.sh` checks the form). The change is under `packages/board/`, so main rebuilds the shipped bundles after the merge: commit no generated bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`). Never run board tests while the operator's board is open: use the `vitest related` command the local checks print, not `pnpm test:board`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you edit one, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names: the choice for where `cannot-tell` is produced, the zero-call measurement including the merge-commit read, and the tests that fail on `main`.

### Scope guard

This branch owns `packages/board/src/server/controllers/deliverability.ts`, its wiring in `packages/board/src/server/entry/deliver.ts`, the pure store-decision function it shares with `entry/pr-index-lookup-answer.ts`, their tests, and one changeset. It does not touch `deliver.ts` plan resolution (wave 1, merged), `approve.ts`, `commission.ts`, `rules/deliverable.ts`'s `allSlicesConfirmed`, or `fleet.ts`. `auto-dispatch.ts:162` has a second `mergedBranches` over the pulse with different inputs: leave it. No other branch of this plan is in flight.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
