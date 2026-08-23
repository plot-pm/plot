## Implementation brief — the-wave-is-a-thing-the-board-can-hold (wave: Modelled)

- **Plan (canonical):** `docs/plans/*the-wave-is-a-thing-the-board-can-hold.md` on `main`
- **Branch:** `feature/the-contract-carries-a-wave` (base: `main`)
- **Ends as:** one PR to `main`

This is wave 1 of 7 and **the foundation the rest of the plan builds on** — the
other waves consume the `Wave` this one puts on the wire. Get the shape right.

### What to build

The contract carries a **`Wave`**: identity, branches, verdict, section and
completeness — derived **once**, in the server, where the verdicts already are.

### The decisions the plan settles — do not re-derive them

**Derive it once, server-side.** The plan says *"derived once where the verdicts
already are"* — `packages/board/src/server/fleet.ts`. The renderer must not
recompute any part of it. `schema.ts` has already paid for this lesson on `kind`:

> `kind` is set where the row is CREATED, because the server is the only place
> that knows why the row exists. … A derivation is a guess with a rule attached.

**A wave has a `verdict` and INHERITS a `phase`; it never has one of its own.**
Every wave of a plan shares that plan's phase — measured across the estate, zero
plans have waves reporting different phases. Do not put a phase on the Wave.

**The client CASTS the fleet payload, it does not parse it.** A Zod `.default()`
does not apply client-side, so a renderer reading a new field on an older pulse
gets `undefined`, not the default. Give every new field a default AND expect the
consumer to guard. This repo has shipped that bug before.

### Done when

The plan's `## Done when` is the specification. Plus the repo's gates:
`nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:board`,
`pnpm build:board` with the artifact committed, and a changeset with its
`bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `packages/board/src/contract/schema.ts`,
`packages/board/src/server/fleet.ts`, and their tests.

**`schema.ts` is contended.** `bug/a-release-is-its-version` also needs a new
contract field and is deliberately NOT dispatched alongside you for that reason.
Keep your diff to the `Wave` shape so it rebases cleanly when it follows.

Waves 2–7 of this plan are blocked on you and are not yours.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
