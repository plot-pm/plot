---
"@plot-pm/board": patch
---

board: DONE holds the release scope — a released plan has drained

DONE is the release scope: work that has landed and whose version has NOT
shipped, waiting on its endgame test. Measured on the live board 2026-08-23,
41 of its 61 rows were `Released` work the board had no further say over — the
section that should answer *what landed and still wants testing* was two-thirds
shipped history.

`Released` is the leave-condition, and it already means exactly this: an agent
runs `/plot-release`, the version resolves from `git tag --contains`, and the
plan is out of the board's scope. `rowsFromPulse` now drops a `released`-phase
plan's rows, so the section drains rather than accumulates — a queue, not an
archive. The rolling window is why it fires at all: the scan admits plans
released inside the last 24 h, and a freshly-released plan would otherwise
crowd DONE with shipped work.

Decided and enforced:

- **Dropped at the PLAN, not per row in `classify`.** A plan releases all its
  waves at once — there is no partial release — so a released plan's every
  branch leaves together, which asking the question once per plan says.
  `classify` has no "not rendered" among its six groups; a released row it kept
  would land in a section, and every section is a call to action a shipped plan
  is not.
- **`released` only, never `delivered`.** A delivered plan is complete and
  unreleased — the core of the scope, ready for the endgame — and it stays.
  Every wave being complete is a measurement; releasing is a decision; only the
  decision drains the queue.
- **The one licensed drop.** A membership rule's easy failure is losing a live
  row silently, so the drop is confined to the single phase that earns it and
  nothing else leaves for any other reason — asserted directly, and the
  delivered and planless cases are pinned so an over-reach would break them.

Server-side only, in the render path: no schema change. The Discovery row that
also sits wrongly in DONE is a sibling's fix (`a-draft-plan-claims-no-approvals`);
this drains only what shipped.
