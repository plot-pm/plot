---
"plot": minor
---

`/plot-merge-queue`: a safe merge order, and which branches will collide.

When several agents finish at once their PRs land in a burst, and **each merge invalidates the others' bases** — the second PR was green when it was opened and is broken by the time anyone reaches it. Serial work never hits this; a fleet hits it constantly.

The queue answers, before any of that: in what order is it safe to merge, and what will break? Per branch it asks two questions, both computed with `git merge-tree --write-tree` (a merge computed entirely in memory — no working tree, no index, nothing touched):

1. Does it merge cleanly into main right now?
2. **Does it conflict with a branch ahead of it in the queue?** This is the burst case, and the one that is invisible without a queue: every branch can be independently green while being pairwise incompatible.

Branches are ordered by footprint, fewest changed files first — the smallest clean branch merged early invalidates the fewest other bases.

**It merges nothing.** That is the design: most of the value is in knowing the safe order, and knowing it requires no merge rights at all. Merge authority stays with the human until the ordering has proven itself.

Predictions are exact for textual conflicts and say nothing about semantic ones — two branches can merge cleanly and still break the build together. CI remains the arbiter.

Requires git ≥ 2.38.

<!--
bumps:
  skills:
    plot-merge-queue: minor
-->
