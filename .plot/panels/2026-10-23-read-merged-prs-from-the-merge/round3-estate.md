# Round 3 — estate

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `9774d8e1b`. Code read on `origin/main` `8f87cb9c4` in the `panel2419-main` worktree. Lens: does this already exist, and what does the estate already say about it?

Position: amend

## Estate facts the plan does not carry

1. **A Released plan rejected this exact paging shape for #333, and the plan does not cite it** (read). `docs/plans/2026-09-20-a-pr-list-reads-every-page.md` (Released 2.19.0, #333), section *Why not page the list — the shape this plan rejected*: an earlier version walked `next` through all 18 merged pages, and two lenses refuted it because paging cost grows with PR history and the cadence follows it (4 → 21 requests, 240 s → 1260 s). It shipped the per-branch query instead (`bb_branch_query`, `bb_branch_sweep`), which slice 3 now reuses. The amended plan revives the paged listing. Its Cost bullet 1 (plan line 91) answers the cadence argument in substance: the PR index now runs deltas and one full read per 24 h, so `PR_REQUESTS_PER_REFRESH.bitbucket` stays 3. That store did not exist on 2026-09-20. But the plan names neither the precedent nor what changed since, and Notes (line 154) cite #333 only as "truncated merged list". The precedent also lists what a paged listing must not break: the fleet scan's completeness guard (`.list-complete`). On main that guard is `plot-fleet-scan.sh:1262-1274`: it licenses `NONE` on a `page complete` line from both calls, or on the row-count fallback `_pr_rows < PR_LIST_LIMIT` (3000). Slice 1 changes both inputs on Bitbucket, and slice 1's test list has no fleet-scan case. The precedent's note "`bb`'s own paginator caps at 10 pages, any future slice that does page must not reach for that helper" is consistent with slice 1, which uses `bb api`.
2. **#2400's state on main is neither "Delivered, plan file unchanged" nor "Approved"** (read, `git log` on main). `6666041ff` (15:38:04) rejected #2400 and added a `Rejected:` record that names this plan's slice 1. `c67b5cd1f` (15:38:47, 43 s later) delivered it again: `State: Delivered`, symlink back in `delivered/`, sprint item ticked. So plan line 158 "#2400's plan file is unchanged" is false, and lines 32, 133 and 166 describe the pre-rejection history only. The brief's "Approved again" is also stale against `8f87cb9c4`. #2400's Changelog line still says the listing "reads every page ... when the installed `bb` supports `pr list --all`", a change that is not on main and never will be under that plan. No `.changeset` file names #2400 (ran `grep` over `.changeset/`), so the release notes do not carry it, but `/plot-release` step 3 cross-checks plans against changesets and will meet a Delivered plan whose Changelog describes code nobody wrote. The plan says so in one clause (line 158) and assigns no owner.
3. **Lowering the queue to 50 reverses a measured fix, and slice 1 leaves its comment standing** (read). `registryd-main.ts:782-788` says the limit is "EXPLICIT AND LARGE" because on 2026-09-06 a default page missed #707 and #710 and held their plans. The plan's argument for 50 is the index join (`queue-reading.ts:323-332`, added for #1454 on 2026-10-10), which is real. But `prIndexRows` yields nothing for a missing or other-version store, and the only Bitbucket store on this machine is ewz-kus-portal's `v: 2` file (round 2 blind spot 1). On Bitbucket the queue reads one 50-row page today, so 50 changes nothing there. On GitHub it shrinks from 500 to 50 whenever the store is unreadable. Slice 1 must name that case and rewrite the `:782-788` comment, which otherwise states the opposite of the code.
4. **The Cost table misses a `prList('merged', …)` caller** (read). `packages/board/src/server/entry/review-bypass.ts:46` (`plot-review-bypass.mjs`, reconcile §20a, `plot-reconcile-scan.sh:2615`) lists `--limit $MERGED_PR_LIMIT` = 500 (`:432`) and then calls `host.prReview` once per listed PR, with no `since` filter before the read (`:47-60`). On Bitbucket each `pr-review` is one `bb api` GET plus two `_bb_paged_walk` reads (`plot-host.sh:4299-4310`), so at least 3 requests. Today the listing returns 50 PRs: about 151 requests. After slice 1: 10 + 1500. This runs only where `Review required since` is set. ewz-kus-portal does not set it (read its `AGENTS.md` Plot Config), so the measured estate is unaffected, but the plan's table claims to list the callers.
5. **The Shell Lines fallback contradicts Approach 2** (read). Plan line 103 offers "reuses `_bb_paged_walk` with a page-cap argument". `_bb_paged_walk` (`plot-host.sh:1132-1148`) prints *possibly truncated* and **returns 3** at its cap. Approach 2 requires exit 0 at the limit. `bb_branch_query` and `pr-review` share that walk, and their exit 3 at the cap is their contract. The fallback needs a second mode, and the slice must keep the shared callers' exit 3.

## 1. Round-2 findings

| Round-2 item | Disposition | Plan line |
|---|---|---|
| A1 exit 7 shows a false *host unreachable* | resolved: no exit 7 for a short listing | 47, 163, 167 |
| A2 exit 7 gets a second meaning | resolved | 47, 167 |
| A3 callers lose rows on exit 7 | resolved; their request counts are in Cost | 84-86, 168 |
| A4 slice 3 duplicates the deliver gate | scoped with reasons (PR numbers for step 5, no new rule) | 52-61, 173 |
| A5 slice 2 Changelog names no reachable case | restated to the footer note | 17, 172 |
| A6 existing domain test, wrong line 43 | resolved | 47, 175 |
| D1 third merge-walk cap | resolved, plus equality test | 49, 146, 171 |
| D2 what slice 1 becomes | resolved: it pages | 46, 142 |
| D3 is slice 1 worth its price | partly: Cost prices it; two new open points | 91-93, 170, 174 |
| D4 slice 3 one call or many | resolved: one call, repeated `--branch` | 50, 150 |
| #2400 delivered with no code | resolved in text, now stale: see estate fact 2 | 32, 133, 158, 166 |
| GitHub `complete: true` at 1000 | left open as an operator decision | 174 |
| `merge-subjects.ts:40-41` comment | in slice 2 | 146 |
| Summary opens with the July plans | resolved | 3 |
| No shell-line offset for slice 1 | resolved, but the fallback is wrong: estate fact 5 | 103 |
| Stale `2000` in `merge-subject.ts:39` | in slice 2 | 146 |
| `prWindowFor` line | resolved (`:384`, read) | 92 |
| Blind spot 1, page order and live v5 store | page order measured; live store still unmeasured, no line names it | 34, 156 |
| Blind spot 2, what the plan is for | answered: slice 1 does #2400's paging | 32, 133 |

## 2. Approach against the code

Read on `8f87cb9c4`, every cited line checked:

- `bb_state_listing` `plot-host.sh:1393-1406`, one page, never follows `next`: true.
- `_bb_paged_walk :1132`, `bb_window_listing :1309`, `bb_branch_sweep :1222`, `PR_LIST_PARTIAL_RC=7 :935`, exit meanings `:960-970`, `pr_list_report_truncation :3250`, GitHub truncation at `:4735-4736`, `--head` for one branch `:4488`, notice `:4771`: all true.
- The Bitbucket arm of `pr_list_report_truncation` (`:3262-3266`) gives the result slice 1 needs without change: `next=0` prints *page complete*, and a last page with `next` present and 1000 rows fails the 50-row length test and prints *possibly truncated*. The domain mirror then disagrees in name only: `listingPagingFor` reports Bitbucket as `fixed-page`, which stops being true. The slice should say whether it becomes `honours-limit`, or say why it stays.
- `registryd-main.ts:791` `prList('merged', 500)` and `:599` `MERGE_WALK_LIMIT = 2000`: true. `registryd.ts:80` `TICK_INTERVAL_MS = 60_000` (in `packages/fleet/src/server/entry/`): true.
- `queue-reading.ts:325-332` index join: true (the block runs `:323-332`).
- `plot-fleet-scan.sh:472`, `:1047`, `:1063`: true. `PR_LIST_LIMIT` is 3000 (`:691`).
- `production.ts:286-290` `limit = 2000`: true.
- `pr-refresh.ts:249` `bitbucket: 3`, `:303` `PR_LIMIT = 1000`, `:331` `PR_FULL_READ_MS`, `:1499` full-read call, `:1781-1792` partial path: true.
- `rules/pr-index.ts:268-269` `wholenessAfter`, `:384` `prWindowFor`: true. `scripts-shell.ts:99` exit 0 → `answered`: true (path is `adapters/scripts/scripts-shell.ts`).
- `deliverability.ts:182` `prMerged` per branch: true (path is `packages/board/src/server/controllers/deliverability.ts`, not the domain).
- `plot-impl-status.sh:245-251` early-exit loop, `:254-262` header ("constant in branch count"), `:269` the call, `:274-277` first-row pick: true, despite #2158's delivery on 2026-10-25 touching that file.
- Slice 3 on both hosts: `--branch` accumulates (`plot-host.sh:4456`); on Bitbucket a non-empty list selects the sweep; on GitHub only one branch becomes `--head`. True as the plan states. The sweep fails the whole state if one branch fails, and the caller's `2>/dev/null || true` then reads no rows: the conservative direction.
- False or stale: Cost misses review-bypass (fact 4); the Shell Lines fallback (fact 5).

## 3. Slices against the Changelog

- Slice 1 → line 1: observable through `pr-list` output and the board's PR rows. Accurate. It should also say the queue limit change, which is a behaviour change on GitHub too.
- Slice 2 → line 2: observable as the footer note disappearing. Accurate, and modest.
- Slice 3 → line 3: observable in step 4's report. Accurate; "on Bitbucket" holds because GitHub keeps the listing for several branches.
- The ewz-kus-portal symptom: the summary (line 3), Board impact and Scope (line 124) say the July plans' *state unknown* comes from HTTP 429 and stays. The plan no longer claims that fix. Motivation line 24 still opens with that symptom; the Changelog does not.

## 4. Open points

- Line 162, scope: operator decision.
- Line 164, reused branch names: the code answers the current pick (`plot-impl-status.sh:274-277` first row; `merged-row.ts` lowest number, not re-read here). Whether a Bitbucket row carries a merge commit is unmeasured; slice 3 measures it. Operator need not decide before approval.
- Line 165, `--merges`: the numbers are in the plan; operator decision.
- Line 170, partial back-off: a design choice inside slice 1. It is the one point that changes request spend under 429, which is ewz-kus-portal's live condition, so it should be decided before approval, not in the slice.
- Line 174, `complete: true` above `PR_LIMIT`: operator decision. The estate adds that GitHub has had it since the store existed and nothing reads the flag for a lookup (round 2, read).

## 5. Amendments needed

1. Cite `2026-09-20-a-pr-list-reads-every-page` in Motivation or Notes, state what changed since its rejection of paging (delta refresh and the daily full read), and add its must-not-break item to slice 1's tests: a Bitbucket fleet scan with no tracked branch writes `.list-complete` only when both calls print *page complete* or the row-count fallback holds (`plot-fleet-scan.sh:1262-1274`).
2. Correct lines 32, 133, 158 and 166 to the history on main (`6666041ff` reject, `c67b5cd1f` redeliver), and say who corrects #2400's Changelog line or why it stays.
3. Slice 1 rewrites the `registryd-main.ts:782-788` comment and names the unreadable-store case for the 50-row queue limit.
4. Add `review-bypass.ts:46` (reconcile §20a) to Cost.
5. Replace the `_bb_paged_walk` fallback in *Shell Lines* with one that keeps exit 3 for its current callers, or drop it.
6. Name the package of `deliverability.ts` (`packages/board`, not the domain).
