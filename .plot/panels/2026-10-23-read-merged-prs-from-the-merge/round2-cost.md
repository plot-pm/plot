# Juror round 2: cost lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `6eb7fb922`. Code read in the main worktree at `18a3456fe`. Every claim says **read** (file and line) or **ran** (command).

## Summary

The amendment is honest about host requests: 0 saved per refresh, and no 429 relief. It is not honest about the other costs. Slice 1 adds a permanent amber banner and turns every refresh into a full read. Slice 2 changes no answer on the estate that motivated it. Slice 3 spends a second time requests that the deliver controller already spends. Each slice needs a named change before approval.

## 1. Round-1 findings

| Round-1 item | Status | Plan line |
|---|---|---|
| Agreed 1: subject row reaches delivery | Resolved. No subject row enters the index. | *Merge-Subject Rows*, first paragraph |
| Agreed 2: `whole` fold erases rows | Resolved. No rows of this plan exist to erase. The "written once" claim is withdrawn. | *Merge-Subject Rows*, last two paragraphs |
| Agreed 3: addendum uncovered | Scoped out, with one reason for each point. | *Scope* table |
| Three jurors: truncated listing records `complete: true` | Addressed by slice 1. The costs of slice 1 are understated (section 2). | Approach 1, *Cost* slice 1 |
| Disagreement 1: cursor or full walk | Resolved: full walk, with no new field. | Approach 2 |
| Disagreement 2: board sentence | Resolved. The board sentence left the Changelog, and the plan states that the July plans' *state unknown* comes from HTTP 429. | Motivation, paragraph 4; Board-impact comment |
| Disagreement 3: where the saving is | Resolved for host requests: "0 requests per refresh". Open for local cost and attention (section 2). | *Cost* |
| Disagreement 4: `plot-approve` lookup | Scoped out: an `OPEN` row is not terminal. | *Scope* row 7 |
| Disagreement 5: declined PRs | Scoped out. | *Scope* row 8 |
| Blind spot 1: walk saturated at 2000 | Addressed by slice 2. The saturation has no effect on any answer on ewz-kus-portal (section 2). | Slice 2 |
| Blind spot 2: stale store | **Open.** The plan re-read the code. It did not measure a live store. I read `/Users/jwloka/Quatico/ewz/ewz-kus-portal/.git/.plot/state/index/bitbucket.json`: it is still `v: 2`, `complete: true`, `wholeAt: null`, written 2026-10-02 08:28, with 111 rows. No fleetd has written there since. The `complete: true` claim on current code still rests on reading only. | Motivation, "Read on `origin/main`" |
| Blind spot 3: squash subject unmeasured | Resolved by measurement. The walk question is an open point. | Notes, Open Points 4 |
| Round-1 cost 6: TS, not shell | Partly. Slice 3 states that the shell line count does not grow. Slice 1 adds lines to `plot-host.sh`, and the plan names no offset for `scripts/check-shell-lines.sh`. | Slice 3; slice 1 has no such clause |

## 2. Approach against the code

### Slice 1: a short listing becomes partial

Mechanism (read). `pr_list_states` (`plot-host.sh:1488-1553`) is Bitbucket-only, and the GitHub arms call `pr_list_report_truncation` directly (`:4658`, `:4735`). So the change stays on Bitbucket, as the Changelog says. `scripts-shell.ts:111` maps 7 to `partial` and keeps stdout. `answerKind` (`rules/pr-index.ts:90-95`) returns `partial`, and `wholenessAfter` (`:268-271`) writes `false`. The cited lines hold.

Costs that the plan does not name:

1. **A permanent amber banner.** Read: `pr-refresh.ts:1532` takes `said` as the whole stderr, and `:1792` writes `entry.prError = partialSaid` on every partial answer. `prStatus` (`rules/pr-status.ts:163-176`) strips only the notice patterns at `:55-66`. "possibly truncated" is not one of them. The text left over reaches `refusalKind` (`rules/refusal.ts:59-64`), which returns `outage` for any text it does not know. `prStatusLevel` then returns `warning`. `prStatusEntry` (`host-notes.ts:376-460`) renders an amber line: *"PR data stale — host unreachable (plot-host: bitbucket pr-list state=MERGED possibly truncated …)"*. Today exit 0 discards stderr (`scripts-shell.ts:99`), so no banner shows. After slice 1, the banner shows on every refresh of every Bitbucket board that has more than 50 PRs in one state. It stays until #2400 ships, and for good on an older `bb`. The wording is also false: the host answered. Slice 1's tests do not cover the board line.
2. **Deltas stop entirely, and the full read is heavier than the plan says.** Read: `prWindowFor` (`rules/pr-index.ts:384-404`) returns a full read whenever `!held.complete`. The plan names this and calls it "the same count as a delta". That holds for REST requests only. A full read asks `--rich-open` (`pr-refresh.ts:1499`). On Bitbucket the rich arm pipes every row through `bb_fold_mergeable_stream` (`plot-host.sh:4892-4895`, `:2138`). For each `OPEN` row, `bb_fold_mergeable` (`:2117-2131`) runs `bb_fetch_base_bounded`, a network `git fetch` of the base, once per base per process (`:2126`, `:2071`), plus one `git merge-tree` per open PR. A delta folds only the rows that changed, so a quiet estate fetches nothing. After slice 1, each 180 s refresh makes at least one `git fetch` for each base while any PR is open, plus 11 merge-trees on ewz-kus-portal's last store (11 `OPEN` rows). Under `CI: jenkins` the Jenkins colour map is also read on every refresh. The *Cost* section names none of this.
3. **A coverage loss that is not measured.** Read: the delta that slice 1 removes is `bb_window_listing` (`plot-host.sh:1309-1340`). It asks `updated_on>=<watermark>` and follows `next`, so it sees every PR that changed. The full read that replaces it is one page of 50 rows per state (`bb_state_listing`, `:1393-1406`). A PR outside its state's first page, for example an old open PR that merges, enters the store only if the page order puts it in the first 50. The plan does not measure the page order. Today the store at least receives every change through the delta, even though the whole fold erases it once a day.
4. **What the flag buys.** Ran `git grep` for readers of the PR index's `complete`: there are two, `prWindowFor` (cadence) and `index-findings.ts:179` (retraction). No lookup reads it, because the index never says `none`. So slice 1 buys a correct flag, and the flag's only readers are a cadence rule and a retraction. In exchange the board loses deltas and retractions and gains a banner. The plan should state this trade as a trade.
5. **The scan's partial note is false for this case.** Read: `plot-fleet-scan.sh:1332-1336` prints *"the git host answered for some states and not others … Re-run to get the whole list"* on `partial`. A re-run does not help with a short page. The note shows only when `TRACKED_BRANCHES` is empty, because the scan passes `--branch` (`:1036-1037`), and a sweep skips the detector (`plot-host.sh:1540-1542`).
6. **Timing.** Read: #2400 (`docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md:28`) plans its dependency for the sprint 2026-10-26 to 2026-10-30. The costs above therefore apply for days on a current `bb`, and for good on an older `bb`. The plan's *Overlap with #2400* answer does not compare those two windows.

### Slice 2: the merge walk cap rises to 20 000

Read: the two caps are `plot-fleet-scan.sh:472` and `registryd-main.ts:599` (used at `:629`). `plot-reconcile-scan.sh:2849` (`CHANGESET_MERGE_WINDOW=40`) is a different walk. The plan's list is complete and correct.

Ran on ewz-kus-portal (read-only `git log`): the 2000th-newest merge is `562ff425a`, dated 2023-12-08. The oldest merge is from 2021-04-08. The first plan file was added in `9040bd2b95` on 2026-07-10. Only **253** merges lie between that commit and `origin/develop`. The age rule (`plot-fleet-scan.sh:474-477`, `merge-subject.md:43`) proves nothing with a merge that the plan's adding commit already contains. So every merge beyond the 2000 cap on this estate is older than every plan and cannot prove any branch. **Slice 2 changes no branch's answer on the estate that motivated it.** Its one visible effect there is that the footer's `merge_detect=truncated` note disappears. The Changelog line *"a branch merged before the 2000th-newest merge reads as merged"* is true only for a plan with more than 2000 merges after its own addition. No measured estate has such a plan. The cost is small (0.02 s), so the slice is cheap. The Changelog overstates it.

### Slice 3: delivery asks by name

Read: `plot-impl-status.sh:263-271` makes one `pr-list --state merged --limit 500` call, as the plan says. Two facts are missing from the plan:

1. **The deliver controller already asks by branch.** `deliverabilityOf` (`controllers/deliverability.ts:270-330`) calls `Host.prMerged`, and `host-shell.ts:387-391` runs `plot-host.sh pr-merged <branch>` once for each branch that the store cannot answer. According to the plan's own Motivation, #2484 made `pr-merged-heads` follow `next`. `plot-deliver.mjs` and `POST /api/deliver` are the gate (CLAUDE.md, *The Master Agent Uses The Controllers*). `plot-impl-status.sh` runs only from `skills/plot-deliver/SKILL.md:130`, step 4. So the gate already finds an older merged PR. Slice 3 fixes the skill's step-4 reading, and it makes one delivery spend the same N by-name requests twice: once in step 4 and once in the controller. In step 4, each hit also costs one `pr-state` call (`plot-impl-status.sh:330`). The *Cost* line counts "1 request per such branch" and leaves out the controller's N.
2. **There is a cheaper route.** `plot-ask.mjs deliverable` already answers the question through the same controller (CLAUDE.md lists `deliverable`). If step 4 reads that answer, the requests are not duplicated, and shell code is deleted, which is the direction of *A Shell Script Asks The Domain*. The plan does not consider this.

The Changelog line *"so `/plot-deliver` finds an older merged PR"* claims a result that the gate already delivers. The line should name step 4's report.

## 3. Each slice against its Changelog line

- Slice 1: the observer sees `complete: false` in the store, and also the banner described in section 2. The Changelog names only the first of these.
- Slice 2: no observer on the motivating estate sees a changed answer. Only the footer note changes. The Changelog overstates it.
- Slice 3: the observer sees step 4 resolve an older un-annotated branch. The delivery verdict does not change. The Changelog overstates it.
- The ewz-kus-portal symptom: the plan no longer claims to fix it. Motivation paragraph 4 and the Board-impact comment state that the July plans' *state unknown* comes from HTTP 429 and does not change. That statement is honest. Nothing in the plan now changes a visible symptom on ewz-kus-portal except the slice-1 banner, which is new.

## 4. Open points

- **Scope** (operator decision). With a cost lens, the narrow scope is right. No v6 `subjects` array: the walk costs 0.02 s, so a stored copy is a cache that git can reach.
- **Can every caller take exit 7?** The code mostly answers this (read). The refresh takes it (`pr-refresh.ts:1530-1532`), but it raises the false banner. The scan takes it (`plot-fleet-scan.sh:771-783`), but with a false note. The Host port takes it (`host-shell.ts:248-257` parses the rows), but it keeps a held refusal, so `approve.ts:400-405` gets its rows and `lastRefusal` carries the truncation sentence. `plot-impl-status.sh` discards stderr and ignores the exit code (`:269`). The survey is still owed for the held-refusal precedence in `approve.ts`. The banner is the real blocker.
- **Reused branch names in slice 3.** This stays open, and it is a correctness question, not a cost question. Routing step 4 through the controller removes it from the shell, because `pr-merged` answers merged or not-merged and needs no row number.
- **Drop `--merges`?** A measurement answers it: 0 single-parent `Merged in` subjects on ewz-kus-portal, and a cost of 0.10–0.12 s against 0.02 s. With the age-rule finding above, keep `--merges`. The operator can close this point now.

## 5. New defects

1. The slice-1 banner (section 2, slice 1, item 1). New, and introduced by the design.
2. Slice 1 drops deltas, which adds a network fetch and merge-trees on every refresh. It also removes the paged `updated_on` window (items 2 and 3).
3. Slice 2's Changelog claims an effect that the age rule prevents on the motivating estate (ran: 253 merges since the first plan, 2000th merge dated 2023-12-08).
4. Slice 3 duplicates the controller's per-branch requests. Its Changelog credits it with a gate result that already exists.
5. Slice 1 has no shell-line offset for `check-shell-lines.sh`.

## Changes before approval

1. Slice 1: keep the truncation line out of `prError`'s outage path. Make it a notice pattern in `rules/pr-status.ts:55-66`, or a distinct word that the board renders as *incomplete*, not *unreachable*. Add a board test for that wording. In *Cost*, state the full-read-every-refresh price: `git fetch` per base, merge-tree per open PR, and the Jenkins map. Either decide that a store that is not whole still narrows by delta, or state the coverage loss of the 50-row page. State the order relative to #2400, and whether slice 1 is for an older `bb` only.
2. Slice 2: rewrite its Changelog line to what it changes: the `truncated` footer, and a plan with more than 2000 merges after its addition. Alternatively, bound the walk by the oldest plan's adding commit. That bound is exact, and it is smaller on every measured estate.
3. Slice 3: count the controller's N requests in *Cost*, and consider reading `plot-ask.mjs deliverable` in step 4 instead of adding a second by-name path. Rewrite its Changelog line so that it names step 4 and not delivery.
4. Name the shell-line offset for slice 1.

Position: amend
