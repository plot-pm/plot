# Panel: read-merged-prs-from-the-merge (round 2)

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `6eb7fb922` (Draft, #2385, plan PR #2419), after the round-1 amendment. Code read at `origin/main` `18a3456fe`.
Caller: `/challenge-the-plan` Phase 3P. Commitment: `Position: proceed,amend,reject`. Lenses: the same four as round 1.
Siblings: 4 read (#2400 `plot-host-bitbucket-pr-list-reads`, #2386 `one-pr-reader-per-machine-and`, #2484 `bitbucket-and-github-listings-read-one`, #2560 `the-pr-index-keeps-checks-pending`). The active sprint `2026-W43-follow-ups-2-28-3` holds 30 items. Contradiction also read #2158 and #2479. The other 26 sprint items are unread beyond their titles.

## Gate

| Juror | `plot-panel.mjs check` | Position |
|---|---|---|
| estate | exit 0 | amend |
| contradiction | exit 0 | amend |
| deliverable | exit 0 | amend |
| cost | exit 0 | amend |

`plot-panel.mjs reconcile`: `unanimous amend estate,contradiction,deliverable,cost`. No juror was sent back.

## What each juror looked at

- **estate**: read the code. It also ran `git rev-list` on ewz-kus-portal and `jq` over this checkout's live PR index (`github.json`, `v: 4`, 1007 rows, `complete: true`).
- **contradiction**: read the code. It also ran `gh pr view 2422` and `git log` / `git show` on `origin/main`, which moved to `b2df79eaf` during the review.
- **deliverable**: read the code. It also ran read-only `git log`, `git ls-tree` and `git show` on ewz-kus-portal `origin/develop`.
- **cost**: read the code. It also ran read-only `git log` on ewz-kus-portal and read that repository's store file.

## Round 1

All four jurors find every round-1 defect, disagreement and blind spot resolved or scoped out with a reason. There is one exception: blind spot 2, the stale store. The plan re-read the code but measured no live store. Cost read ewz-kus-portal's store again, and it is still `v: 2` from 2026-10-02 with 111 rows. No fleetd has written there since that date.

## Agreement

1. **Slice 1 has visible effects that the plan does not name** (all four jurors). Exit 0 discards stderr today. With exit 7, `pr-refresh.ts:1532` takes the whole stderr and `:1792` writes it to `entry.prError`. `refusalKind` reads the unknown text as `outage`, so the board shows *"PR data stale — host unreachable (… possibly truncated …)"* after every refresh of every Bitbucket board with more than 50 PRs in one state. The host answered, so the text is false. The Board-impact comment says that only the wave gate changes.
2. **Exit 7 gets a second meaning** (estate, contradiction, cost). `plot-host.sh:960-970` and `scripts-shell.ts:101-110` define exit 7 as "some states answered and some did not", and say that a single-state call has no partial answer. `plot-fleet-scan.sh:5332-5336` tells the operator to re-run. A re-run does not fix a short page.
3. **Some callers lose rows on exit 7** (estate, deliverable; the moderator confirmed by reading). `plot-reconcile-scan.sh:738` runs the merged listing inside `if … then`. `plot-open-pr.sh:116` runs `|| pr_rows=""`. `packages/domain/corpus/listing-page.corpus.test.ts:124` throws on any non-zero exit. The plan's survey list names none of the three.
4. **Slice 3 duplicates the deliver gate's by-name lookup** (estate, cost). `deliverabilityOf` (`controllers/deliverability.ts`) already calls `Host.prMerged` for each branch that the index cannot answer, and `plot-host.sh pr-merged` follows `next`. The gate therefore already finds an older merged PR. Slice 3 fixes only the step-4 report of the `/plot-deliver` skill, and it spends the same N requests a second time. Changelog line 3 overclaims.
5. **The Changelog line for slice 2 describes no reachable case on the measured estates** (deliverable, cost; both ran). On ewz-kus-portal, all 1770 `Merged in` subjects lie inside the 2000 cap. Merge 2000 is a Data Center `Pull request #1566` subject from 2023-12-08. Only 253 merges are newer than the first plan file (2026-07-10), and the age rule proves nothing with an older merge. The one visible change is that the footer's *merge scan hit its limit* note disappears.
6. **The domain test in slice 1 already exists** (contradiction, deliverable). `packages/domain/test/pr-index.test.ts:205-220` folds `partial` over a `complete: true` store. Approach line 43 says that `complete` stays as it was on `partial`. `wholenessAfter` (`rules/pr-index.ts:268`) writes `false`. The slice text and the code agree with each other, but line 43 does not.

## Disagreements

1. **Is there a third cap on the merge walk?** Estate and contradiction say yes: `packages/domain/corpus/production.ts:286-290` `readMergeSubjects(…, limit = 2000)` is documented as *matching `MERGE_SCAN_LIMIT`*, and `branch-state.corpus.test.ts:340,392` calls it with the default. Deliverable and cost say the plan's list of two is complete. **The moderator read the file: the third cap exists.** Deliverable and cost searched `packages/board` and `packages/fleet` and missed `packages/domain/corpus`. Estate adds that `registryd-main.ts` has no saturation report, so the plan's sentence *the saturation report stays* holds for the scan only.
2. **What slice 1 should become.** The jurors find the same defect and propose four different responses:
   - **Contradiction:** slice 1 pages `bb_state_listing` itself through `bb api` and `next`, as `bb_branch_query` and `bb_window_listing` already do. The listing then becomes complete instead of only being marked partial, and exit 7 keeps its single meaning. This is the only response that also makes the title true for the scan.
   - **Deliverable:** the adapter reads the *possibly truncated* line that exit 0 already prints and folds `partial`. No shell caller changes.
   - **Cost:** make the truncation line a notice pattern in `rules/pr-status.ts:55-66`, so that the board renders *incomplete* and not *unreachable*.
   - **Estate:** fix the callers that break, or take the plan's stderr-marker fallback.

   These responses differ in scope. Contradiction's response makes the listing correct. The other three make a known-short listing honest and quiet.
3. **Is slice 1 worth its price at all?** Only cost and deliverable count the price. A store that never becomes whole gets a full read on every 180 s refresh (`prWindowFor`). On Bitbucket that costs one `git fetch` per base plus one `merge-tree` per open PR, and it replaces the paged `updated_on>=` delta with a 50-row page per state. Cost adds that the `complete` flag has two readers only, cadence and retraction, and no lookup. Estate and contradiction treat the honest flag as worth having and do not price it.
4. **Slice 3: one call or one per branch.** Contradiction says that `pr-list` accepts repeated `--branch` and that `plot-impl-status.sh:251-253` documents a lookup that is constant in branch count. Cost says that step 4 should read `plot-ask.mjs deliverable` and add no shell. Estate says to call the domain or to declare the duplicate and pair it. Deliverable adds that slice 3 changes every backend, so "On Bitbucket" in the Changelog is wrong.

## Found by one juror

- **#2400 is Delivered with no code (contradiction; the moderator confirmed).** PR #2422 held only a claim and a blocker commit (`f576060de`, "No code change follows"). It merged at 2026-10-26T14:19:47Z as `eede90c78`, and `b2df79eaf` delivered #2400. `bb_state_listing` on `origin/main` still asks one page. This session's merge watcher refused #2422 at 09:24 as claim-only, so the merge came from elsewhere. The plan names #2400 as the owner of Bitbucket paging in four places (Motivation, Cost, Scope, Overlap). All four are now false, and slice 1's "until #2400 ships" has no end date. The release would also publish #2400's Changelog line for a change that is not on main.
- **The same false `complete: true` exists on GitHub (estate, ran).** `PR_LIMIT = 1000` (`pr-refresh.ts:303`). The GitHub arm prints *possibly truncated* at the limit and exits 0 (`plot-host.sh:4735-4736`). This checkout's live store reads `complete: true` with 1007 rows. Slice 1 is Bitbucket-only and does not say why GitHub is out of scope.
- **`merge-subjects.ts:40-41` contradicts the plan's own measurement (contradiction).** The comment says that a `--merges` walk loses no `Merged in` subject. The plan measured 7 single-parent ones across about 70 clones.
- **The summary still opens with the July plans (deliverable).** A reader who stops at the summary expects their *state unknown* to clear. The plan says that it does not, but only in Motivation paragraph 4.
- **Slice 1 names no offset for `check-shell-lines.sh` (estate, cost).**
- **The stale `2000` in `packages/board/src/server/entry/merge-subject.ts:39`** (deliverable).
- **Line references:** `prWindowFor` is at `rules/pr-index.ts:384`, not `:394` (contradiction, cost).

## Shared blind spots

1. **No juror measured a live v5 Bitbucket store or the page order of Bitbucket's unfiltered listing.** Every claim about slice 1's runtime effect comes from reading code. The coverage loss in disagreement 3 depends on which 50 rows the first page holds, and nobody measured that. The only Bitbucket store on this machine is the `v: 2` file from 2026-10-02.
2. **Nobody asked what the plan is for once #2400 is gone.** Round 1 narrowed the plan to fixes around #2400. #2400 now reads Delivered with no paging on main. Slice 2 changes no answer on the measured estates, and slice 3 duplicates a gate that already works. Only slice 1 then fixes a defect an operator meets, and it does so by marking a known-short listing. Contradiction's option (b), paging the listing, would turn the plan into the one that does #2400's work. No juror said whether that is still this plan.

## Outcome

The panel is unanimous on `amend`. Nothing is approved. The open points go to the plan's `## Open Points`.

**#2400 needs a decision first.** The operator chooses one of two options:

- reject #2400 back to Approved with `/plot-reject` and keep this plan's ownership text;
- move the paging into this plan's slice 1 and close #2400 against it.

The rest of the amendments follow from that choice.
