## Implementation brief — bitbucket-shares-one-budget-with-bb (wave 1: Listing and prediction)

- **Plan (canonical):** `docs/plans/2026-11-20-bitbucket-shares-one-budget-with-bb.md` on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3592 merged
- **Branch:** `bug/bitbucket-lists-all-states-in-one-request` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

This slice waits on nothing. `bug/bitbucket-predicts-800-an-hour` runs beside it and changes different lines. `bug/plot-host-reads-bb-rate-limit` waits on this slice, because both change the `pr-list` arm of `plot-host.sh` around `:4770`.

### What to build

A Bitbucket listing asks for all its states in one paginated request and never once per branch and per state. Measured on `origin/main` at `21ae2c638`, for 53 tracked branches: fleetd's full listing read sends 212 requests (`readBitbucketListing`, `packages/fleet/src/shared/fleet-scan.ts:612`: an `open` sweep of 53 plus an `all` sweep of 53 × 3). A refused delta retries as a full read and is priced as a delta, so in a repository with 50 or more open PRs every pass sends 216 requests every 240 s, which is 3,240 requests an hour. Bitbucket allows 1,000 an hour per user account, and the limit applies to the website too.

The mechanism, on top of what exists:

- **Plain listing:** `GET /2.0/repositories/<ws>/<repo>/pullrequests?state=OPEN&state=MERGED&state=DECLINED&pagelen=50&fields=…`, following `next` to the end or to the row limit. Both implementations change: `bb_state_listing` (`skills/plot/scripts/plot-host.sh:1437`) and `STATES` / the per-state loop in `packages/domain/src/adapters/host/bitbucket-pr-listing.ts:17,258`.
- **A query with `q=`** carries the states inside it as `(state="OPEN" OR state="MERGED" OR state="DECLINED")`, because `q=` overrides `state=`. This covers `bb_window_listing` (`:1338`) / `windowState` and `bb_branch_query` (`:1179`) / `sweepState`.
- **`fields` filter** names `next`, `size` and every `values.*` field the row projection reads (`bb_state_row`, the `pr-list` arm's projection, and `project` in `bitbucket-pr-listing.ts`).
- **fleetd's full read stops sweeping:** one all-state walk to the end plus the open walk, keeping only rows of tracked branches, so the rendered listing equals today's sweep listing on the same fixture. The delta's open half walks every page and claims whole by `size`, so a page at the cap no longer refuses every delta (`no-whole-page-claim`, `rules/scan-listing.ts:312`). The threshold is 50, not 49 (`listing-page.ts:54,89-95`).
- **Bounded sweeps:** `pr-list --branch` asks one request per branch for all asked states (`bb_branch_sweep`, `:1251`). `pr-state <branch>` asks one request and keeps its rank (open, then merged, then declined) over the rows it gets.
- **Price matches requests:** `scanListingCost` (`fleet-scan.ts:255`) prices a Bitbucket full read from the walk's `size` or page count and a delta as ⌈O / 50⌉ + 1. `PR_REQUESTS_PER_REFRESH.bitbucket` (`pr-refresh.ts:253`) becomes 1, and its comment states the new arithmetic. The cadence derives from these prices, so each reader stays near 60 requests an hour.

The plan is canonical; this is orientation. Read the plan's *Slice design › Slice 1* and *Requests per pass* before you start.

### Settled decisions — do not re-derive

- **One union of states is allowed now, and the old comment is wrong for a walk.** `THE STATES STAY SEPARATE CALLS` (`plot-host.sh:1416`) measured that one union lost 12 of 14 declined rows. That read one page only. A walk that follows `next` to the end has no such loss. Replace the comment with the walk's rule. Do not keep the per-state loop on the strength of that comment.
- **A walk that stops at a row limit claims whole for no state.** The PR pass's full read sets its limit to 3 × `PR_LIMIT` (`pr-refresh.ts:351`), so it reads at least the rows that three per-state reads of 1,000 read.
- **A missing `fields` entry must fail a test, never read as empty.** Assert that every field the projection reads is in the filter, in both implementations.
- **Price a full read from the walk's `size` or page count, not from R.** The carried listing holds only tracked-branch rows (`fleet-scan.ts:990-995`), so a row count taken from it under-prices the walk. Use 2 where none is held.
- **The shell and the in-process listing stay one answer.** `corpus/bitbucket-pr-listing.corpus.test.ts` holds the pair, and on a disagreement the branch stops. Do not adjust either side to make it pass.
- **The idle pass keeps its per-branch `pr-merged`.** *A Decision Reads The Index* licenses only a settled MERGED row as an answer. This slice does not change it.
- **Carried-over invariants:** the index never says `pr: 'none'`, and an empty result is not proof of no PRs. A failed or partial walk answers partial or refuses the fold, and never reads as an empty listing.
- **Layering:** the controller calls the domain, only an adapter reaches a script or the host, and a new function you write is an arrow function.

### Done when

The plan's `## Done when` list is the specification. The plan's slice line names these assertions; each exists because a naive change passes without it:

- **Request count independent of N.** A stub host counts requests per pass for N = 1, 53 and 200 tracked branches: a full read sends ⌈R / 50⌉ + ⌈O / 50⌉ and a delta ⌈O / 50⌉ + 1. A per-branch regression passes every output test and fails only this one.
- **Shell request count.** A stub `bb` counts `api` calls for `pr-list --state all`, `pr-list --branch` × 53 (53 calls, not 159) and `pr-state` (1 call).
- **49 or more open PRs.** A delta with 50 or more open PRs no longer refuses (`no-whole-page-claim`). Without this case the 3,240-an-hour loop survives under a green suite.
- **Equal listing.** On one fixture, fleetd's new full read renders the same listing as today's sweep.
- **The fields filter holds every projected field,** in the shell and in `bitbucket-pr-listing.ts`.

Plus: this slice changes `plot-host.sh`, so `scripts/check-shell-lines.sh pr` must not read higher than at the merge base. The per-state loops in the Bitbucket callers of `pr_list_states` and `bb_branch_sweep`'s state handling shrink, and growth is paid for in the same change. The gate counts commands, not lines, and joining statements with `;` or `&&` is not a payment. Add a changeset (description first, `bumps:` block last, package `plot`; the plan's changelog bullet 1 is the description). Commit no board bundle (`scripts/check-no-bundle-diff.sh`).

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Tests that touch a temp path use a private directory and remove it by the exact name `mkdtempSync` returned.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it is open, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-host.sh` (the listing, window, branch-sweep and `pr-state` Bitbucket paths only), `packages/domain/src/adapters/host/bitbucket-pr-listing.ts`, `packages/domain/src/adapters/host/listing-page.ts` if the walk needs it, `packages/domain/src/rules/scan-listing.ts`, `packages/fleet/src/shared/fleet-scan.ts`, `packages/fleet/src/shared/pr-refresh.ts`, `packages/domain/corpus/bitbucket-pr-listing.corpus.test.ts` and the tests for each.

Not this branch's: `DEFAULT_PREDICTED_HOST_LIMIT` and the 10000 comments and tests (`bug/bitbucket-predicts-800-an-hour`), `rules/bb-ledger.ts`, `bb-ledger-file.ts`, and any `bitbucket-api.ts` ledger or pause code (`bug/fleetd-counts-in-the-bb-ledger`), and the `limit` op, exit-75 mapping and the craftamap probe (`bug/plot-host-reads-bb-rate-limit`). Verified at dispatch: none of those three branches exists on origin and no brief for this slug exists on `origin/main`. Leave `plot-host.sh`'s `bb()` wrapper and `budget_reading` alone, so the later shell slice merges cleanly.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
