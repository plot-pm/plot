---
'@plot-pm/board': patch
---

fix(@plot-pm/board): a wave row speaks its own verdict

A multi-branch wave row now shows its verdict word (`complete`, `eligible`,
`blocked`) in the status slot instead of a section-chosen word (`delivered`
for DONE, `stalled` for QUIET, etc.). This makes all waves of a plan consistent
— six merged waves no longer show one word for the multi-branch wave and
another for its single-branch siblings.

Branch rows still show `delivered` for merged refs, per the existing
`stateStatus` function. Single-branch waves inherit their branch's status
via `soleStatus`, preserving the #323 fix.
