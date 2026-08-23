---
"@plot-pm/plot": patch
---

A branch whose pull request has merged now reads `merged` even when its ref
still exists. GitHub deletes the ref at merge, but a worktree that still holds
the branch can push it back afterwards — which a fleet does routinely — and a
squash merge rewrites the work onto a different commit, so the local walk sees
commits the default branch lacks and calls finished work `wip`.

Measured 2026-08-23: a merged branch read `wip` for three hours, its wave
reported "3 merged, the rest not yet" over four merged branches, and the plan
sat in Development with nothing left to do. `wip` is the worst of the wrong
answers because it claims an agent is working there, so a leftover worktree
reads as an occupied desk.

The state comes from the pull-request list the scan already fetches once, so
this adds no host request. Only `MERGED` may override the local walk, and only
toward `merged`: an open pull request over unlanded commits is still `wip`.

<!--
bumps:
  skills:
    plot: patch
-->
