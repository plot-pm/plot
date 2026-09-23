---
'@plot-pm/board': patch
---

`recordRound` lands in the domain. `Rounds:` was parsed by `plot-plan-meta.sh` and rendered by the board's plan card while no rule knew what a round was — so there was nothing for a controller to call and nothing a gate could check. The transition increments and never sets, refuses five named cases, and takes the moderation's existence as a `Precondition` reading rather than a path it could only pretend to verify.

<!--
plan: docs/plans/2026-09-22-a-round-is-a-domain-fact.md
-->
