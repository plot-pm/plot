## Implementation brief — the-domain-moves-out-of-the-board (slice 3: Entities)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/the-entities-carry-their-states` (base: `main`)
- **Ends as:** one PR to `main`
- **Depends on:** slice 1 (#509) — merged. `@plot-pm/domain` exists.

Independent of slices 2 (`Deliverable`) and 4 (`Transitions`).

### What to build

The ten entities the pulse does **not** carry, as domain types in
`@plot-pm/domain`: PR, Build, Release, Worktree, Agent, Machine, Issue, Story,
Sprint, Person — each with the **identity kind** and **state source** its spec
records. Plus `PortResult<T>`.

**Every one has a written spec. Read it; do not re-derive the entity.**

| entity | spec |
|---|---|
| PR, Build, Release, Worktree, Agent, Machine, Issue, Story, Sprint | `docs/stories/the-master-agent-holds-the-fleet/DESIGN-<name>.md` |
| **Person** | **no file of its own** — specified in `DESIGN-entities.md` §1c (line 814) |
| `PortResult<T>` | `DESIGN-ports.md` §2b |

Person being inside `DESIGN-entities.md` is not an oversight — the doc says it
*"sits outside that split: it is not derived from"* the same sources as the
others. Do not create a `DESIGN-person.md`.

### The decisions the plan settles — do not re-derive them

**Four sources of entity state, and each fails differently** (`DESIGN-review.md`):
STATED (a file — can be **wrong**), DERIVED (goes **stale**), FOREIGN (a surface
that **disagrees**), MEASURED (**decays instantly**). Each entity's spec records
which it is. That is the field you are carrying, not decoration.

**Three kinds of identity, each with its own failure**: slug (collision), natural
key (the source lying), minted (**nobody minting**). `DESIGN-agent.md` records
Agent's as *minted* — and the measured failure is exactly that nobody mints:
**0 manifests against 13 worktrees**, so every agent row the board shows is
synthesized.

**`PortResult<T>` has THREE outcomes, never two:**
`{ok:true,value}` | `{ok:false,why:'failed'}` | `{ok:false,why:'unaskable'}`.
Collapsing *failed* and *unaskable* loses the distinction the whole ports design
rests on — a host that is down is not a host that cannot be asked.

**Wave lands as a type with NO constructor.** The plan says why: *"Wave has no
source of truth — it is formed at dispatch and persisted nowhere."* That is the
honest shape until the plan that builds it. Do not invent a way to construct one.

> **Note on the name.** The domain currently calls a *slice* a `Wave`
> (`FleetWaveSchema`, `plan.waves`). That is a known defect with its own plan
> (`2026-08-29-the-domain-speaks-slices.md`) and a comment at the schema. The
> `Wave` you add here is the **real** Wave — the fleet's cross-plan cohort — so
> for a short while two different things carry the name. **Say so in a comment**
> rather than resolving it; the rename plan owns that.

### Done when

The plan's `## Done when` for this slice:

- **every entity is constructible in a test with no fixture file** — a
  constructor that needs a file on disk has smuggled a port into the domain
- the design's **cardinality diagram is expressible in the types**
  (`DESIGN-entities.md`)
- `vitest --coverage` reports **100% for `src/entities/`**, with the threshold
  **enforced in config** so it fails the build

**The coverage gate will bite here, unlike slice 1.** Slice 1's 100% covered 8
statements and 0 branches — zod declarations are not executable code. Real
constructors have branches. Expect to write tests for every refusal path, not
just the happy one.

**The domain must stay pure.** CI greps for `node:`/`fs`/`child_process`/`http`
imports under `packages/domain/src/` and fails on a hit. An entity that needs to
*read* something takes it as an argument — that is what `PortResult` is for.

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm`), `pnpm build:board`
committed if the artifact moves, `pnpm run typecheck`, `pnpm run test:board`, a
changeset.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Entities (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn.

### Scope guard

**This branch owns:** new files under `packages/domain/src/entities/` and the
`PortResult` type.

**Two siblings are in flight from the same plan** —
`feature/one-deliver-rule-decides-in-the-domain` (adds `src/rules/`) and
`feature/a-transition-is-one-value` (adds transitions). Expect a trivial
conflict in `packages/domain/src/index.ts` if all three export from it; rebase,
never revert.

**Do not touch `fleet.ts`.** It is slice 1's moved entity graph and the rename
plan's subject.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
