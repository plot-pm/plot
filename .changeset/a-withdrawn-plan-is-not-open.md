---
'@plot-pm/board': patch
---

A rejected or superseded plan no longer counts as outstanding work. `planStatus`'s default arm answered `draft`/`open` for both phases, so the estate counter reported plans nobody intends to build as open — measured, a rejected plan with `Review: in-session` read `draft` and one with `Review: pr` read `open`, which is indistinguishable from a plan waiting for approval. The new `withdrawn` status covers both phases because a reader acts on them identically, and it is terminal like `released`: the arm returns before the review channel, the landed reading and the claim are consulted. It is a FOURTH bucket rather than an exclusion, so `total` keeps counting every plan and the invariant becomes `total = open + wip + done + withdrawn`; dropping withdrawn from the total would make it stop being the plan count. The term renders unconditionally, including at zero, because a reader adds the terms against the total by eye. A withdrawn plan renders no card either way — `toBoardPhase` already answered null — so only the counter moves. Both `PlanStatusSchema` declarations gain the member and a test asserts they declare the same set.

<!--
plan: docs/plans/2026-09-16-a-withdrawn-plan-is-not-open.md
-->
