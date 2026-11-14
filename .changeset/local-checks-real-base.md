---
'plot': patch
---

`plot-local-checks.mjs` reads a change against the branch's real base, with no host call: the `--base` argument, else the `base` the desk manifest records, else whichever of `origin/<default>` and every `origin/sprint/*` the branch sits the fewest commits past, a tie going to the default branch. A branch cut from a sprint branch now gets only its own changes, and the first output line names the base and the reason.

<!--
bumps:
  skills:
    plot: patch
-->
