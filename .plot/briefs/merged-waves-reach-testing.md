## Implementation brief — done-means-delivered (wave 1: Reached)

- **Plan (canonical):** `docs/plans/2026-08-21-done-means-delivered.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `feature/merged-waves-reach-testing` (base: `main`)
- **Ends as:** one PR to `main`

This is wave 1 of 4. Three waves follow (`Verified`, `Offered`, `Named`) and are
blocked until this merges.

### What to build

**A plan whose every non-deferred branch has merged reaches the phase that means
*ready for testing*.** Today it stays at `Approved` until a person runs
`/plot-deliver`, and nobody does.

Measured, and the numbers move because the estate keeps refilling them:

```
2026-08-21   merged_not_delivered = 16
2026-08-22   drained by hand to 2   ← cost a person a morning
2026-08-23   merged_not_delivered = 5
```

Three of today's five are plans in the current sprint. **The refill is the
argument**: detection works and nothing acts on it, so the backlog returns every
time a fleet lands work.

### The decisions the plan settles — do not re-derive them

**The detection already exists and must be reused, not rebuilt.**
`plot-reconcile-scan.sh` section 2 finds every one, names the merged PRs, and
prints `consider: /plot-deliver <slug>`. Your work reads that, it does not
re-derive it.

**Delivery stays a DECISION, never a measurement.** This is the model the whole
2.9.0 release rests on (`docs/board-domain-model.md`): *every wave being complete
is a measurement; delivering is a decision.* So **no automatic phase flip.** A
person acts; the board makes acting cheap.

**Two of today's five read `PRs: none-linked`** and would refuse any deliver
action — the missing `→ #N` annotations are wave 2's (`Verified`) problem, not
yours. Do not fix them here; do not let their absence block this wave.

### Done when

The plan's `## Done when` is the specification. Beyond it:

- A plan with **every non-deferred branch merged** is identified, and one with a
  deferred branch among merged ones is **also** identified — a deferred branch is
  exempt from the merge gate by design, measured (Endgame plans hold 6 merged and
  3 deferred).
- A plan with **one unmerged branch** is NOT identified. Assert the negative:
  an implementation that flags everything passes the positive test.
- **Nothing flips a phase without a person.** Assert it directly.

Plus the repo's gates: `nvm use` (Node 24), `pnpm run test:board` green, a
changeset with its `bumps:` block if a skill changes, `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` on `main`
when the PR exists. **Push your first real commit as soon as it exists** — and
run tests in the foreground: three workers stalled today with sound work
uncommitted.

### Scope guard

You own the detection-to-action path for wave 1. Not the board button (wave 3),
not the PR back-fill (wave 2), not the phase rename (wave 4).

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.**
Never `git add -A` in this worktree.
