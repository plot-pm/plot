---
'plot': minor
---

`plot-deliver.sh --branch <name>` records a delivery on a sprint's integration branch: it reads the plan, the indexes and the sprint file from `origin/<name>`, cuts the booking worktree from it, and pushes the booking to `<name>`. A branch that origin does not hold refuses before anything is written, `--dry-run` names the target branch, and `--release` refuses the flag. Without the flag, delivery books on the default branch as before.

<!--
bumps:
  skills:
    plot-deliver: minor
-->
