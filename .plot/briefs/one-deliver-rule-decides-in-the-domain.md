## Implementation brief — the-domain-moves-out-of-the-board (slice 2: Deliverable)

> **REBUILD.** A first attempt shipped as PR **#511** and was **closed green
> rather than merged**. Read *Why this is being rebuilt* before anything else —
> the previous work is a correct reference for the WHAT and wrong for the HOW.

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/one-deliver-rule-decides-in-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **The rename has landed.** `@plot-pm/domain` exports `FleetSliceSchema` and
  `SliceVerdictSchema`; the board's compatibility aliases are gone and it reads
  `plan.slices`. Verified 2026-08-29 — you inherit corrected names, not a
  migration in flight.

**What is still called `waves`, and must stay that way:**

| still `waves` | why |
|---|---|
| `WaveSchema` / `Wave` in the board | a DIFFERENT entity — the board's own derived per-`(plan, wave)` render state, not the domain's Slice. `schema.ts` says so at the re-export. |
| `PlanMeta.waves` | `plot-plan-meta.sh` emits that key. Slice 3 teaches the parser `## Slices`; the scan's own `"waves"` output is a separate migration step. |

**Counting occurrences will mislead you here.** A `grep` for `.waves` finds ~21
sites and suggests the rename is unfinished; reading them shows most are prose
or the two legitimate cases above. **Your rename is the RULE'S OWN NAME only.**

### Why this is being rebuilt

#511 was correct work: the definition left `board.ts`, no board test was edited,
coverage went from slice 1's toothless 100% (8 statements, 0 branches) to **30
statements / 16-of-16 branches across 36 tests**, and CI was green on the tip.

**It carried the wrong vocabulary.** `DESIGN-slice.md` renamed the entity
**Slice** on 2026-08-28: a Slice holds exactly one branch and belongs to one
plan, while a **Wave** is the fleet's cross-plan cohort, formed at dispatch and
persisted nowhere. `allWavesMerged` asks whether every *slice* of one plan has
merged — the name says Wave and means Slice. Merging it would have grown the
defect and left `Entities` and `Transitions` building on top of it.

Two further conventions were settled in the same review, and #511 predates all
three.

### What to build

Move the deliverable rule from `packages/board/src/server/board.ts` into
`@plot-pm/domain` as `src/rules/deliverable.ts`, **in the corrected vocabulary
and the package's house style**.

| #511 called it | build it as |
|---|---|
| `allWavesMerged(...)` | `allSlicesMerged(...)` |
| `export function` | `export const … = (…) => …` |
| 137 lines / 28 code / 109 comment | factual TSDoc |

**The board keeps compiling** — re-export from `board.ts` under whatever name
the call sites still use, and say in one line that the alias is temporary.

### The reference implementation, and how to use it

**#511's three commits are still on `feature/one-deliver-rule-decides-in-the-domain`
at `dcce9d22`.** Its `deliverable.ts` and `deliverable.test.ts` are a verified
reference for the LOGIC: 14 cases in the dedicated test file, and a `merged > 0`
guard whose absence once made a plan with no merged slice read as delivered.

**Take the behaviour. Do not take the prose.** That file is 28 lines of code
under 109 lines of comment — the exact ratio that produced rule 3 below.

```bash
git show dcce9d22:packages/domain/src/rules/deliverable.ts
git show dcce9d22:packages/domain/test/deliverable.test.ts
```

### The three house rules — all CI-gated, all new since #511

`CLAUDE.md` › **The Domain Package**:

1. **Vocabulary.** No new `Wave` under `packages/domain/src/`. A gate counts
   occurrences and fails on an increase over `allowed=` in
   `.github/workflows/ci.yml`. **The rename slice lowers that number before you
   start; do not raise it.**
2. **Arrow functions.** `export const f = (…) => …`. A `function` declaration
   under `packages/domain/src/` fails the build.
3. **Factual API docs.** TSDoc says what an export does, its parameters, its
   return, its failure modes — and stops. Reasoning goes in the plan and the
   commit message, where it is dated and `git log -S` finds it.

**Rule 3 has no gate and is the one to get right by hand.** A measurement worth
keeping (*"a plan with no merged slice read as delivered, 2026-08-20"*) belongs
in the commit that introduces the guard, not above it.

### Numbers in the plan that are wrong — re-measured 2026-08-29

The plan says *"with its 25 tests. The board's three call sites import it."*

| plan says | actually |
|---|---|
| 3 call sites | **4** non-test call sites |
| 25 tests | spread over **four** files; the dedicated one has 14 cases |

**Trust `tsc`, not either count.** It names every call site that has not moved.

### Done when

- the tests pass from the domain package with **no board test edited**
- `board.ts` **no longer defines** the rule — a re-export is fine, a wrapper that
  *decides* is not
- coverage of `src/rules/` meets the **100% threshold**, which **fails the
  build** when unmet — expect to write tests, not only move them
- the three house rules hold, and **the vocabulary gate's `allowed=` is not
  raised**

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm`), `pnpm build:board`
committed, `pnpm run typecheck`, a changeset naming both packages.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Deliverable (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn, so a background
  job's completion never reaches you and finished work is stranded uncommitted.

### Scope guard

**This branch owns:** `packages/domain/src/rules/deliverable.ts`, its test, the
rule's definition in `packages/board/src/server/board.ts`, and the import lines
at its call sites.

**Do not rename anything the rename plan owns.** `FleetSlice`, `SliceVerdict`
and `plan.slices` arrive from `infra/the-domain-names-a-slice`. Your rename is
the *rule's own name* only.

**The board suite is load-flaky on two files** — `streaming-scan.test.ts` and
`auto-dispatch-spawn.test.ts` fail under full parallel load on `main` too.
Neither touches this rule (verified: 0 occurrences). Run them alone before
believing a failure, and baseline against a pristine `main` worktree.

**A board artifact conflict is mechanical:** take either side of
`board-server.mjs`, run `pnpm build:board`, commit. Never read its diff.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
