## Implementation brief — the-fleet-scan-re-reads-all (wave 1: Priced Listing)

- **Plan (canonical):** `docs/plans/2026-10-26-the-fleet-scan-re-reads-all.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2721 merged
- **Branch:** `bug/the-scan-listing-is-priced-in-pages` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 (`feature/the-scan-listing-is-a-host-delta`) and wave 3 (`bug/the-bitbucket-sweep-asks-open-once`) both wait on this branch. Keep the change small and the signature stable: they build on it.

### What to build

On 2026-10-26 the repository held 1,767 PRs. The scan's GitHub listing is `pr-list --state open --rich` plus `pr-list --state all --limit 3000`, about 19 requests (`gh pr list` pages at 100 rows). `scanListingCost` (`packages/fleet/src/shared/fleet-scan.ts:113`) prices it at 1, so `listingSpend` computes an interval of 5–40 s, shorter than the scan's own ~2 min period. The listing runs on almost every scan, about 25 per hour, and the cadence controller never sees its real price.

This slice prices a GitHub listing at `1 + max(1, ceil(rows / 100))` requests. `rows` is the count of branch lines in the last adopted listing (`state.listing`, adopted at `fleet-scan.ts:430-433`), counted by a new function beside `listedBranchCount` (`:125`) that reads the carried listing and skips dotted notes (`.branches`, `.list-complete`, …). Before the first adopted listing the count is unknown and the price is 2; the first listing is always permitted (`listing-spend.ts:79`), so that price decides nothing. The Bitbucket arm does not change here (slice 3 owns it). The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**This slice does not cut idle spend, and the plan says so.** At 19 requests the base interval is 5 s × 19 = 95 s and the ceiling is 8 × 95 s = 760 s. The stretch target is `share / (share − others)` with `share` = 720 per hour (`cadence.ts:134`); the record reads ~618 lines per hour on an idle night, below 720, so `others` is 0, the stretch stays 1, and 95 s is shorter than the scan's ~2 min period. The listing count does not change on a quiet account. The saving (~385 requests per hour) appears only when the record exceeds ~720 lines per hour, and reaches the ceiling at ~1,440. The idle saving is slice 2. Do not "fix" the quiet-account figure here by lowering `REFRESH_MS` or raising the stretch: `MAX_CADENCE_STRETCH` is 8 on purpose (`cadence.ts:32`).

**Count branch lines, not PRs.** The carried listing collapses reused branch names to one line, so the count is at most the row count and the price errs low by the number of reused names. Accepted: the alternative needs a host call or a new field in the scan's report, which is shell.

**The record counts lines, the cost counts requests** (#2717). The stretch therefore acts later than the requests justify. The plan leaves the record to #2717 and ships this slice without it (open question 5, operator to confirm). Do not touch the record.

**`scanListingCost` is also re-exported by `packages/board/src/server/fleet.ts:123`.** It is a re-export only. If the signature gains a parameter (rows), update the call at `fleet-scan.ts:381` and check the board re-export still typechecks.

Carried-over rules: absent is not false — an unknown row count is "2", never 0, and a listing with no `.branches` note must not read as empty. Domain-style code is arrows with factual TSDoc and no decision history in comments.

### Done when

The plan's Slice 1 test list is the specification:

- `scanListingCost('github', …)` answers `1 + max(1, ceil(rows / 100))` for 0, 1, 100, 101 and 1,767 rows. Catches an off-by-one at the page boundary (100 rows is 1 `all` page, 101 is 2) and a 0-row listing priced at 1.
- The row count skips dotted notes. Catches counting `.branches` and `.list-complete` as PRs.
- `listingSpend` with a cost of 19 answers a 95 s interval with no rate and 760 s at the ceiling. Catches a cost that is computed but never reaches the controller.

Acceptance (state it in the PR, measured with fleetd on this slice's code): listings per hour from a `ps` sample (count of `pr-list --state all` processes over 30 minutes) with the record's lines per hour in the same window. On a quiet account the count stays near 25 per hour; the unit test proves the stretch at the ceiling. Do not claim an idle saving.

Plus: a changeset for package `plot` with the plan's Changelog line 1 as the description (description first, `bumps:` block last if any; `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite locally, and not `test:e2e`. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice needs no shell.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. Append `→ #<number>` to this branch's line under `### Priced Listing` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `scanListingCost` and the new row-count function in `packages/fleet/src/shared/fleet-scan.ts`, the one call site that passes the count, and their tests (`packages/fleet/test/unit/fleet-scan.test.ts`, `listing-spend` tests).

Not this branch: the delta read and `rules/scan-listing.ts` (wave 2), the `settled` state word and the Bitbucket arm (wave 3), `plot-fleet-scan.sh`, and the record in #2717. In flight elsewhere: #2716 (`an-idle-board-and-fleetd-spend`, `registryd-main.ts` and `rules/known-pr.ts`) is separate code.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
