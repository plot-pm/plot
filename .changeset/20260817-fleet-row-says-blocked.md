---
"plot": patch
---

A drafted plan's branches stop reading `eligible — nobody has taken it`

NOT STARTED means *discovered, planned, ready for an agent to pick up*. A plan
still under review has not reached that point, and `plot-dispatch` refuses its
branches — so the row was offering an action the tool declines, which is the
same mismatch the Start button already avoids by appearing only on eligible
rows.

Seen live twice: a plan drafted minutes earlier, its plan PR still in CI, its
branches immediately indistinguishable from work that had been waiting since
February. Such a row now reads `plan not approved yet — still in review`,
naming the review rather than merely saying *blocked* — and loses its Start
button by construction, since the button matches the eligible sentence.

Derived, never stored: the pulse has carried each plan's phase since #140,
deliberately as data, and the row re-derives from it on every scan. Approving
the plan flips the note on the next scan with nothing to clear.

<!--
bumps:
  skills:
    plot: patch
-->
