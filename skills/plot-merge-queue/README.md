# plot-merge-queue — developer notes

Safe merge ordering and collision prediction for a plan's finished branches.
`SKILL.md` is the agent-facing instruction; this file is why it looks the way it
does.

Design plan: `docs/plans/2026-08-14-parallel-agent-fleet.md` (Stage 5).

## The problem it solves

Parallel agents finish in a burst. Each merge invalidates the others' bases, so
the second PR was green when opened and is broken by the time anyone reaches
it. Serial workers never hit this; a fleet hits it constantly.

The plan stages the fix deliberately:

| Stage | Who merges | This package |
|---|---|---|
| v1 | human only | — |
| **v2** | **human, from an ordered queue** | **← here** |
| v3 | a single merge authority | not built |

v2 was chosen as the real unlock because **most of the queue's value is knowing
the safe order**, and knowing it requires no merge rights whatsoever. That keeps
the risky half (landing) under human control while the cheap half (ordering)
becomes automatic.

## `git merge-tree --write-tree`

The whole approach rests on this one command. It computes a merge **in memory**
— no working tree, no index, no checkout — and exits non-zero on conflict. That
is what lets the queue stay strictly read-only, and therefore what lets it live
in a scan-style script rather than in the writing dispatcher.

Requires git ≥ 2.38. Older git has `merge-tree` with completely different
semantics (a three-way file diff, no `--write-tree`), so the version floor is
real and stated in the skill's `compatibility`.

## Two questions, not one

Per branch:

1. **Clean against `main` now?** No → it is stale, rebase it; nothing else in
   the queue depends on that.
2. **Clean against branches already ahead of it in the queue?** No → it merges
   cleanly *today* but will not once that branch lands. **This is the burst
   case**, and it is the one that is invisible without a queue: every branch can
   be independently green while being pairwise incompatible.

## Ordering: fewest changed files first

A small clean branch merged early invalidates the fewest other bases. When two
branches collide, the one further back in the queue is the one that should
rebase — rebasing the earlier, smaller one just moves the same conflict around.

This is a heuristic, not an optimum. Computing a true minimum-conflict ordering
is a graph problem, and the payoff over "smallest first" does not justify it for
the handful of branches a wave produces.

## What a prediction does and does not mean

Exact for **textual** conflicts. Silent about **semantic** ones: two branches
can merge cleanly and still break the build together. CI stays the arbiter, and
the skill says so — a queue that implied "clean = safe" would be worse than no
queue.

## The queue is a snapshot

It goes stale the instant anything merges. The skill therefore says to re-run
after each merge rather than working down a list computed earlier. Same reason
`--next` is re-asked per claim rather than computed once: anything that changes
the world invalidates a precomputed answer.

## Tests

`test/reconcile/mergequeue.test.mjs` — a throwaway repo with three branches: two
independent (different files) and one that rewrites the same line as another.
Asserts the independent ones report clean, the collision is predicted **against
the branch ahead of it rather than against main**, the footer counts, and that
`origin/main` never advances.

That last assertion is the important one: it is what holds the read-only line.

## Known gaps

- No PR-state awareness — the queue orders branches, not pull requests, so a
  branch whose PR is still draft or red appears alongside ready ones. Pair it
  with `plot-impl-status.sh` when that matters.
- `waiting=` in the footer is always 0; it is reserved for a future state
  (branch ready but blocked on a dependency) that Stage 5 does not compute.
- No auto-rebase. Deliberate: rebasing someone else's branch while their worker
  may still be running is exactly the kind of write this design avoids.
