---
'plot': patch
---

The reconciliation sweep reports a Draft plan amended since its last recorded interrogation round. Section 13 names the round, the commit that last wrote it, and the commit that amended the plan after it, and the footer carries `rounds_drift=`. A plan recording no round produces no finding — an unquestioned plan is honestly unquestioned — while `Rounds: 0` is a recorded value and reports like any other. The section stays out of `attention=`, so a stale round never stops a delivery.

<!--
bumps:
  skills:
    plot: patch
-->
