---
'plot': patch
---

A slice that lives in another repository now reads `merged` in the pulse when its own host merged the PR that `→ owner/repo#N` names, so its wave completes and the plan card's slice count moves past it. The scan asks that host once per scan, by the PR number, as delivery does. An open or closed foreign PR keeps the slice `foreign`, and a foreign host that cannot answer reads `unknown`. The fleet still never claims or dispatches a foreign slice, and `dispatch --branch` refuses it as `branch-foreign` in every state. The snapshot protocol rises to 11, because the walk branch carries `foreignPr` in place of `foreignMerged` (#3762).

<!--
bumps:
  skills:
    plot: patch
-->
