---
"plot": patch
---

The no-ref arm already reads the join, and now a test says so

This branch set out to stop the no-ref arm of `branch_state` from asking the
host about a branch the repo-wide `pr-list` had already answered for. It turns
out to do that already. What was missing was a test, and the reason the gap
mattered is that the property is invisible from the outside: every answer is
correct either way, and only the clock differs.

**What was measured, and what it showed.** The reported symptom was real and
reproduced exactly — a counting wrapper around `gh` recorded **16 calls, 15 of
them `pr view`**, on a 34.7 s scan against the board's 30 s budget. But the 15
are not what the diagnosis assumed. Every one of them has no ref on origin
*and* is absent from the list that arrived:

| The 15, checked individually | |
|---|---|
| refs on origin | 0 of 15 |
| named by the arrived `pr list --state all` | **0 of 15** |

They are branches a plan names that nobody has pushed yet — no ref because the
work has not started, and no PR because none was opened. That is the case the
plan itself calls "the genuinely unknown branch … which correctly costs one
call". Reducing it would mean reading an arrived list's silence as evidence of
no PR, which is `an-outage-is-not-an-answer` inverted.

**The branches offered as proof of the defect already cost nothing.** PRs #252,
#253 and #254 — `feature/the-plan-meta-reports-a-changelog`,
`feature/a-sprint-proposes-its-work`, `feature/the-scan-derives-its-plan-list`
— are each named by an active plan, each return 0 refs from
`git ls-remote --heads`, and each appear in the list as `MERGED`. The counting
wrapper recorded **zero** `pr view` calls for all three.

**Why it already works, and why that is fragile.** `merged_by_host` does pass
`--ask` unconditionally, which is what the diagnosis pointed at — but
`host_pr_state` consults the per-branch cache *before* it reaches the `--ask`
arm, so a joined branch returns from the join and the flag never costs
anything. The saving therefore rests entirely on the order of two adjacent
blocks. Hoist the ask above the cache read, or gate the cache read on the
no-ask path, and every merged-and-deleted branch pays a round trip again with
every rendered verdict still correct. On Bitbucket, where one call was measured
at ~10 s against GitHub's 461 ms, that silent reordering is the difference
between a scan and a timeout.

**So the cost shape is the opposite of what was feared.** Shipping a branch
makes it appear in the list and costs nothing; the scan does not get slower as
the team ships. *Planning* a branch costs one call until someone pushes it, so
the remaining cost tracks planned-but-not-started work — bounded by the plan
estate rather than growing with completed work.

The test that pins this arrives with the list *naming* the branch, which is what
separates it from the two count tests already beside it: both of those stub
`pr-list` to emit nothing, so they establish what a no-ref branch costs when the
join cannot answer and neither establishes what it costs when the join can. It
asserts zero `pr-state` calls, one `pr-list`, and — because a count that fell to
zero by losing the answer would settle nothing and block the successor wave
forever — that the branch still reads `merged` and its wave still completes.
Confirmed to fail on the reordering it describes, rather than merely to pass
today.

<!--
bumps:
  skills:
    plot: patch
-->
