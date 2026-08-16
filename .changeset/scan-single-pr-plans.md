---
"plot": patch
---

`plot-reconcile-scan.sh` finds plans whose implementation rode a single PR.

Section 2 asked one question — is a branch this plan names present in `git branch -r --merged`? In single-PR mode the plan and its implementation share one idea branch, and that branch is deleted at merge. The ref is gone, so the answer was always no, and the plan sat in Approved unreported. `kanban-board-v1` hung that way for five weeks while the scan called the repo clean. The check was looking for the right thing in a place where it could not be.

The scan now also matches each plan's named branches against the heads of merged PRs, fetched once per run beside the existing bundled open-PR list. A plan is merged-but-not-delivered if **either** signal fires. The two are OR-ed rather than swapped: fan-out plans keep being caught by the branch check, since their per-branch PRs merge at different times.

The obvious fix — read the plan's own `prs` field and ask the host about it — was rejected because it misses its own motivating case. `kanban-board-v1` carried no PR annotation at all while it hung; `→ #40` was back-filled at delivery. The missing annotation and the missing delivery share a cause, so an annotation-keyed check is blind to exactly the sloppy plans it exists to catch. Matching branch names against merged PR heads needs neither a surviving ref nor a recorded number.

Cost stays constant in plan count: one bundled `--state merged` call per run, not one `pr-state` call per plan. The list is fetched with `--limit 500`, because gh's default page of 30 reaches back only to #90 on plot's own repo — #40 is invisible at the default, and silently missing old plans is this check's own failure mode. Measured on that repo, 200 and 500 both cost ~0.8-1.1 s; the round trip dominates, so the headroom is nearly free.

Both degraded paths now say so instead of printing a bare `(none)`: `--offline`/`--no-pr` note that merged-PR heads were not consulted, and a saturated list reports that older PRs went unexamined. A check that quietly skipped used to be indistinguishable from a check that found nothing, and silence reading as health is the defect this section was fixed for.

<!--
bumps:
  skills:
    plot: patch
-->
