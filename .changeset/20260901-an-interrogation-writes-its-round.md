---
'plot': patch
---

The round is owed by anyone who interrogates a plan, not only by
`/challenge-the-plan`, and the plan template now describes the `Rounds:` field
that records it.

Measured 2026-09-01: five plans were interrogated across nine rounds in one
session and every one reported `rounds: undefined`, so the board showed no
badge. Nothing was broken — `plot-plan-meta.sh` reads `Rounds:` from `## Status`
first, and `PlanCard.tsx` renders the badge. The gap was the entrance: an
interrogation conducted directly, reading the plan and measuring its claims
against the code, left no trace and was indistinguishable afterwards from a plan
nobody had questioned.

`Rounds:` was the one `## Status` field the shipped template did not describe,
which is why a hand interrogation did not know it existed. Its comment now
states who writes it and that absence is not zero: a plan nobody has questioned
is honestly unquestioned, while `0` says the plan was questioned and nothing came
of it, and the badge exists to keep those apart.

Phase 5b's write instruction is unchanged. It already specifies
replace-or-insert-after-`Impl:` and warns that a greedy match on `## Status`
destroys the `Approved:` / `Started:` / `Delivered:` records.

<!--
bumps:
  skills:
    challenge-the-plan: patch
    plot: patch
-->
