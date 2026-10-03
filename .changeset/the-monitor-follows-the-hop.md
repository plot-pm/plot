---
'plot': patch
---

The AgentMonitor and the BuildMonitor re-read the manifest's `worktree` field every pass and follow it to a new desk after a hop, instead of watching the desk they were launched on forever. The wrapper's `gone`/`clear` line, appended once after `wait "$agent"` returns, follows the same reading, so a killed hopped agent's finding lands where the loop's watcher and the board actually look. The new desk is read through `watchedDesk` (`packages/domain/src/rules/desk-manifest.ts`) and its shell twin `plot_watched_desk` (`plot-monitor-subject.sh`), held together by a corpus test. The AgentMonitor resets its `published`/`since` state on a desk change, so a debt measured on the old desk is never reported cleared merely because the new desk has not been measured yet.

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
bumps:
  skills:
    plot-dispatch: patch
-->
