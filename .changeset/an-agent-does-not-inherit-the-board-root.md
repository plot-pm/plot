---
'plot': patch
---

A fleet agent's prompt runs without `PLOT_REPO_ROOT`. The supervisor's unit sets the variable for its own scripts, and before this change every test an agent ran inherited it. A test that dispatched into a sandbox repository then wrote its agent manifest into the host's registry, and the supervisor counted those manifests against the `Parallel agents` cap.

<!--
bumps:
  skills:
    plot: patch
-->
