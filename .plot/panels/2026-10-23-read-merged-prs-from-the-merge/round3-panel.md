# Panel: read-merged-prs-from-the-merge (round 3)

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `9774d8e1b` (Draft, #2385, plan PR #2419). This is the plan after the round-2 amendment, in which the operator chose to have slice 1 page `bb_state_listing`. Code read at `origin/main` `8f87cb9c4`.
Caller: `/challenge-the-plan` Phase 3P. Commitment: `Position: proceed,amend,reject`. Lenses: the same four as rounds 1 and 2.
Siblings: #2400, #2386, #2484 and #2560 are named in the brief. Contradiction and estate also read `2026-09-20-a-pr-list-reads-every-page` (#333, Released 2.19.0), which was not in the brief. Contradiction read all 30 sprint titles. No other sprint item was read beyond its title.

## Gate

| Juror | `plot-panel.mjs check` | Position |
|---|---|---|
| estate | exit 0 | amend |
| contradiction | exit 0 | amend |
| deliverable | exit 0 | amend |
| cost | exit 0 | amend |

`plot-panel.mjs reconcile`: `unanimous amend estate,contradiction,deliverable,cost`. No juror was sent back.

## What each juror looked at

- **estate**: read the code on `8f87cb9c4` and ran `git log` over #2400's plan file on main.
- **contradiction**: read the code, ran `git log` / `git show` over #2400's three state commits, and read #333 in full.
- **deliverable**: read the code. It ran 2 read-only `bb api` GETs, a by-name merged query for `fix-bdd` on ewz-kus-portal, and `git log --merges` there.
- **cost**: read the code. It ran 8 read-only `bb api` GETs on ewz-kus-portal at about 14:56Z: the listing endpoint answered HTTP 429 to 6 of 7 listing GETs, and the single-PR endpoint answered. It ran `jq` over both live stores: this checkout's `github.json` is `v: 4` with 1008 rows, and ewz-kus-portal's `bitbucket.json` is `v: 2` from 2026-10-02.

The 429s fell inside the juror window, and the jurors share one account. Some of that spend is the panel's own.

## Round 2

All four jurors find each round-2 agreement resolved: the false *host unreachable* note, the second meaning of exit 7, the callers that drop rows, the third cap, the slice-2 Changelog line, line 43 and the duplicate domain test. Slice 3's overlap with the deliver gate is scoped with a reason. Two items regress or stay open:

- **#2400.** The rejection did not hold (see Agreement 6).
- **Partial repeat.** The plan leaves it as an open point. Three jurors say that slice 1 creates it and so must carry the fix (Agreement 4).

## Agreement

1. **The *Shell Lines* fallback breaks Approach 2** (all four). Line 103 offers reuse of `_bb_paged_walk` with a page cap. That walk returns exit 3 at its cap (`plot-host.sh:1138`), and `plot-host.sh:1097-1103` documents exit 3 as the one vocabulary for "the answer may be short". Reused as it is, every state above the limit fails. On ewz-kus-portal (3527 merged against `PR_LIMIT` 1000), every full read then exits 7 and folds `partial`, which is the round-2 defect again. `bb_branch_query` and `pr-review` share the walk and must keep exit 3. Contradiction adds that Approach 2's exit 0 at the limit departs from `:1097-1103`, and the plan must name that departure.
2. **Lowering the queue's `prList('merged', 500)` to 50 is a GitHub change with a false premise** (all four).
   - Approach 3 (line 48) says the index holds *the newest 1000 PRs of each state on both hosts*. On GitHub the full read asks `--state all --limit 1000` once, so the index holds 1000 PRs across all states.
   - `prIndexRows` returns `[]` for a missing or undecodable store (`registryd-main.ts:843-849`). A clean 50-row answer reads as `whole`, so `landedWithoutListing` does not run. That re-opens the #707/#1454 failure that `registryd-main.ts:782-789` and `queue-reading.ts:320-330` record.
   - This checkout's store is `v: 4`, and `origin/main` decodes only `v: 5` (cost, ran).
   - On Bitbucket the queue reads 50 rows today, so the change does nothing there.
   - The Changelog and the Board-impact comment do not mention the change.
3. **Cost misses `review-bypass.ts:46`** (estate, deliverable, cost). Reconcile §20a lists merged PRs and then calls `prReview` on each one before it applies `since`. On Bitbucket each `pr-review` costs at least 3 requests. Cost puts the run at about 151 requests today and about 1510 after slice 1 with `--limit 500`. Deliverable reads the default limit as 100, so its run doubles. Both readings say the multiplier is unpriced. It runs only where `Review required since` is set, and ewz-kus-portal does not set it.
4. **The back-off for a partial full read belongs in slice 1** (contradiction, deliverable, cost; estate says to decide it before approval).
   - A partial answer is not thrown (`pr-refresh.ts:1530-1532`), so it gets no back-off and does not set `prFullReadFailedAt`.
   - `prWindowFor` returns a full read on `!held.complete` before it reads the grace, so the fix also changes `prWindowFor`.
   - After slice 1 a partial full read costs up to 24 requests every 180 s, against 3 today.
   - `pr-refresh.ts:184-188` forbids a cost that is both unbounded and under-declared.
5. **#333 is the precedent, and the plan does not cite it** (estate, contradiction). The Released plan `2026-09-20-a-pr-list-reads-every-page` rejected paging on cadence grounds (4 → 21 requests, 1260 s). The plan's answer is sound: deltas now carry the refresh, and the full read runs once a day. The plan must name the precedent and what changed since. Estate adds #333's must-not-break item: a Bitbucket fleet scan with no tracked branch writes `.list-complete` only on *page complete* from both calls or on the row-count fallback (`plot-fleet-scan.sh:1262-1274`). Slice 1 has no test of that.
6. **#2400 is Delivered again** (estate, contradiction). `c67b5cd1f` re-delivered #2400 43 seconds after `6666041ff` rejected it. Plan line 158 (*#2400's plan file is unchanged*) is now false, and #2400's Changelog line will publish beside this plan's line for the same change. The moderator traced the re-delivery to fleetd's auto-deliver (`packages/fleet/src/shared/auto-deliver.ts`), which reads no `Rejected:` record and counts a claim-only PR as a merged slice. Filed as #2713.

## Disagreements

1. **How to fix the queue.**
   - Deliverable and cost: keep 500 on GitHub, and lower the limit only on Bitbucket, where it changes nothing.
   - Contradiction: keep 500 everywhere and price the 10 Bitbucket requests per tick, or make a Bitbucket listing that reaches its limit non-`whole` so that `landedWithoutListing` asks by number.
   - All three ask for a test with an empty index.
   - The options differ in what the queue trusts: the listing, or the index.
2. **Who owns #2400's Changelog line.** Contradiction: this plan names how #2400 leaves the release, either by editing #2400's line or by recording that slice 1 supersedes it. Estate: assign an owner, with no preference. Deliverable and cost did not take it up.
3. **Does slice 1 pay on the motivating estate?** Only cost measured the listing endpoint, and it was throttled. If it stays throttled, the paged walk mostly fails its merged state, and the slice brings correct answers only where the host has budget. Estate, contradiction and deliverable price the healthy path only.

## Found by one juror

- **The Changelog bound** (deliverable, cost). Line 16 says *outside the newest 50*. The measured order is `updated_on`, so the line should say *the 50 most recently updated*, and it should name the 1000-per-state bound: 2527 of ewz-kus-portal's merged PRs stay outside it.
- **A trimmed last page** (deliverable). The Bitbucket arm of `pr_list_report_truncation` never compares the row count with `--limit`. A walk that trims its last page and records that page's `next = 0` reports *page complete* for a state it cut short. The walk must record `next` from the page where it stopped.
- **Slice 1's `packages/fleet` test** (deliverable). It stubs the host answer, so it tests the existing `whole` fold and proves no paging. Replace it with the empty-index queue test.
- **Slice 3 under throttling** (deliverable). The sweep returns the first failing branch's code and prints no rows. Under `|| true`, one 429 empties step 4's answer for every branch.
- **Reused branch names** (deliverable, ran). By-name results come back in `updated_on` order. `fix-bdd` merged 6 times, and the query returns #3452 first. For a plan whose slice merged as #3195, step 4 reports #3452. The remaining decision is to filter by merge time after the plan landed, or to accept the newest.
- **The per-hit `pr-state` call** in slice 3 is still not in Cost (cost).
- **Stale comments after slice 1** (contradiction): `plot-host.sh:1381-1388`, `:3153-3156`, `:3175-3180` and `pr-refresh.ts:240-244`. Estate adds that `listingPagingFor` reports Bitbucket as `fixed-page`, and that `plot-impl-status.sh:251-253` says *constant in branch count*.
- **Line references:** `deliverability.ts` lives in `packages/board`, not in the domain (estate). The index join is at `queue-reading.ts:331-333` (cost).
- **The `--merges` open point can close** (contradiction, cost). The plan's own numbers and `merge-subjects.ts:40-41` keep `--merges`.

## Shared blind spots

1. **The motivating estate is throttled now.** Every juror priced requests, but only cost asked the host, and the listing endpoint answered 429. No juror asked whether slice 1 should first ship the back-off (Agreement 4) and measure ewz-kus-portal's listing budget before it pages. The panel's own GETs share the account, so the panel cannot separate its spend from the estate's load.
2. **No juror read a live v5 Bitbucket store.** None exists on this machine. Every runtime claim about slice 1 on Bitbucket still comes from reading code. No fleetd has written ewz-kus-portal's store since 2026-10-02, so the index half of slice 1 has no observer there until a fleet runs.

## Outcome

The panel is unanimous on `amend`. Nothing is approved. The open points go to the plan's `## Open Points`.

The fixes are mechanical except two operator choices:

- the queue: keep 500 on GitHub, or trust the index;
- #2400's Changelog line.

#2713 holds the re-delivery loop. Until it is fixed, a rejection of #2400 cannot hold.
