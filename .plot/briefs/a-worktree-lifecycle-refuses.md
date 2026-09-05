## Implementation brief — a-worktree-lifecycle-refuses (slice: The worktree's lifecycle)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-worktree-lifecycle-refuses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 3 of five. `a-story-lifecycle-refuses` merged as **#707** and `an-agent-lifecycle-refuses` as **#710** — copy their shape.

## What this delivers

`packages/domain/src/transitions/worktree.ts` — a desk's lifecycle as a rule that refuses illegal transitions, with a test per refusal.

## The assertion

**A reaped checkout is re-creatable and a deleted ref is not.** That asymmetry is what makes `plot-reap.sh` and `plot-release-refs.sh` refuse differently, and it lives only in their comments today.

`plot-release-refs.sh` states it: a removed checkout *"comes back with `git worktree add`, a deleted ref does not, so the blast radius is bounded by the plan file."* That is why the reaper is slug-blind and the ref-deleter is plan-scoped.

**Make it a property the code can be held to**, not a paragraph two scripts happen to agree on.

## What already exists — do not rebuild it

**`rules/reapable.ts` is there and the reaper already asks it.** Verified 2026-09-05: three exports, and `plot-reap.sh:46` says it *"reads `packages/domain/src/rules/reapable.ts`, and ACTS on the answer; it holds no judgement."*

So the reaper's five measurements are already domain-side. **This slice is about TRANSITIONS** — what a desk may move between, and what it may not — rather than re-deriving the reap question.

**The five refusals, for reference:** a live worker pid; uncommitted changes; a `PLOT-BLOCKED*` marker; a tree sitting on the default branch; no merged PR.

## The boundary with `a-desk-is-finished-with-once`

**#705 is a separate, open plan about the ref-deleter's five guards** — that `plot-release-refs.sh` answers the same question about the same desk with its own copy of the judgement.

**This slice does not touch `plot-release-refs.sh`.** It supplies the transitions the desk has; #705 is what routes the ref-deleter through them. If the two collide, this one yields — it is the earlier of the pair and the one whose scope is the domain type.

## The pattern to follow

`transitions/plan.ts`, `transitions/story.ts` (#707), `transitions/agent.ts` (#710). Shape:

```
Precondition · RefusalReason · Refusal · Decision · TransitionResult
isDecision / isRefusal · <verb>able(x) · <verb>(x, input)
```

`transitions.test.ts` holds 41 tests with 46 `isRefusal` assertions for the plan lifecycle — that is the standard a refusal set is held to here.

**Readings as values, not ports.** The rule performs no I/O; the caller reads and passes in. `rules/reapable.ts` and `rules/quiet.ts` are the models.

**Arrow functions**, purity gate holds (outside `adapters/`, the domain imports `zod` and nothing else), TSDoc says what an export does rather than why it was decided — the reasoning goes in the commit.

## Testing

A test per refusal, and each must fail against a real violation. The plan's own warning, from the agent slice: an earlier draft's assertion *"would have passed on the day it was written."*

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

## Done when

- `transitions/worktree.ts` exists with a refusal per illegal transition and a test per refusal
- the re-creatable/not-re-creatable asymmetry is a property the code carries, not a comment
- `rules/reapable.ts` is consumed, not duplicated
- `plot-reap.sh` still refuses on its five measurements
- the gates above pass

## Do not

- **Do not re-derive the reap question.** `rules/reapable.ts` already answers it and the reaper already asks.
- **Do not touch `plot-release-refs.sh`.** That is `a-desk-is-finished-with-once` (#705).
- **Do not weaken any of the five refusals.** Each is a measurement, and the tree-on-the-default-branch one exists because such a tree's dispatched branch was never checked out, so its state was never measured.
- **Do not make ref deletion look symmetrical with reaping.** The asymmetry is the whole assertion.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
