---
"@plot-pm/board": minor
---

board: the Design column means Design

`toBoardPhase` maps `design → Design` and reads `approved` as Development
whether or not a branch has started. The board once manufactured its Design
column by forking `approved` on `started` — a plan nobody had begun went to
Design, one with commits to Development — so a column named for an activity was
populated by the *absence* of that activity. Waves 1 and 2 made `design` a real
phase in the parser and the gates; this wave is the board reading it.

**Approved-but-unstarted is Development, not Design.** It is work waiting for an
agent, and it belongs beside the Start button that offers it. The measured case
the plan named — approved-unstarted plans sitting in a column called Design —
moves out: the `tiny-garden` data test now reads `Design: 0, Development: 2`
where it read `Design: 2, Development: 0`.

**`rowPhase` and the board card now agree by construction.** The divergence that
justified deriving a row's phase from git rather than the plan file — an
approved plan with stale bookkeeping reading Design on the card and Development
on the row — cannot occur once approved is Development on both. The `started`
half `rowPhase` supplied from git no longer moves an approved plan, but it is
still read and still passed, so the two views compose the one mapping.

`toBoardPhase`'s second parameter is kept, unread, as `_started`: the plan says
approved is Development *whether or not* a branch has started, which presupposes
the input still exists. It is the seam a future `started`-forking phase would
use, and the agreement test asserts the two callers stay in step through it.

**A Design card sorts by its own clock.** `design_raw` joins the board's
`PlanMeta` schema — the shell parser emitted it since wave 1, but the board's
Zod schema dropped it as an unknown key, so it was never reachable. `phaseDateOf`
reads it for the Design column: a plan *in* Design has a `Design:` date but not
yet an `Approved:` one, so the two columns cannot share a record, and a Design
card with no `Design:` line sorts by arrival rather than borrowing approval.

<!--
bumps:
  skills:
-->

No skill version bumps: this is board-side only. The skills and helper scripts
are untouched — `plot-plan-meta.sh` already emits `design_raw` and normalises
the `design` phase (wave 1), and the gates already accept it (wave 2). This wave
only teaches the board's TypeScript to render what those already produce.
