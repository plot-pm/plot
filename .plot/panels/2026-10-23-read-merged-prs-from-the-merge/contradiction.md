# Juror: contradiction lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` (Draft, #2385). Siblings read: #2400 (`plot-host-bitbucket-pr-list-reads`, Approved), #2386 (`one-pr-reader-per-machine-and`, Approved, Started), #2407 (`plot-approve-reports-no-pr-found`, now Approved on `origin/main` `ceccdce99`).

**Method.** **Ran** means I ran a read-only command. **Read** means I only read the code. Disclosure: I ran one `git fetch -q` in the main checkout to see the sibling branches. It updated remote-tracking refs only and did not touch the working tree.

## 1. Approach against the code

- **Step 2 conflicts with the row contract (read).** `entities/pr-index.ts:15-16` defines a row as *"exactly what the host answered, and nothing the board inferred"*. A merge-log row is inferred from git. Four fields are required (`draft`, `checks`, `review`, `url`, `:38-42`) and git answers none of them. The schema is `.strict()` (`:90`), so a source marker needs a schema change and a `PR_INDEX_VERSION` bump from 5 to 6 (`:12`). The plan says the store "already holds" what it needs. It does not.
- **"Read only `<last indexed>..origin/<default>`" has no field to live in (read).** `watermark` is the host's `updatedAt` and must never be this machine's value (`entities/pr-index.ts:119-125`, `rules/pr-index.ts:116-119`). A commit cursor is a new field, so it belongs to the same version bump.
- **A `whole` fold deletes merge-log rows (read and ran).** `foldPrIndex` starts empty on `whole` (`rules/pr-index.ts:147-154`). A truncated Bitbucket listing exits 0 (`plot-host.sh:1429-1446`, `pr_list_report_truncation` only warns, `:3049`). The adapter maps exit 0 to `answered` (`scripts-shell.ts:99`), so a full read folds as `whole` and writes `complete: true`. **Ran** against `ewz-kus-portal`'s store (`.plot/state/index/bitbucket.json`, `v: 2`, dated 2026-10-02): 50 MERGED rows, 50 CLOSED rows, `complete: true`. In the same repository `git log origin/develop --merges` holds **1765** `Merged in … (pull request #N)` subjects. Each daily full read (`PR_FULL_READ_MS`, `pr-refresh.ts:334`) and each cold start would therefore drop every subject-derived row unless the fold changes. The plan does not mention the fold, and `PrAnswerKind` (`rules/pr-index.ts:59`) has no kind for "git-derived". Folding the rows as `partial` latches `complete` to false and forces a full read on every refresh (`prWindowFor`, `:394`). Folding them as `delta` inherits a `complete` that is already false on this store.
- **Pre-existing contradiction the plan relies on.** `entities/pr-index.ts:97-103` says `complete` *"IS RECORDED, NEVER INFERRED"*, yet a 50-row page is recorded as complete (ran, above). The plan treats the `complete` flag as sound. It is not sound on Bitbucket.
- **Step 3 "declined PRs" agrees with the repo (read).** `merged-row.ts:6-9` makes MERGED the only terminal state, and CLOSED is re-asked. The plan agrees with that. The addendum does not (see §3).

## 2. The seven Open Questions

1. **One index or two.** CLAUDE.md answers it: there is one writer, and `pr-refresh.ts` is the only caller of `foldPrIndex` (*A Decision Reads The Index*, "One writer"). The answer is one store. **Collision:** #2386's open question *"Does the cache extend the existing PR index or replace it?"* (#2386 plan :48, :54) decides where that store lives. This plan must name #2386's answer as a precondition. An operator decides the order.
2. **Subject or host.** `merge-subject.md:53-62` already answers this. No destructive decision reads a subject. `plot-impl-status.sh` takes any MERGED, non-draft store row without asking the host (`:169-175`, `pr-index-lookup-answer.ts:60-62`, `merged-row.ts:17-18`), and `/plot-deliver` runs it (`skills/plot-deliver/SKILL.md:130`). An unmarked subject row would therefore settle a delivery with zero host calls. That contradicts the boundary table row *"auto-delivery … reads a subject-only branch as `unknown`"* and *One Answer*. **Operator decision:** either amend *One Answer* or keep subject rows out of `isTerminalRow`.
3. **Row shape.** The code answers this. Use the absent words for unanswered fields (`ABSENT_VERDICTS`, `rules/pr-index.ts:188-192`: `checks: 'unknown'`, `review: ''`). Omit `mergedAt` and `updatedAt`, because both are "as the host spelled it" (`entities/pr-index.ts:53-60,80-81`). A git commit date written into `mergedAt` would also fire the IndexMonitor's `pr merged` finding (`index-findings.ts:58-63`), which is a trigger built on a non-host answer. A source marker is required (version 6), and `isTerminalRow` must refuse it. Which readers accept the marker is an operator decision.
4. **Overlap with #2400.** No file collision: #2400 edits `bb_state_listing`, `pr_list_report_truncation` and `listing-paging.ts`, and this plan edits none of them. **Sequencing contradiction:** #2400 is blocked on agent-skills#98 (#2400 Notes). Before #2400 ships, the `whole` fold deletes the rows this plan adds (§1). After #2400 ships, the host lists every merged PR (about 36 pages of 50 for 1765 merges), so the merge log only removes cost. The plan should state its value for each of the two orderings.
5. **Overlap with #2386.** This is the same trigger in both plans. #2386 approach 3 says *"refresh open PRs when a `git fetch` brings new refs"* (#2386 :41). This plan says *"after each `git fetch`"*. Both would add a fetch-driven pass to `refreshPrs`. A git read costs no API call, so it needs no single reader for budget reasons. It must still run inside the one writer. The two plans must name one owner for the fetch trigger.
6. **Squash and rebase.** The code answers this already. A missing row answers `ask` and never `none` (`pr-index-lookup-answer.ts:21-28,83-88`). No change is needed. Bitbucket's squash subject is unmeasured here.
7. **Reused names.** **The rule does not carry over.** The age rule is keyed by plan: *"a subject proves a branch for a plan only when … `<added>` is the commit that first added that plan's file"* (`merge-subject.md:11,43`). The index is keyed by PR number and has no plan (`rules/pr-index.ts:109-114`). `mergedRowByHead` takes the **lowest** PR number for a head (`merged-row.ts:23,30-33`). **Ran:** `ewz-kus-portal` has 87 reused names among its `Merged in` subjects. A full history in the store makes branch-only resolution in `plot-impl-status.sh` answer with the oldest merge of a reused name. #2400's full paging has the same hazard, so the two plans share it.

## 3. Coverage of the #2385 addendum

| Addendum point | Covered? |
|---|---|
| Separate throttling of the list and the single-PR GET | **No.** The plan does not mention it. |
| Seed once with a full paged walk | **No.** The plan replaces the merged seed with the merge log and says nothing about seeding open or declined PRs. |
| Terminal rows (merged, declined, superseded) written once | **Partly.** Merged rows only. Declined rows stay re-asked, which agrees with `merged-row.ts:6-7` and **contradicts the addendum**. The plan should say so. |
| Open PRs as a watch list refreshed by single-PR GET | **No.** `pr-state` already takes a number (`plot-host.sh:3730`), but the plan keeps the listing. |
| Discovery by one delta page `sort=-updated_on`, `q=updated_on > last seen`, only after a fetch brings a new ref | **No.** The store already asks `updated_on>=watermark` for each state on every refresh (`bb_window_listing`, `plot-host.sh:1212`). The addendum changes this to one page, gated on a fetch and using a strict `>`. That change is not in any plan. |
| Pair with #2386's single reader | **Named as a question only** (OQ5). |
| `plot-approve` lookup made local | **Not covered, and it conflicts with CLAUDE.md.** Open rows are not terminal, and only terminal answers are read from the index. #2407 fixes only the refusal text, so it does not collide with this plan. |

## 4. CLAUDE.md consistency

- **One writer:** the plan is consistent if the merge-log read runs inside `refreshPrs`, but the plan does not say where it runs. The `git log` call must go through an adapter (Layering Rule), for example `refs-git.ts`, and not through a new spawn in `pr-refresh.ts`.
- **Only terminal answers / never `none`:** consistent (OQ6), on the condition that subject rows are kept out of `isTerminalRow` or that *One Answer* is amended.
- **One Answer:** **contradicted as written.** Step 2's phrase *"A merged row is terminal, so it is written once and never re-asked"* routes a subject into `/plot-deliver` (§2.2).

## 5. Changes before approval

1. State which readers accept a subject row. Keep it out of `isTerminalRow`, `mergedRowByHead` and the IndexMonitor, or amend *One Answer* and `merge-subject.md`'s table in this plan.
2. Name the schema change: add a source marker and a merge-log cursor, omit `mergedAt` and `updatedAt`, and bump `PR_INDEX_VERSION` to 6.
3. Specify the fold: subject rows must survive a `whole` fold and must not change `complete`. Name the new kind, or the rule that re-derives the rows on every fold.
4. Record that a truncated Bitbucket page folds as `complete: true` today (ewz-kus-portal store). Either fix it here or hand it to #2400.
5. Replace OQ7's "confirm it carries over" with the finding that it does not carry over. Address reused names for branch-only lookups.
6. Settle the owner of the fetch trigger with #2386 and the store location before this plan's slice starts.
7. Either adopt or explicitly defer each addendum point in §3, and state the declined-is-not-terminal disagreement with the addendum.

Position: amend
