---
'plot': patch
---

`plot-approve.sh` finds the plan PR by the plan file it adds or changes against the PR's merge base, not only by the branch `idea/<slug>`, so a plan from `/plot-idea` batch mode approves through the controller. A plan absent from the checkout is read from the default branch or from the open PR's head, so `POST /api/approve` approves a plan whose PR has not merged. Approving one plan of a batch PR merges the PR once and names the other plans, which land as Draft, in `carried=`; approving each further slug reports `merged=already` and flips that plan. Two open PRs that change the same plan file are refused before any merge.

<!--
bumps:
  skills:
    plot-approve: patch
    plot-idea: patch
-->
