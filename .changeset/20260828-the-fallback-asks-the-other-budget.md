---
'plot': patch
---

<!--
bumps:
  skills:
    plot: patch
-->

`plot-host.sh` answers through REST when the GraphQL budget is exhausted.

GraphQL and REST are separate rate buckets, and the estate kept hitting one
while the other sat untouched — measured, GraphQL at 0/5000 with REST barely
used. A spent GraphQL budget emptied the board's view entirely, because every
PR question went through the one exhausted path.

The fallback is taken ONLY when GraphQL is spent, so the cheap path stays the
default and no extra request is made on the ordinary route. Both paths produce
the same vocabulary — a caller cannot tell which answered, which is what keeps
`pr-state` a single contract rather than two shapes depending on the hour.

A failing REST fallback exits non-zero rather than answering `NONE`. That is
the same rule the adapter already applies to its other paths: an empty answer
and an unanswerable question are different facts, and collapsing them is how a
branch with no PR becomes indistinguishable from a host that could not be
asked.

Bitbucket is unaffected — it has no GraphQL budget to exhaust, so no budget
query is made and no REST fallback exists on that path.
