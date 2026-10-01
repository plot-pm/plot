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
- A failed daily full read no longer repeats every minute: the board asks for changed PRs and retries the full read an hour later.

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

**Slice 1, the domain.** `PrIndexUpdate` replaces `complete: boolean` with the kind of answer: `whole` (a full read that every state answered), `delta` (a window over a whole store that every state answered) or `partial` (a state did not answer). The domain decides the kind. `PrWindow.complete` (`packages/domain/src/rules/pr-index.ts:125`) becomes `PrWindow.kind`, and one exported arrow, `answerKind(window, partialSaid)`, maps the window and the partial sentence to `whole`, `delta` or `partial`. `fleet.ts:3007` calls it and stops doing the arithmetic. `foldPrIndex` replaces on `whole`, merges on the other two, keeps `complete: true` on a `delta` over a whole store, and writes `complete: false` on `partial`. `PrIndex` gains `wholeAt`, this machine's clock at the last `whole` fold. `prWindowFor` measures the 24 h full read against `wholeAt`, never against `at`. `PR_INDEX_VERSION` goes to 3, so a version-2 store reads as `null` and costs one full read, the existing behaviour for an unrecognised version (`pr-store.test.ts:350`). `refreshPrs` passes the kind that `answerKind` returns. Vendor words stay out: the domain sees *whole*, *delta* and *partial*.

**The served maps stay keyed on the answer kind.** `fleet.ts:3039` serves this pass's rows as the whole map when `complete` is true. After this slice a delta fold over a whole store also reads `complete: true`, so a controller that read the folded store's flag would serve a 0-row window as the whole map. `fleet.ts:3039` therefore tests `kind === 'whole'`, never the folded store's `complete`. `pr-store.test.ts:442` (*a delta whose window returns 3 rows still serves 933*) stays green unchanged.

**The version bump names every reader.** `PR_INDEX_VERSION` 3 changes these, in slice 1's commit: the fixtures that write `v: 2` (`test/reconcile/impl-status-index.test.mjs:313`, `test/reconcile/scan-index.test.mjs:279`, `packages/board/test/unit/registryd-main.test.ts:1268`); `packages/domain/test/pr-index.test.ts:249`, which pins `PR_INDEX_VERSION` at 2; and the two bundles that embed `decodePrIndex`, `skills/plot/scripts/board/plot-pr-index-lookup.mjs` and `skills/plot/scripts/board/board-server.mjs`, rebuilt. A version-2 store costs exactly one full read, and a test says so.

**A failed full read falls back to a delta.** Today a 504 is no rate limit, so `hostReaction` returns `null` (`fleet.ts:1652-1676`, called at `:3078`), the next refresh follows in `PR_REFRESH_MS` (60 s, `fleet.ts:134`), and the full read is still due. The board would repeat its heaviest query every minute. After this slice the board records, in memory on the entry, the time of a full read that failed. `prWindowFor` takes that time as a reading: where the store is whole, carries a watermark and the full read is due only by age, a full read that failed less than one hour ago answers a delta instead. The full read is asked again one hour after the failure. A cold store, a partial store and a store with no watermark have no delta to fall back to, so they keep today's cadence; slice 2 shortens that read.

**Slice 2, the full read.** The full read stays one per day and on a cold store, and it still takes 43 s on this repository. The rich fields that cost 36 s are verdicts about a PR's head: checks, mergeability, review. For a `MERGED` row these cannot change. The split has two halves, one in the adapter and one in the domain.

- **The adapter.** `pr-list` gains the flag `--rich-open`. On GitHub it makes two calls inside the GitHub arm: `--state open` with the rich fields and `--state all` with the plain fields. The board still makes one `pr-list` call per refresh, so `PR_REQUESTS_PER_REFRESH` (`fleet.ts:202-246`) needs no new arithmetic for Bitbucket. On Bitbucket `--rich-open` answers as `--rich` does, because that arm asks no verdict of the host (`plot-host.sh:3914-3918`). A terminal row from the plain call carries every field the rich row carries (`packages/domain/src/entities/pr-index.ts:38-42`): `draft` from `isDraft`, `url` and `updatedAt`, which the plain GitHub arm lacks today (`plot-host.sh:3902`). Its verdict fields take the absent values the Bitbucket arm already emits (`plot-host.sh:4013`): `checks: "unknown"`, `mergeable: "unknown"`, `review: ""`, `failing_checks: []`. The schema accepts these values, so no second version bump follows.
- **The domain.** `foldPrIndex` carries the held verdict fields onto an incoming `MERGED` or `CLOSED` row with the same number whose verdict fields hold the absent values. Only the fold reads `held`, so the rule lives there. A terminal row with no held row keeps the absent values.
- **One answer from two calls.** The answer is `whole` only when both calls answered. When either call fails, `pr-list` prints no rows and exits non-zero, so the board writes nothing to the store.

This slice adds one flag and no op name and no script.

**Why slice 2 stays after slice 1 and the fallback.** Slice 1 makes the full read daily, and the fallback stops a failed full read from repeating every minute. Neither shortens the full read itself. A cold store, a partial store and every board's first read after slice 1's version bump have no delta to fall back to, so each pays the 43 s read and its 504 risk at the ordinary cadence. Slice 2 is the change that shortens that read.

**Slice 3, the report.** `host_failure_kind` gains `timeout` for a server-side timeout: `HTTP 502`, `HTTP 503`, `HTTP 504` and GitHub's *couldn't respond to your request in time*. The patterns live in `plot-host.sh`, the adapter. `pr_list_failed` prints `plot-host: pr-list: host timed out — <stderr>` and no login repair, and exits 3 as before, so no caller's exit-code handling changes. The board's banner shows the adapter's sentence unchanged.

### What this does NOT do

- **It does not change the delta.** The delta answered in 0.8 s, and its window rule stays as `09cf9018` built it.
- **It changes Bitbucket too.** A windowed Bitbucket listing narrows through `bb_window_listing` (`skills/plot/scripts/plot-host.sh:933`, called at `:3978`), and a healthy Bitbucket answer from all three states carries no partial sentence. Slice 1 therefore reads it as `delta`, and a Bitbucket store stays whole after a healthy delta. Only a state that did not answer is `partial`. Slice 1 corrects the stale comments that say the bulk listing cannot narrow (`plot-host.sh:89-99`, `fleet.ts:233-238`).
- **It does not raise `PR_LIMIT`.** The truncation at 1000 is #333's and is reported already.
- **It does not retry a 504 at once.** A retry doubles the cost of a request that already ran too long. A failed full read is asked again one hour later, and the refreshes between ask a delta.

### Open Points

- [ ] Slice 2: `prsByHead` holds every state for the branch link (`fleet.ts:2946`, read at `fleet.ts:6506`), and `pr.checks` is read at `fleet.ts:2233`, `:4572` and `:5555`. The slice names which of these readers can receive a terminal row and asserts that each renders `checks: "unknown"` as unavailable.
- [ ] The alternation is derived from code, not observed on a running board. Slice 1's PR body shows the call sequence of three real refreshes from a running board's log, before and after.
- [ ] Slice 2 has no measurement of `--state open --rich` with open PRs present; the store showed 0. The issue measured 2.5 s for it on 2026-09-30.

## Slices

### A delta keeps the store whole (Branch: bug/a-delta-keeps-the-store-whole)

`PrIndexUpdate.kind`, `PrIndex.wholeAt` and `PR_INDEX_VERSION` 3 in `packages/domain/src/entities/pr-index.ts`; the fold, the window, `PrWindow.kind`, `answerKind` and the failed-full-read fallback in `packages/domain/src/rules/pr-index.ts`; `fleet.ts:3007` calls `answerKind`, `fleet.ts:3039` tests `kind === 'whole'`, and the catch records a failed full read; every version-2 reader and both bundles named above; the stale comments at `plot-host.sh:89-99` and `fleet.ts:233-238`. <!-- builds: PrIndex.wholeAt, the whole/delta/partial answer kind -->

Tests:

- `packages/domain/test/pr-index.test.ts`: a `delta` over a whole store stays whole and advances the watermark; a `partial` over a whole store is not whole; a `delta` over a partial store stays partial; the full read is due 24 h after `wholeAt` while `at` is newer; a store with no `wholeAt` reads as due; `answerKind` answers `whole`, `delta` and `partial` for each window and partial sentence; a whole store whose full read failed less than one hour ago answers a delta, and one hour later answers a full read. `pr-index.test.ts:350` (*a delta is never complete*), `:365` (*measures the full read against `at`*) and `:249` (pins version 2) are rewritten to the new rule in the same commit.
- `packages/board/test/unit/pr-store.test.ts`: three refreshes over one fixture host send one full call and two `--since` calls; `:474` and `:558` are rewritten to the new rule; `:535` ages `wholeAt`, not `at`; `:442` stays green unchanged; a new case serves 1000 PRs after a 0-row delta over a whole store; a version-2 store on disk costs exactly one full read; a fixture host that answers a due full read with `HTTP 504` gets a `--since` call on the next refresh and the full call again one hour later.
- `test/reconcile/host.test.mjs`: a stubbed `bb` with `--since` answers all three states through `bb_window_listing` with no partial sentence, and the board folds it as `delta`.
- The PR body shows the call sequence of three real refreshes from a running board's log.

### The full read asks verdicts of open PRs only (Branch: bug/the-full-read-asks-verdicts-of-open-prs-only) <!-- waits: bug/a-delta-keeps-the-store-whole -->

`pr-list --rich-open` in `skills/plot/scripts/plot-host.sh` makes the two GitHub calls and emits terminal rows with `draft`, `url`, `updatedAt` and the absent verdict values; `foldPrIndex` carries held verdicts onto a terminal row with the same number; the full read in `refreshPrs` passes `--rich-open`. It waits on slice 1 because both change `refreshPrs` and the store's fold. <!-- builds: the two-call full read -->

Tests:

- `packages/domain/test/pr-index.test.ts`: a `MERGED` row with absent verdicts keeps the held row's `checks`, `mergeable`, `review` and `failing_checks`; a terminal row with no held row keeps the absent values; an `OPEN` row never takes held verdicts.
- `pr-store.test.ts`: a full read sends one `pr-list --rich-open` call; a non-zero exit from it leaves the store untouched.
- `test/reconcile/host.test.mjs`: on GitHub `--rich-open` sends `--state open` with the rich fields and `--state all` with the plain fields, and each terminal row carries `draft`, `url`, `updatedAt`, `checks: "unknown"`, `mergeable: "unknown"`, `review: ""` and `failing_checks: []`; a failing open call and a failing all call each exit non-zero and print no rows; on Bitbucket `--rich-open` emits the same rows as `--rich`.
- A measurement in the PR body: at least three runs each of the old full read and the new one on this repository, with the time and the GraphQL `used` delta from `gh api rate_limit` for each run.

### A host timeout names no login (Branch: bug/a-host-timeout-names-no-login)

`timeout` in `host_failure_kind` and its arm in `pr_list_failed` in `skills/plot/scripts/plot-host.sh`. <!-- builds: the timeout failure kind -->

Tests:

- `test/reconcile/host.test.mjs`: a stubbed `gh` failing with `HTTP 504: We couldn't respond to your request in time` exits 3 and prints `host timed out` without `auth login`; a stubbed `bb` failing with `HTTP 503` does the same; a rate-limit text is still `throttled`.

## Done when

- On this repository a board with a whole store sends one full listing per 24 h and `--since` listings between them, proved by `pr-store.test.ts` and by the store reading `complete: true` after a delta.
- The full read on this repository takes at most 15 s over at least three runs, and spends fewer GraphQL points than the old full read, measured in slice 2's PR body.
- A failed due full read is followed by a delta, not by the full read, on the next refresh.
- A 504 from `pr-list` prints `host timed out` and no login advice.
- No new `plot-*.sh` script; every host call goes through `plot-host.sh`.
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate pass. Each slice carries a changeset.

## Notes

Written 2026-10-01 from #1087 (filed 2026-09-30). The four listing calls above are the plan's whole host spend.

Panel round 1 (2026-10-01, three lenses: skeptic, operator, domain): unanimous `amend`. The moderation is `.plot/panels/2026-10-01-a-pr-refresh-reads-the-history-once-a-day/round1.md`. This plan applies its eight changes. The disagreement on where slice 2's split lives is resolved by taking both halves: the adapter makes the two GitHub calls, and the domain fold carries the held verdicts. The shared blind spot is answered by the call-sequence evidence in slice 1's PR and by the section *Why slice 2 stays after slice 1 and the fallback*.
