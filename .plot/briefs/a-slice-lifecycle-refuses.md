## Implementation brief — a-slice-lifecycle-refuses (slice: The slice's lifecycle)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-slice-lifecycle-refuses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

The last of the four entity lifecycles. `story` (#707), `agent` (#710) and `worktree` (#716) have merged — copy their shape.

## What this delivers

`packages/domain/src/transitions/slice.ts` — a slice's lifecycle as a rule that refuses illegal transitions, with a test per refusal.

## The states

`eligible`, `claimed`, `waiting`, `merged`, `deferred` — plus the `waits:` prerequisite that `a-slice-can-wait-on-another-plan` introduced (**Released**, so the feature is live).

**`SliceVerdict` already exists** in `entities/fleet.ts` and `rules/eligible.ts` consumes it. This slice adds the transitions between those verdicts, not a second set of them.

## THE ASSERTION IS A DEADLOCK THE PLAN WAS CORRECTED TO AVOID

**Asserted: a prerequisite that merged and was then reaped still clears.**

A slice waiting on another names it with `waits:`. If the prerequisite merges and its ref is later deleted by `plot-release-refs.sh`, a naive reading finds no branch and concludes the prerequisite never landed — so the waiter waits forever.

**That was found while writing `a-slice-can-wait-on-another-plan` and fixed by correcting the plan.** It is remembered in prose today; this slice makes it a refusal a test holds.

**`waits:` is parsed in 9 places in `plot-plan-meta.sh`** — the parser is the contract and the transitions rule reads what it reports, never re-parsing.

## Where the readings come from

**`rules/eligible.ts:80` is the neighbour to read first.** `sliceVerdict` returns `complete` when `outstanding === 0`, above every other test — and `the-slice-contract-says-what-it-reads` is an open Draft about that line answering `complete` for a slice with **no branches at all**.

**Do not fix that here.** It is a separate plan with its own round. But the transitions rule must not depend on `outstanding === 0` meaning *finished*, because it does not always.

## The pattern to follow

`transitions/plan.ts`, `story.ts` (#707), `agent.ts` (#710), `worktree.ts` (#716):

```
Precondition · RefusalReason · Refusal · Decision · TransitionResult
isDecision / isRefusal · <verb>able(x) · <verb>(x, input)
```

`transitions.test.ts` holds 41 tests with 46 `isRefusal` assertions for the plan lifecycle — that is the standard.

**Readings as values, not ports.** The rule performs no I/O; the caller reads and passes in.

**Arrow functions**, purity gate holds — outside `adapters/`, the domain imports `zod` and nothing else. **TSDoc says what an export does**; the reasoning goes in the commit.

## The ratchet is live and will notice

`scripts/check-state-declarations.sh` shipped in #720. A `lifecycle` marker without a `transitions/<entity>.ts` fails it — so declaring the slice's lifecycle without writing the rule is a red build, and writing the rule lowers the count.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, and `./scripts/check-state-declarations.sh`.

A test per refusal, each failing against a real violation — the plan's standing warning is that an earlier draft's assertion *"would have passed on the day it was written."*

## Done when

- `transitions/slice.ts` exists with a refusal per illegal transition and a test per refusal
- a prerequisite that merged and was then reaped still clears, asserted
- `SliceVerdict` is consumed, not redeclared
- `check-state-declarations.sh` count is lowered
- the gates above pass

## Do not

- **Do not redeclare the slice states.** `SliceVerdict` is in `entities/fleet.ts`.
- **Do not re-parse `waits:`.** `plot-plan-meta.sh` is the contract; read what it reports.
- **Do not fix `eligible.ts:80`.** That is `the-slice-contract-says-what-it-reads`, a Draft with its own rounds — but do not depend on `outstanding === 0` meaning finished.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
