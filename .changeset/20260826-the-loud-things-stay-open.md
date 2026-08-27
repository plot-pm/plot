---
"@plot-pm/board": patch
---

A folded plan head names its exceptions, and a fold with exceptions renders open.

The plan's rule: *folding may hide repetition, never exceptions*. A `conflict`,
`double-claimed`, `artifact-conflict`, or `unsliced-wave` is a structural issue
the reader must see immediately — they cannot decide what to unfold without
knowing what is inside, and hiding a conflict behind a closed fold makes the
board look healthy when it is not.

Two changes:
1. **Exception summary in fold heads** — the aside beside the wave summary now
   shows `claimed twice`, `conflict`, etc. in amber, using `stuckWord`'s labels
   so the head and the row use the same vocabulary. Multiple distinct exceptions
   are comma-separated; the same state across rows appears once, not counted.
2. **Default-open for exceptions** — any fold containing an exception renders
   expanded by default. The toggle still works (the exception is a default, not
   a lock), so a reader who has dealt with the issue can collapse the fold.

`ci-failing` and `unpushed` are explicitly NOT exceptions. They are transient
states the row shows for its own reader, not structural conflicts that demand
immediate visibility. A reader may browse a folded list without seeing every
red build.

<!--
bumps:
  skills:
    plot: patch
-->
