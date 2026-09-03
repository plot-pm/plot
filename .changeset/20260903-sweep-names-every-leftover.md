---
'plot': minor
---

`plot-reap.sh` sweeps three more kinds of leftover: local branches the host merged that no worktree holds, orphaned claim refs a plan already recorded as deferred or moved, and dirty trees nobody owns. Measured 2026-09-02 on plot's own estate — 85 of 98 local branches were already merged and nothing looked at them. The local-branch gate is the reaper's two measurements rather than `git branch -d`, which refuses a squash-merged branch for the wrong reason and would have kept all 85. A dirty tree is named with its owner as `nobody` and nothing is deleted from it. Every kind is `--dry-run` by default, acts on `--yes`, and honours `--max N`; the reaper's five refusals are unchanged.

<!--
bumps:
  skills:
    plot: minor
-->
