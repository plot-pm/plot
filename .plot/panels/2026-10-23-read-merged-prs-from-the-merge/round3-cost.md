# Juror round 3: cost lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `9774d8e1b`. Code read at `origin/main` `8f87cb9c4` (main worktree). Siblings: none re-read beyond what round 2 recorded; no further sprint item read.

Position: amend

## Summary

The amendment removes the round-2 cost defects that came from exit 7: no false *host unreachable* banner, no lost deltas on a healthy store. The Cost table is mostly correct and the arithmetic holds. Three costs are still missing or misplaced, and one of them is the largest multiplier slice 1 creates:

1. **The review-bypass section (`plot-reconcile-scan.sh` §20a) is not in the Cost table.** It lists `--limit 500` merged PRs and then reads each one's review with at least 3 Bitbucket requests. After slice 1 that is about 1510 requests per reconcile run instead of about 151.
2. **The partial-repeat amplification is an Open Point, but slice 1 creates it.** The slice text does not include the fix. On 2026-10-26 the ewz-kus-portal listing endpoint answered HTTP 429 to 6 of my 7 listing GETs, so a throttled state mid-walk is the likely operating mode on the motivating estate, not an edge case.
3. **The queue's `prList('merged', 500)` → 50 also changes GitHub**, and on GitHub the queue then depends on a decodable PR index for every merge older than the newest 50. This checkout's live store is `v: 4`, and `origin/main` decodes only `v: 5`.

## Measurements in this round

- **Ran** 8 read-only `bb api` GETs on `quatico/ewz-kus-portal` at about 2026-10-26T14:56Z (Quatico bb 3.17.1 plugin CLI). `pullrequests?state=MERGED&pagelen=50&page=1..3`: all three returned `HTTP 429 — Rate limit for this resource has been exceeded`, each in about 0.5 s. `pullrequests/3725` (single PR): answered, `MERGED`. `state=OPEN&pagelen=1`: answered. `state=MERGED&pagelen=1`: failed with non-JSON output (not captured; most likely 429). `state=OPEN&pagelen=50`: 429, twice. I cannot attribute the spend; other jurors may share the account. The listing resource is throttled while the single-PR resource answers, which matches the #2385 addendum.
- **Ran** `jq` on the live stores. This checkout: `github.json` `v: 4`, `complete: true`, 1008 rows (980 MERGED), written 2026-10-26T14:50Z. ewz-kus-portal: `bitbucket.json` `v: 2`, 111 rows, written 2026-10-02 (unchanged since round 2; no fleetd has written there).
- **Read** `PR_INDEX_VERSION = 5` and `v: z.literal(PR_INDEX_VERSION)` (`entities/pr-index.ts:12,123`). A v4 store decodes to `null` on `origin/main`.

## 1. Round-2 findings

| Round-2 item | Status | Plan line |
|---|---|---|
| Agreement 1: false *host unreachable* banner from exit 7 | Resolved. A walk at its limit exits 0, and exit 0 keeps stderr out (`scripts-shell.ts:99`, read). | 47, 167 |
| Agreement 2: exit 7 gets a second meaning | Resolved. Exit 7 now means only "a state failed". | 47, 163 |
| Agreement 3: callers drop rows on exit 7 | Resolved as stated: no new exit-7 meaning. Residual cost not named: a 20-page walk has 20 chances to fail instead of 1, so `plot-reconcile-scan.sh:738` and `plot-open-pr.sh:116` lose their whole answer on exit 7 more often. | 168 |
| Agreement 4: slice 3 duplicates the deliver gate | Scoped out with a reason (PR numbers for step 5), and the double spend is counted. | 52-61, 96 |
| Agreement 5: slice 2 Changelog unreachable | Restated to the footer note. | 17, 172 |
| Agreement 6: Approach line 43 on `complete` | Resolved. | 47, 175 |
| Disagreement 1: third cap | Resolved; all three caps and an equality test. | 49, 146 |
| Disagreement 2: what slice 1 becomes | Resolved by the operator's choice (page the listing). | 32, 133, 166 |
| Disagreement 3: is slice 1 worth its price | Partly. The Cost table prices the healthy path. The partial path stays an Open Point (see section 4). | 77-97, 170 |
| Disagreement 4: slice 3 one call or per branch | Resolved: one `pr-list` with repeated `--branch`. | 50, 150 |
| #2400 delivered with no code | Resolved in Motivation. | 32 |
| False `complete: true` on GitHub too | Left open, with options. | 174 |
| `merge-subjects.ts:40-41` comment | In slice 2. | 146 |
| Summary opens with July plans | Resolved. | 3 |
| No shell-line offset | Resolved, with a caveat (section 5, item 4). | 101-105 |
| Stale 2000 in `merge-subject.ts:39` | In slice 2. | 146 |
| `prWindowFor` line | Fixed to `:384` (read: correct). | 92 |
| Blind spot 1: page order, live v5 store | Page order measured. A live v5 Bitbucket store is still unmeasured: the only one is `v: 2` (ran). | 34, 156 |
| Blind spot 2: what the plan is for after #2400 | Answered by the operator's choice. | 158 |

## 2. Approach against the code

All **read** unless marked.

**Slice 1.**

- `bb_state_listing` at `plot-host.sh:1393-1406` asks one `pagelen=50` page and never follows `next`. Correct.
- `_bb_paged_walk` (`:1132`) and `bb_window_listing` (`:1309`) follow `next`. Correct. But `_bb_paged_walk` **returns exit 3** when it reaches its page cap (`:1138`), and `BB_BRANCH_QUERY_PAGE_CAP=20` (`:1193`). *Shell Lines* (line 103) offers "reuses `_bb_paged_walk` with a page-cap argument" as the fallback. Reused as written, a state above the limit fails, `pr_list_states` counts it failed, and the call exits 7. That brings back the round-2 banner and the row-dropping callers. The fallback must say that the limit stop exits 0 and leaves the truncation line to `pr_list_report_truncation`.
- `pr_list_report_truncation` (`:3250`) prints *possibly truncated* when `next="1"` and the count is not below `BB_LIST_PAGELEN=50` (`:3196`). A walk that stops at 1000 with `next` present takes that path. Correct.
- `PR_LIST_PARTIAL_RC=7` (`:935`), `return 0` at `:1544`, the notice at `:4771`, the GitHub limit at `:4733-4736`: correct.
- The Jenkins bind (`_bb_jen_bind`, `:4859`) filters to `OPEN` rows before it spends lookups, so 1000 merged rows add no Jenkins cost. The plan does not say this; it is a cost it does not owe.
- **Cost table, checked row by row against ewz-kus-portal's sizes (10 / 3527 / 147):** full read 1+20+3 = 24, correct. Delta 3, correct (`bb_window_listing` pages). Queue 1, correct. `plot-reconcile-scan.sh:738` (`MERGED_PR_LIMIT=500`, `:432`) 10, correct. `plot-open-pr.sh:116` 1+4+3 = 8, correct. `approve.ts:341,400` and `needs-design.ts:181` (`PRS_LISTED = 100`), correct. `plot-fleet-scan.sh:1047,1063` (`PR_LIST_LIMIT=3000`, `:691`), correct; with tracked branches the scan sweeps by name and does not list.
- **Missing row: `review-bypass.ts:46`.** `plot-reconcile-scan.sh:2615` runs `plot-review-bypass.mjs --limit "$MERGED_PR_LIMIT"` (500). `readMerged` lists the merged PRs and calls `host.prReview` for **each** row (`review-bypass.ts:46-57`). On Bitbucket, `pr-review` (`plot-host.sh:4299-4311`) makes one PR GET plus two `_bb_paged_walk` reads (statuses, comments): at least 3 requests per PR. Today: 1 + 50 × 3 ≈ 151 requests per reconcile run. After slice 1: 10 + 500 × 3 ≈ 1510. `readMerged` reads every listed PR's review before `reviewBypasses` applies `since`, so most of those reads are for PRs merged before `Review required since`. The section runs only where that key is set; ewz-kus-portal does not set it (read: its `AGENTS.md` has no such key). It is still the largest multiplier slice 1 creates on any Bitbucket estate that does set it, and it lands on the single-PR resource that is the one still answering.
- **Daily spend arithmetic** (line 91): 480 refreshes × 3 = 1440, plus 21. Correct. The pricing argument for keeping `PR_REQUESTS_PER_REFRESH.bitbucket` at 3 matches the file's own rule for the pending re-ask (`pr-refresh.ts:194-203`).
- **Queue change.** `registryd-main.ts:791` asks `prList('merged', 500)` every `TICK_INTERVAL_MS = 60_000` (`registryd.ts:80`). The comment above it (`:783-788`) records why it is large: #707 and #710 sat hundreds of merges back. The index rows join the set (`queue-reading.ts:331-333`; the plan cites `:325-332`, which is the comment above). With a 50-row listing, a 0-row index read leaves the queue 50 merged PRs deep on GitHub, where it is 500 today. `prIndexRows` returns `[]` for a missing or undecodable store (`registryd-main.ts:843-849`). A 50-row listing also reads as `whole`, so `landedWithoutListing` does not run. On a GitHub squash estate such as this one, `subjectProofOf` has no `Merge pull request` subject to rescue it. The plan states that "the index holds the newest 1000 PRs of each state on both hosts" (line 48) as if the index is always readable. Measured: this checkout's store is `v: 4`, and `origin/main` reads only `v: 5`. On GitHub the change also saves about 4 GraphQL pages per tick (`gh pr list --limit 500` against `--limit 50`; read, not measured), which the plan does not claim.

**Slice 2.** The three caps exist at the cited lines (`plot-fleet-scan.sh:472`, `registryd-main.ts:599`, `production.ts:286-290`). 0 host requests is correct. The scan hands `MERGE_SUBJECTS` once to `plot-merge-subject.mjs` (`plot-fleet-scan.sh:3644-3653`), so text processing is linear. Not priced: the age rule asks ancestry per matching subject, and an older log adds matches for reused names (87 on ewz-kus-portal). This is unmeasured and probably small.

**Slice 3.** `plot-impl-status.sh:245-250` breaks on the first unresolved branch, and `:269` asks `--limit 500`. Correct. On Bitbucket, `--branch` runs `bb_branch_sweep` (`:1222`), one query per branch. On GitHub, one branch maps to `--head` (`:4488`), and several branches keep the listing. Correct. The Cost line (96) still omits the `pr-state` call per hit (`plot-impl-status.sh` around `:330`, read), which round 2 named. After slice 3, more branches hit on Bitbucket, so more `pr-state` calls follow. For a plan with more than 10 unresolved branches, slice 3 costs more than slice 1's 10-page listing alone. Line 85 states both numbers, which is honest.

## 3. Slices against the Changelog

- **Slice 1** has an observable effect: the PR index holds up to 1000 rows per state, and the board shows a PR for an older branch. The Changelog line says "a merged PR outside the newest 50 of its state stops reading as no PR". That holds only within the newest 1000 **by `updated_on`** (line 34). ewz-kus-portal holds 3527 merged PRs, so 2527 still read as no PR from the listing. The line should name the bound. It also omits the queue's 500 → 50 change, which is a GitHub behaviour change.
- **Slice 2** ships the footer change and nothing else on the measured estates. The line says that. Good.
- **Slice 3** ships a step-4 report change. The line names step 4. Good.
- **The motivating symptom.** The plan no longer claims to fix the July plans' *state unknown*; it names HTTP 429 as the cause (lines 3, 20, 38, 124). That is honest. The cost consequence is not stated: slice 1 spends more on the listing resource, and that resource answered 429 on 2026-10-26. Line 97 ("buys correct answers, not budget") understates this. On the motivating estate today, the paged walk would mostly fail its merged state and return exit 7.

## 4. Open points

- **[Scope] reshaped scope, no v6 `subjects`.** Operator decision. From a cost lens, no v6 is right: the walk costs 0.02 s.
- **[Domain] reused names in slice 3.** A correctness question. Operator or slice measurement.
- **[Technical] drop `--merges`.** Answered by measurement already in the plan: 0 single-parent subjects on ewz-kus-portal, 0.10–0.12 s against 0.02 s. Close it: keep `--merges`.
- **[Cost] partial repeat.** The code answers it, and the answer is that slice 1 must carry the fix. **Read:** a partial answer is not thrown (`pr-refresh.ts:1530-1532`), so it gets no `hostReaction` back-off and does not set `prFullReadFailedAt` (that is set only in the `catch`, `:1811`). `prWindowFor` returns a full read on `!held.complete` (`rules/pr-index.ts:394`) before it ever consults the grace (`:409-410`), so even recording the failure would not help without a change to `prWindowFor`. Today a partial full read costs 3, the same as a delta. After slice 1 it costs up to 24 every 180 s, which is up to 480 requests per hour against 60 today, and it re-spends pages 1..k-1 of the failed state each time. The 429 measured above makes this the expected mode on ewz-kus-portal. The proposal on line 170 is right, but it is a requirement of slice 1, not an open question: put it in slice 1's text and tests, and name the `prWindowFor` change.
- **[Scope] `complete: true` above `PR_LIMIT`.** Partly a cost question, and it interacts with the point above. Raising `PR_LIMIT` to cover 3527 merged PRs costs 75 requests once a day, about 5 % of the 1440 daily delta spend. That is cheap only if the partial repeat is fixed. Without the fix it becomes up to 75 requests every 180 s under throttling. `PR_LIMIT` is shared with GitHub (`pr-refresh.ts:303`). The choice between accepting the flag and raising the limit stays with the operator.

## 5. New defects

1. **Cost table misses the review-bypass multiplier** (section 2): about 151 → 1510 requests per reconcile run on a Bitbucket estate with `Review required since` set. Fix: keep that call at its own small limit, or make `readMerged` skip PRs whose `mergedAt` is before `since` before it calls `prReview`, and count the row.
2. **The partial-repeat amplification ships in slice 1 without its fix** (section 4). The plan leaves it open while slice 1's tests already include the HTTP 429 stub on page 2 that would show it.
3. **The queue's lower limit depends on the index without saying so** (section 2). A missing or old-version store shrinks the GitHub queue's merged set from 500 to 50 rows. Fix: state the dependency, and add a test where `prIndexRows` returns `[]`. Or lower the limit on Bitbucket only, where it reads 50 rows today anyway.
4. **The `_bb_paged_walk` fallback in *Shell Lines* exits 3 at its cap** (section 2), which would bring back exit 7 for every state above the limit. The fallback text must require exit 0 at the limit.
5. **Changelog line 1 states no bound** (section 3): name "the newest 1000 per state by update time", and name the queue change.

## Changes before approval

1. Add the §20a review-bypass row to *Cost*, and bound it in slice 1.
2. Move the partial-repeat back-off into slice 1's text and tests, including the `prWindowFor` change. Close that Open Point.
3. State the queue's dependency on a readable index and test the empty-index case. Or keep 500 on GitHub.
4. Make the *Shell Lines* fallback require exit 0 at the limit.
5. Bound Changelog line 1 at 1000 per state by `updated_on`, and mention the queue limit change.
6. Add the per-hit `pr-state` call to slice 3's Cost line.
7. Close the `--merges` Open Point: keep `--merges`, from the plan's own numbers.
