---
'@plot-pm/board': patch
---

feat(@plot-pm/board): the board reports registry metadata

A board started in a worktree with no `.plot/agents/` of its own synthesizes
the entire fleet from `git worktree list`, and nothing else on screen said so.
The rows rendered, the agents carried no sessions, the drop menu vanished, and
an operator had no way to tell a synthesized fleet from one that happens to
have nothing to offer.

The WORKING section header now shows the registry metadata when interesting:
`0 manifests, 12 synthesized` says immediately what took ten minutes to
diagnose: the board is reading an empty directory, not a broken one.

The display appears only when notable — either no manifests found (the error
case this exists for) or any synthesized entries. A healthy fleet with 7
manifests and 0 synthesized needs no annotation.

Hover the badge to see the full registry path and detailed counts.

<!--
bumps:
  skills:
    plot: patch
-->
