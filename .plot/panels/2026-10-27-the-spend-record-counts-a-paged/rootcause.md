# Juror: rootcause

Position: amend

Lens: reproduce. All line numbers are from `pmain` at `4a1b8a5fa` (origin/main).

## 1. The problem

**The named cause is real (ran).** I ran `plot-host.sh pr-list --state merged --limit 500` in a scratch GitHub-remote repo against a fake `gh` that returns 0, 99, 100, 101 and 500 rows, with `HOME`/`PLOT_BUDGET_HOME` in a scratch dir. Every run wrote exactly one `b1 github … graphql … 1` line. 500 rows, about 5 real GraphQL pages, recorded `spent` 1.

**The mechanism (read).** The three GitHub `pr-list` sites (`plot-host.sh:4731`, `:4776`, `:4808`) call `pr_list_call gh … pr list`. `gh` is the wrapper at `plot-host.sh:3888-3894`: it runs `command gh` once, then calls `budget_record_call github github <bucket>` once. `budget_record_call` (`:3651`) passes a literal `1` to `budget_append` on both paths (`:3665`, `:3670`). `gh pr list` cannot be harvested (`:5855-5859`), so the line is basis `unknown`.

**The readers sum `spent` (read).** `plot-budget.sh:613,628` sums field 6; `packages/domain/src/rules/budget-record.ts:195` reduces `entry.spent`. So a larger `spent` reaches `localSpenders` (`board/src/server/fleet.ts:7431`) and `mine=` (`fleet/src/server/entry/registryd.ts:590`) with no reader change. The plan is right on this point.

**The two callers in the issue exist (read).** `registryd-main.ts:790` (`mergedBranches`) and `plot-fleet-scan.sh:1063` (`pr-list --state all --limit "$PR_LIST_LIMIT"`). Both go through `plot-host.sh pr-list`, one process each.

**The plan misstates `issue-list`, and that is the main finding (ran).** Design step 3 says GitHub `issue-list` "pages through its own `--page-token`, one request per call, and stays at `1`". That is false for GitHub. `plot-host.sh:5466-5467` already records each page past the first:

```
# `gh` pages by 100 inside ONE process and the wrapper records one call
# per process, so each page past the first is recorded here.
jq -r "[range(1; length / $ISSUE_PAGE_ROWS | ceil)] | .[]" <<<"$out" | while read -r _; do budget_record_call github github graphql; done
```

It landed in `ce6602da9` (#1653, 2026-10-13). I ran `issue-list --limit 300` against the fake `gh`: 100 rows record 1 line, 101 rows record 2, 250 rows record 3. `--page-token` is the Jira arm's paging. The Notes line "Deliverable search … nothing builds a request count" is also false: this is exactly a request count for a paged GitHub listing, the same derivation the plan proposes. No test pins it: `grep budget` across `test/reconcile/host.test.mjs` finds only a Jira budget test (`:10924`).

**Scope: other paged calls with the same miscount (read).**

| Site | Call | Paged? | Recorded |
|---|---|---|---|
| `plot-host.sh:4731/4776/4808` | `gh pr list --limit N` | yes, `ceil(rows/100)` | 1 — the plan's subject |
| `plot-host.sh:4300` (`pr-merge-dest` / merge-commit lookup) | `gh pr list --head … --limit $limit`, limit doubles 100→200→400 | yes past 100 rows | 1 per process — same defect, rare (one head with 100+ PRs) |
| `plot-host.sh:684` `gh_marker_comment_id` | `gh api --paginate …/comments` (REST `core`, 30 per page) | yes past 30 comments | 1 — same defect, `core` bucket |
| `plot-host.sh:5021`, `:5157` | `gh run list --limit` (default 10) | only past 100 | 1 — not reached by current callers |
| `plot-host.sh:5456` GitHub `issue-list` | `gh issue list` | yes | already counted (`:5467`) |
| Bitbucket `pr-list` via `_bb_paged_walk` (`:1159-1185`) | one `bb … api <path>` per page | walked in shell | one line per page, correct: each page is its own `bb` process through the `bb()` wrapper (`:3897`) |
| Bitbucket `issue-list` (`:5492`) | `bb issue list`, one process | unmeasured whether `bb` pages internally | 1 |
| Jira | `budget_append jira … 1` (`:3173`) per request; `--paged` is one request per call | no | correct |

So the plan's open question about Bitbucket has an answer in the code: the walked `pr-list` already records per page (read, not run; the `bb` arm needs a capability probe I did not fake). `plot-listing-walk.mjs` (#2730) only decides when the walk stops (`walkStep`, `listing-page.ts:89`); it spends nothing and records nothing.

## 2. The approach against the code

The derivation `max(1, ceil(R / min(N,100)))` matches how `gh pr list` pages (`first: min(limit,100)`, loop until `limit` rows or no `hasNextPage`). That is from my reading of `gh`'s source, not run against the real host.

**The plan's mechanism double-counts as written.** Step 2 gives `budget_record_call` a fourth argument and "passes it to `budget_append` in place of the literal `1`". But for `gh pr list` the only `budget_record_call` is inside the `gh()` wrapper, which runs before the rows are known and cannot see them. A slice that adds a second `budget_record_call … N` from the `pr-list` arm records `1 + N`. The plan must name one of:

- record the pages past the first after the call, as `issue-list` does (`spent` N−1 on one extra line, via the new fourth argument, or N−1 lines as today), or
- bypass the wrapper with `command gh` at these sites and record `N` once, as `gh_api_harvest` does for its own reason (`:3740-3746`).

The first is the existing pattern and needs no change to the wrapper. I recommend one helper, for example `gh_record_extra_pages <bucket> <rows>`, called by the `issue-list` arm and the three `pr-list` sites, which replaces the `:5467` one-liner. That keeps one derivation and keeps the `check-shell-lines.sh` cost near zero.

**Page-size constant.** `:5467` divides by `ISSUE_PAGE_ROWS` (`:647`), which is also the Jira page bound (`:5372`). A GitHub listing must use its own constant (`gh`'s 100). A Jira change to `ISSUE_PAGE_ROWS` would otherwise change the GitHub count.

**Layer.** This is adapter bookkeeping, in the adapter. A one-line arithmetic in shell is acceptable under "A Shell Script Asks The Domain"; `listing-page.ts` models GitHub as `honours-limit` and has nothing to reuse.

**Unit.** The record will count requests. GitHub's `graphql` bucket meters points, and a rich listing (`statusCheckRollup`, nested connections) can cost more than one point per page. The comment and Changelog should say "requests", so nobody reads `mine=` as points.

## 3. Safety

Nothing removes, merges, delivers or releases. The record feeds display (`localSpenders`, `mine=`) and the PR pass's cadence stretch, which slows reads and is reversible. `graphql_budget_spent` (`:2411`) reads `remaining` with basis `actual`, not `spent`, so it does not change. `host_concurrency_bound` (`:3822`) reads `limit`, not `spent`. A double count (section 2) would only over-slow the PR pass; it is still a defect.

## 4. Slices and acceptance

One slice is right. Its acceptance is checkable and fails today: a fake `gh` returning 500 rows for `pr-list --limit 500` must sum `spent` 5 in `budget.tsv` (today 1, ran). It must also assert the sum is not 6, which catches the double count. Add the missing test for the existing `issue-list` count (101 rows → 2), since the slice will touch that code.

## 5. New defects to avoid

- `check-shell-lines.sh` ratchets plot-host.sh; the plan does not name the offset. A shared helper that replaces `:5467` pays for itself.
- Bash 3.2: the `issue-list` pattern (`jq … | while read`) is portable; keep any new arithmetic in `jq` or `$(( ))`.
- The `--rich-open` path re-enters `"$0" pr-list` twice (`:4612-4620`); each child records its own pages, so the count must stay inside the child and not be added again by the parent.
- Project-agnostic: unaffected; the change is per backend arm.

## Amendments

1. Correct Design step 3 and the Notes: GitHub `issue-list` already records its pages at `plot-host.sh:5466-5467` (#1653). Name it as the precedent and reuse it.
2. State how the count avoids the `gh()` wrapper's own `1` (`plot-host.sh:3888-3894`): record pages past the first, or bypass the wrapper. Acceptance asserts 500 rows → `spent` sum 5, not 6.
3. Extract one helper used by `issue-list` and the three `pr-list` sites (`:4731`, `:4776`, `:4808`), with a GitHub page-size constant separate from `ISSUE_PAGE_ROWS`.
4. Decide scope for `:4300` (`pr list --head` with doubling limit) and `:684` (`gh api --paginate`, `core`): include them, or list them as out of scope.
5. Close the Bitbucket open question from the code: `_bb_paged_walk` already records one line per page; only `bb issue list` remains unmeasured.
6. Say in the code comment and Changelog that `spent` counts requests, not GraphQL points.
7. Name the `check-shell-lines.sh` offset, and add a test for the existing `issue-list` page count.
