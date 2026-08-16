---
"plot": minor
---

A branch holding commits nobody has pushed reads as **working** rather than quiet, and the row says how many.

**`local_dirty` cannot answer this case, by construction.** It reports *someone is editing*, and committing **clears** it. So the moment a worker finishes tidily and pauses before pushing, the worktree is clean, the flag is false, and the board reads **"claimed, no commits yet"** for a branch holding a complete implementation. That is not hypothetical: it happened on 2026-08-16 on `bug/fleet-sees-local-work` — the very branch that fixed the other half of this blindness — at 3 commits ahead, 0 dirty files, no PR. The gap opens **exactly when the work is most complete**, and complete-but-unpushed work is also work with no backup and nothing for a merge-queue check to inspect. That day it also blocked a dispatch: a branch could not start while the collision it had to avoid existed only on one machine's disk.

**It is a ref question, not a worktree question** — and getting that wrong was this plan's own first draft. `local_dirty` has to go through the worktree list because dirtiness is a property of a *working directory*: only the checkout knows whether files were edited. Aheadness is not. Worktrees share one ref database, so `refs/heads/<branch>` answers from the main repo for a branch checked out in a *different* worktree, and the comparison needs no `git -C` at all. Binding it to the worktree list would have been *consistent* with `local_dirty` and wrong: a local branch with no worktree — checked out once and moved away from, or fetched from a colleague — still holds commits nobody else can see, and the worktree-shaped version would silently skip exactly those. Two signals that answer different questions read from the sources that actually hold the answers.

**Ahead only; divergence is not this question.** `rev-list --count A..B` counts one direction, and that is the right one. The question is *does work exist here that nobody else can see*, and unpushed commits are exactly that whether or not the branch also trails the remote. Being *behind* is not an invisible state — it is sitting in the remote for anyone to read — and reporting it would answer a second question with no action attached.

**It obeys the same rules as the signal it joins**, which is the argument for adding it here rather than designing something new. *Absent is not false*: a branch with no local ref answers from refs exactly as today, so every detached worker, every teammate's laptop and every CI run is unaffected. *One-directional*: it may lift a branch out of quiet and may never downgrade a group, and a branch with an open PR still answers about its PR. *Read the exit code, not the emptiness*: a missing upstream exits **128 with empty output** — bit-identical to the deleted-worktree signature the shipped code already handles — so empty output must not read as "zero ahead", for exactly the reason empty `git status` output must not read as "clean". *No cap*: 5.2 ms per call against the 6.6 ms per worktree the scan already accepts, so twenty branches cost ≈104 ms on a scan that runs 500–1050 ms, and the count follows the plans rather than the checkout.

**Dirty and ahead are different facts, and the row says both, unpushed first.** `local_dirty` means *someone is editing*; `local_ahead` means *finished work exists that nobody else can see*. An earlier draft reported only the unpushed commits, on the grounds that they are the more urgent fact. That is true and not a reason to drop the other: suppressing a true fact because a second one outranks it is precisely the displacement `deferred` used to cause to the note text. The two together also change the advice — *push this* versus *push this, and someone is still working* — which is the whole reason to distinguish them. A branch whose only local evidence is uncommitted edits reads exactly what it read before.

**An unpushed count is not an age, and is not shown as one.** *"2 commits not pushed locally"* answers a question no timestamp can: it names an action, and the action belongs to a specific machine.

<!--
bumps:
  skills:
    plot: minor
-->
