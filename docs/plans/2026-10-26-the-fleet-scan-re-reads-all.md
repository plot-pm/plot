# The fleet scan re-reads all PRs every two minutes

> fleetd's scan lists every PR of the repository, merged ones included, about 25 times per hour, and the cadence rule prices that listing at 1 request while it spends about 19. This plan prices the listing at the requests it spends, then replaces the whole GitHub listing with the last whole listing plus a host delta since its watermark, and stops the Bitbucket sweep from asking the `open` state twice.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2720
- **Rounds:** 1
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2721 merged
- **Started:** 2026-10-26, Jan Wloka, `bug/the-scan-listing-is-priced-in-pages`
- **Started:** 2026-10-26, Jan Wloka, `feature/the-scan-listing-is-a-host-delta`
- **Delivered:** 2026-10-27

## Changelog

- fleetd prices a GitHub scan listing at the requests it spends, one open page plus one page per 100 PRs of the `all` listing, so `listingSpend` can stretch the scan's listing interval on a busy account.
- On GitHub, fleetd reads the scan's PR listing as its last whole listing plus `pr-list --state open --rich` and `pr-list --state all --since <watermark − 60 s>`, with a full read every 24 hours, instead of the whole `--state all` listing on every listing; CLAUDE.md *A Decision Reads The Index* names this consumer.
- On Bitbucket, the scan's second listing sweeps the `merged` and `declined` states only and no longer asks the `open` state that the first listing already answered.

<!-- Board impact: the plan format, the template and the board payload do not change. The scan reading's eleventh field `list_complete` keeps its meaning: it is true only when a whole host listing of this run, fetched or carried, earned `.list-complete`. Slice 2 changes who fetches that listing on GitHub and not what the field says. Slices that change a bundle rebuild it locally only (pnpm build:board) and commit no generated bundle. -->

## Motivation

`plot-fleet-scan.sh:1063` asks `pr-list --state all --limit 3000` after the `--state open --rich` call at `:1047`. On 2026-10-26 the repository held 1,767 PRs (1,711 merged, 3 open), counted with one GraphQL `totalCount` query. `gh pr list` pages at 100 rows (`plot-host.sh:4733`), so the `all` call is about 18 requests and the pair about 19. *Derived from the page count, not measured per call.*

### Cadence

fleetd runs the scan on every 5 s beat (`REFRESH_MS`, `fleet-scan.ts:14`). The scan does not list on every pass: `scanOnce` asks `listingSpend` (`listing-spend.ts:72`) whether a listing is due, and hands a deferred scan the previous listing as `PLOT_PR_LISTING` (`fleet-scan.ts:415`). The interval is `REFRESH_MS × cost × stretch` (`refreshIntervalMs`, `cadence.ts:244-257`), and the stretch is at most 8 (`MAX_CADENCE_STRETCH`, `cadence.ts:32`). `scanListingCost` prices a GitHub listing at 1 request (`fleet-scan.ts:113-114`), so the interval is 5–40 s, shorter than the scan's own period. The listing therefore runs on almost every scan, and the scan's period sets the rate: a `ps` sample on 2026-10-26 (#2715) shows one pair about every 2 minutes, about 25 listings per hour.

### Units

| Unit | Per listing | Per hour at ~25 listings | Basis |
|---|---|---|---|
| Record lines (`budget.tsv`) | 2 (one per `gh` process) | ~50 | measured, #2715 `ps` sample |
| GraphQL requests | ~19 (1 open + ~18 `all`) | ~475 | derived from page count |

The record writes one line per `gh` process and not one per page (#2717), so it shows about 50 lines per hour for about 475 requests. The cost juror of round 1 compared `actual` rate-limit readings with record lines and found 1.4–2.9 points per line.

After #2716, this listing is the largest idle GraphQL spender in requests. #2716 leaves it out of scope and points here.

### Listing uses

The scan uses the `all` listing for three answers (`plot-fleet-scan.sh:1087-1275`):

| Use | Where it decides | Answer after this plan |
|---|---|---|
| MERGED for a branch | `host_pr_state` (`:1309`) → `merged_by_host` (`:1505`), the wave gate, `--next` | From a whole host listing of this run: fetched, or carried and brought up to date by a host delta. |
| CLOSED for a branch | the branch's PR state | The same. |
| Completeness → `.list-complete` (`:1270`, `:1273`) and, with the open call, `.list-arrived` (`:1178`) | `host_pr_state --ask` reads a miss as `NONE` with no host call (`:1346-1351`); without `--ask` a miss reads `NONE` after `.list-arrived` (`:1371-1375`); `NONE` on a no-ref branch reads `open` (`branch-state.ts:269`), which `--next` hands out | Only from a whole host listing of this run, fetched or carried plus a delta, never from PR-index rows. |

`.list-complete` is the dangerous one: written from anything but a whole host listing, it reads a merged branch without a row as `open`, and fleetd dispatches it again.

## Design

### Approach

One design, in three slices: **price first, then delta, then the Bitbucket sweep.**

- **Slice 1 prices the listing.** `scanListingCost` (`fleet-scan.ts:113-117`) prices a GitHub listing at `1 + max(1, ceil(rows / 100))` requests: the open page plus the pages of the `all` call. `rows` is the count of branch lines in the last adopted listing (`state.listing`, adopted at `fleet-scan.ts:430-433`), counted by a function beside `listedBranchCount` (`:125`). It reads the carried listing and needs no shell. Branch lines collapse reused branch names, so the count is at most the row count and the price errs low by the number of reused names. Before the first adopted listing the count is unknown and the price is 2; the first listing is always permitted (`listing-spend.ts:79`), so that price decides nothing. The Bitbucket arm does not change in this slice.
- **Slice 2 reads a delta.** On GitHub, fleetd makes the scan's listing reads itself, through the host port, and hands the result to the scan as `PLOT_PR_LISTING`, the path the scan already trusts (`carried_listing`, `plot-fleet-scan.sh:893-937`). A full read is `pr-list --state open --rich` plus `pr-list --state all`. A delta read is `pr-list --state open --rich` plus `pr-list --state all --since <watermark − 60 s>`, folded over the last whole listing. The watermark is the newest host `updatedAt` of the rows of the last whole listing; the plain GitHub row carries it (`plot-host.sh:4734-4738`). fleetd makes the full read too, because the delta's `since` must be a host stamp, and the scan's report carries none (`report_listing`, `plot-fleet-scan.sh:955-987`); adding one would be shell. fleetd makes a full read when it holds no whole listing, when the last full read is older than `PR_FULL_READ_MS` (24 h, `pr-refresh.ts:331`), and whenever the rule refuses a delta. Bitbucket keeps the scan's own sweep, because the sweep needs the scan's tracked branches (`TRACKED_BRANCHES`, `plot-fleet-scan.sh:766`).
- **Slice 3 trims the Bitbucket sweep.** `bb_states_for all` is `open merged declined` (`plot-host.sh:2538`), and with tracked branches each state sweeps one request per branch (`plot-host.sh:4779`). The scan drops the `all` payload's OPEN rows (`plot-fleet-scan.sh:1089`), so the `open` sweep of the second call costs B requests per listing for rows nothing reads. The slice adds a `settled` state word to `pr-list`: on Bitbucket it sweeps `merged` and `declined`; on GitHub it asks `--state all`, because GitHub answers `all` in one listing and the scan already drops its OPEN rows. The scan's second call asks `--state settled`. `scanListingCost`'s Bitbucket arm, `branches × 3`, then matches the spend exactly: B for the open sweep plus 2B for the settled sweep. Today the spend is 4B.

### Rules

- **The decision is a pure domain rule.** A rule in `packages/domain/src/rules/scan-listing.ts` takes the last whole listing (or none), its watermark, when its full read happened, and now, and answers `full` or `delta` with a `since` stamp. A second function folds the two new answers over the carried listing, or refuses. `fleet-scan.ts` calls both and decides nothing itself.
- **One watermark rule.** `since` is the watermark minus 60 s in the host's own spelling, through the function #2716 adds to `rules/known-pr.ts`. If #2716 keeps that arithmetic inside its store rule, slice 2 exports it as one function both callers use. It writes no second copy.
- **The fold.** OPEN rows come only from the new open call; every carried OPEN row is dropped first, as the full read drops the `all` payload's OPEN rows (`plot-fleet-scan.sh:1089`). Non-OPEN rows are the carried rows plus the delta's rows, ranked per branch as the scan ranks them: OPEN, then MERGED, then the rest (`plot-fleet-scan.sh:1145-1146`). A reused branch name with a new open PR keeps OPEN over an older MERGED row.
- **The markers.** `.list-arrived` and `.list-complete` come only from a whole host listing in this run: a full read, or the carried listing plus a delta. Never from PR-index rows. The folded listing carries `.list-arrived` only when both new calls answered `ok`. It carries `.list-complete` only when the carried listing carried it and both new calls claimed their pages whole (`page complete`, `plot-host.sh:3281`, read through `pr-status.ts:57`).
- **A refused delta is a full read.** The fold refuses, and fleetd makes the full read, when a new call fails or answers `partial`, when a call makes no whole-page claim, when the watermark is missing or does not parse, and when a carried OPEN row is in neither the new open call nor the delta. If the full read also fails, fleetd hands no listing, and the scan lists as it does today.
- **The PR index is not read.** No slice reads `.plot/state/index/github.json` or `board/plot-pr-index-lookup.mjs`. The carried listing is fleetd's copy of its own host answers, not the index. The `v: 4` store precondition of round 1 therefore does not apply.
- **The fold duplicates the scan's parse.** The key encoding (`_` → `__`, `/` → `_`) and the rank in the fold answer the same question as `prefill_pr_states` (`plot-fleet-scan.sh:1140-1146`). Slice 2 declares the pair in a corpus test under `packages/domain/corpus/`: one full-read payload through both gives the same listing lines.

### Expected spend

| Slice | Listings per hour | Requests per hour | Saving | Basis |
|---|---|---|---|---|
| Today | ~25 | ~475 | — | listings measured, requests derived |
| 1, quiet account | ~25 | ~475 | ~0 | derived |
| 1, busy account at the ceiling | ≤ 4.7 | ≤ 90 | up to ~385 | derived |
| 2 | ~25 delta + 1 full per 24 h | ~50 + ~19 per day | ~425 | derived |
| 3 (Bitbucket) | unchanged | 3B instead of 4B per listing | 25 % of each listing | derived; B not measured on a Bitbucket estate |

**Slice 1 in detail.** At 19 requests per listing the base interval is 5 s × 19 = 95 s and the ceiling is 8 × 95 s = 760 s. The stretch target is `share / (share − others)` with `share` = 720 per hour (`cadence.ts:134`), and `others` is the record's rate minus fleetd's own derived spend at its current interval (`cadence.ts:97-101`). The record reads about 618 lines per hour on an idle night (#2716), below 720, so `others` is 0, the stretch stays 1, and the interval is 95 s, shorter than the scan's period of about 2 minutes, so the listing count does not change. The stretch acts only when the record exceeds about 720 lines per hour, and it reaches the ceiling at about 1,440: then at most 3,600 / 760 ≈ 4.7 listings per hour, about 385 requests per hour fewer. The record counts lines while the cost counts requests (#2717), so the stretch acts later than the requests justify. Slice 1 makes the controller see the listing's real price; the idle saving comes from slice 2.

**Slice 2 in detail.** A delta listing is 1 open page plus 1 delta page; under 100 PRs change between listings. Priced at 2 by slice 1's rule, its base interval is 10 s, so it runs on every scan, about 25 per hour, while the scan's period stays near 2 minutes. That is about 50 requests per hour plus one 19-request full read per 24 hours, against about 475.

### Tests

- **Slice 1:** `scanListingCost('github', …)` answers `1 + max(1, ceil(rows / 100))` for 0, 1, 100, 101 and 1,767 rows; the row count skips dotted notes. `listingSpend` with a cost of 19 answers a 95 s interval with no rate and 760 s at the ceiling.
- **Slice 2, rule:** `full` with no carried listing, a missing or unparseable watermark, or a full read older than 24 h; `delta` with `since` = watermark − 60 s otherwise.
- **Slice 2, fold:** a reused branch name with an OPEN row from the open call and an older MERGED row keeps OPEN. A carried OPEN row that moved to MERGED appears as MERGED from the delta. A carried OPEN row in neither new answer refuses the fold. A failed or partial delta, or one without a `page complete` claim, refuses the fold and fleetd makes the full read. A carried listing without `.list-complete` yields none.
- **Slice 2, scan:** a listing folded from a delta and handed in as `PLOT_PR_LISTING` gives the same readings as the fetched listing it equals. A no-ref merged branch that no listing names reads `-` or is asked, never `open`, when the handed listing carries no `.list-complete`. With no listing handed in, the scan makes both calls as today.
- **Slice 2, corpus:** one full-read payload through the fold and through `prefill_pr_states` gives the same listing lines.
- **Slice 3:** `bb_states_for settled` answers `merged declined`; the GitHub arm asks `--state all` for `settled`. A settled sweep with every state answered prints the sweep claim, and with one failed state prints none and the scan writes no `.list-complete`. An empty tracked set prints no sweep claim. The open sweep's claim and the settled sweep's claim together license `.list-complete` as the `all` sweep's did.

### Acceptance

Measured with fleetd on the slice's code, and stated per listing.

- **Slice 1:** listings per hour from a `ps` sample (count of `pr-list --state all` processes over 30 minutes), with the record's lines per hour in the same window stated. On a quiet account the count stays near 25 per hour. A unit test proves the stretch at the ceiling.
- **Slice 2:** a 200 s `ps` sample before and after. Before: every listing shows `pr-list --state all --limit 3000` without `--since`. After: every listing shows `pr-list --state all --since …`, and a `--state all` call without `--since` appears at most once per 24 hours. `gh api rate_limit` `graphql.used` sampled at the start and end of one hour, before and after: the after figure is lower by about 400 points per hour.
- **Slice 3:** on a Bitbucket repository with B tracked refs, a `ps` sample shows the second call as `--state settled`, and the sweep claim on its stderr reads `2 of 2 states answered`. The requests per listing fall from 4B to 3B.

### Changesets

Each slice adds a changeset for package `plot`, with its Changelog line as the description.

### CLAUDE.md

Slice 2 adds one paragraph to *A Decision Reads The Index*, next to the paragraph #2716 adds, and runs `./scripts/check-agents-md.sh --write`:

> **A carried listing plus a host delta is a whole host answer.** fleetd's scan listing (`scanOnce`, `packages/fleet/src/shared/fleet-scan.ts`) on GitHub folds `pr-list --state open --rich` and `pr-list --state all --since <watermark − 60 s>` over its last whole listing, where the watermark is that listing's newest host `updatedAt`, and hands the result to `plot-fleet-scan.sh` as `PLOT_PR_LISTING`. The result may carry `.list-complete` only when the carried listing carried it and both new calls claimed their pages whole; anything else is a full read. This consumer reads no PR-index row: `.list-complete` and `.list-arrived` come only from host listings.

#2716 and #2386 also edit this section. The slice that lands later rebases its text onto the earlier one.

### Open Questions

- [x] Which shape asks the host less? — The delta over the carried listing, after pricing the listing. Operator decision 2026-10-26. On GitHub "the branches the index lacks" does not narrow: the scan already passes every tracked branch (`plot-fleet-scan.sh:1036-1037`), and the GitHub arm uses `--branch` only when exactly one is given (`plot-host.sh:4488`).
- [x] Does the Bitbucket arm support the shape? — Bitbucket does not page 50 per state for this call: with tracked branches it sweeps per branch per state (`plot-fleet-scan.sh:1027-1034`). #2419 changes the no-branch case to follow `next` up to `--limit`. Slice 3 trims the sweep; the delta is GitHub-only.
- [x] Does a fallback need a visible note? — Not applicable. The plan reads no PR index, so no store-version fallback exists. A refused delta is a full read, which the `ps` sample shows.
- [x] Does this plan wait for #2716? — Separate code: #2716 changes `mergedBranches` (`registryd-main.ts:780`), this plan changes the scan listing. They share the watermark function and the CLAUDE.md section.
- [ ] Does slice 1 wait for #2717? — The stretch compares a record in lines with a cost in requests, so it acts later than the requests justify. The plan leaves the record to #2717 and ships slice 1 without it. Operator to confirm.

## Slices

### Priced Listing

- `bug/the-scan-listing-is-priced-in-pages` — `scanListingCost` prices a GitHub listing at `1 + max(1, ceil(rows / 100))` requests from the carried listing's branch lines, and a test states the 95 s base and 760 s ceiling at 19 requests → #2734

### Listing Delta

- `feature/the-scan-listing-is-a-host-delta` — on GitHub fleetd reads the scan listing as a full read or as the carried whole listing plus `pr-list --state open --rich` and `pr-list --state all --since <watermark − 60 s>`, through a pure rule in `rules/scan-listing.ts` that writes the markers only from host listings and answers a full read on any doubt, with a corpus test, the CLAUDE.md paragraph and the regenerated `AGENTS.md` <!-- waits: bug/the-scan-listing-is-priced-in-pages, feature/the-tick-reads-merged-prs-as-an-index-delta --> → #2744

### Bitbucket Settled Sweep

- `bug/the-bitbucket-sweep-asks-open-once` — `pr-list` gains the `settled` state word (Bitbucket `merged declined`, GitHub `all`), the scan's second call asks it, and `scanListingCost`'s Bitbucket arm states the open plus settled sweeps; the slice removes as many shell commands as it adds, measured by `scripts/check-shell-lines.sh` <!-- waits: bug/the-scan-listing-is-priced-in-pages --> → #2777

## Notes

- Related plans: `2026-10-26-an-idle-board-and-fleetd-spend` (Approved, #2716) reads fleetd's tick merged set as the index plus a delta and adds the watermark function. `2026-10-23-one-pr-reader-per-machine-and` (Approved, #2386) gives the boards one reader of the host. #2419 (Approved) changes the Bitbucket no-branch listing. `2026-10-16-fleetd-scan-cost-and-read-cadence` (Released, #1845) cut other scan reads.
- Panel round 1 (unanimous amend) found that the first slice, which read MERGED rows from the PR index in `plot-fleet-scan.sh`, fires on no live scan: 10 of 11 remote refs and 11 of 97 plan branches had no MERGED row. Its natural build writes `.list-complete` from index rows and re-opens merged work. The operator replaced it on 2026-10-26 with this design. The branch `feature/the-idle-scan-reads-merged-prs-from-the-index` never started.
- Considered for slice 3: one `pr-list --state all --rich` call in place of the scan's two. The GitHub arm already splits it into the same two requests (`plot-host.sh:4538-4556`), but the Bitbucket rich arm's cost on terminal rows is not measured, so slice 3 adds the state word.
- Created unattended from issue #2720. The plan writes nothing to the tracker.
- Cited lines verified on `origin/main` at `cc5c7a1d5`.
