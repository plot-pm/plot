---
'@plot-pm/board': patch
---

The pulse derivations are domain rules.

`sliceReadings` (what each slice is and whether it is complete),
`doubleClaimedBranches` (a branch two plans both name) and `pulseLoss` (what the
fleet stopped seeing between two readings) move to
`packages/domain/src/rules/pulse.ts`. The board maps their results onto the
payload it renders, and `planSlugOf` replaces two copies of one regex.
