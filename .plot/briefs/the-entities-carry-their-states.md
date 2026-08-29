## Implementation brief — the-domain-moves-out-of-the-board (slice 3: Entities)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/the-entities-carry-their-states` (base: `main`)
- **Ends as:** one PR to `main`

**Pulled ahead of the wave gate, deliberately.** The scan reads this slice
`blocked` because `Deliverable` precedes it in the plan and the gate serialises
*within* a plan. That gate asks about ORDER, not about dependency — and this
slice depends on nothing the others produce. It creates **new files only**,
under `packages/domain/src/entities/`, and imports nothing from `fleet.ts`.

### What to build

The ten entities the pulse does **not** carry, as domain types in
`@plot-pm/domain`: **PR, Build, Release, Worktree, Agent, Machine, Issue, Story,
Sprint, Person** — each with the **identity kind** and **state source** its spec
records. Plus `PortResult<T>`.

**Every one has a written spec. Read it; do not re-derive the entity.**

| entity | spec |
|---|---|
| PR, Build, Release, Worktree, Agent, Machine, Issue, Story, Sprint | `docs/stories/the-master-agent-holds-the-fleet/DESIGN-<name>.md` |
| **Person** | **no file of its own** — `DESIGN-entities.md` **§1c, line 814** |
| `PortResult<T>` | `DESIGN-ports.md` §2b |

Person sitting inside `DESIGN-entities.md` is deliberate, not an omission: it
*"sits outside that split"* because it is not derived from the same sources as
the others. **Do not create a `DESIGN-person.md`.**

### The decisions the specs settle — do not re-derive them

**Four sources of state, each failing differently** (`DESIGN-review.md`): STATED
(a file — can be **wrong**), DERIVED (goes **stale**), FOREIGN (a surface that
**disagrees**), MEASURED (**decays instantly**). Each entity's spec records
which it is. That is the field you are carrying, not decoration.

**Three kinds of identity, each with its own failure**: slug (collision),
natural key (the source lying), minted (**nobody minting**). `DESIGN-agent.md`
records Agent's as *minted*, and the measured failure is exactly that: **0
manifests against 13 worktrees**, so every agent row the board shows is
synthesized rather than declared.

**`PortResult<T>` has THREE outcomes, never two**, copied verbatim from
`DESIGN-ports.md` §2b:

```ts
PortResult<T> =
  | { ok: true,  value: T }          // answered — INCLUDING an empty answer
  | { ok: false, why: 'failed' }     // asked, and it broke
  | { ok: false, why: 'unaskable' }  // this source cannot answer at all
```

*Absent is not false*, as a type rather than a discipline. Collapsing `failed`
and `unaskable` loses the distinction the whole ports design rests on — a host
that is down is not a host that cannot be asked. **The estate has already paid
for the two-outcome version repeatedly.**

**A Wave lands as a type with NO constructor.** In the spec's vocabulary a
**Slice** holds one branch and belongs to one plan, while a **Wave** is the
fleet's cross-plan cohort — *"formed at dispatch and persisted nowhere"*. It has
no source of truth, so it gets a type and no way to build one. That is the
honest shape until the plan that builds it, and it is not a gap to fill in.

### House rules — the terminology one changed since this brief was first written

`CLAUDE.md` › **The Domain Package**, all three CI-gated:

1. **The spec's vocabulary is binding.** `infra/the-domain-names-a-slice` is
   landing `FleetSliceSchema`, `SliceVerdictSchema` and `plan.slices`. **Write
   Slice, never Wave** — the sole exception is the `Wave` type above, which is
   the *real* Wave and should carry a one-line comment saying so. A CI gate
   counts `wave` under `packages/domain/src/` and fails on an **increase** over
   `allowed=` in `.github/workflows/ci.yml`; **do not raise that number.**
2. **Arrow functions.** `export const f = (…) => …`. A `function` declaration
   under `packages/domain/src/` fails the build.
3. **Factual API docs.** TSDoc says what an export does, its parameters, its
   return, its failure modes — and stops. Reasoning goes in the plan and the
   commit message, where it is dated and `git log -S` finds it. The measured
   problem that produced this rule: **28 lines of code under 109 lines of
   comment.**

### Done when

Per the plan's `## Done when` for this slice:

- **every entity is constructible in a test with no fixture file** — a
  constructor that needs a file on disk has smuggled a port into the domain
- the design's **cardinality diagram is expressible in the types**
  (`DESIGN-entities.md`)
- `vitest --coverage` reports **100% for `src/entities/`**, with the threshold
  **enforced in config** so it fails the build

**The coverage gate will bite here, unlike slice 1.** That slice's 100% covered
8 statements and 0 branches — zod declarations are not executable code. Real
constructors have branches: expect a test per refusal path, not only per happy
path.

**The domain must stay pure.** CI greps for `node:`/`fs`/`child_process`/`http`
imports under `packages/domain/src/` and fails on a hit. An entity that needs to
*read* something takes it as an argument — that is what `PortResult` is for.

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm` — homebrew pnpm
crashes), `pnpm run typecheck`, `pnpm run test:board`, `pnpm build:board`
committed if the artifact moves, a changeset naming `'@plot-pm/domain'`.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Entities (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn, so a background
  job's completion never reaches you and finished work is stranded uncommitted.

### Scope guard

**This branch owns:** new files under `packages/domain/src/entities/` and the
`PortResult` type.

**Do NOT touch `packages/domain/src/entities/fleet.ts`.** It is slice 1's moved
entity graph and `infra/the-domain-names-a-slice` is rewriting it right now — a
live branch. Your files sit beside it.

**Expect a trivial conflict in `packages/domain/src/index.ts`** if you export
from it while the rename branch does too. Rebase; never revert.

**The board suite is load-flaky on two files** — `streaming-scan.test.ts` and
`auto-dispatch-spawn.test.ts` fail under full parallel load on `main` too.
Neither touches this work. Run them alone before believing a failure, and
baseline against a pristine `main` worktree.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
