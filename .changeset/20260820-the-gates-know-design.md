---
"plot": minor
---

plot: the two pre-Approved gates know the Design phase

Wave 1 (`design-is-a-phase`) taught `plot-plan-meta.sh` the word `design`. This
wave teaches the two **gates** that guard the transition out of it, so a plan in
Design is treated the way its name says rather than falling through a case
written only for Draft.

**`plot-phase-gate.sh` blocks implementation commits in Design as it does in
Draft.** Both are the phases before Approved: in Draft nobody has committed to
the plan, in Design the approach itself is still open — a spike or a tracer
bullet answering whether it works. Implementation only ever references an
*approved* plan (Manifesto P2), so both wait. The refusal now **names the phase
it read** — "still Design" over a Design plan, "still Draft" over a Draft one —
because a gate that says Draft over a Design plan sends the reader hunting for a
word that is not in the file. Plan-only commits still pass in both phases:
refining the plan is how it becomes approvable.

**`plot-approve.sh` accepts a Design plan as it accepts a Draft one.** Approving
is Design's forward exit — the spike answered its question, so the plan advances
to Approved. The refusal case now accepts `draft|design|approved` (approved
staying the idempotent repair), and `flip_phase()` rewrites `Design` → `Approved`
as it already rewrote `Draft`. The wildcard refusal message no longer implies
only Draft is approvable.

**`/plot-implement` is unchanged in behaviour, and that is the load-bearing
part.** It still requires phase `approved`, so Design cannot become a way to
start work early — a Design plan is refused exactly as a Draft one is. The prose
only gains the word: the stop message now names Design alongside Draft rather
than describing a Design plan with a message written for Draft.

Tests: a Design plan blocks an implementation commit with the phase named; a
Design plan on a same-branch shared ref blocks too; approving from Design flips
the phase and fills `Approved:`; every existing Draft, Approved and offline path
is byte-identical.

<!--
bumps:
  skills:
    plot: minor
    plot-implement: patch
-->
