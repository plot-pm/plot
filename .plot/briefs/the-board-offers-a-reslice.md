## Implementation brief — a-wave-is-one-branch (wave: Offered)

- **Plan (canonical):** `docs/plans/2026-08-21-a-wave-is-one-branch.md` on `main`
- **Branch:** `feature/the-board-offers-a-reslice` (base: `main`)
- **Ends as:** one PR to `main`

Two prior waves have landed: **#335** (`/plot-reslice`, the command this button
spawns) and **#341** (the reconcile section that reports unsliced waves). You are
the third and last: the control that reaches the command.

### What to build

The `unsliced-wave` row gains **one menu item — *Slice this wave*** — which
spawns `/plot-reslice`, wrapping the agent exactly the way `/api/idea` wraps
`/plot-idea`.

### The decisions the plan settles — do not re-derive them

**The detection does not change.** `stuckState`'s `unsliced-wave` arm and
`isSpikeWave` landed already and are not revisited. You are adding a control to
a row that already knows it is unsliced.

**The board writes nothing itself.** It spawns the command; `/plot-reslice` asks
a human before rewriting a plan's `## Branches`. This is the standing rule for
board writes — reuse `/api/idea`'s agent-spawn shape for a judgement act rather
than inventing a lifecycle transition.

**A new write route must join the write-gate test.** Adding `POST /api/*`
fails `write-gate.test.mjs` until the route is added to its `WRITE_ROUTES`. This
is a known trap in this repo — expect it rather than debugging it.

**Refuse with a reason, never silently.** The item is absent where the server
would refuse and NAMES the refusal on the control. A `complete` wave offers
nothing. The route refuses a non-localhost binding, like every other spawn.

### Done when

The plan's `## Branches` → *Offered* entry is the specification, and its test
list is explicit. Plus: `nvm use` (Node 24), `pnpm test`, `pnpm run test:board`,
`pnpm build:board` with the artifact committed, and a changeset with its
`bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own the new route in `packages/board/src/server/`, its registration, the
menu item in `AgentList.tsx`, and their tests.

Two other agents are live in `AgentList.tsx` territory
(`bug/the-wave-name-stays-in-its-cell`) and in
`packages/board/src/server/` (`bug/the-registry-names-a-live-agent`, which holds
`schema.ts`, `registry.ts`, `continue.ts`). **Do not touch `schema.ts`** — if the
menu item needs a contract change, stop and report it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
