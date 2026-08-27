---
"plot": minor
"@plot-pm/board": patch
---

A reaped worktree takes its registry manifest with it, and an entry whose
worktree is gone can be dropped.

**The measured bug**: `plot-reap.sh` removed checkouts and contained zero
references to the registry, so every reap converted a finished agent into a row
naming a directory that no longer existed. Measured 2026-08-26: twelve
worktrees removed, seven `unknown` rows appearing at once, sessions of 1h to
6h. Measured again 2026-08-27, four more, cleared by hand both times.

The row could not be cleared either. *Drop this agent* refused with *"check the
worktree manually"* — advice naming a directory that did not exist.

**Two defects, and either alone leaves a hole.** The reaper strands manifests;
the guard cannot clear a stranded one. Fixing only the reaper leaves every
manifest stranded by any other means permanently undroppable, and fixing only
the guard leaves the reaper producing rows a person must then clear by hand.

`plot-reap.sh` now removes the manifest inside the worktree-removal success arm
and nowhere else — the reverse order leaves a live worktree unregistered, which
`readAgentRegistry` answers by synthesizing the same bad row a different way.
A sweep clears manifests whose worktree is already absent, which is the
population earlier reaps left behind. The five refusals are unchanged, and a
refused reap keeps its manifest: the agent is still real.

`drop.ts` narrows its refusal rather than removing it. A deleted worktree is not
ambiguity — nothing runs in a directory that does not exist — while `unknown`
with a worktree that EXISTS still refuses, because that is the live-worker case
the guard was written for. The live check runs first, so a positive `running`
verdict outranks the directory's absence.

Two things measurement caught that the design did not predict: the config guard
tested `-x` on a helper invoked through `bash` (which needs it readable), and
`git worktree list` reports symlink-resolved paths while a manifest records what
the dispatcher was handed — so on macOS one directory arrived as two strings and
matched nothing.

<!--
bumps:
  skills:
    plot: minor
-->
