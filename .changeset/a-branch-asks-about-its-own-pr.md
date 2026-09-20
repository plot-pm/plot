---
'plot': patch
---

A Bitbucket pull-request lookup asks the host about the branches it tracks rather than listing every pull request in the repository. `bb pr list` returns a fixed page of 50 per state, so on the repository measured 2026-09-20 — 886 merged pull requests — 836 of them never reached the join that indexes by branch, and every branch whose pull request was among them read as `commits, no PR ever opened`. An operator saw that verdict on branches with live pull requests. `pr-list` gains a repeatable `--branch`: given branches, the Bitbucket arm queries the REST endpoint about each one by name through the same `q=` filter `bb` already builds for `--author`, one exact query per branch per state; given none, the four existing callers get the listing they always got and the page-truncation detector still fires on it. Paging the listing was measured and refused — the declared per-refresh cost stretches the board's cadence, so 18 merged pages take the interval from 240 s to 1260 s and a busy account to 2.8 hours, and paging costs grow with pull-request history while a sweep costs what the caller tracks and is constant in pull-request count. Completeness now comes from the adapter's own statement rather than from a row count: a sweep says how many branches it asked and how many states answered, a partial sweep says nothing and exits 7 with the survivors' rows, and `plot-fleet-scan.sh` writes `.list-complete` on the statement while the listing path keeps the row-count heuristic unchanged. `PR_REQUESTS_PER_REFRESH` stays 4, which is what the board's own refresh spends, and now records that moving it onto the sweep means `branches × 3 + 1`.

<!--
plan: docs/plans/2026-09-20-a-pr-list-reads-every-page.md
bumps:
  skills:
    plot: patch
-->
