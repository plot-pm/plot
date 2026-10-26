# Bitbucket: an old merged PR stops reading as no PR

> On Bitbucket the host lists one page of 50 PRs per state, and Plot reads that page as the whole answer. This plan makes the Bitbucket listing follow every page up to the caller's limit, makes the wave gate read up to 20 000 merges, and makes `/plot-deliver` step 4 ask the host about each unresolved branch by name. The *state unknown* note on three July plans on ewz-kus-portal comes from HTTP 429 (#333), and this plan leaves it out of scope.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2385
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- On Bitbucket, `plot-host.sh pr-list` follows `next` up to the caller's `--limit` instead of reading one page of 50 PRs per state, so a merged PR outside the newest 50 of its state stops reading as no PR, and the PR index holds up to 1000 PRs per state.
- The fleet scan reads up to 20 000 merges of the default branch instead of 2000, so on a repository with 2000 to 20 000 merges the scan footer no longer reports *merge scan hit its limit*.
- `/plot-deliver` step 4 (`plot-impl-status.sh`) asks the host about its unresolved, un-annotated branches by name in one `pr-list` call, so on Bitbucket it reports a merged PR older than the newest 500 merged PRs with its number.

<!-- Board impact: slice 1 fills a Bitbucket board's PR index with up to 1000 PRs per state instead of 50, so a branch whose PR is older than the newest 50 of its state shows its PR. Exit codes do not change, so the board shows no new PR status line. Slice 2 removes the scan footer's *merge scan hit its limit* note on an estate with 2000 to 20 000 merges. The *state unknown* note on the three July plans in Motivation comes from HTTP 429 and does not change. No plan format, template or docs/plans layout change. -->

## Motivation

Measured 2026-10-23 on ewz-kus-portal (Plot 2.28.0, bb 1.11.2): `plot-host.sh pr-list --state merged --limit 1000` returns 50 rows and prints *"possibly truncated (50 rows, requested limit 1000 unprovable)"*. Three Delivered July plans show under *Not started* with *state unknown — the host's answer is incomplete*, while the board keeps hitting HTTP 429 (#333).

Read on `origin/main` at `b2df79eaf` (2026-10-26), the short listing is read as a whole one:

- `bb_state_listing` (`plot-host.sh:1393-1406`) asks one page of `pagelen=50` per state and never follows `next`.
- `pr_list_report_truncation` (`plot-host.sh:3250`) prints *possibly truncated* on stderr and returns 0. `pr_list_states` returns 0 when every state answered (`plot-host.sh:1544`).
- `scripts-shell.ts:99` maps exit 0 to `answered`. `answerKind` (`rules/pr-index.ts:90-95`) then returns the window's kind, a full read folds as `whole`, and `wholenessAfter` writes `complete: true` (`rules/pr-index.ts:268-269`).
- The Delivered plan `bitbucket-and-github-listings-read-one` (#2484) made `bb_branch_query`, `pr-merged-heads` and the `pr-review` arm follow `next`. It did not change `bb_state_listing`.
- #2400 (`plot-host-bitbucket-pr-list-reads`) planned to page `bb_state_listing` through `bb pr list --all`. It was delivered with no code on 2026-10-26: PR #2422 merged at 14:19:47Z holding only its claim and the blocker commit `f576060de`, and `b2df79eaf` delivered it. This plan's slice 1 now does the paging.

Measured 2026-10-26 on ewz-kus-portal (read-only `bb api` GET, bb 1.11.2): the unfiltered listing holds 10 open, 3527 merged and 147 declined PRs (`size` at `pagelen=1`). The first `state=MERGED&pagelen=50` page is sorted by `updated_on`, newest first, and not by PR number: PR #3725 down to #3678, oldest `updated_on` 2026-10-02.

Delivery has the same gap. For a branch the PR index cannot answer, `plot-impl-status.sh:269` asks `pr-list --state merged --limit 500`. On Bitbucket that call returns one page of 50 rows.

The merge log is not the fix for the three July plans. Measured 2026-10-26 on ewz-kus-portal (read-only, `origin/develop` as fetched 2026-10-23): the Delivered plans `ewzkus-3518-invoice-aggregation`, `ewzkus-3711-sammelrechnungen-anzeige` and `ewzkus-3712-liegenschaft-suche` name slice PRs #3488, #3489 and #3490. No merge subject on `origin/develop` names these PRs or their branches. Their commits landed linearly on an integration branch, which merged as #3491. All 11 slice branches of the July plans have no ref on origin, so the scan reads them in the refless arm (`branch-state.ts:238-268`). That arm answers `unknown` only while the host is throttled (`branch-state.ts:259-267`). The *state unknown* note on those plans therefore comes from HTTP 429.

A Bitbucket merge commit carries the subject `Merged in <branch> (pull request #N)`. On ewz-kus-portal, `git log origin/develop --merges` reads 2340 merges in 0.02 s, and the scan's walk stops at 2000 (`plot-fleet-scan.sh:472`).

## Design

### Approach

1. **The Bitbucket listing follows `next`.** `bb_state_listing` asks `bb api` with `pagelen=50` and follows each page's `next` link, the way `_bb_paged_walk` (`plot-host.sh:1132`) and `bb_window_listing` (`plot-host.sh:1309`) already do. It stops when it holds `--limit` rows or a page has no `next`, so the page cap is `ceil(limit / 50)`. A call with no `--limit` reads one page, as today. The last page's `next` reading goes to `BB_LIST_NEXT_FILE` as today, so `pr_list_report_truncation` prints *page complete* for a state that ends before the limit and *possibly truncated* for a state that reaches it. The `bitbucket ignores --limit` notice (`plot-host.sh:4771`) goes.
2. **Exit codes keep their meanings.** A walk that reaches the limit exits 0 with the *possibly truncated* line, which is what the GitHub arm does at its limit (`plot-host.sh:4735-4736`). A page that fails after page 1 fails its whole state with the host's own exit code and prints none of that state's rows, as `_bb_paged_walk` does. `pr_list_states` then counts that state as failed: exit `PR_LIST_PARTIAL_RC` (7, `plot-host.sh:935`) when another state answered, and the failure's own code when none did. That is the meaning `plot-host.sh:960-970` already documents. The refresh folds exit 7 as `partial`, and `wholenessAfter` writes `complete: false` (`rules/pr-index.ts:268`).
3. **The queue asks one page.** `registryd-main.ts:791` asks `prList('merged', 500)` on every 60 s tick (`registryd.ts:80`). After step 1 that costs 10 Bitbucket requests per tick. Slice 1 lowers it to 50. The index's MERGED rows join the queue's set on every pass (`queue-reading.ts:325-332`), and after step 1 the index holds the newest 1000 PRs of each state on both hosts.
4. **The wave gate reads up to 20 000 merges.** `MERGE_SCAN_LIMIT` (`plot-fleet-scan.sh:472`), `MERGE_WALK_LIMIT` (`registryd-main.ts:599`) and the corpus default `readMergeSubjects(…, limit = 2000)` (`packages/domain/corpus/production.ts:286-290`) rise from 2000 to 20 000. The scan keeps its saturation report (`plot-fleet-scan.sh:481-483`). `registryd-main.ts` has no saturation report, and this plan adds none: at 20 000 the cap is 8.5 times the largest measured log. The walk feeds the wave gate only, and its reading is never written to the PR index.
5. **Step 4 asks by name, once.** `plot-impl-status.sh:263-271` passes every un-annotated branch that the index could not answer as a repeated `--branch` to its one `pr-list --state merged --limit 500` call. On Bitbucket, `--branch` runs `bb_branch_sweep` (`plot-host.sh:1222`): one `bb_branch_query` per branch, each following `next` since #2573. On GitHub, one branch maps to `--head` (`plot-host.sh:4488`), and several branches keep the listing. The helper stays one call per plan, as its header states (`plot-impl-status.sh:251-253`).

### Deliver Gate Overlap

The deliver controller already asks the host by name: `deliverabilityOf` (`controllers/deliverability.ts:182`) calls `Host.prMerged` for each branch the index cannot answer, and `plot-host.sh pr-merged` follows `next`. The gate therefore finds an older merged PR today. Slice 3 changes the step-4 report only.

Slice 3 keeps a shell lookup, for two reasons:

- Step 4 reports PR numbers. Step 5's jurors diff each PR, and the optional back-fill writes `→ #N` (`skills/plot-deliver/SKILL.md:124-150`). `plot-ask.mjs deliverable` returns `merged`, `unmerged` and `deferred` and no PR number (`DeliverabilityAnswer`, `controllers/deliverability.ts:14-38`).
- The slice adds no rule. The host's `MERGED` answer decides, as today and as *One Answer To "Did This Land"* requires. The slice changes which host query the existing lookup sends.

The duplicate is the host request, not a rule: on Bitbucket a delivery asks each unresolved branch twice, once in step 4 and once in the controller. Cost counts both.

### Merge-Subject Rows

This plan writes no merge-subject row into the PR index, and `PR_INDEX_VERSION` stays 5 (`entities/pr-index.ts:12`). Three facts decide it:

- *Answers, never verdicts* (CLAUDE.md, *A Decision Reads The Index*): the index holds bought answers. A merge-subject reading costs 0.02 s of local git on the largest measured estate, so a stored copy is a cache that git can reach.
- Every reader of a terminal row decides something destructive or feeds such a decision. `pr-index-lookup-answer.ts:61` answers `plot-impl-status.sh` for `/plot-deliver`. `deliverability.ts:167` answers the deliver controller. `merged-desk.ts:33-34` sets desk state in `drop.ts` and `registry.ts`. A subject row in `rows` reaches all three through `isTerminalRow` (`merged-row.ts:17-18`), and `docs/domain/merge-subject.md:53-62` forbids a subject in a destructive decision.
- The three July plans in Motivation left no subject, so subject rows would not answer them.

With no subject rows, the daily `whole` fold (`rules/pr-index.ts:146-154`, `PR_FULL_READ_MS` at `pr-refresh.ts:331`) has no row of this plan to erase. A `whole` fold re-lists every row once per 24 hours, and that fold is the one answer that sees a deleted PR (`rules/pr-index.ts:149-151`).

If the operator wants subject rows in the store regardless, the mechanism is a v6 store with a separate `subjects` array beside `rows`, re-derived by `pr-refresh.ts` on every fold. `rows` keeps its contract, *"exactly what the host answered"*, and no existing reader sees a subject. Open Points hold this decision.

### Cost

Request counts use the ewz-kus-portal sizes measured 2026-10-26: 10 open, 3527 merged, 147 declined. One request reads 50 rows.

| Caller | Limit | Runs | Before | After |
|---|---|---|---|---|
| `pr-refresh.ts:1499`, full read | 1000, `--state all` | once per 24 h (`PR_FULL_READ_MS`), on a cold store, and after a `partial` answer | 3 | 1 + 20 + 3 = 24 |
| `pr-refresh.ts`, delta | `--since` | every 180 s | 3 | 3 (`bb_window_listing` already pages) |
| `registryd-main.ts:791`, queue | 500 → 50, merged | every 60 s tick | 1 | 1 (10 if the limit stayed 500) |
| `plot-reconcile-scan.sh:738` | 500, merged | per operator command | 1 | 10 |
| `plot-impl-status.sh:269` | 500, merged | per `/plot-deliver` | 1 | 10, or 1 per unresolved branch after slice 3 |
| `plot-open-pr.sh:116` | 200, `--state all` | per slice PR opened | 3 | 1 + 4 + 3 = 8 |
| `approve.ts:341,400`, `needs-design.ts:181` | 100 | per approval | 1 each | 1 open, 2 merged |
| `plot-fleet-scan.sh:1047` | 3000, open | per scan | 1 | 1 |
| `plot-fleet-scan.sh:1063` | 3000, `--state all` | only with no tracked branch (`:766`, every remote ref) | 3 | 1 + 60 + 3 = 64 |

- **The daily full read spends 24 requests in one refresh.** `PR_REQUESTS_PER_REFRESH.bitbucket` stays 3 (`pr-refresh.ts:249`). It prices a request that every refresh makes, and the full read runs once in about 480 refreshes. Declaring 24 would stretch every refresh from 180 s to 24 minutes to pay for one call a day. The same rule keeps the pending-check re-ask out of the table (`pr-refresh.ts:194-203`). Per day the refresh spends 1440 + 21 requests instead of 1440.
- **A `partial` full read repeats.** `prWindowFor` (`rules/pr-index.ts:384`) asks a full read while `complete` is false, and a partial answer gets no back-off (`pr-refresh.ts:1781-1792`). While one state keeps failing, every 180 s refresh spends up to 24 requests instead of 3. Open Points hold this.
- **A state above the limit still records `complete: true`.** ewz-kus-portal's 3527 merged PRs exceed `PR_LIMIT = 1000` (`pr-refresh.ts:303`). The walk stops at 1000 rows, prints *possibly truncated*, and exits 0, so the full read folds as `whole`. The store then runs deltas and reads in full once per 24 h, at 24 requests. The GitHub arm does the same at 1000 today. Open Points hold this.
- On Bitbucket, `--rich-open` only sets `rich=1` (`plot-host.sh:4521-4572`). A full read folds mergeability for each `OPEN` row: one `git fetch` per base and one `merge-tree` per open PR (`plot-host.sh:2117-2131`). Paging adds no open row on ewz-kus-portal, where the 10 open PRs fit one page.
- Slice 2: 0 requests. The walk costs 0.02 s at 2340 merges.
- Slice 3: on Bitbucket, one `/plot-deliver` run asks 1 request per unresolved un-annotated branch in step 4, and the controller asks the same branches again through `Host.prMerged`. On GitHub, step 4 stays 1 call.
- The plan buys correct answers, not budget. HTTP 429 relief needs the addendum's watch list, which Scope leaves out.

### Shell Lines

`scripts/check-shell-lines.sh pr` refuses a change that grows shipped shell. Each slice names its offset:

- Slice 1 adds the page loop to `bb_state_listing`. It removes the `bitbucket ignores --limit` notice (`plot-host.sh:4771`, 4 commands) and the one-page `pagelen` call it replaces. If that is not enough, it reuses `_bb_paged_walk` with a page-cap argument instead of a second loop. The slice reports the before and after counts from `check-shell-lines.sh --per-file`.
- Slice 2 changes one number on `plot-fleet-scan.sh:472`: 0 commands.
- Slice 3 replaces the early-exit loop at `plot-impl-status.sh:245-250` with a loop that collects `--branch` arguments, and drops its `break`: 0 or fewer commands.

### Scope

Each point of the #2385 addendum, and where it goes:

| Addendum point | In this plan | Reason |
|---|---|---|
| List and single-PR GET throttled separately | no | The addendum measured it. This plan makes no host call to re-measure it. It motivates the watch list below. |
| One-time paged seed | partly | Slice 1 pages every full read up to `PR_LIMIT`. There is no separate seed: the first full read is the seed. |
| Terminal rows written once, never re-asked | no | A `whole` fold is the only answer that sees a deleted PR (`rules/pr-index.ts:149-151`). Subject rows stay out of the index (above). |
| Open PRs as a watch list over single-PR GET | no | It changes `PR_REQUESTS_PER_REFRESH` (`pr-refresh.ts:205-250`) and so the refresh cadence. That is a cadence decision, and it stays on #2385 for a later plan. |
| One delta page after a fetch brings a new ref | no | `refreshPrs` never fetches. The fetch trigger is #2386 proposal 3, which #2386 leaves unscheduled. |
| Pairing with #2386's single reader | not needed | #2386's slice was deferred on 2026-10-25: PR #2436 closed unmerged, and `one-pr-index-writer.test.ts` refuses a board-side write to the index. This plan adds no index writer and no host reader beside `pr-refresh.ts`. |
| Local `plot-approve` lookup | no | An `OPEN` row is not terminal, and *A Decision Reads The Index* reads only terminal answers. #2407 (Delivered 2026-10-23) fixed the refusal text. |
| Declined PRs as terminal | no | `CLOSED` stays re-asked (`merged-row.ts:4-9`). Whether a declined Bitbucket PR can reopen is unmeasured, and this plan writes no row that depends on it. |

Also out of scope:

- The *state unknown* note on the three July plans. It comes from HTTP 429 (Motivation).
- #2400's window change. #2400 also planned to replace `bb_window_listing` with `bb pr list --updated-since`. `bb_window_listing` already follows `next` and checks the server's `size`, so slice 1 keeps it.
- The branch-with-ref arm (`branch-state.ts:310-325`). On ewz-kus-portal, 9 of 31 origin refs are behind `origin/develop`, and 6 of those 9 are the second parent of a merge. None of them is a July plan's slice branch.

### Open Questions

- [x] **One index or two?** — *answered round 1: neither.* The plan adds no file and no row. `pr-refresh.ts` stays the one writer of the one store.
- [x] **Subject or host for "did this land"?** — *answered round 1: the host.* No subject reaches a destructive decision, and *One Answer To "Did This Land"* stays as it is. The wave gate keeps its subject reading.
- [x] **What does the index store for a subject-derived row?** — *answered round 1: nothing.* See *Merge-Subject Rows*.
- [x] **Overlap with #2400** — *answered round 2:* #2400 was delivered with no code on 2026-10-26. Slice 1 pages `bb_state_listing` through `bb api` and `next`, and does #2400's listing work. It needs no `bb pr list --all` and no agent-skills#98.
- [x] **Overlap with #2386** — *answered round 1:* #2386's slice is deferred, and this plan needs no single reader. See Scope.
- [x] **Squash or rebase merges** — *answered round 1:* a branch with no subject falls through to the host, and the index never answers `none` (`pr-index-lookup-answer.ts:61`). Measured: on Bitbucket a squash commit keeps the `Merged in` subject on a single-parent commit. Open Points hold the walk question.
- [x] **Reused branch names** — *answered round 1:* the age rule is keyed by plan (`merge-subject.md:43`) and does not carry over to a row keyed by PR number. With no subject rows, only the wave gate reads subjects, and it keeps the per-plan rule. Slice 3 has its own reused-name question in Open Points.

## Slices

### Paged Bitbucket Listing

- `bug/a-bitbucket-listing-reads-every-page` — `bb_state_listing` follows `next` through `bb api` until it holds `--limit` rows or a page has no `next`; a call with no `--limit` reads one page. A page that fails after page 1 fails its state with the host's exit code and prints none of its rows. The `bitbucket ignores --limit` notice goes. `registryd-main.ts:791` asks 50 merged rows instead of 500. Files to read first: `adapters/host/listing-paging.ts` (`listingPagingFor`, `envelopeNextFor`) and `rules/listing-page.ts`, which mirror the page rule, and `packages/domain/corpus/listing-page.corpus.test.ts`, which pairs `pagePossiblyTruncated` with `pr_list_report_truncation` and must agree after the change. Shell lines: see *Shell Lines*. Tests: `test/reconcile/host.test.mjs` — a Bitbucket stub with 120 merged rows on 3 linked pages makes `pr-list --state merged --limit 1000` print 120 rows, exit 0 and print *page complete*; a stub whose pages always carry `next` stops after 2 pages for `--limit 100` and prints *possibly truncated*; a stub that answers HTTP 429 on page 2 of the merged state makes `--state all` exit 7, print the open and declined rows and no merged row, and name `merged` as missing; a call with no `--limit` asks one page. `packages/fleet` — a full read whose host answer holds 120 merged rows across pages writes all 120 rows and `complete: true`; the queue's `mergedBranches` asks `prList('merged', 50)`. <!-- builds: a paged Bitbucket listing -->

### Whole Merge Walk

- `bug/the-merge-walk-reads-the-whole-log` — `MERGE_SCAN_LIMIT` (`plot-fleet-scan.sh:472`), `MERGE_WALK_LIMIT` (`registryd-main.ts:599`) and the corpus default in `readMergeSubjects` (`packages/domain/corpus/production.ts:286-290`, read by `branch-state.corpus.test.ts:340,392`) rise to 20 000. The scan's saturation report stays. The comment at `merge-subjects.ts:22-24` states the Bitbucket squash measurement beside the GitHub one, and `merge-subjects.ts:40-41` replaces "a `--merges` walk loses none" with the measured 7 single-parent `Merged in` commits in about 70 clones. `packages/board/src/server/entry/merge-subject.ts:39` says 20 000. Tests: the saturation tests in `test/reconcile/fleet.test.mjs` pass unchanged through the `PLOT_MERGE_SCAN_LIMIT` seam; a test asserts that the scan's default, `MERGE_WALK_LIMIT` and the corpus default are equal. <!-- builds: a 20 000-merge walk for the wave gate -->

### Delivery Lookup By Name

- `bug/impl-status-asks-merged-prs-by-branch` — `plot-impl-status.sh` passes every un-annotated branch that the index could not answer as a repeated `--branch` to its one `pr-list --state merged --limit 500` call. `skills/plot-deliver/SKILL.md:139` says "one `pr-list --state merged` call that names the plan's unresolved branches" instead of "a single bundled `pr-list --state merged` for the whole plan". Shell lines: 0 or fewer, see *Shell Lines*. Tests: `test/reconcile/impl-status-index.test.mjs` — with a Bitbucket stub whose merged listing holds 50 newer rows, a branch merged outside them resolves through the by-name query in one `pr-list` call; a branch with no merged PR stays unresolved, and delivery refuses it; a fully merged plan that the index answers still makes zero host calls. <!-- builds: a by-name merged lookup for plot-impl-status -->

## Notes

- Source: issue #2385, https://github.com/plot-pm/plot/issues/2385. Related: #333 (truncated merged list), #1139 (merged branch from its merge commit), #2400, #2386, #2484, #2407.
- Measurements, 2026-10-26, read-only. ewz-kus-portal `origin/develop`: 2340 merges in 0.02 s (3 runs); 1770 `Merged in` subjects for PR #1795 to #3719; 87 branch names with more than one subject; 0 single-parent commits with a `Merged in` subject. All commits: 16 884, walked in 0.10–0.12 s. Across about 70 local Bitbucket clones: 7 single-parent commits with a `Merged in` subject, in 5 repositories. This repository: 677 merges in 0.014 s (cost juror, 2026-10-23).
- Measurements, 2026-10-26, read-only `bb api` GET on `quatico/ewz-kus-portal` with bb 1.11.2, 5 requests: `size` 10 open, 3527 merged, 147 declined, 0 superseded; the first 50-row merged page runs from PR #3725 to #3678 and is sorted by `updated_on` descending, not by PR number.
- 2026-10-26, panel round 1 revision (`.plot/panels/2026-10-23-read-merged-prs-from-the-merge/panel.md`): no subject row enters the PR index; each addendum point has a row in Scope; the short Bitbucket listing became slice 1; full walk with no cursor; the board sentence left the Changelog.
- 2026-10-26, panel round 2 amendment (`round2-panel.md`): the operator chose that slice 1 pages `bb_state_listing`, because #2400 was delivered with no code. #2400's plan file is unchanged, and its Changelog line names `bb pr list --all`, which is not on main. Slice 1 no longer marks a short listing with exit 7, so the false *host unreachable* line and the callers that drop rows on exit 7 do not arise. Slice 2 names the corpus cap. Slice 3 uses one call with repeated `--branch`.

## Open Points

- [ ] [Scope] Does the operator accept the reshaped scope: no subject rows in the PR index, three bug slices, slice 1 paging the Bitbucket listing, and the addendum out of scope? The alternative is the v6 `subjects` array in *Merge-Subject Rows*. — *decides: the operator, at approval*
- [x] [Technical] Can every `pr-list` caller take exit 7 for a short listing? — *answered round 2: retired.* Slice 1 pages the listing and adds no exit 7. A walk at its limit exits 0, and exit 7 keeps its one meaning, "a state did not answer" (`plot-host.sh:960-970`). Every caller takes that exit today.
- [ ] [Domain] Which merged PR does slice 3 take for a reused branch name? A by-name query returns every merged PR of the name, and ewz-kus-portal holds 87 reused names. Today `merged_pr_for_branch` takes the first listed row (`plot-impl-status.sh:274-277`), and `mergedRowByHead` takes the lowest number (`merged-row.ts:30-33`), so both can pick an earlier attempt. The Bitbucket row fills `mergedAt` from `updated_on`, which moves on a comment. — *decides: whether a Bitbucket row carries a merge commit, so the per-plan age rule (`merge-subject.md:43`) applies; slice 3 measures it read-only on ewz-kus-portal*
- [ ] [Technical] Does the wave gate drop `--merges` to read squash subjects? Across about 70 local Bitbucket clones, 7 single-parent commits carry a `Merged in` subject, and ewz-kus-portal holds 0. Walking every commit costs 0.10–0.12 s against 0.02 s on ewz-kus-portal. The default keeps `--merges`. — *decides: the operator, from these numbers*
- [x] [Sibling] #2400 is Delivered with no code. — *answered round 2: the operator chose option 2.* Slice 1 pages `bb_state_listing` through `bb api` and `next` and takes over #2400's listing work. Motivation, Cost, Scope and the Overlap answer say so. #2400's plan file is unchanged.
- [x] [Technical] Slice 1's exit 7 puts stderr into `prError` and gives exit 7 a second meaning. — *answered round 2: does not arise.* A paged walk at its limit exits 0, and exit 0 keeps stderr out of the result (`scripts-shell.ts:99`), so `pr-refresh.ts:1792` writes no `prError`. A page that fails midway makes its state fail, which is exit 7's existing meaning, and the existing *answered N of M states* line is true for it.
- [x] [Technical] Callers that lose rows on exit 7: `plot-reconcile-scan.sh:738`, `plot-open-pr.sh:116` and `listing-page.corpus.test.ts:124`. — *answered round 2: does not arise.* Slice 1 adds no exit 7, so these callers see the exit codes they see today. Their request counts change, and Cost lists them.
- [x] [Cost] A store that never becomes whole gets a full read on every refresh, and the page order is unmeasured. — *answered round 2:* measured, the unfiltered page is sorted by `updated_on` descending. A paged full read folds as `whole`, so the store runs deltas and reads in full once per 24 h, at 24 requests on ewz-kus-portal. The full read every refresh remains only after a `partial` answer; see the next point.
- [ ] [Cost] A `partial` full read repeats every 180 s. `prWindowFor` asks a full read while `complete` is false (`rules/pr-index.ts:384`), and a partial answer gets no back-off (`pr-refresh.ts:1781-1792`). While one state keeps failing, each refresh spends up to 24 requests instead of 3. Proposal: the refresh applies its rate-limit back-off to a partial answer whose missing state was throttled. — *decides: slice 1's design, tested with a stub that answers HTTP 429 on page 2*
- [x] [Technical] Slice 2 misses a third cap, `registryd-main.ts` has no saturation report, and two comments go stale. — *answered round 2:* slice 2 raises `production.ts:286-290` too and tests that all three caps are equal. `registryd-main.ts` gets no saturation report; Approach 4 says why. `merge-subjects.ts:40-41` and `merge-subject.ts:39` are in slice 2's file list.
- [x] [Deliverable] Slice 2's Changelog line describes no reachable case on ewz-kus-portal. — *answered round 2: restated.* The line names the footer note that disappears. The oldest-plan bound is not adopted: it adds an ancestry query per scan to save 0.02 s, and a plan added later moves the bound.
- [x] [Deliverable] Slice 3 duplicates the deliver gate's by-name lookup. — *answered round 2: one `pr-list` call with repeated `--branch`.* Step 4 needs PR numbers, which `plot-ask.mjs deliverable` does not return, and the call adds no rule. Changelog line 3 names step 4, "On Bitbucket" is accurate because GitHub keeps the listing for several branches, and slice 3 edits `SKILL.md:139`. See *Deliver Gate Overlap*.
- [ ] [Scope] A state above `PR_LIMIT` records `complete: true` on both hosts. GitHub prints *possibly truncated* at 1000 rows and exits 0 (`plot-host.sh:4735-4736`), and this checkout's store holds 1007 rows with `complete: true`. After slice 1, Bitbucket does the same: ewz-kus-portal's 3527 merged PRs exceed 1000. The flag has two readers, `prWindowFor` (cadence) and `index-findings.ts:179` (retraction), and no lookup. Marking such a read `partial` would make every refresh a full read: 24 requests per 180 s on ewz-kus-portal. Raising `PR_LIMIT` to cover 3527 merged PRs makes the daily full read 75 requests. — *decides: the operator: accept and document the flag, raise `PR_LIMIT`, or add an answer kind that writes `complete: false` without a full read on every refresh*
- [x] [Deliverable] The summary opens with the July plans, Approach line 43 is wrong, slice 1's domain test exists, and slice 1 names no shell-line offset. — *answered round 2:* the summary says the July plans' *state unknown* is out of scope (HTTP 429). Approach 2 says that `partial` writes `complete: false` (`rules/pr-index.ts:268`). Slice 1's tests are of the paged walk, and the existing `pr-index.test.ts:205-220` test is not claimed. *Shell Lines* names an offset for each slice. `prWindowFor` is cited at `:384`.
- [x] [Domain] Does a merge-log row settle `pr: MERGED` for delivery? — *answered round 1: no.* No subject row enters the index. See *Merge-Subject Rows*.
- [x] [Technical] What does a v6 row hold? — *answered round 1:* there is no v6. `PR_INDEX_VERSION` stays 5.
- [x] [Technical] How do merge-log rows survive a `whole` fold? — *answered round 1:* there are none to survive. The "written once" claim is withdrawn.
- [x] [Technical] A truncated Bitbucket listing records `complete: true`. — *answered round 1:* slice 1. *Amended round 2:* slice 1 pages the listing; a state above `PR_LIMIT` is the open point above.
- [x] [Technical] Incremental cursor or full walk? — *answered round 1: full walk*, 0.02 s for 2340 merges, with no new field.
- [x] [Deliverable] Which reader shows the Changelog's board change? — *answered round 1: none.* The board sentence left the Changelog; see Motivation.
- [x] [Deliverable] Split the one slice? — *answered round 1:* three slices, one deliverable each. The subject-to-number rule is not built.
- [x] [Domain] How does a branch-only lookup resolve a reused name? — *answered round 1:* no subject row exists to look up. Slice 3's own case is the open point above.
- [x] [Scope] Adopt, defer or exclude each #2385 addendum point. — *answered round 1:* see the Scope table.
- [x] [Domain] Is a declined PR terminal? — *answered round 1: out of scope.* `CLOSED` stays re-asked.
- [x] [Domain] Does the addendum's local `plot-approve` lookup stay? — *answered round 1: no.* It reads a non-terminal row.
- [x] [Sibling] Who owns the fetch trigger and where does the store live? — *answered round 1:* this plan adds no fetch trigger and no store. #2386's slice is deferred.
- [x] [Cost] Does the saving justify the slice? — *answered round 1:* 0 requests saved per refresh. The plan claims correct answers only; see Cost.
- [x] [Unmeasured] Does a Bitbucket squash merge leave a `Merged in … (pull request #N)` subject? — *answered round 1: yes*, on a single-parent commit (7 commits in about 70 clones). The walk question is the open point above.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "Panel round 1: estate, contradiction, deliverable and cost lenses", "a": "unanimous amend; moderation at .plot/panels/2026-10-23-read-merged-prs-from-the-merge/panel.md; revision 2026-10-26 answered 14 points and left 4 open", "category": "panel"},
    {"q": "Panel round 2: estate, contradiction, deliverable and cost lenses", "a": "unanimous amend; moderation at .plot/panels/2026-10-23-read-merged-prs-from-the-merge/round2-panel.md; 9 new open points, #2400 delivered with no code decides first", "category": "panel"},
    {"q": "#2400 is Delivered with no code: reject it, or move the paging into slice 1?", "a": "operator chose slice 1 pages bb_state_listing through bb api and next; amendment 2026-10-26 resolved 9 of 13 open points and added 1", "category": "scope"}
  ],
  "deferredItems": [
    {"q": "Accept the reshaped scope, or restore subject rows as a v6 subjects array?", "category": "scope", "context": "Open Points"},
    {"q": "Which merged PR does slice 3 take for a reused branch name?", "category": "domain", "context": "Open Points"},
    {"q": "Does the wave gate drop --merges to read squash subjects?", "category": "technical", "context": "Open Points"},
    {"q": "Does a partial full read get the rate-limit back-off, so it does not repeat at 24 requests every 180 s?", "category": "technical", "context": "Open Points"},
    {"q": "A state above PR_LIMIT records complete: true on both hosts: accept, raise PR_LIMIT, or add an answer kind?", "category": "scope", "context": "Open Points"}
  ],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
