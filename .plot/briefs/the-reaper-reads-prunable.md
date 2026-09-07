## Implementation brief — the-reaper-reads-prunable (slice: A vanished desk is not a desk)

- **Plan (canonical):** `docs/plans/2026-09-06-a-desk-is-adopted-and-swept.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/the-reaper-reads-prunable` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

**Its `waits:` annotation is cleared and the prerequisite has landed.** `finishedWith` merged with **#754**, so the reaper's decision path is now one rule rather than two divergent copies. That wait was real: adding a sixth reading while the ref-deleter held its own copy would have meant writing it twice.

Slice 1 merged as **#729**. This is the last slice; it unblocks the plan's delivery.

## What this delivers

`plot-reap.sh` reads git's `prunable` and reports a tree whose directory is gone.

**GIT ALREADY KNOWS, AND ONE COMPONENT ALREADY ASKS.** `plot-fleet-scan.sh:1366` parses the porcelain output and skips prunable entries for a stated reason: a directory can be deleted without git knowing. **The reaper asks five questions about a tree and every one assumes the tree exists.**

## It is a report, not a sixth refusal

**THE OTHER FIVE SAY *do not remove this*. `prunable` SAYS *there is nothing to remove and the entry is stale*.** Those are different sentences and the output must not blur them.

A refusal tells an operator to go and look. This tells them `git worktree prune` will tidy it.

## The reading travels through the port it already has

**`trees-git.ts` PARSES `prunable` TODAY** — verified 2026-09-07 at `:23` and `:33`, where it reads the porcelain field and carries it in the local shape. **`ports/trees.ts` does not expose it.**

So the field joins the port, and `rules/reapable.ts` is handed it — **rather than the reaper growing a sixth `git` call of its own**. That is the layering rule: the adapter reaches the world, the domain takes readings as values.

## It joins one rule, not one of two

`finishedWith` (#754) states every condition both scripts apply, with `unknown` as a first-class answer for a reading that cannot be taken. **A vanished tree is exactly that case at its sharpest**: four of the reaper's five conditions need a tree, and a pruned entry has none.

**Do not make `prunable` a sixth boolean beside them.** It answers a prior question — *is there a tree at all* — and the four tree-dependent conditions are unaskable when it is true.

## Done when

- `plot-reap.sh` reports a worktree entry whose directory is gone, distinctly from its five refusals
- `prunable` is on `ports/trees.ts` and reaches the domain as a reading
- the reaper gains no new `git` invocation
- the report names `git worktree prune` as the repair
- the five existing refusals are unchanged
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not make it a refusal.** Nothing is being protected; the entry is stale.
- **Do not add a `git` call to the reaper.** The adapter already parses this field.
- **Do not prune anything.** The reaper removes checkouts it was asked about; a stale entry is git's to tidy and the operator's to trigger.
- **Do not touch `plot-release-refs.sh`.** A vanished tree says nothing about a ref, and that asymmetry is the point of `finishedWith`.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json`.
