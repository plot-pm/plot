---
"@plot-pm/board": minor
---

The board's plan row can now deliver a fully-merged plan. A new `POST /api/deliver`
route spawns `/plot-deliver` the way `/api/reslice` spawns `/plot-reslice`:
slug-scoped, through the `Idea command` binding, with the prompt written to a
file so no plan text becomes a shell word. It writes none of the transition
itself — `/plot-deliver` re-verifies every implementation PR is merged, flips the
phase to Delivered and moves the plan — which is the standing rule for board
writes, and the domain model's own line: every wave being complete is a
measurement, delivering is a decision, and this control is a person making it.

The route refuses with a named reason rather than silently: `no-deliver-command`
where no runner is configured, `plan-unreadable` where the plan's waves cannot be
parsed, `not-deliverable` where a non-deferred branch has not merged (the gate
`/plot-deliver` keeps, not weakened here), and `already-delivered` where the
plan's phase is past Development. Deliverability is read through
`plot-plan-meta.sh`'s `waves[]` against the same pulse the board renders from —
the same `allWavesMerged` arithmetic that auto-bumps a fully-merged plan's card
into Endgame — so the route and the card agree by construction.

The affordance is a new `deliverable` bit on each card, set only where the server
auto-bumped a complete plan into Endgame — never on a plan already delivered, so
that decision cannot be offered twice. The `Deliver` control lives on the plan
head's `⋯` menu beside Approve and Commission, gated on that bit rather than on a
Draft phase; unlike the draft acts it opens even when the server refuses, stating
its reason on the control the way `Slice this wave` does. It joins the router's
write table, so it inherits the loopback gate by construction and is covered by
the write-gate test; a seventh `deliver` capability flag rides on `/api/board`
beside `reslice`. `GET /api/deliver/<slug>` reads the command's own words back
for a refusal, since a delivery moves no row until its phase flips.
