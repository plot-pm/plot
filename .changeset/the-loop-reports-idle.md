---
'plot': patch
---

The worker's `idle` finding is now judged by the loop's own watcher subshell rather than a separate WorkerMonitor process, and the dispatcher's wrapper reports `gone`/`clear` itself right after `wait "$agent"` returns. Both publish into the same findings file in the same shape the board already reads, so `attention.ts` and the findings reader see no difference. The flag `PLOT_MONITOR_ENDS_WORKER` now gates only the `kill -USR1` signal — the watcher always runs and always publishes, where `0` used to silently stop the finding existing at all. A dispatched agent now runs `1 + 3N` resident processes (the worker, the AgentMonitor, the BuildMonitor) instead of `1 + 4N`. `gone` changes meaning: before, any death of the watched pid — including an honest exit 0 — published `gone`, which the board reads as "restart it"; after, only a non-zero exit does, and exit 0 publishes `clear`. `rules/sample.ts` drops its two-sample path (`sample`, `MonitorReading`, `observe`); `idleNow` and `publication` are unchanged and `idleNow` stays at 100% branch coverage. A clamp in the new watcher bounds silence by how long the current prompt has actually run, so a prompt resuming an old conversation cannot be judged idle on its first pass against the previous slice's silence.

<!--
plan: docs/plans/2026-10-01-idle-is-read-from-what-the-desk-recorded.md
bumps:
  skills:
    plot: patch
-->
