## Implementation brief — a-story-status-meets-its-plans (slice: A story that disagrees with its plans says so)

- **Plan (canonical):** `docs/plans/2026-09-06-a-story-says-what-it-is.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-story-status-meets-its-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 2 of two, and the only one left: slice 1 (`bug/a-story-status-parses`) **moved** to `a-stated-state-is-one-the-domain-admits` — one defect found from two ends, and the refusal belongs at the parse where every consumer inherits it.

## What this delivers

`plot-story-lint.sh` reports a story whose written `status:` is behind what its plans say. It names both and corrects neither.

## This slice is a MOVE, not a build

**The comparison is already written and already correct.** Verified 2026-09-06 — `computeStatusDrift` at `packages/board/src/server/board.ts:1463` (the plan says 1416; the file has moved):

```ts
function computeStatusDrift(declaredStatus: string, derivedStatus: StoryStanding): string | null {
  if (!declaredStatus) return null;
  if (declaredStatus === derivedStatus) return null;
  const statusOrder = ['draft', 'active', 'done', 'archived'];
  ...
  if (derivedIdx > declaredIdx) { ... }   // warns ONLY when declared is behind
  return null;
}
```

It returns *"All plans released"*, *"All plans delivered"* or *"Has approved plans"*, and warns only in the one direction — which is this slice's stated rule, already implemented. It is called once, at `board.ts:1597`.

**So do not write a comparison. Move this one**, to `packages/domain/src/transitions/story.ts`, beside the `StoryStanding` it compares against. The lint reads it through a bundle the way `plot-approve.sh` reads `plot-transition.mjs`.

**That is the layering rule applied to a rule already correct and in the wrong layer:** `plot-story-lint.sh` cannot call a board function, and a person reading the board is the only thing catching the drift today.

## Two things to fix in the move

**`statusOrder` is a THIRD list of statuses and it travels with the function.** `['draft','active','done','archived']` has four entries; `StoryStatusSchema` admits six (`draft ready active in-review paused done`) and `StoryStanding` adds the seventh (`archived`). **The ordering list silently omits `ready`, `in-review` and `paused`** — so whether a paused story can be *behind* its plans is answered today by accident, via `indexOf` returning `-1`. Decide it deliberately and say which, in the code.

**`computeStatusDrift` is a `function` declaration.** The domain package requires arrows (`export const f = (…) => …`), and CI greps only `packages/domain/src/` — so this is a rule that needs a reviewer who knows it. Write it as an arrow.

**The TSDoc is factual, not historical.** What it does, what its parameters mean, what it returns. The reasoning belongs in the commit message.

## The measured case, re-measured today

`the-domain-knows-what-plot-knows` — `status: draft` on disk, and its plans:

```
2026-09-04-every-element-is-a-domain-concept.md    approved
2026-09-04-the-workflow-owns-the-word-phase.md     approved
2026-09-04-a-lifecycle-is-enforced-by-a-test.md    approved
2026-09-06-a-story-says-what-it-is.md              approved
```

**Four of four Approved** — the plan said three, and a fourth was added since. `deriveStoryStatus` answers `active`; the file says `draft`; nothing reports it.

**A story behind its plans is one nobody updated; a story ahead of them finished early.** The first is the common one, and it is the only one this reports.

## Reported, never corrected

`entities/story.ts:3` gives the reason: *"no mechanism can observe whether knowledge is still being added to, so a story whose plans have all delivered may still be `active`."* A story can legitimately be `paused` with approved plans. It cannot legitimately be nothing at all.

## The lint

**S5, and the footer counts it.** `plot-story-lint.sh` has four findings (S1–S4) plus a machine-countable footer, and **S5 is free**: the sibling plan `a-stated-state-is-one-the-domain-admits` states *"Not a fifth lint — the refusal belongs where the parse happens"*, so it adds none. Verified 2026-09-06 against `main`.

**Whether it gates is a judgement to make and state.** S1–S4 exit 1. A status behind its plans is a reporting gap, not a broken pointer — argue it either way in the code, but say which and why.

## Done when

- the lint reports a story whose status is behind what its plans say, naming both
- `computeStatusDrift` lives in `packages/domain/src/transitions/story.ts` as an arrow, with `board.ts` calling it there
- the four-value `statusOrder` no longer sits inline in the board, and its treatment of `ready`/`in-review`/`paused` is deliberate
- the lint fires on `the-domain-knows-what-plot-knows` and corrects nothing
- `pnpm test`, `pnpm run test:reconcile` and the board's tests pass

## Do not

- **Do not write a new comparison.** Move the one at `board.ts:1463`.
- **Do not correct any story's status**, and do not offer to.
- **Do not touch the six written statuses.** `entities/story.ts:3` settles that they are a person's.
- **Do not change how `archived` is derived.** #707 built it and it works.
- **Do not use a `function` declaration in the domain package.** No gate catches it outside `packages/domain/src/`; a reviewer does.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** This slice touches the domain, so run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` — vitest passes where `tsc` fails, and CI runs that step separately.
