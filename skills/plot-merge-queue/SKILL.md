---
name: plot-merge-queue
description: >-
  Compute a safe merge order for a plan's finished branches and predict which
  will collide, without merging anything. Use on /plot-merge-queue.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.2.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git ≥ 2.38 (for
  `merge-tree --write-tree`) and python3.
---

# Plot: Merge Queue

When several agents finish at once, their PRs land in a burst — and **each
merge invalidates the others' bases**. The second PR was green when it was
opened and is broken by the time anyone gets to it. This command answers, before
any of that happens: *in what order is it safe to merge, and what will break?*

It **merges nothing**. That is deliberate, not a limitation: most of the value
is in knowing the safe order, and knowing it requires no merge rights at all.
The human still merges — from a list that says what will collide.

**Input:** `$ARGUMENTS` = `<slug>`.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Compute the queue | Small | One script call, machine-countable footer |
| 2. Report the order | Small | Print the list as-is |
| 3. Advise | Mid | Which conflict to resolve first is judgment |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

## How it decides

```bash
../plot/scripts/plot-merge-queue.sh <slug>
```

Two questions per branch, both answered with `git merge-tree --write-tree`,
which computes a merge **entirely in memory** — no working tree, no index,
nothing touched:

1. **Does it merge cleanly into main right now?** If not, it needs a rebase
   before anything else can be said about it.
2. **Does it conflict with a branch ahead of it in the queue?** This is the
   burst case: it merges cleanly *today* and will not once that branch lands.

Ordering is by footprint — fewest changed files first. A small clean branch
merged early invalidates the fewest other bases, and when two branches collide
the one further back is the one that should rebase.

## Steps

### 1. Compute and Report

Print the queue as-is; it is already ordered for reading. Then read the footer,
never re-count:

```
summary: ready=2 conflicts=1 waiting=0 main=main
```

### 2. Advise

- **All clean** → say the order and that they can be merged top to bottom.
- **Conflicts with `main`** → those branches are stale. Rebase them first;
  nothing else in the queue is affected.
- **Conflicts with a branch ahead** → merge the clean ones first, *then* rebase
  the flagged branch. Say it in that order — rebasing before the earlier branch
  lands just has to be done twice.
- **Nothing to merge** → normal state. Say so plainly.

### 3. Do Not Merge

Report the order and stop. Merge authority stays with the human until the
ordering has proven itself in practice (the plan's Stage 6). Merging one PR
here would silently invalidate every prediction below it in the same list.

## Guardrails

- **Never merge, never rebase, never push.** This command computes and prints.
- **Never re-count the body.** The footer is the contract.
- **A prediction is a prediction.** It is exact for textual conflicts and says
  nothing about semantic ones: two branches can merge cleanly and still break
  the build together. CI remains the arbiter.
- **The queue goes stale the moment anything merges.** Re-run it after each
  merge rather than working down a list computed earlier.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Merging from a queue computed before the last merge | Predictions below the merged branch are void | Re-run after each merge |
| Rebasing a flagged branch before the branch ahead lands | The rebase has to be redone | Merge the clean ones first, then rebase |
| Reading "clean" as "safe to merge" | Textual cleanliness is not semantic correctness | CI is the arbiter; this is a collision check |
| Merging several at once because they all say clean | Each merge invalidates the others' bases | One at a time, re-running between |
