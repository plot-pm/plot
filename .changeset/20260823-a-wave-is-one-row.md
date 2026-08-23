---
'@plot-pm/board': minor
---

board: a wave renders as exactly one row in exactly one section

A wave existed only as rows that share a name, and the board decided each row's
section from that branch's own state. When a wave's branches disagreed —
`Inverted`: one merged, one open — the merged branch went to DONE and the open
one to NOT STARTED, so the wave rendered in two sections at once.

A wave now lands in ONE section, chosen from its verdict and its plan's phase and
nothing else: a complete wave sits with its merged work, and a wave with any
unmerged branch is where its unfinished work is. `Inverted` appears once, in NOT
STARTED. The collapsed wave row states how many branches it speaks for and says
so when they disagree, so the density is not bought with accuracy.
