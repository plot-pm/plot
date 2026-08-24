---
'@plot-pm/board': patch
---

infra: the registry holds the worker pid, not the worktree

The pid source moves from `$wt/.plot-worker.pid` to the session manifest at
`.plot/agents/<session>.json`. `plot-worker-state.sh` now resolves
worktree to session and reads the pid from the manifest; the worktree file
remains a fallback for backward compatibility with pre-manifest dispatches.

**startedAt validation prevents stale pid reuse.** A pid alone cannot say
whether the process is the one the manifest recorded — a quick exit followed
by unrelated process reuse produces a false positive. The manifest already
carries `startedAt`; `plot-worker-state.sh` now compares it against the
process start time (via `ps -o lstart=`) with 2 s slack for clock skew.
A mismatch reads as `finished` rather than `running`.

No behavior change for callers: the three states, their exit codes, and
the tab-separated output format remain identical.

<!--
bumps:
  skills:
    plot-dispatch: patch
-->
