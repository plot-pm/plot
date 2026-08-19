---
"@plot-pm/board": patch
---

board: the marks column's comment says what the code does

`120a9bc` moved the activity marks out of the row's left padding and into
a grid track of their own, and left the old rationale standing above the
new code. The doc comment described the `sm:absolute sm:left-0` placement
as "UNCHANGED, to the character" — directly above the flow-layout string
that had replaced it. A reader trusting the comment would have learned
the opposite of what the code does.

The superseded argument is kept rather than deleted, because it was
right when it was written and its expiry is the interesting part: six
columns should not move for a mark most rows never carry, and 2 of 56
rows carry one. What broke it is the other side of the trade — `left-0`
is the row's edge and the section's border sits inside it, so a mark wide
enough to be seen was clipped in half. A clipped mark is not a cheaper
mark.

The heading placement's separate reasoning is untouched and still holds:
`sm:absolute` positions against the nearest positioned ancestor and the
`<h2>` has none, so reusing the row's string there would not sit the mark
slightly wrong — it would land it elsewhere on the page entirely.
