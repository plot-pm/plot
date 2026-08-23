## Implementation brief — the-wave-is-a-thing-the-board-can-hold (wave: 2 of 7)

- **Plan (canonical):** `docs/plans/*the-wave-is-a-thing-the-board-can-hold.md` on `main`
- **Branch:** `feature/the-sections-ask-the-wave` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 1 landed as #349** — the contract now carries a `Wave` with identity,
branches, verdict, section and completeness. You are the first consumer.

### What to build

`waveGroupsFor` becomes a **lookup**. The per-section predicates that encode real
distinctions move **onto the wave** rather than being repeated at each section.

### The decisions the plan settles — do not re-derive them

**Ask the wave; do not re-derive it.** #349 put the answer on the wire precisely
so each section stops computing its own. If a predicate cannot be answered from
the `Wave`, that is a finding about wave 1's shape — **report it**, do not
reintroduce a local computation beside it.

**Move only the predicates that encode a REAL distinction.** The plan's wording
is deliberate: some per-section differences are genuine and belong on the wave;
others are repetition. Do not flatten a real distinction to make the lookup
tidier.

**A wave has a `verdict` and INHERITS its plan's `phase`; it never has one of its
own.** Measured across the estate: zero plans have waves reporting different
phases.

**`FleetWaveSchema.verdict` is a strict enum** — #349's own worker reported this.
A pulse carrying an unrecognised verdict **cannot be parsed**; it fails hard
rather than degrading. Do not add a verdict value without weighing that.

**The client CASTS the fleet payload, it does not parse it.** A Zod `.default()`
does not reach the renderer, so a new field read against an older pulse is
`undefined`, not the default. Guard the read.

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `waveGroupsFor` and the section predicates in
`packages/board/src/server/fleet.ts`, plus `schema.ts` where the wave shape needs
it, and their tests.

**`bug/a-release-is-its-version` is dispatched alongside you and also touches
`schema.ts`** — it adds a PR title field. Keep your diff to the wave shape.

`feature/the-plan-row-offers-deliver` is live in `AgentList.tsx` — **do not touch
it**. Waves 3–7 of this plan are blocked on you and are not yours.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
