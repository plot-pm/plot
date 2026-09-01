---
'@plot-pm/board': patch
---

`toBoardPhase`, `rowPhase` and `planStatus` are domain rules.

A phase is a rule about a Plan and a column is a rule about a Branch; neither is
a rendering concern. They move to `packages/domain/src/rules/phase.ts`, and the
board re-exports the first two for callers that already import them.

`planStatus` takes readings rather than a pulse: the board runs the two pulse
queries and the domain decides, which is what makes the rule testable without a
`FleetPulse`. `planStatusBySlug` stays in the board — it reads config, so it is
a reader rather than a rule.
