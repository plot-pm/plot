---
"@plot-pm/board": patch
---

board: a test walks the whole operator path — approve, and Start work takes it

Wave 1 (`bug/the-plan-row-carries-the-plan-decisions`, #325) reconnected a
three-break path: a Draft plan's card offers Approve, an approved plan reaches
NOT STARTED, and the Start work there dispatches it. Every existing test covered
one leg of that path and none walked it — `approve.browser.test.ts` exercises
the card, `plan-head-controls.browser.test.ts` the plan head, and
`not-started-plans.browser.test.ts` the section — so the CONNECTION between them
was pinned nowhere.

This wave adds the walk: one browser test that renders both ends of the journey
in a single board and asserts each junction. It offers no new control, because
the walk found none missing — the deliverable the plan named is the proof
itself. Three of its four assertions exist because a naive implementation passes
without them: the approved plan reaches NOT STARTED **specifically** (a row-count
check passes with the old routing intact), Start work **dispatches** rather than
merely renders (a disabled-but-present control passes a presence check), and the
Draft plan's shelved branch is **absent** from NOT STARTED (only a negative
assertion catches the old `'draft'` allowlist returning).

Each assertion was proven to bite by mutating the fixture — approved plan out of
`not-started`, Draft branch into it, Approve card off Discovery — and watching
exactly the owning assertion go red. No production code changed and the built
artifact is byte-identical.

<!--
bumps:
  skills:
    plot: patch
-->
