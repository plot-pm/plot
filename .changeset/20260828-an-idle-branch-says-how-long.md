---
'@plot-pm/board': patch
---

A branch row says how long it has been idle.

A row carrying work nobody has touched looked identical to one picked up
minutes ago: the board showed *that* a branch was claimed, never *how long
ago*. Age is the fact an operator needs to tell a worker that is thinking from
one that has stopped, and it was the one fact the row withheld.

The age is derived at render time from the reading the row already carries —
no new field on the payload, and nothing stored. A row whose age cannot be
established says nothing rather than guessing zero, because an unknown age and
a fresh one are different facts and rendering the second for the first is how
a stalled branch reads as active.
