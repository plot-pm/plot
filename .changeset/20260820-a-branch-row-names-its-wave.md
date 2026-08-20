---
"@plot-pm/board": minor
---

board: a branch row names its wave, where the plan has more than one

The Agents tab showed plans and it showed branches, and between them the wave —
the level that decides ordering — had no line of its own. `row.wave` was on the
contract and no component read it: the field arrived and stopped.

The wave name now takes the PHASE cell on a branch row. That column showed the
plan's phase, which is the same word on every branch of one plan; which wave a
branch belongs to is the fact that varies row to row, so it is what the column
is for. No seventh track — the grid keeps its seven columns, and a row naming a
wave starts its branch cell at the same x as one naming a phase.

Shown only where the plan divides its work, and the rule is the wave COUNT, not
the presence of a name. Measured across the estate: no plan divides its work
without naming the parts (the `### ` heading is the division), so a count above
one is always a count of named waves — while a plan whose single wave carries a
name is still one wave, and a caption over a partition of one is noise. Keying
on presence would label that plan and leave the eleven branches in unnamed
single-wave plans bare; keying on the count labels exactly the rows where the
answer to *which slice of this plan?* is not "all of it".

The count is PLAN-WIDE, read from the whole fleet rather than one section's rows:
a plan's branches scatter across sections — one working, one not started — and
whether the plan has more than one wave is a fact about the plan. `waveCountByPlan`
and `waveLabel` are pure and pinned in test/unit; the DOM half — the name in
every section, the two single-wave cases (named AND unnamed), the grid holding
still — is in test/integration/agents-tab.browser.test.ts.

Reads `row.wave`, writes nothing to the scan: the scan already emits
`wave.name || '(unnamed)'` per branch. Manifesto Principle 3 puts the
interpretation on the board's side of the line.
