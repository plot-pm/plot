---
"plot": patch
---

Document the fleet: motivation, a 101 walkthrough, and the design anchored in the manifesto.

The commands shipped before the prose did. `intro-to-using-plot.md` had promised since long before any of this that "different people, different agents, different worktrees can all work on the same plan in parallel" — a description of something that did not exist yet. It now explains how.

**Intro** gains *Working several branches at once*: what waves are and why the tracer goes first, why claiming is a `git push` and nothing more, what `/plot-dispatch` does with worktrees and detached workers, how to read the merge queue, and what to do when something goes quiet. Written for someone who knows Plot and is meeting the fleet for the first time.

**README** gains a *Several agents, one plan* section stating the case: two questions hand-coordination answers badly, answered without adding a database.

**MANIFESTO** anchors the design decisions that until now lived only in a plan file and commit messages. Principle 4 gains waves and claim-by-ref as its mechanism — both derived from Principle 1 rather than added alongside it, which is why fleet state is derived and never stored. Pacing gains the sort that is not obvious: watching a fleet is automate-ASAP, fanning one out is human-paced because it commits scope, and merging stays human-paced *even once the order is computed* — automating the ordering removes guesswork, automating the merge would remove the last review point in a workflow that just multiplied its throughput.
