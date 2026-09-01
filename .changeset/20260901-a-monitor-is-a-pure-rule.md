---
'@plot-pm/board': patch
---

The WorkerMonitor's two-sample judgement becomes a domain rule, reached through a fourth build artifact. `plot-monitor.mjs` takes `sample` and `publication` from `@plot-pm/domain/rules/sample` directly rather than through the barrel — once per pass per monitored worker, and the barrel would carry every entity's zod schema, none of which this entry calls. It bundles to 1.5 KB and **spawns nothing**, which is the property that lets the monitor keep its "no host call at all" guarantee while the judgement moves languages: `plot-ask.mjs` answers by running `plot-fleet-scan.sh`, so a monitor calling it would reach the estate through the scan — 127 git processes on a ~30 s cadence.
