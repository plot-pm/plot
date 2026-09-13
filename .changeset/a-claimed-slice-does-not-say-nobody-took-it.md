---
'@plot-pm/board': patch
---

A branch somebody is already on stops reading *nobody has taken it*. The row's note yields to its own `startability`: where the field answers `someone-is-on-it` — a `claimed` or `wip` branch — the verdict sentence is withdrawn, and every other value renders exactly as before. Reported by the operator 2026-09-13, who watched an agent work on `a-harness-this-machine-cannot-run-refuses` while its line read *"eligible — nobody has taken it"* beside slot 5's *someone is on it*. The two fields disagree by construction rather than by timing: `startabilityVerdict` returns `someone-is-on-it` for a claimed branch and never reaches the slice-verdict gate below it, and `eligible` stays true after a claim because a claim does not un-satisfy a prerequisite. The sentence is withdrawn rather than reworded, because slot 5 has carried the fact since `the-row-says-whether-you-can-start-it` and a second spelling beside the first is the duplication this fixes. The fix is in the branch row, not the slice head the plan named: a claimed branch never reaches the client's `sliceNote` chain, since NOT STARTED filters its slice rows to `isUnbegun` and prints the server's note verbatim.

<!--
plan: docs/plans/2026-09-13-a-claimed-slice-does-not-say-nobody-took-it.md
-->
