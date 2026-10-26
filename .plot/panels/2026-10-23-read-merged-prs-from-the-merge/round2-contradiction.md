# Round 2 — contradiction

Lens: does the amended plan disagree with a sibling plan, or with a decision this repo already made?

Position: amend

Plan read at `6eb7fb922`. Code read at `18a3456fe` (the main worktree) unless a line says `origin/main`. `origin/main` moved to `b2df79eaf` during this review, and finding N1 comes from that move.

## Summary

The amendment removes every round-1 contradiction: no subject row enters the index, the `whole` fold erases nothing, and the plan no longer claims the board fix. The amended plan still has new contradictions with a sibling and with the code. The largest one is a sibling: #2400, which the plan names as the owner of Bitbucket paging, is now **Delivered with no code**. The second one is in the code: slice 1 gives exit 7 a second meaning, and three readers already describe exit 7 to people as "a state failed, re-run".

## 1. Round-1 findings

| Round-1 item | Outcome | Plan line | Basis |
|---|---|---|---|
| Agreement 1: subject row reaches delivery | resolved | 49-53 | read |
| Agreement 2: `whole` fold erases rows | resolved, claim withdrawn | 55 | read; `foldPrIndex` at `rules/pr-index.ts:146-154` starts empty on `whole` |
| Agreement 3: addendum mostly uncovered | scoped out, a reason for each row | 69-80 | read |
| Three jurors: truncated listing records `complete: true` | resolved by slice 1 | 43, 98 | read; path confirmed below |
| Disagreement 1: cursor or full walk | resolved: full walk | 44, 124 | read |
| Disagreement 2: board sentence | resolved: sentence removed, cause named as HTTP 429 | 20, 35 | read; `branch-state.ts:259-267` answers `unknown` only on `throttled`/`secondary`/`failed` |
| Disagreement 3: where the saving is | resolved: 0 requests saved | 61-65 | read. The "order with #2400" half is now **stale**, see N1 |
| Disagreement 4: `plot-approve` lookup | scoped out | 79 | read |
| Disagreement 5: declined PRs | scoped out | 80 | read |
| Blind spot 1: 2000 cap | resolved for two of three caps | 44, 102 | read; third cap missing, see N4 |
| Blind spot 2: `complete: true` from a stale store | resolved by reading the code only | 30 | read: `scripts-shell.ts:99` exit 0 → `answered`; `answerKind` (`rules/pr-index.ts:90-95`); `wholenessAfter` (`:266-270`). No live v5 Bitbucket store was measured, by the plan or by me |
| Blind spot 3: squash subject | measured, left as an open point | 111, 119 | read |

## 2. Approach against the code

Claims I confirmed by reading: `PR_LIST_PARTIAL_RC=7` (`plot-host.sh:935`). `bb_state_listing` (`:1393-1406`) uses one `pagelen` page. `pr_list_report_truncation` (`:3250`). `pr_list_states` returns 0 (`:1544`). `PR_LIST_BRANCHES` (`:4786`). The GitHub `--head` arm (`:4488`). `scripts-shell.ts:99/111`. `plot-fleet-scan.sh:472` and `:1265`. `registryd-main.ts:599`. `pr-refresh.ts:249/331/1499`. `merged-row.ts:17-18, 30-33`. `PR_INDEX_VERSION = 5`. `merge-subject.md:43` and its boundary table. `plot-impl-status.sh:269`.

Claims that are false or stale:

- **Approach 1 (line 43) contradicts slice 1 and the code.** The plan says that on `partial`, `foldPrIndex` "leaves `complete` as it was". `wholenessAfter` returns `false` for `partial` (`rules/pr-index.ts:268`). Slice 1 (line 98) states this correctly. Line 43 must match it. One more consequence: slice 1's domain test ("a `partial` full read over a `complete: true` store … writes `complete: false`") describes what main already does. It does not test this plan's change. (read)
- **`prWindowFor` is at `rules/pr-index.ts:384`, not `:394`** (Cost, line 62). (read)
- **Slice 2 names two caps, and there are three.** `packages/domain/corpus/production.ts:286-290` `readMergeSubjects(estate, mainBranch, limit = 2000)` has the doc comment "the walk's cap, matching `MERGE_SCAN_LIMIT`". The branch-state corpus test (`corpus/branch-state.corpus.test.ts:340, 392`) reads it. After slice 2, on any estate with more than 2000 merges, the corpus feeds the domain 2000 subjects while the scan walks up to 20 000. The two sides of the comparison then read different inputs. The equality test in slice 2 must include this default. (read; I found it with `grep --merges|max-count` over `packages/` and `skills/plot/scripts/`. No other cap on this walk exists. `refs-git.ts:755` takes the cap from its caller.)
- **Slice 2 updates `merge-subjects.ts:22-24` and leaves `:40-41`.** Lines 40-41 say "1723 of 1723 `Merged in` subjects sit on two-parent merges, so a `--merges` walk loses none". The plan measured 7 single-parent `Merged in` commits across about 70 clones (line 111). Lines 40-41 then state the opposite of the plan's own measurement. Slice 2 must also update `:40-41`. (read)
- **Slice 3's per-branch loop contradicts the helper's own stated design, and the plan gives no reason.** `plot-impl-status.sh:251-253` says the merged lookup is "fetched ONCE for the whole plan (constant in branch count)". `pr-list` already accepts repeated `--branch` (`plot-host.sh:4456`). On Bitbucket, `bb_branch_sweep` runs one `bb_branch_query` per branch inside a single process (`:1252`). Those queries follow `next` since #2573 and skip the truncation detector (`:1537`). One call with every unresolved branch costs the same number of Bitbucket requests and keeps the helper's design, and it needs fewer shell lines against `check-shell-lines.sh`. On GitHub, a single branch uses `--head`. With several branches, the GitHub arm uses its own sweep (`:4551-4558`), which slice 3 must read before it chooses either form. (read)

## 3. Each slice against its Changelog line

- **Slice 1:** the Changelog line (16) says the index is no longer recorded as complete. That is observable in the store. Two other effects are also observable, and neither the Changelog nor the Board impact comment (line 20) names them; see N2. `pr_list_states` runs only for Bitbucket (`plot-host.sh:4860-4897`), so "On Bitbucket" in the line is accurate. (read)
- **Slice 2:** line 17 is accurate. On ewz-kus-portal, the scan footer `note: merge scan hit its limit of 2000` (`plot-fleet-scan.sh:5295`) disappears, and the 340 oldest merges become readable. The plan says no July plan changes, and that is consistent with Motivation line 35. The summary (line 3) says "reads the whole merge log", but the walk is capped at 20 000. "Up to 20 000 merges", as the Changelog says, is the accurate wording. (read)
- **Slice 3:** line 18 is accurate and observable in `/plot-deliver`.
- **The ewz-kus-portal symptom:** the narrowed plan no longer claims to fix the board's *state unknown* note (lines 20, 35). The title "an old merged PR stops reading as no PR" is true only for delivery (slice 3). In the scan's listing, an old merged PR on Bitbucket still reads as "no PR". Slice 1 marks the listing as partial but adds no row to it. Until somebody pages `bb_state_listing`, nothing fixes that. N1 shows that nobody now owns that work.

## 4. Open points

- **Scope / v6 `subjects` array (line 116):** the operator decides. The repo's rules favour declining it. *Answers, never verdicts* refuses a persisted re-derivable reading, and `fleet.ts` says "A persisted verdict would be a cache git cannot reach". The plan measures a merge-log read at 0.02 s.
- **Can every `pr-list` caller take exit 7 (line 117)?** The code already answers this, so the survey can be a list in the brief rather than a separate step. (read)
  - `plot-fleet-scan.sh:784` maps rc 7 to `_plv=partial`, keeps the rows, and runs pass 1e under `ok|partial` (`:4521`). It accepts exit 7, but its footer text is wrong for the new meaning (N2).
  - `pr-refresh.ts:1530-1532` takes `partial` and sets `entry.prError = partialSaid` (`:1792`). It accepts exit 7, but the board then shows a PR error (N2).
  - `plot-impl-status.sh:269` runs `2>/dev/null … || true` in a pipeline, so the rows reach `jq` whatever the exit code.
  - `plot-reconcile-scan.sh:537` passes no `--limit`, so the detector returns early (`plot-host.sh:3255`) and nothing changes.
  - `plot-pr-merged.sh:141` passes `--branch`, so the detector does not run (`:1537`) and nothing changes.
  - The plan's fallback, "a stderr marker that the adapter reads", is not needed: the scan already decides completeness from stderr (`:1263-1266`).
- **Reused branch name in slice 3 (line 118):** this needs a measurement. I did not measure whether `bb api` orders the by-name query newest-first. `merged_pr_for_branch` takes the first row (`plot-impl-status.sh:274-277`). The choice is an operator decision only if the measurement shows that a Bitbucket row has no `mergedAt` or merge commit.
- **Drop `--merges` (line 119):** the repo already decided this in `merge-subjects.ts:40-41`. The plan's own numbers (0 on ewz-kus-portal, 7 in about 70 clones) do not overturn it. Keep `--merges`, and correct the comment's "loses none" to the measured figure (see §2).

## 5. New defects

**N1 — The sibling #2400 is Delivered with no code, so the plan relies on an owner that no longer exists.** (ran: `gh pr view 2422`; `git log 18a3456fe..origin/main`; `git show f576060de b2df79eaf`)

- PR #2422 merged at 2026-10-26T14:19:47Z as `eede90c78`. It carries two commits: a claim, and `f576060de` "blocked on bb pr list --all", whose message says "No code change follows".
- `b2df79eaf` "plot: deliver plot-host-bitbucket-pr-list-reads" moved #2400 to Delivered and ticked it in `2026-W43-bugfix-2-28-2.md`.
- `bb_state_listing` on `origin/main` still asks one page.
- The plan says #2400 owns this work in four places: line 31 ("#2400 owns. #2400 is Approved and waits on agent-skills#98"), line 62 ("until #2400 ships"), line 74 (Scope: "#2400 owns paging"), and line 89 (Overlap with #2400). All four are now false.
- The release will publish #2400's Changelog line ("reads every page when the installed `bb` supports `pr list --all`") for a change that is not on main.
- Because of this, slice 1's permanent state ("a Bitbucket store with more than 50 PRs in one state never becomes whole", line 62) has no end date.

Required change: the plan must name the new owner. There are two options.

- (a) The operator runs `/plot-reject` on #2400, and this plan keeps its current text with a dated note.
- (b) Slice 1 pages `bb_state_listing` itself, by following `next` through `bb api`. `bb_branch_query` (#2484/#2573) and `bb_window_listing` already do this, and neither needs agent-skills#98. #2400's own Approach chose `bb pr list --all` only because that was the route it planned. #2400 measured `bb api` as cheaper (3 requests against 8). With this option, slice 1 makes the listing complete instead of only marking it partial, and the title becomes true for the scan as well.

This plan must not ship while #2400 reads Delivered and this plan says #2400 owns the work.

**N2 — Slice 1 gives exit 7 a second meaning, and the code's documented contract for exit 7 disagrees with it.** (read)

- `plot-host.sh:960-970` defines `PR_LIST_PARTIAL_RC` as "some answered and some did not". The same comment says "A SINGLE-STATE CALL HAS NO PARTIAL ANSWER TO REPORT". `scripts-shell.ts:101-110` says the same.
- After slice 1, a single-state call (for example `--state merged --limit 500`, or the scan's `--state open --limit 3000 --rich`) exits 7 when no state failed.
- Two readers turn this into wrong text for people:
  - `plot-fleet-scan.sh:5332-5336` prints "the git host answered for some states and not others … Re-run to get the whole list". On ewz-kus-portal, that note appears on every scan, it is false, and a re-run does not clear it.
  - `pr-refresh.ts:1792` writes the partial sentence into `prError` on every refresh. The board's `prStatusEntry`/`prStatus` (`host-notes.ts:376-395`) then shows a PR error that never clears.
- The Board impact comment (line 20) says the scan's wave gate is the only board change.

Required change, either one of these:

- Give the short listing its own stderr word, and update the three texts (`plot-host.sh:960-970`, `scripts-shell.ts:101-110`, `plot-fleet-scan.sh:5332`) to state both causes.
- Or make slice 1 page the listing (N1 option b), so that exit 7 keeps its single meaning.

In both cases the Board impact comment must name the PR status entry.

**N3 — Approach line 43 contradicts slice 1 and `wholenessAfter`** (see §2).

**N4 — Slice 2 misses the corpus cap, and it leaves `merge-subjects.ts:40-41` contradicting the plan's own measurement** (see §2).

**N5 — Slice 3's per-branch calls contradict the helper's stated design "constant in branch count"** (see §2). The plan must give a reason for this, or use one call with repeated `--branch`.

No other contradiction found:

- With #2386 (read): the plan correctly records that PR #2436 closed unmerged. #2386's own Design paragraph still says proposal 1 "has shipped", which is a defect of that plan and not of this one.
- With #2484 and #2560 (read).
- With the active sprint items I read: #2158 (impl-status host resolution, done) and #2479 (reconcile-scan sections 7 and 20-24, open). Neither touches `pr_list_states`, the merge walk or `merged_pr_for_branch`. I did not read the other 26 items beyond their titles.
- With *A Decision Reads The Index*, *One Answer To "Did This Land"* or the layering rule (read): slice 3 keeps the host's `MERGED` as the deciding answer, and nothing writes the index.
