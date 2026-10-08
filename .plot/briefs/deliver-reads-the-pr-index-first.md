## Implementation brief — delivery-reads-one-source (slice 2: Deliver reads the PR index first)

- **Plan (canonical):** `docs/plans/2026-10-07-delivery-reads-one-source.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/deliver-reads-the-pr-index-first` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Second and last slice. It waited on `bug/deliver-reads-the-plan-at-the-pulse-ref`, which merged as #1350 (`c60ff3cee`). Slice 1 changed the board route in `packages/board/src/server/deliver.ts`; this slice changes the other path, `packages/board/src/server/controllers/deliverability.ts`, so the two share no file.

### What to build

`mergedBranches` in `controllers/deliverability.ts` (`:80`) reads the PR store first and asks `host.prMerged` only for the branches the store does not answer, and a host answer of `unknown` refuses the delivery as `cannot-tell` instead of counting as not merged.

The failure, measured in #1165: a 12-slice plan on Bitbucket sends about 60 requests (`prMerged`, `prMergeCommit` and a `commitFiles` read per branch) and gets 12 `unknown` answers. Each `unknown` counts as not merged, so the refusal reads "12 branch(es) not merged" for a plan whose slices all merged. The store already holds those answers: `fleet.ts` is the only writer of `PrIndexStore`, and `plot-impl-status.sh` already answers a fully merged plan from it with zero host calls (`impl-status-index.test.mjs`, *"a fully merged plan is answered from the store with no host call"*).

The pieces that exist: `PrIndexStore.read(connector)` (`packages/domain/src/ports/pr-index.ts`), `decodePrIndex` behind it, `prIndexFile({ cwd })` as the adapter, and `mergedRowByHead` in `entry/pr-index-lookup-answer.ts:82` as the merged-only lookup both shell consumers share. The controller receives `{ planStore, host, refs }` (`DeliverabilityPorts`) and has no store port yet. It gains one, and the two callers wire it: `entry/deliver.ts:390` and `entry/ask.ts:128`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Only a `MERGED` row answers, from the index.** `OPEN`, `CLOSED` and draft rows go to the host. A merged PR cannot revert on the host; the other states are stale in either direction and the rows record no SHA to revalidate against (`CLAUDE.md`, *A Decision Reads The Index*). Reuse the merged-only lookup the shell consumers use. A second implementation of "which row is the merged one" is free to drift from `PR_INDEX_VERSION`.

**The index supplies `merged` and never `not-merged`.** A missing store, a missing row, a wrong-version file and an unreadable file all mean *ask the host*. `PrIndexStore.read` already folds the first three into `answered(null)` and reserves `failed` for a file that exists and cannot be read — treat `failed` as *ask the host* too, not as an error. Measured 2026-08-27: an empty result read as *no PRs* refused four fully merged plans.

**`unknown` refuses as `cannot-tell`; it does not count as not merged.** Today `mergedBranches` drops every non-`merged` answer into one bucket (`:85-87`), so `unknown` and `not-merged` look the same to `deliver`. They must stay apart: `not-merged` is `branches-unmerged` (a person merges something), `unknown` is *the host did not answer* (a person waits or retries). The refusal names the host's own words, and its `merged` figure is the count of slices that really merged — `merged: 11` for a 12-branch plan with one `unknown` — not `0`.

**Where the new reason lives.** `deliver`'s reason union (`workflows/deliver.ts:10-16`) has no `cannot-tell`, and `DeliverBranchReading.merged` is a `boolean`, so a third state does not fit through `deliver()` as written. Decide the smallest change and say which in the commit message: widen the reading, or refuse in the controller before `deliver()` runs. Whichever you pick, the refusal must carry `reason: 'cannot-tell'` through `DeliverabilityAnswer`, and `deliverable` stays `false`.

**One host call per branch stays where the store does not answer.** `Host.prMerged` is the question the domain owns (it reads `mergedAt`, never `state`, and covers every PR on the branch). Do not batch or replace it. The saving is the calls the store removes.

### The tension to settle before writing code: `carriedWorkOf` is a host call too

The plan's second assertion says a 12-branch plan whose store holds 12 `MERGED` rows is deliverable with **zero host calls**. `carriedWorkOf` (`:112-127`) calls `host.prMergeCommit(branch)` for every merged, non-deferred branch, and the store rows hold no merge commit (`PrIndexRowSchema` has `number`, `head`, `state`, `draft`, `checks`, `review`, `url` and optional fields — no SHA). So answering `merged` from the store does not by itself reach zero: the empty-slice finding still spends a host call per branch, which is the rate-limit cost #1165 reports.

Do not drop the finding silently to make the count pass. `emptySlices` is a reported finding (`deliverable` stays `true` beside it), and passing `'unknown'` for it on the store path would hide an empty slice that today is named. Pick one and state it in the commit message and the PR:

- **Skip the finding on the store path and say so.** The branch reports `carriedWork: 'unknown'`, and the delivery output notes that the empty-slice check did not run for store-answered branches. Costs the finding; meets "zero host calls" literally.
- **Keep the finding and change the assertion.** Zero `prMerged` calls, with `prMergeCommit` still asked. Costs the plan's wording; report the difference rather than editing the plan.
- **Stop.** If neither is acceptable to you, write a `PLOT-BLOCKED` marker naming the choice. The plan's Open Questions say *None*, and this one was found at dispatch.

Whichever you choose, the test counts `prMerged` **and** `prMergeCommit` separately so the assertion says what it measures.

**Rules carried over unchanged.**

- **Absent is not false.** No row, no store and no host answer are never `not-merged`.
- **The controller asks ports and never spawns.** The store is a port (`PrIndexStore`); do not read the file or shell out from the controller (`CLAUDE.md`, *The Layering Rule*). `check-host-cli-callers.sh` and the CI spawn ratchet (`allowed=28`) both stay as they are.
- **The shell consumers read and never write.** This slice reads the store and writes nothing back. `fleet.ts` stays the only caller of `foldPrIndex`.
- **A function you write is an arrow** (`export const f = (…) => …`), including helpers in board files and tests.
- **No hand edit of a plan's `State:` line** — `plot-state-gate.sh` refuses it. This slice has no reason to touch one.

### Done when

The plan's `## Done when` slice-2 list is the specification:

- a 12-branch plan whose store holds 12 `MERGED` rows is deliverable with zero host calls (see the tension above for what *zero* counts);
- a host `unknown` for one branch refuses as `cannot-tell` with `merged: 11`.

Assertions that exist because a naive implementation passes without them:

- **The `unknown` test uses a store that does NOT hold the unknown branch.** A store holding all 12 rows never reaches the host, so it passes today's code and proves nothing about the refusal. Give the store 11 rows and let the host answer `unknown` for the twelfth.
- **A second arm: a host `not-merged` for the twelfth refuses as `branches-unmerged`, not `cannot-tell`.** Without it a fix that turns every non-`merged` answer into `cannot-tell` passes.
- **An `OPEN` row, a `CLOSED` row and a draft row each go to the host.** Mirror the shell consumers' tests (*"a store row that is OPEN gives the host the last word"*). A fix that trusts any row passes the all-`MERGED` test.
- **A wrong-version store (`v` ≠ `PR_INDEX_VERSION`) and a store with no file both ask the host for every branch.** `PR_INDEX_VERSION` is 3 today; a fixture hard-coding `v: 1` hides a store the decoder rejects (the live store on one machine read `v: 1` and every read fell through to the host).
- **Mutation-test the store arm.** Commit first, then revert the index read in place and confirm the zero-call test goes red; revert the `unknown` handling and confirm the `cannot-tell` test goes red.

Plus: a changeset (`.changeset/<slug>.md`, package `plot`, description first and the `bumps:` block last, with the `plan:` line), and the board rebuilds on `main` after the merge — commit no generated bundle (`scripts/check-no-bundle-diff.sh`). The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to charge. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/controllers/deliverability.ts`, its two callers (`entry/deliver.ts`, `entry/ask.ts`), the estate wiring that hands them a `PrIndexStore` (`estate.ts`), the `cannot-tell` reason in `packages/domain/src/workflows/deliver.ts` if you widen it, their tests, and one changeset.

It does not own `packages/board/src/server/deliver.ts` (slice 1, merged), `fleet.ts` (the store's only writer), `entry/pr-index-lookup*.ts` (the shell consumers' bundle — read from it, do not change it) or `auto-dispatch.ts:162`, which has its own `mergedBranches` over the pulse. The plan's Notes record that duplicate as a candidate for one shared resolver; leave it. Other plans in flight (`the-fleet-loop-reads-its-runs-right`, `a-controller-owns-what-it-starts`, `the-tests-and-sweeps-leave-no-trace`) own none of these files as of dispatch, but `entry/ask.ts` is shared ground — rebase before you push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
