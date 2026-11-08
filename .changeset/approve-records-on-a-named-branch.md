---
'plot': patch
---

`plot-approve.sh --branch <name>` records an approval on a sprint's integration branch: it reads the plan from `origin/<name>` where it read the default branch, merges the plan PR only where the host names its base as `<name>`, cuts the booking worktree from `origin/<name>`, and pushes the booking to `<name>`. A branch that origin does not hold refuses before the merge, `--dry-run` names the target branch, and `Impl: same branch` refuses the flag. Without the flag, a plan PR based on another branch than the default refuses before the merge and names `--branch <base>`; a PR based on the default branch approves as before.

<!--
bumps:
  skills:
    plot-approve: patch
-->
