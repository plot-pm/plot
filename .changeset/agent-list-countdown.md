---
"@plot-pm/board": patch
---

Two display bugs in the Agents tab, both found by looking at the board rather than by a test.

**`next in 0s`, permanently.** The git countdown subtracted `ageSeconds` from the client's poll interval — but `ageSeconds` dates the *server's* scan (5 s timer) while the client polls every 4 s. One clock's age against another clock's interval is reliably negative, and the clamp turned that into a fixed zero. The server now reports `scanNextInSeconds` from the timer it actually obeys, exactly as it already did for the PR side; absent, no countdown is shown at all.

While fixing it: both countdowns now test with `== null`, since a payload that never passes through the schema sends `undefined` and `undefined - tick` renders `next in NaNs`.

**A plan name printed on every row.** `plans.length > 1` suppressed the sub-heading for six QUIET rows of one plan, so its name appeared six times down the column — more chrome than one heading above six shorter rows. But `rows.length > plans.length` alone breaks the mirror case: two plans with one row each separate nothing and would run together unlabelled. A heading earns its place when it **separates** plans *or* **saves** repetition, so it needs both counts. Where a heading names the plan, the rows below no longer repeat it.

The rule is now a named function with unit tests for all four shapes, and the countdown gained the negative test its PR counterpart already had.

<!--
bumps:
  skills: {}
-->
