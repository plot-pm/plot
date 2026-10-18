---
'plot': patch
---

A continuation's manifest now writes before the prompt and log it names, so a crash between the two leaves no manifest naming a prompt that was never written. Stopping a free-waiting loop first checks that its manifest answers at all, and then waits for the manifest's own `wrapperPid` rather than only the loop's own pid, so a continuation no longer starts over a wrapper the stop believed had already ended. A post-start manifest stamp that fails to write now names its path in a `warning` field on the started response, and a corpus test holds `writeDeskManifest` to the same fields `agentsFs(...).register` writes, run through a subprocess so the comparison never gives `@plot-pm/domain` a dependency on `@plot-pm/fleet`.

<!--
plan: docs/plans/2026-10-17-manifest-retry-and-race-findings.md
bumps:
  skills:
    plot: patch
-->
