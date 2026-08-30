---
'plot': patch
---

A monitor ends when its agent's worker does.

**Nothing ended them before.** Every done-when in the monitors plan asked whether
they live *long enough*; none asked when they stop. Measured 2026-08-30: 152
monitor processes running, all `ppid=1`, holding 566 MB between them.

The research that preceded the fix is committed beside it
(`docs/research/2026-08-30-what-ends-a-monitor.md`) and corrects the record: the
occasional `Terminated: 15` in a worker log was **a process-group kill aimed at
the dispatching shell**, reaching the monitors collaterally. Not a cleanup, and
not something a fix may rely on — which is why one was written.

Monitor output (`.plot-worker.monitor.*.jsonl`) also joins the four sibling
runtime files in `.gitignore`. It was blocking the reaper: uncommitted work
correctly refuses a reap, and monitor output was not marked as machinery.
