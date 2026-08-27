---
plot: patch
---

The reconcile scan now reports sprint items left unchecked whose plan has
already reached `delivered` or `released` — in CLOSED sprints as well as active
ones.

`/plot-sprint close` (the sibling wave) reconciles a sprint's checkboxes against
plan phase *at close time*, so every sprint closed from now on is correct on
close. But nothing ever recomputes a sprint that was already closed before that
fix shipped — measured 2026-08-26, `2026-W34-the-board-tells-the-truth` reported
1 of 13 done while 12 of 13 plans were Delivered or Released. This is the
reporting half: what has ALREADY drifted, which closing can never reach.

**Section 11 (stale sprint tally)** walks every sprint file, closed and active,
and reports each unchecked `- [ ] [slug]` item whose plan's phase is `delivered`
or `released`. It reads the PHASE via `plot-plan-meta.sh`, never the `active/`
vs `delivered/` directory — respecting `/plot-deliver`'s design where the phase
edit is the transition and the index write is best-effort.

An item with no resolvable plan (a bare prose line, or a slug naming no plan
file) is skipped silently: it carries no phase to read, so the question "is the
plan delivered?" has no answer.

**Advisory, like index drift.** A closed sprint with a stale tick is wrong, not
broken, and rewriting a retrospective's history automatically is worse than
reporting it. The finding carries its own footer counter (`stale_tally=`) and
stays out of the `attention=` count that gates `/plot-deliver` and the `/plot`
hygiene line.

<!--
bumps:
  skills:
    plot-reconcile: patch
-->
