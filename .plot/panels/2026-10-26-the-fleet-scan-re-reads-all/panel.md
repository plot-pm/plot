# Panel round 1 — moderation

Subject: `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` at `8b7d08131` (#2720, plan PR #2721, Draft). Jurors: safety, estate, cost, contradiction. Gate: all four committed (exit 0). Reconcile: `unanimous amend`.

## Evidence basis

All four read `plot-fleet-scan.sh`, `fleet-scan.ts`, `plot-host.sh` and the index code on `origin/main` `c1d02f4fa`. Estate, cost and safety decoded the live PR index (`v: 4`, 1,003 rows, `complete: true`, lowest PR #776). Cost joined `last-pulse.json` (97 plan branches) with the index, compared `actual` rate-limit readings with record lines (1.4–2.9 points per line), and ran one `gh api rate_limit`. Cost also ran `plot-pr-index-lookup.mjs` against the v4 store; it answered `ask` for branches with MERGED rows. No juror ran a test.

## Findings all four share

1. **The `all` listing does more than report MERGED rows.** It supplies CLOSED rows and it earns `.list-complete` (and, with the open call, `.list-arrived`). `.list-complete` lets `host_pr_state --ask` read a missing branch as `NONE` with no host call, and `NONE` on a no-ref branch reads `open`, which `--next` hands out. The index can answer MERGED only; it can never earn completeness. The plan names only the MERGED use.
2. **The slice as written fires on no real scan.** "An idle scan over a fully merged store" needs every tracked and plan-named branch to have a MERGED row. Today 10 of 11 remote refs and 11 of 97 plan branches do not, and an unstarted branch never can. #2716 dropped this same shape for its merged listing for this reason.
3. **The unsafe implementation is the natural one.** If the scan feeds index rows to the existing parser, or keeps writing `.list-complete` after it drops the `all` call, a merged branch outside the index's 1,000-PR window (or any branch while the store is `v: 4`) reads `open` and is dispatched again. The plan must state that `.list-complete` and `.list-arrived` come only from a whole host listing in this run, fetched or carried, never from index rows, and test a no-ref branch outside the index that reads `-` or is asked, never `open`.
4. **The live store is `v: 4` against `PR_INDEX_VERSION` 5.** Every lookup answers `ask` until fleetd restarts on current code. The acceptance must name that precondition and use a `ps` sample, because the record has no operation or page count (#2717).
5. **The shell ratchet.** An index read in `plot-fleet-scan.sh` grows shipped shell (about 15–20 commands by estate's estimate), and the plan budgets no offset. Putting the work in `fleet-scan.ts`, which already hands the scan `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE`, adds no shell and fits the layering rule.

## Findings three jurors share

6. **`scanListingCost` prices a GitHub listing at 1 request** (`fleet-scan.ts:113-114`) while it costs about 19 pages, so `listingSpend` cannot stretch it (estate, cost, contradiction). Pricing it in pages is a one-function domain change with no shell and no rule question.
7. **"Ask the host about the rest" does not narrow on GitHub.** The scan already passes every tracked branch, and the GitHub arm uses `--branch` only when exactly one is given, so the residual is either the same 18-page listing (saving 0) or one `pr-state` per branch: about 175 requests/h saved at R = 11 plus about 42 s of scan time, break-even at R = 18 — the N+1 that #216 removed (estate, cost, contradiction; safety names the same cost path).
8. **The better shape is the delta over the carried listing.** A carried whole listing plus `pr-list --state all --since <host watermark − overlap>`, merged in `fleet-scan.ts`, stays a whole host answer, keeps earning `.list-complete`, and saves about 425 requests/h (estate, cost; contradiction notes the plan's own Approach sentence describes it).

## Findings two or fewer jurors share

- **Cost:** on Bitbucket the `all` sweep re-asks the `open` state that the scan drops; removing it saves 25 % of every Bitbucket listing with no index read.
- **Contradiction:** the plan describes three different designs (shrink `all`, remove it, keep only the open call); a scan runs every 5 s and `listingSpend` permits the ~25 listings per hour; the Bitbucket fact "pages 50 per state" is wrong for this call (it sweeps per branch) and #2419 changes the no-branch case.
- **Safety:** an index MERGED row must never overwrite a fresh OPEN row for a reused branch name, or a wave settles on work in review and `allSlicesMerged` can start a delivery; the skip predicate must refuse an empty `TRACKED_BRANCHES`; carried listings need their own tests.
- **Cost and estate:** share one watermark rule with #2716 (`rules/known-pr.ts`) rather than write a second.

## Disagreement: does the delta need a CLAUDE.md paragraph?

- **Contradiction** reads #2716's proposed paragraph ("another consumer needs its own paragraph here") as requiring one, because the delta is a store-plus-delta read.
- **Cost** says it needs none: the carried listing is the scan's own earlier host answer, not the PR index, so completeness stays on host answers and *A Decision Reads The Index* is not engaged.
- **Estate** takes a middle position: an index MERGED read needs no paragraph (the #1022 precedent); a delta does.

The question turns on whether the carried listing counts as "the index". It is a fleetd-held copy of a host answer, distinct from the PR index store. The operator should decide; if in doubt, a short paragraph costs one edit in the same slice.

## Shared blind spot

All four accepted that the scan must list at all on a 5 s beat. None asked whether the cheapest fix is to stop the listing from running about 25 times per hour: finding 6 alone, pricing the listing honestly, would let the existing `listingSpend` controller slow it on a busy account. The plan should weigh that lever first and size the delta's saving after it.
