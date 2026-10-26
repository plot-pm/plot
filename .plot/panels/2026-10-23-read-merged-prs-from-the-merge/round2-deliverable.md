# Round 2 — deliverable

Lens: does every slice name something that ships, and does the Changelog describe what the slices build and nothing more?

Position: amend

Code read on `panel2419-main` at `18a3456fe`. Measurements ran read-only on ewz-kus-portal (`git log`, `git ls-tree`, `git show` against `origin/develop`). No host call, no test suite.

## 1. Round-1 findings

| Round-1 item | Status | Plan line |
|---|---|---|
| Agreed 1: a subject row reaches delivery | Resolved. No subject row enters the index. | 49-53 |
| Agreed 2: the `whole` fold erases rows | Resolved by removal. "Written once" withdrawn. | 55 |
| Agreed 3: the addendum is mostly uncovered | Scoped out, each point with a reason. | 69-80 |
| Three-juror: a truncated listing records `complete: true` | Taken as slice 1. Slice 1 introduces new defects (section 5). | 43, 98 |
| Disagreement 1: cursor or full walk | Resolved: full walk. | 44, 124 |
| Disagreement 2: does the slice reach the board | Resolved: the board sentence left the Changelog. The July plans' *state unknown* comes from HTTP 429. | 20, 35 |
| Disagreement 3: where the saving is | Resolved: 0 requests saved, stated. | 61-65 |
| Disagreements 4 and 5: `plot-approve` lookup, declined PRs | Scoped out with reasons. | 79-80 |
| Blind spot 1: the walk saturates at 2000 | Taken as slice 2. On ewz-kus-portal no answer changes (section 3). | 44, 102 |
| Blind spot 2: `complete: true` evidence from a stale store | Resolved: the plan re-read the path on current code. I confirm it by reading (section 2). | 26-30 |
| Blind spot 3: Bitbucket squash subject unmeasured | Measured. The walk question is still an open point. | 111, 119 |

## 2. Approach against the code (read)

Slice 1:

- `bb_state_listing` asks one `pagelen=50` page and does not follow `next` (`plot-host.sh:1393-1406`). True.
- `pr_list_states` returns 0 when every state answered, and `PR_LIST_PARTIAL_RC` only when a state failed (`plot-host.sh:1488-1553`). True.
- `scripts-shell.ts:99` and `:111`: the file is `packages/domain/src/adapters/scripts/scripts-shell.ts`. Its exit-0 line returns `answered` and stdout only, without stderr. Exit 7 returns `partial` with stdout and the whole stderr as `said`. True.
- `pr-refresh.ts:1499-1500` passes `--limit`, so the truncation report fires on a full read. A delta sets `PR_LIST_SINCE`, so `bb_window_listing` pages fully and makes no page claim. True.
- On Bitbucket, `--rich-open` only sets `rich=1`. The two-call split is GitHub-only (`plot-host.sh:4521-4572`). The Cost line "each call asks `--rich-open` instead of `--rich`" therefore changes nothing on Bitbucket.
- The GitHub arm does not call `pr_list_states` (`plot-host.sh:4656-4738`), so slice 1 is Bitbucket-only, as the Changelog says.
- The slice's domain test already exists. `packages/domain/test/pr-index.test.ts:205-220` folds `partial` over a `complete: true` store and asserts `complete: false`. Slice 1's new behaviour is the shell exit code and what each caller does with it.

Slice 2:

- `MERGE_SCAN_LIMIT=${PLOT_MERGE_SCAN_LIMIT:-2000}` (`plot-fleet-scan.sh:472`) and `MERGE_WALK_LIMIT = 2000` (`registryd-main.ts:599`, used at `:629`). True.
- No other code caps the same walk. `refs-git.ts:755` takes `max` from its caller, and the only caller is `registryd-main.ts:629`. The board's `merge-subject.ts:39` mentions 2000 only in a comment about the stdin format. That comment goes stale if the cap rises, and the slice does not name it.

Slice 3:

- `plot-impl-status.sh:269` asks `pr-list --state merged --limit 500`. True.
- `PR_LIST_BRANCHES="$branches"` is at `plot-host.sh:4786`. True. `bb_branch_query` pages through `_bb_paged_walk` (`plot-host.sh:1150-1155`), so a by-name query reads every page. True (#2573 is `3a06a3a30`).
- GitHub sets `--head` for exactly one named branch (`plot-host.sh:4488`). True.

## 3. Each slice against its Changelog line

**The narrowed plan no longer claims to fix the ewz-kus-portal symptom, but it still opens with that symptom.** Motivation line 24 presents the three July plans as the reason for the plan. Line 35 and the Board-impact comment (line 20) then say no slice changes them. The title and summary (lines 1-3) say nothing about this. A reader who stops at the summary expects the July plans to stop reading *state unknown*. The summary must say that the July plans' display is out of scope and why (HTTP 429, #333, the watch list in Scope).

**Slice 1 — Changelog line 16.** "No longer records the PR index as complete" is the store effect, and it is true. The line omits what an operator sees, and the plan's Board-impact comment says the board does not change. That is false (read):

- `pr-refresh.ts:1792` writes `entry.prError = partialSaid`, and `partialSaid` is the whole stderr (`scripts-shell.ts`).
- `extractHostNotices` (`rules/pr-status.ts`) strips only the four notice forms. "possibly truncated" and the new partial line stay in the remainder. `refusalKind` (`rules/refusal.ts:59-64`) calls any remainder `outage`, and `prStatusLevel` gives `warning` while data is on screen.
- So on every Bitbucket repository with more than 50 PRs in one state, the board shows *"PR data stale — host unreachable (plot-host: bitbucket pr-list state=merged possibly truncated …)"* after every refresh, until #2400 ships. The host is reachable.

**Slice 2 — Changelog line 17.** "A branch merged before the 2000th-newest merge reads as merged" changes no answer on any measured estate. Ran on ewz-kus-portal `origin/develop`:

- 2340 merges. Merges 2000 and 2001 are `Pull request #1566: …` and `Pull request #1593: …` from 2023-12-08. That is the Bitbucket Data Center form, which `merge-subjects.ts:15-20` says names no branch.
- 0 `Merged in` subjects lie past the 2000th merge. All 1770 lie within it. The oldest is merge 1818, `pull request #1802`, from 2024-01-23.
- The first file under `docs/plans` arrived on 2026-07-10, so every Plot-era merge is about 1800 merges inside the cap.
- This repository holds 677 merges (round 1).

The visible change on ewz-kus-portal is that the scan's footer note *"merge scan hit its limit of 2000 — older merges were not examined"* (`plot-fleet-scan.sh:5294-5296`) disappears, because 2340 < 20 000. The Changelog does not say that. The Board-impact comment's "a refless branch … moves from `open` or `unknown` to `merged`" names a branch that does not exist on either measured estate.

**Slice 3 — Changelog line 18.** It ships a visible change: `/plot-deliver` resolves a merged PR beyond the newest page. Two corrections:

- "On Bitbucket" understates it. The slice changes `plot-impl-status.sh` on every backend, so GitHub also moves from one `--limit 500` listing to one `--head` call per branch. This repository's PR numbers pass 2700, so GitHub gains the same fix. The Changelog should say so, or the slice should limit itself to Bitbucket.
- No instance is measured. On ewz-kus-portal, 5 of 9 active plans already carry `→ #N` on their slice line (3853, 3879, 3881, 3889, 3890) and skip this lookup. The other 4 (3819, 3893, 3894, 3895) are from September and October 2026. The plan names no delivery that refused. That is acceptable for a bug fix, but the Motivation sentence "a complete 500-row page misses most merged PRs" counts all 1770 merges, while delivery only asks about the plans being delivered.

## 4. Open points

- **[Scope] accept the reshaped scope** — still the operator's decision.
- **[Technical] can every `pr-list` caller take exit 7** — the code answers it now, and the answer is no (read):
  - `plot-reconcile-scan.sh:738` runs the call inside `if … then`. Exit 7 skips the branch, and the 50 merged heads it reads today are lost.
  - `plot-open-pr.sh:116` runs `|| pr_rows=""`. Exit 7 empties every row, so `openSlicePr` sees no earlier PR for the branch. The plan's survey list (line 117) does not name this caller.
  - `plot-fleet-scan.sh:785-786` reads 7 as `partial` and keeps rows. With an empty tracked set it uses the bulk listing and then prints *"the git host answered for some states and not others"* (`:5332-5336`). That sentence is false for a short listing. With tracked branches it sweeps and never reaches the truncation report.
  - `plot-pr-merged.sh:141` passes `--branch`, so it sweeps and is unaffected.
  - `plot-impl-status.sh:269` keeps its rows (pipe plus `|| true` under `pipefail`), and slice 3 replaces the call anyway.
  - The plan's fallback already exists. The adapter can read the "possibly truncated" line that exit 0 already prints, in `scripts-shell.ts` or `pr-refresh.ts`, and fold `partial`. No shell caller changes, and the slice decides separately whether `prError` carries the line.
- **[Domain] reused branch names in slice 3** — partly answered by reading. The Bitbucket row's `mergedAt` is `.updated_on` of a MERGED PR (`plot-host.sh` Bitbucket arm). It moves when anyone comments on the PR, so it does not record when the PR merged. The row does not carry the merge commit. Whether to add `merge_commit.hash` to the row is still a design decision for slice 3.
- **[Technical] drop `--merges`** — the operator decides, from the stated numbers. On ewz-kus-portal 0 single-parent commits carry a `Merged in` subject, so the default changes nothing there.

## 5. New defects

1. **Slice 1 drops rows that two callers read today.** `plot-reconcile-scan.sh:738` and `plot-open-pr.sh:116` discard stdout on a non-zero exit. On a Bitbucket repository with more than 50 PRs in a state, both get fewer rows after slice 1 than before. The slice's tests do not cover either caller.
2. **Slice 1 shows a false outage on the board.** See section 3. Neither the Changelog nor the Board-impact comment names it.
3. **Slice 1 ends the delta.** A store that never becomes complete gets a full read on every refresh (`prWindowFor`, `rules/pr-index.ts:394`). Today a delta goes through `bb_window_listing`, which pages through every changed PR. After slice 1, every refresh reads one 50-row page per state. Before choosing to give up the paged delta until #2400 ships, the plan needs the sort order of Bitbucket's unfiltered `pullrequests` listing, which is not measured. The Cost section counts requests only.
4. **Slice 2's Changelog line describes no reachable case.** Section 3 has the measurement. Restate it as the saturation note leaving ewz-kus-portal's scan footer, plus the stale `2000` in `board/src/server/entry/merge-subject.ts:39`.
5. **Slice 3's Changelog says "On Bitbucket" for a change on every backend.**

## Changes needed for proceed

- Summary and Motivation: state that the July plans' *state unknown* is out of scope, and name what would fix it.
- Slice 1: choose the adapter-side reading of the existing "possibly truncated" line, or name and test `plot-reconcile-scan.sh:738` and `plot-open-pr.sh:116`. Say what the board shows for a short listing, and correct the Board-impact comment. Replace the redundant domain test with a caller test.
- Slice 2: rewrite the Changelog line and the Board-impact comment to name the change an observer sees.
- Slice 3: drop "On Bitbucket", or limit the slice to Bitbucket.
