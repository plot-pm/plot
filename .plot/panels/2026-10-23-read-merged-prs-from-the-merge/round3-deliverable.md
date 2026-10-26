# Round 3 — deliverable

Lens: does every slice name something that ships, and does the Changelog describe what the slices build and nothing more?

Position: amend

Subject: the plan at `9774d8e1b`. Code read on `panel2419-main` at `8f87cb9c4` (`origin/main`, 2026-10-26 15:40). Measurements: read-only `git log` on ewz-kus-portal `origin/develop`, and 2 read-only `bb api` GET calls against `quatico/ewz-kus-portal` (section 4). No test suite, no host write.

## 1. Round-2 findings

| Round-2 item | Status in the amended plan | Plan line |
|---|---|---|
| Agreement 1: exit 7 puts stderr into `prError`, false *host unreachable* | Resolved. Slice 1 pages the listing and adds no exit 7 for a short listing. Read: exit 0 keeps stderr out of the result. | 47, 167 |
| Agreement 2: exit 7 gets a second meaning | Resolved. A failed page fails its state, which is the documented meaning (`plot-host.sh:960-970`). | 47, 163 |
| Agreement 3: callers that lose rows on exit 7 | Resolved by removal of the cause. Their request counts move to Cost. | 84-86, 168 |
| Agreement 4: slice 3 duplicates the deliver gate | Scoped with a reason: step 4 needs PR numbers, `DeliverabilityAnswer` has none. The duplicate request is priced. | 52-61, 173 |
| Agreement 5: slice 2's Changelog line has no reachable case | Resolved: the line now names the footer note only. | 17, 172 |
| Agreement 6: the domain test exists, line 43 wrong | Resolved. Approach 2 says `partial` writes `complete: false`. | 47, 175 |
| Disagreement 1: third cap | Resolved. Slice 2 names `production.ts:286-290` and tests equality of three caps. | 49, 146 |
| Disagreement 2: what slice 1 becomes | Resolved by the operator: slice 1 pages `bb_state_listing`. | 46, 166 |
| Disagreement 3: is slice 1 worth its price | Partly. The full read is priced at 24 requests per day. The repeat after `partial` stays open. | 81, 92, 170 |
| Disagreement 4: slice 3 one call or per branch | Resolved: one call with repeated `--branch`. | 50, 150 |
| One juror: #2400 Delivered with no code | Resolved as an ownership fact. #2400's plan file and Changelog line stay unchanged, and the plan says so (line 158). The release still publishes #2400's line for a change that is not on main; this plan does not say who corrects it. | 32, 158 |
| One juror: the same false `complete: true` on GitHub | Left open as an operator decision. | 174 |
| One juror: `merge-subjects.ts:40-41` | Resolved in slice 2's file list. | 146 |
| One juror: summary opens with the July plans | Resolved. The summary says the July plans are out of scope. | 3 |
| One juror: shell-line offset | Resolved. | 99-105 |
| One juror: `merge-subject.ts:39` | Resolved in slice 2. | 146 |
| One juror: `prWindowFor` line | Resolved, `:384`. | 92 |
| Blind spot 1: Bitbucket page order unmeasured | Resolved by measurement: `updated_on` descending. | 34, 156 |
| Blind spot 2: what the plan is for once #2400 is gone | Resolved. Slice 1 now does #2400's listing work, so the plan has a user-visible deliverable again. | 32, 133 |

## 2. Approach against the code (read)

Slice 1:

- `bb_state_listing` asks one `pagelen=50` page and writes the envelope's `next` reading to `BB_LIST_NEXT_FILE` (`plot-host.sh:1393-1406`). True.
- `pr_list_report_truncation` (`:3250`) prints *page complete* for Bitbucket when `next` is `"0"`, and never compares the row count with `--limit` on the Bitbucket arm (`:3262-3264`). The plan relies on this. It holds only because every caller's limit is a multiple of 50 (50, 100, 200, 500, 1000, 3000). A walk that trims a last page to the limit and records that page's `next = 0` reports *page complete* for a cut state. The slice text should say that the walk records `next` from the page where it stopped, and that a trimmed page counts as `next = 1`.
- **The fallback in *Shell Lines* contradicts Approach 2.** Line 103 offers reuse of `_bb_paged_walk` "with a page-cap argument". `_bb_paged_walk` returns 3 when it reaches its cap and prints *possibly truncated* (`plot-host.sh:1138`). Approach 2 (line 47) requires exit 0 at the limit. Reusing the walk as it is turns every state above the limit into a failed state, so the full read on ewz-kus-portal (3527 merged > 1000) exits 7 on every daily read and folds `partial` forever. That is the round-2 defect, restored by the fallback. The walk also serves `bb_branch_query` and `pr-review`, whose cap must keep returning 3.
- **Approach 3's claim about GitHub is false.** Line 48 says the index "holds the newest 1000 PRs of each state on both hosts". On GitHub the full read asks `gh pr list --state all --limit 1000` once for the terminal half (`plot-host.sh:4551-4555`), so the GitHub index holds the newest 1000 PRs across all states, not per state. The estate juror's live store read 1007 rows in round 2, which matches 1000 + open.
- **The queue change reaches GitHub and depends on the index being readable.** `registryd-main.ts:791` asks `prList('merged', 500)`. `prIndexRows` returns `[]` when the backend word or the store cannot be read (`registryd-main.ts:843-849`). `whole` is `refusal === null` (`:806-807`), so a clean 50-row answer reads as whole and `landedWithoutListing` does not run (`queue-reading.ts:334-336`). On Bitbucket nothing changes: the queue reads 50 rows today. On GitHub, with no readable store (a cold store, a version mismatch, or fleetd started before the first refresh), the queue's merged set drops from 500 to 50, and a slice whose predecessor merged more than 50 merges back stays on `waits`. That is #1454, which the comment at `queue-reading.ts:325-330` names. The Changelog does not mention the queue, and slice 1's tests check only that the call asks 50.
- **Cost misses one caller.** `review-bypass.ts:46` asks `prList('merged', limit)` with a default of 100 and then one `prReview` per row (`:47-58`). On Bitbucket today it reads 50 rows and its `truncated` test (`length >= limit`) reads false. After slice 1 it reads 100 rows, doubles its `pr-review` calls, and prints *hit its limit of 100*. The Cost table (lines 79-89) does not list it.
- `plot-fleet-scan.sh:1063`, `plot-open-pr.sh:116`, `plot-reconcile-scan.sh:738` (`MERGED_PR_LIMIT=500`, `:432`), `plot-impl-status.sh:269`: limits as the plan states. True.
- `bb_states_for all` is open, merged, declined (no superseded), so the full read's 1 + 20 + 3 = 24 is right for ewz-kus-portal sizes. True.

Slice 2:

- `MERGE_SCAN_LIMIT=${PLOT_MERGE_SCAN_LIMIT:-2000}` (`plot-fleet-scan.sh:472`), `MERGE_WALK_LIMIT = 2000` (`registryd-main.ts:599`), `readMergeSubjects(…, limit = 2000)` (`production.ts:286-290`). True. The footer note is at `plot-fleet-scan.sh:5295`. True.

Slice 3:

- `plot-impl-status.sh:245-250` breaks at the first unresolved un-annotated branch; `:269` asks one listing at `--limit 500`; `merged_pr_for_branch` takes the first matching row (`:274-277`). True.
- On Bitbucket `--branch` routes to `bb_branch_sweep` (`plot-host.sh:1222`), one `bb_branch_query` per branch, each through `_bb_paged_walk`. The sweep returns the first failing branch's code and prints no rows (`:1261-1262`). `plot-impl-status.sh:269` discards stderr and runs `|| true`, so one 429 on any branch empties `MERGED_HEADS` for every branch. Today one request decides. True as stated, and the failure widening is not stated (section 4).
- On GitHub one branch maps to `--head` (`:4488`); several branches keep the listing. True.

## 3. Each slice against its Changelog line

**The narrowed plan no longer claims to fix the ewz-kus-portal symptom.** The summary (line 3), Motivation (line 38), Board impact (line 20) and Scope (line 124) all say the July plans' *state unknown* comes from HTTP 429 and stays. Read. The title "an old merged PR stops reading as no PR" matches slice 1 and 3, not the July symptom. Good.

**Slice 1 — Changelog line 16.** It ships a visible change: every Bitbucket listing with `--limit` reads up to that many rows. Corrections:

- "outside the newest 50 of its state" — measured order is `updated_on`, not age (line 34). A merged PR that someone commented on recently is inside the 50. The line should say "outside the 50 most recently updated".
- "the PR index holds up to 1000 PRs per state" is true for Bitbucket only. Correct as written, because the line starts "On Bitbucket". Approach 3 is the false sentence (section 2).
- The line omits the queue's 500 → 50 change, which runs on both hosts (section 2). Either the Changelog names it, or the slice keeps 500 on GitHub, or the slice asks 50 only when the index is readable.
- On ewz-kus-portal the store is `v: 2` from 2026-10-02 (round 2, cost juror) and no fleetd writes it. So the index half of the line has no observer on the motivating estate until a fleet runs there. The listing half reaches `plot-reconcile-scan.sh`, `plot-impl-status.sh` and `plot-open-pr.sh` directly. Acceptable, but the Board-impact comment (line 20) describes only the board.

**Slice 2 — Changelog line 17.** It describes what the slice builds and nothing more. On ewz-kus-portal (2340 merges) the footer note disappears. No answer changes there (round 2, ran). Accepted.

**Slice 3 — Changelog line 18.** It ships a visible change on Bitbucket: step 4 names a merged PR older than the newest 500. Two gaps:

- On GitHub with exactly one unresolved branch the call becomes `--head`, which also finds an older PR. The line says nothing about GitHub. Minor; the change helps.
- On the motivating estate the slice trades one request for N, and one failure blanks the whole step-4 answer (section 2). Section 4 measures a 429 on the second of two consecutive requests. The Changelog promises a number; the plan should say that a throttled step 4 reports nothing, as today, and that the controller gate is unaffected.

## 4. Open points

- **[Scope] reshaped scope** — operator decision. Nothing in the code decides it.
- **[Domain] which merged PR slice 3 takes for a reused name** — partly answered by measurement (ran, 2026-10-26, `bb api` GET). `git log origin/develop --merges` shows `fix-bdd` merged 6 times and `EWZKUS-3556-service-anfrage` 11 times. The by-name query `state="MERGED" AND source.branch.name="fix-bdd"` returns #3452, #3229, #3200, #3198, #3195, #2252, #1591, #1577, #1571, … sorted by `updated_on` descending, all into `develop`. So `merged_pr_for_branch` takes the most recently updated attempt, the same rule today's listing applies. For a plan whose slice merged as #3195, step 4 reports #3452. What remains is a design decision: filter by `mergedAt` after the plan's file landed (the per-plan age rule), or accept the newest.
- **[Technical] drop `--merges`** — operator decision from the stated numbers. ewz-kus-portal has 0 single-parent `Merged in` commits, so the default changes nothing there.
- **[Cost] a `partial` full read repeats** — still open, and more likely after slice 1. The measurement above hit HTTP 429 on the second of two requests. A full read on ewz-kus-portal makes 24. The plan's proposal (back-off on a throttled partial) belongs in slice 1, not a later plan, because slice 1 creates the exposure.
- **[Scope] `complete: true` above `PR_LIMIT`** — operator decision. The code confirms the premise: Bitbucket's truncation rule reports *possibly truncated* and returns 0, and no lookup reads `complete`.

## 5. New defects

1. **The *Shell Lines* fallback breaks Approach 2.** `_bb_paged_walk` returns 3 at its cap (`plot-host.sh:1138`). Reusing it unchanged makes a state above the limit fail, and the daily full read on ewz-kus-portal folds `partial` every time. The slice must either forbid that fallback or state that the cap argument exits 0 with *possibly truncated* for the listing only.
2. **Approach 3 states a false fact about GitHub** ("newest 1000 PRs of each state on both hosts"). The GitHub full read holds 1000 across all states.
3. **The queue limit drop is an unlisted behaviour change on GitHub.** It regresses to #1454 whenever the index is unreadable. Neither the Changelog nor the tests cover that case. Add a test: with `prIndexRows` empty, a predecessor merged as the 51st-newest still reads as merged — or keep 500 on GitHub.
4. **Cost omits `review-bypass.ts:46`.** On Bitbucket it doubles its `pr-review` calls after slice 1.
5. **The trimmed-last-page case** in `pr_list_report_truncation` (section 2) is latent. Name the rule in the slice.
6. **Slice 1's `packages/fleet` test proves no paging.** "A full read whose host answer holds 120 merged rows across pages writes all 120 rows and `complete: true`" stubs the host answer, and the fold never sees pages. It tests the existing `whole` fold. Replace it with the queue test from defect 3.

## Changes needed for proceed

- Slice 1: remove or correct the `_bb_paged_walk` fallback; correct Approach 3's GitHub sentence; name the queue change in the Changelog or limit it to Bitbucket; add the empty-index queue test in place of the 120-row fold test; add `review-bypass.ts:46` to Cost; move the back-off for a throttled `partial` into slice 1.
- Changelog line 16: "the 50 most recently updated" instead of "the newest 50".
- Slice 3: state that one throttled branch empties step 4's answer, and decide the reused-name rule from the measured order.
