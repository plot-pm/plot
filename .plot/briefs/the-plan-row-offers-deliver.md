## Implementation brief — done-means-delivered (wave: Offered)

- **Plan (canonical):** `docs/plans/2026-08-21-done-means-delivered.md` on `main`
- **Branch:** `feature/the-plan-row-offers-deliver` (base: `main`)
- **Ends as:** one PR to `main`

Waves 1 and 2 have merged: **#345** (a fully-merged plan reaches the phase after
Development) and **#350** (`/plot-deliver` finds PRs with no `→ #N`). You are
wave 3 — the control that reaches the command those two made safe.

### What to build

The plan row gains a **`Deliver`** action that spawns `/plot-deliver <slug>`.

### The decisions the plan settles — do not re-derive them

**Wrap the skill; write nothing yourself.** The board's standing rule: it never
invents a lifecycle transition. Model this on `/api/reslice` (merged today as
**#348**) and `/api/idea` — spawn the command, let it do the work.

**Delivery is a DECISION, and this button is a person making it.** The domain
model is explicit: *"every wave being complete is a measurement; releasing is a
decision. A measurement cannot make a commitment."* The action must never fire
automatically, and reaching DONE must not imply it was pressed.

**Offer it only where it would succeed, and name the refusal otherwise.** The
same shape `/api/reslice` uses: absent where the server would refuse, and when
present-but-unavailable it says why on the control. A plan with an unmerged
branch is not deliverable — #350 kept that gate and you must not weaken it.

**A new write route must join `write-gate.test.mjs`.** Adding `POST /api/*`
fails that test until the route is listed in its `WRITE_ROUTES`. Known trap in
this repo — expect it rather than debugging it.

### Done when

The plan's `## Branches` → *Offered* entry is the specification. Plus:
`nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`, `pnpm run test:board`,
`pnpm build:board` with the artifact committed, and a changeset with its
`bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own the new route in `packages/board/src/server/`, its registration, the
control in `AgentList.tsx`, and their tests.

**Do NOT rename `Endgame` to `Testing`** — that is wave 4 of this plan
(`feature/the-phase-after-development-is-testing`), touching the `BOARD_PHASES`
enum and 13 plan files.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
