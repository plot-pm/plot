---
'plot': patch
'@plot-pm/board': patch
---

A branch whose `<!-- waits: … -->` prerequisite is a slice some plan names now reads `waiting` when the host has no pull request for that slice, because nobody has started it yet. `blocked` stays for a name that no plan contains. `plot-fleet-scan.sh` passes the rule a twelfth field per branch, whether each prerequisite is a named slice, and `plot-dispatch.sh` refuses a branch waiting on an unstarted sibling slice as `waiting on …` instead of `blocked — no PR found for …` (#1305).

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
