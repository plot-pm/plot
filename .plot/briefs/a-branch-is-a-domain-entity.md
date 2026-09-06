## Implementation brief — a-branch-is-a-domain-entity (slice: Naming the branch)

- **Plan (canonical):** `docs/plans/2026-09-04-every-element-is-a-domain-concept.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-branch-is-a-domain-entity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of three; the other two (`bug/the-default-branch-repairs-itself`, `feature/a-plan-is-a-domain-entity`) wait on it.

## What this delivers

`SourceBranchSchema` is renamed to what it is, and the branch rules that live in shell move onto it.

**IT IS A HOME FOR THE RULES, NOT A WRAPPER ROUND A STRING.** The wrapper framing did not survive measurement: only **4** fields in the whole domain are a bare branch string, none is a plan slug, and this repo has **no branded-type precedent**. A `Branch` that only stopped a slug being passed where a branch belongs would move no judgement.

## What is actually scattered

**The schema is already a Branch entity in all but name.** Verified 2026-09-06 — `packages/domain/src/entities/fleet.ts:148` (the plan records `:124`; the file has moved) carries `branch`, `state`, `deferred` and the deferral reason.

**The judging is what lives in shell, and it is written twice:**

| script | count |
|---|---|
| `plot-reap.sh` | five refusals |
| `plot-release-refs.sh` | five guards |

**They are the same question about the same thing, and each is blind to a guard the other applies** — measured 2026-09-06: `plot-release-refs.sh` never asks about a live pid; `plot-reap.sh` never asks `pr_open`. Two implementations that must never disagree, and they already do.

**`packages/domain/src/rules/reapable.ts` ALREADY EXISTS** — 122 lines on `main`. **Read it first.** Part of this work may already be there, and a third copy is the exact failure this slice exists to end.

**Asserted: the reaper's refusals and the ref-deleter's guards are one rule with two callers.** That is the property that makes the type worth having, and the one a wrapper would not deliver.

## The asymmetry is load-bearing and must survive

`plot-reap.sh` removes a **checkout**, which `git worktree add` re-creates. `plot-release-refs.sh` deletes a **remote ref**, which is not undoable. That is why ref deletion is plan-scoped where the reaper is slug-blind. **One rule with two callers must not flatten that into one blast radius** — the shared rule answers the question; each caller keeps its own scope.

## Done when

- the schema is named for what it is, and its callers follow
- the reaper's and the ref-deleter's rules are one rule in the domain with two callers
- neither caller loses a guard the other had — all ten readings survive
- the checkout/ref asymmetry is preserved and stated in the code
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not create a branded string type.** The plan measured this and rejected it.
- **Do not write a third copy of the reap rules.** `rules/reapable.ts` exists; extend it.
- **Do not give the ref-deleter the reaper's scope**, or vice versa.
- **Do not rewrite functions you are only passing through.** The unit is the function, not the file — a rename inside a signature does not make its neighbours yours.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc` — vitest passes where it fails.
