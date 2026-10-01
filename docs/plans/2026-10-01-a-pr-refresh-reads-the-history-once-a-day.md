# A PR refresh reads the history once a day

> The board makes its 43 s full PR listing on every second refresh, because a delta answer marks the PR index as not whole and the next refresh then refuses to narrow. This plan keeps a delta over a whole store whole, shortens the full read that remains, and reports a host timeout as a timeout.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1087
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The board asks the host for its whole PR history once a day, and asks only for changed PRs between those reads. It made the whole read on every second refresh before.
- A git host that times out on a PR listing is reported as *the host timed out*, without the advice to log in again.

## Motivation

#1087 reports that the board's rich merged and closed listings take 46-68 s and sometimes end in a GitHub GraphQL 504. The banner then names `gh auth login`, which does not repair a server-side timeout.

### Measured 2026-10-01 on `origin/main` (`1dbd7c01`)

Four listing calls through `skills/plot/scripts/plot-host.sh pr-list`, in the board's own argument order (`packages/board/src/server/fleet.ts:2884-2885`), on this repository with `gh` 2.98.0:

| Call | Time | Rows |
|---|---|---|
| `--rich --state all --limit 1000` (the board's full read) | 43.0 s | 1000 |
| the same with `--since 2026-10-01T13:19:29Z` (the board's delta) | 0.8 s | 0 |
| `--state all --limit 1000` (no `--rich`) | 7.3 s | 1000 |
| `--rich --state all --limit 100` | 3.4 s | 100 |

- **The field set is most of the cost.** The same 1000 rows take 7.3 s without `--rich` and 43.0 s with it, so the `--rich` fields cost about 36 s.
- **The cost grows with the row count.** 100 rich rows take 3.4 s and 1000 take 43.0 s. `gh pr list` pages internally and has no page-size flag, so this plan does not change the page size.
- **The full read is already truncated.** It returned PRs #41 to #1143, and the adapter warned `state=all possibly truncated (1000 rows …) (#333)`. All 1000 rows were terminal: 964 `MERGED`, 36 `CLOSED`, 0 `OPEN`.

### What the PR index already answers

The store at `.git/.plot/state/index/github.json`, read 2026-10-01T18:09Z: version 2, 1000 rows (964 `MERGED`, 36 `CLOSED`), every row with `updatedAt`, `watermark: 2026-10-01T13:19:29Z`, `complete: false`, `at: 2026-10-01T18:08:02Z`. The watermark equals the newest `updatedAt` the host returned one minute later, so the store held every row the full read bought. The delta from that watermark answered 0 rows in 0.8 s.

### Why the board still makes the full read

`--since` shipped on 2026-09-21 (`09cf9018`), and `prWindowFor` decides the window (`packages/domain/src/rules/pr-index.ts:158-172`):

1. A full read writes `complete: true`.
2. The next refresh asks a delta, `{ since: watermark, complete: false }` (`pr-index.ts:172`). `refreshPrs` folds it with `complete = window.complete && partialSaid === null` (`fleet.ts:3007`), and `foldPrIndex` writes `complete: update.complete` (`pr-index.ts:104`). The store is now `complete: false`. `pr-store.test.ts:474` pins this.
3. The next refresh finds `!held.complete` and asks for everything (`pr-index.ts:164`). `pr-store.test.ts:558` pins this.

So the store alternates, and the board makes the 43 s full read on every second refresh. `PR_FULL_READ_MS` is 24 h (`fleet.ts:311`) and does not apply, because the full read happens long before that. The store measured above is in step 2.

`complete` carries two meanings. *The last answer covered every state* is what a Bitbucket partial answer lacks: a state did not answer, so rows exist that the store has never seen. *The store holds every PR up to its watermark* is still true after a delta over a whole store, because a PR that did not change since the watermark is still as stored. A delta cannot see a deleted PR, and that is what the 24 h full read is for. `at` cannot be its clock once a delta keeps the store whole, because every delta rewrites `at` (`pr-store.test.ts:493`).

### Why the banner names a login

`host_failure_kind` knows `secondary`, `throttled` and `failed` (`skills/plot/scripts/plot-host.sh:474-482`). A 504 is `failed`, and `pr_list_failed` then calls `host_repair` (`plot-host.sh:564`), which prints `If it is not logged in: gh auth login` (`plot-host.sh:527`).

## Design

### Approach

**Slice 1, the domain.** `PrIndexUpdate` replaces `complete: boolean` with the kind of answer: `whole` (a full read that every state answered), `delta` (a window over a whole store that every state answered) or `partial` (a state did not answer). `foldPrIndex` replaces on `whole`, merges on the other two, keeps `complete: true` on a `delta` over a whole store, and writes `complete: false` on `partial`. `PrIndex` gains `wholeAt`, this machine's clock at the last `whole` fold. `prWindowFor` measures the 24 h full read against `wholeAt`, never against `at`. `PR_INDEX_VERSION` goes to 3, so a version-2 store reads as `null` and costs one full read, the existing behaviour for an unrecognised version (`pr-store.test.ts:350`). `refreshPrs` passes the kind from `window` and `partialSaid`. Vendor words stay out: the domain sees *whole*, *delta* and *partial*.

**Slice 2, the full read.** The full read stays one per day and on a cold store, and it still takes 43 s on this repository. The rich fields that cost 36 s are verdicts about a PR's head: checks, mergeability, review. For a `MERGED` row these cannot change. The full read becomes two `pr-list` calls through `plot-host.sh`: `--state open --rich` and `--state all` without `--rich`. A terminal row takes its verdict fields from the stored row with the same number where one exists, and stays without them where none exists. The store schema already allows an absent `mergeable` and `failing_checks` (`packages/domain/src/entities/pr-index.ts`); `checks` and `review` are required strings today, and the slice decides their absent form before it starts. The plain arm must also emit `updatedAt`, which is `--rich` only today (`plot-host.sh` header, `pr-list`), or the watermark cannot advance. This slice changes no op name and adds no script.

**Slice 3, the report.** `host_failure_kind` gains `timeout` for a server-side timeout: `HTTP 502`, `HTTP 503`, `HTTP 504` and GitHub's *couldn't respond to your request in time*. The patterns live in `plot-host.sh`, the adapter. `pr_list_failed` prints `plot-host: pr-list: host timed out — <stderr>` and no login repair, and exits 3 as before, so no caller's exit-code handling changes. The board's banner shows the adapter's sentence unchanged.

### What this does NOT do

- **It does not change the delta.** The delta answered in 0.8 s, and its window rule stays as `09cf9018` built it.
- **It does not change Bitbucket's bulk listing.** `bb pr list` cannot narrow, says so, and the board folds that answer as partial (`plot-host.sh` header, `pr-list`). Slice 1 keeps that answer `partial`, so a Bitbucket store reads in full as today.
- **It does not raise `PR_LIMIT`.** The truncation at 1000 is #333's and is reported already.
- **It does not retry a 504.** A retry doubles the cost of a request that already ran too long.

### Open Points

- [ ] Slice 2: `prsByHead` holds every state for the branch link (`fleet.ts:2946`, read at `fleet.ts:6506`), and `pr.checks` is read at `fleet.ts:2233`, `:4572` and `:5555`. The slice names which of these readers can receive a terminal row and chooses the absent form of `checks` and `review` from that list.
- [ ] Slice 2 has no measurement of `--state open --rich` with open PRs present; the store showed 0. The issue measured 2.5 s for it on 2026-09-30.

## Slices

### A delta keeps the store whole (Branch: bug/a-delta-keeps-the-store-whole)

`PrIndexUpdate.kind`, `PrIndex.wholeAt` and `PR_INDEX_VERSION` 3 in `packages/domain/src/entities/pr-index.ts`; the fold and the window in `packages/domain/src/rules/pr-index.ts`; the kind passed at `fleet.ts:3007`. <!-- builds: PrIndex.wholeAt, the whole/delta/partial answer kind -->

Tests:

- `packages/domain/test/pr-index.test.ts`: a `delta` over a whole store stays whole and advances the watermark; a `partial` over a whole store is not whole; a `delta` over a partial store stays partial; the full read is due 24 h after `wholeAt` while `at` is newer; a store with no `wholeAt` reads as due. `pr-index.test.ts:350` (*a delta is never complete*) is rewritten to the new rule in the same commit.
- `packages/board/test/unit/pr-store.test.ts`: three refreshes over one fixture host send one full call and two `--since` calls; `:474` and `:558` are rewritten to the new rule; `:535` ages `wholeAt`, not `at`.

### The full read asks verdicts of open PRs only (Branch: bug/the-full-read-asks-verdicts-of-open-prs-only) <!-- waits: bug/a-delta-keeps-the-store-whole -->

The full read in `refreshPrs` becomes two `plot-host.sh pr-list` calls; terminal rows keep stored verdict fields; the plain arm of `pr-list` emits `updatedAt`. It waits on slice 1 because both change `refreshPrs` and the store's fold. <!-- builds: the two-call full read -->

Tests:

- `pr-store.test.ts`: a full read sends `--state open --rich` and `--state all` without `--rich`; a `MERGED` row keeps its stored `checks`; a terminal row with no stored row carries the absent form; a failed open call leaves the store untouched.
- `test/reconcile/host.test.mjs`: the plain arm emits `updatedAt` on GitHub and on Bitbucket.
- A measurement in the PR body: the new full read on this repository, at most 2 listing calls.

### A host timeout names no login (Branch: bug/a-host-timeout-names-no-login)

`timeout` in `host_failure_kind` and its arm in `pr_list_failed` in `skills/plot/scripts/plot-host.sh`. <!-- builds: the timeout failure kind -->

Tests:

- `test/reconcile/host.test.mjs`: a stubbed `gh` failing with `HTTP 504: We couldn't respond to your request in time` exits 3 and prints `host timed out` without `auth login`; a stubbed `bb` failing with `HTTP 503` does the same; a rate-limit text is still `throttled`.

## Done when

- On this repository a board with a whole store sends one full listing per 24 h and `--since` listings between them, proved by `pr-store.test.ts` and by the store reading `complete: true` after a delta.
- The full read on this repository takes at most 15 s, measured in slice 2's PR body.
- A 504 from `pr-list` prints `host timed out` and no login advice.
- No new `plot-*.sh` script; every host call goes through `plot-host.sh`.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. Each slice carries a changeset.

## Notes

Written 2026-10-01 from #1087 (filed 2026-09-30). The four listing calls above are the plan's whole host spend.

Panel round 1 (2026-10-01, three lenses: skeptic, operator, domain): unanimous `amend`. The moderation is `.plot/panels/2026-10-01-a-pr-refresh-reads-the-history-once-a-day/round1.md`. It requires: `fleet.ts:3039` keyed on the answer kind; the kind decided in the domain; every version-2 reader and bundle named; the Bitbucket claim corrected (a windowed Bitbucket listing narrows); a failed due full read that does not repeat every minute; slice 2 fields, absent forms and two-call answer defined; three-run and GraphQL-spend measurement.
