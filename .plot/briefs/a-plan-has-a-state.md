## Implementation brief — the-workflow-owns-the-word-phase (slice: Naming what a plan is)

- **Plan (canonical):** `docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md` on main
- **Approved:** 2026-09-04, plan-PR #701 merged, 2 rounds of interrogation
- **Branch:** `feature/a-plan-has-a-state` (base: `main`)
- **Ends as:** one PR to main
- **Sprint:** the-domain-owns-the-lifecycle

**This slice lands FIRST in its plan and blocks two others.** The four
`transitions/` files in `a-lifecycle-is-enforced-by-a-test` are written after it
or they copy the conflation into four new files. Do not widen scope; do not wait
for anything.

### What to build

`Phase` → `PlanState` in `packages/domain/src/transitions/plan.ts:13`, the
`phase-*` refusal reasons → `state-*`, and every caller through the domain and
the board.

**A plan has a state; the development workflow has phases.** A delivered plan is
in the Testing phase — its state is `delivered`, its phase is `Testing`. One word
carries both today, and `Phase` is declared twice in `packages/domain/src`
meaning different things: `transitions/plan.ts:13` (a plan's states) and
`rules/phase.ts:15` (`Discovery | Design | Development | Testing | Released`,
which are the workflow's). **This slice renames the first only.** The second is
`feature/the-workflow-has-phases`, a different branch.

### The decisions the plan settles — do not re-derive them

**The plan FILE keeps `- **Phase:**`, and the wire key stays `phase`.** 196 plan
files carry the field, humans type it, and the board ships `phase` on the wire —
`schema.ts:328` and `:581` type it as `z.enum(BOARD_PHASES)`. Renaming the wire
key breaks every reader of `/api/board`. The file rename is a separate slice
(`infra/a-plan-file-says-state`) with a dual-read parser; it is not this one.

**Scale, measured 2026-09-04:** 221 `phase` occurrences in `packages/domain/src`,
528 in `packages/board/src`, 308 in `skills/plot/scripts/*.sh`. Most are the
workflow's phases or the file field and must NOT change. Rename what refers to a
**plan's state**.

**`rules/phase.ts` is not yours.** It holds the workflow's five phases and
`toBoardPhase`, which has 14 tests. Leave it.

### Done when

The plan's `## Slices` entry is the specification. Plus:

- **Asserted: nothing named `Phase` in the domain refers to a plan.**
- **The board renders identically** — `pnpm run test:board` green, and the
  wire payload unchanged.
- **All 196 plan files parse unchanged** — `plot-plan-meta.sh` over
  `docs/plans/*.md` before and after, zero differences.
- Repo gates: `nvm use` (Node 24), `corepack pnpm`, `pnpm test`,
  `pnpm run typecheck`, `pnpm run test:reconcile`, `pnpm run test:board`.
  **Do NOT run `pnpm run test:e2e`** — CI's gate, and it takes the machine down.
- A changeset. `'plot': patch` with a `bumps:` block if a skill changes;
  description FIRST, `bumps:` LAST.

### Verify against the code, not a reading of it

**This plan's own interrogation found two confident claims that a grep produced
and a single run disproved.** Before asserting that a rename is safe, run the
thing: parse a plan both ways, build the board, diff the payload. A claim about
what a parser or a renderer does, made from a grep, is the failure mode this
whole story exists to remove — and it has already happened twice inside it.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Slices` section on main. Push the first real commit as soon as it exists.

### Scope guard

Yours: `packages/domain/src/transitions/plan.ts` and the callers of the symbols
it renames.

**Not yours:** `rules/phase.ts` (the workflow's phases — another slice), the
plan file's `**Phase:**` field (another slice), the `phase` wire key (never).

**In flight elsewhere:** 36 branches hold files across the repo;
`bb-state-work-parked` holds `plot-host.sh`, and three `bug/` branches hold
`plot-worker-loop.sh`. None should collide with `transitions/plan.ts`, but rebase
before opening the PR.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
