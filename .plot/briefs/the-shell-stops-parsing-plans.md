# Implementation brief — production-calls (Delivering)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/the-shell-stops-parsing-plans` (base: `main`)
- **Ends as:** one PR to main

> **This plan is gated.** It stays Draft until
> `the-domain-runs-the-workflows-in-a-sandbox` is **delivered**. Plot cannot
> enforce that — eligibility is computed per plan — and with `autoDispatch: true`
> and `parallelAgents: 11`, approving it claims a branch within a minute against
> a package that may not be ready. **Check the dependency yourself before
> starting.**

### What to build

The deliver rule's shell half gives way to the domain's. **One rule per branch,
and the branch deletes what it replaces.**

### The rule already moved; this removes the copy

`allSlicesMerged` is in `packages/domain/src/rules/deliverable.ts`.
`board.ts:671` re-exports it as `allWavesMerged`, and three call sites in
`deliver.ts` and `auto-deliver.ts` still say the old word.

**There is no second implementation to delete — there is a name to retire.**
That is what `the-sprint-proves-its-own-goal`'s gate counts, and this slice is
what makes its number fall.

### Done when

- the `TEMPORARY ALIAS` at `board.ts:671` is gone
- the three call sites use `allSlicesMerged`
- **the shell no longer parses a plan to decide deliverability** — it asks
- **delete the old implementation in the same commit**, not a follow-up

**The regression to lock:** the deliver gate still refuses the same things. Its
refusals are the only guard between a delivery and a false claim — a plan with
an unmerged branch must still fail.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:reconcile`,
`pnpm run test:board`, artifact rebuilt, changeset.

### Scope guard

Deliverability. Not eligibility (next slice), not the refusals (the one after).

**If the shell and the domain disagree on any plan in `docs/plans/`, stop and
report it.** That is the whole reason this sequence exists — two implementations
with two bug histories — and the disagreement is the finding, not an obstacle.
