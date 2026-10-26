## Implementation brief — read-merged-prs-from-the-merge (wave 1: Paged Bitbucket Listing)

- **Plan (canonical):** `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` on `main`
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2419 merged
- **Branch:** `bug/a-bitbucket-listing-reads-every-page` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 of 3. `bug/the-merge-walk-reads-the-whole-log` and `bug/impl-status-asks-merged-prs-by-branch` wait on this wave's merge.

### What to build

On Bitbucket, `plot-host.sh pr-list --state merged --limit 1000` returns 50 rows and prints *possibly truncated*. Measured 2026-10-23 on ewz-kus-portal, and again 2026-10-26: 3527 merged PRs, the first page sorted by `updated_on` descending. `bb_state_listing` (`plot-host.sh:1393`) reads one page of `pagelen=50` per state and never follows `next`. The exit is 0, so `scripts-shell.ts:99` maps it to `answered` and the index writes `complete: true`. A merged PR outside the newest 50 then reads as no PR.

Make `bb_state_listing` follow `next` through `_bb_paged_walk` (`plot-host.sh:1132`) in a row-limit mode, until it holds `--limit` rows or a page has no `next`. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**No second page loop.** `_bb_paged_walk` already holds the page-2 failure rule (fails the whole state, prints no partial array) and the refusal of a `next` outside `BB_API_BASE`. A copy adds commands, and `check-shell-lines.sh` stores no allowance. Add a row-limit mode to the walk instead.

**Exit 0 at the limit, not exit 3.** The walk's header (`:1097-1103`) says a walk stopped by its page cap returns 3. In row-limit mode the caller got the rows it asked for, so the walk exits 0, prints no line of its own, and `pr_list_report_truncation` prints *possibly truncated* (the GitHub arm does the same, `:4735-4736`). Without a row limit the walk keeps `BB_BRANCH_QUERY_PAGE_CAP` (20) and exit 3, so `bb_branch_query` and `pr-review` do not change. The slice rewrites the header to name the departure.

**Truncation signal for a non-multiple of 50.** The walk writes the `next` reading of the page where it stopped to `BB_LIST_NEXT_FILE`, and `1` when it trimmed that page. Otherwise `--limit 120` ends mid-page 3 and `pr_list_report_truncation` (`:3262-3265`, which compares no row count with the limit) prints *page complete*.

**Exit 7 keeps one meaning**: a state did not answer. A page that fails after page 1 fails its state with the host's own code. Do not use exit 7 for a short listing.

**A partial full read must not repeat every 180 s.** After paging a full read costs up to 24 requests. `prFullReadFailedAt` is unset for a partial answer (`pr-refresh.ts:1530`, `:1811`), so a failing state would cost 24 requests per refresh against 3. Record `prFullReadFailedAt` for a partial full read, take the rate-limit back-off when the missing state was throttled, and make `prWindowFor` (`rules/pr-index.ts:384-414`) read the failure grace before it returns a full read for an incomplete store. `PR_REQUESTS_PER_REFRESH.bitbucket` stays 3; declaring 24 would stretch every refresh to 24 minutes.

**The queue keeps 500 on GitHub and asks 50 on Bitbucket** (`registryd-main.ts:791`), chosen by `host.backend()`. A 500-row Bitbucket ask would cost 10 requests per 60 s tick. Lowering GitHub to 50 is rejected: it breaks the #707/#710 fix recorded at `registryd-main.ts:784-789`.

**`readMerged` bounds the review-bypass reads** (`packages/board/src/server/entry/review-bypass.ts:42-63`): skip a PR whose `mergedAt` is before `since` before it calls `prReview`. Without it, §20a goes from about 151 to about 1510 requests per run. On Bitbucket `mergedAt` is `updated_on`, never earlier than the merge, so the skip drops no PR merged after `since`.

**Supersedes #2400.** `plot-host-bitbucket-pr-list-reads` is Delivered on main with no code (PR #2422 carried only its claim; #2713 re-delivered it). Do NOT edit its plan file. The changeset description states that this slice supersedes it.

**Rules carried over unchanged:** the index never says no (a missing row is not `pr: 'none'`); the host's `mergedAt` decides "did this land", never ancestry; read the exit code, not the emptiness of stdout; `pr-refresh.ts` is the one writer of the index.

**Out of scope:** subject rows in the index (`PR_INDEX_VERSION` stays 5), the HTTP 429 "state unknown" note, a state above `PR_LIMIT` recording `complete: true` (an open point for the operator).

### Done when

The plan has no `## Done when` section; the specification is the slice's line and Changelog line 1: on Bitbucket, `pr-list` follows `next` up to `--limit`. Tests the plan names, each catching a naive pass:

- `test/reconcile/host.test.mjs`, Bitbucket stub: 120 merged rows on 3 linked pages with `--limit 1000` print 120 rows, exit 0, *page complete*. Always-`next` pages stop after 2 pages for `--limit 100`, exit 0, *possibly truncated*. 3 pages and no `next` on page 3 with `--limit 120` prints 120 rows and *possibly truncated* (catches the non-multiple-of-50 trim). HTTP 429 on page 2 of merged makes `--state all` exit 7, print open and declined rows and no merged row, and name `merged` missing (catches a half-array). No `--limit` asks one page. `bb_branch_query` at its page cap still exits 3 (catches a walk change that leaks).
- `test/reconcile/fleet.test.mjs`: a Bitbucket scan with no tracked branch writes `.list-complete` when both calls print *page complete* across pages, and none when a state prints *possibly truncated* at `PLOT_PR_LIST_LIMIT` (`plot-fleet-scan.sh:1262-1274`).
- `packages/fleet`: with `prIndexRows` returning `[]`, GitHub's queue asks `prList('merged', 500)` and a predecessor merged as the 51st reads merged; Bitbucket's asks 50 and an older predecessor stays held; a partial full read whose merged state got 429 makes the next refresh inside the grace ask a delta.
- `packages/board`: `readMerged` with `since` calls `prReview` only for PRs merged after `since`.
- Comments this change makes false are rewritten: `plot-host.sh:1380-1388`, `:3153-3156`, `:3186-3191`, `pr-refresh.ts:235-241`, `registryd-main.ts:784-789`, `queue-reading.ts:325-330`, and `listingPagingFor` (`adapters/host/listing-paging.ts:19-31`). State whether Bitbucket's kind becomes `honours-limit`, and keep `packages/domain/corpus/listing-page.corpus.test.ts` (it pairs `pagePossiblyTruncated` with `pr_list_report_truncation`) in agreement. Read `listing-paging.ts` and `rules/listing-page.ts` first.

Plus: add a changeset (description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-host.sh`: pay for growth in the same change. The plan's offset is the removed `bitbucket ignores --limit` notice (`:4771`, 4 commands) and the one-page `bb api` call and `next` reading (`:1403-1404`). Report before and after from `check-shell-lines.sh --per-file`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line under `### Paged Bitbucket Listing` in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-host.sh` (`bb_state_listing`, `_bb_paged_walk`, `pr_list_report_truncation` callers), `packages/fleet/src/shared/pr-refresh.ts`, `registryd-main.ts`, `queue-reading.ts`, `packages/domain/src/rules/pr-index.ts` (`prWindowFor`), `adapters/host/listing-paging.ts`, `packages/board/src/server/entry/review-bypass.ts`, and their tests.

Not yours: `plot-fleet-scan.sh:472` and the merge-walk caps (wave 2), `plot-impl-status.sh` and `skills/plot-deliver/SKILL.md` (wave 3). Other branches in flight on the PR index: `bug/the-pr-index-keeps-checks-pending` (`pr-refresh.ts`), `feature/one-pr-reader-per-machine-and`, `feature/pr-reader-lock-elects-one-writer` — check their diffs for `pr-refresh.ts` overlap before editing the same block.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
