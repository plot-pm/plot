---
"@plot-pm/board": patch
---

**Pins the mixed-section case for plan headings in a browser.** `showPlanHeading(group)` is already asserted per group in `test/unit`, but it is a pure function of a group — it cannot observe the row half of the same rule, and the row half is where a weaker implementation fails.

The rule has two halves that must agree: a group of two or more rows earns a heading and its rows stay bare, while a one-row group earns none and its row must then carry the plan name **itself**. Decide the second half section-wide instead of per group — the obvious shortcut, since the heading half looks like it could be summed — and the lonely row loses its plan name with nothing replacing it. The unit test still passes; the reader is left looking at a branch with nothing saying what it belongs to.

The new browser test holds one section containing both shapes at once (`beans` with three rows beside `lonely` with one) and asserts both halves together: exactly one heading, reading `beans(3)`; the lonely row carrying `lonely` as its own link; and the headed plan's rows not repeating the name. Verified to fail against the section-wide implementation, on the assertion that the lonely row keeps its name.

Asserted on the plan **cell** rather than the row's text, because the branch is named `feature/beans-1` — a substring search for the plan name finds the branch and passes for the wrong reason.

<!--
bumps:
  skills: {}
-->
