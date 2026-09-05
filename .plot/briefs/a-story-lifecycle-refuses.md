## Implementation brief — a-story-lifecycle-refuses (slice: The story's lifecycle)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-story-lifecycle-refuses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of five, and it gates the other four. It is the pattern the agent, worktree and slice lifecycles then follow, so what this branch settles about SHAPE is what four later branches copy.

## What this delivers

`packages/domain/src/transitions/story.ts` — a story's lifecycle as a domain rule that refuses illegal transitions, with a unit test per refusal.

## Why the story goes first

**It is the one lifecycle already declared three times, disagreeing.** Verified 2026-09-05:

| declaration | what it says |
|---|---|
| `entities/story.ts:10` | six states: `draft ready active in-review paused done`. No `archived` |
| `contract/schema.ts:225` | **the same six again, by hand**, importing nothing from the domain |
| `board.ts:1401` | returns a **seventh**, `'archived'`, that neither list admits |

`deriveStoryStatus` is typed `(declaredStatus: string, plans) => string`, so `'archived'` type-checks against nothing. The duplicated six are the more dangerous half — they agree today, so nothing looks wrong, and they drift the moment one is edited. `deriveStoryStatus` is that drift, already happened.

**It cost a person rather than CI.** Measured 2026-09-04: five stories were marked `done` while consolidating the estate, three of them wrongly. What caught it was the board rendering a warning and a human reading it. Every step was a correct reading of a different declaration.

## The two assertions the plan names

**1. A status the domain cannot represent is a compile error.** This fails today at `board.ts:1401` (`return 'archived'`). Give the return type the domain's union and the line stops compiling — that failure is the deliverable, not an obstacle to it.

**2. `archived` is derived, never stored.** The board's rule — *every plan released* — becomes a domain function over a story's plans, and the board reads the answer instead of computing a second one. `deriveStoryStatus:1393` currently computes `allReleased`, `allDelivered`, `hasApproved` inline; that logic moves.

## The fourth reader

`plot-story-lint.sh:91` decides S3 — *status done but not archived* — from its own parsing:

```sh
if [ "${status_lc%% *}" = "done" ] && [ "$in_archived" = 0 ] \
   && ! grep -qi '^archived:' "$story"; then
```

This is the check that catches a half-archived story today, and it duplicates `archivalIsConsistent` (`entities/story.ts:73`):

```ts
export const archivalIsConsistent = (story: Story): boolean =>
  storyIsDone(story) === (story.archived !== null);
```

Same invariant, two implementations, one in shell and one in TypeScript. **The lint must keep working** — it is a gate and this branch must not weaken it. Whether it reaches the rule through a bundle or stays as it is with the duplication documented is this slice's call; say which and why in the code.

## The pattern to follow

`packages/domain/src/transitions/plan.ts` is the one that works. Verified: **41 tests, 46 `isRefusal` assertions** in `packages/domain/test/transitions.test.ts`.

Its shape, which this file should mirror:

```
Precondition        what must hold
RefusalReason       a closed union of why-nots
Refusal / Decision  the two outcomes
TransitionResult    Decision | Refusal
isDecision / isRefusal   type guards
<verb>able(x)       the boolean
<verb>(x, input)    the result
```

Its callers reach it two ways, and both precedents exist: `server/entry/transition.ts` imports it directly, and `plot-approve.sh:474` pipes JSON into `board/plot-transition.mjs` and reads the answer back. Nine such bundles exist under `skills/plot/scripts/board/`.

**Readings as values, not ports.** The domain here takes what was measured and returns an answer — no rule imports a port or awaits anything. `rules/quiet.ts:36` is the model, and it already documents this exact discipline for a host answer.

**Arrow functions.** `export const f = (…) => …` in `packages/domain/**`. The purity gate holds: outside `adapters/`, the domain imports `zod` and nothing else.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `skills/plot/scripts/plot-story-lint.sh` must stay green on this estate.

A test per refusal is the plan's own standard — 24 refusal assertions is what `plan.ts` earned its confidence with.

## Done when

- `transitions/story.ts` exists with a refusal per illegal transition and a test per refusal
- `contract/schema.ts:225` no longer declares the six states by hand
- `deriveStoryStatus` cannot return a status the domain does not admit — enforced by the type, not by review
- `archived` is derived from plan phases by a domain function, computed in one place
- `plot-story-lint.sh` still catches a half-archived story
- the gates above pass

## Do not

- **Do not add `archived` to `StoryStatusSchema`.** It is derived. `entities/story.ts:3` says the six are *"written by a person, never derived"*, and `archived` is the opposite kind of thing — mixing them is what produced the seventh value.
- **Do not weaken `plot-story-lint.sh`.** It is a gate and it caught what the board only warned about.
- **Do not generalise to the other four entities here.** Agent, worktree, slice and the `infra/` branch are their own slices, and each is blocked behind this one so it can copy a settled pattern.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
