---
'plot': patch
'@plot-pm/board': patch
---

`plot-review` gives the reviewer the pull request's exact change. In the review worktree it fetches `origin/<base>`, computes the merge base with the head, and writes `git diff <merge-base>..<head>` to `.plot-review/change.diff` inside that worktree. The request names the merge base, the changed files and the diff file's absolute path, carries the diff inline up to 200,000 characters, and tells the reviewer to judge only this change: content outside it goes under a separate "Outside this change" heading and never counts in the `Findings:` line. A change that cannot be read refuses and writes no status.

<!--
bumps:
  skills:
    plot: patch
-->
