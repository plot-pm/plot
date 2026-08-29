## Implementation brief — the-domain-moves-out-of-the-board (slice 4: Transitions)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-moves-out-of-the-board.md` on `main`
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Branch:** `feature/a-transition-is-one-value` (base: `main`)
- **Ends as:** one PR to `main`
- **Depends on:** slice 1 (#509, merged), **slice 2** (`Deliverable`) **and slice 3** (`Entities`).

**The ordering is a gate, not advice.** A slice becomes eligible only once
EVERY prior slice has merged, so this is the last of the four — verified in
the fleet scan 2026-08-29. The slices touch different directories and are
independent in CONTENT, but they are dispatched strictly in order.

### What to build

`plan.approve()`, `plan.deliver()`, `plan.release()` in `@plot-pm/domain` —
**returning what should be written rather than writing it.**

Each returns `Decision | Refusal` and **checks its own precondition**.

### The decisions the plan settles — do not re-derive them

**A STATED state can be wrong.** A file can say `Approved` when nobody approved
it. That is why transitions are gated — *"and a gate a caller can skip is a rule
rather than a gate"*.

**`plot-approve.sh` is the shape to copy.** It refuses on the phase, on the
review channel, and on the PR state **before writing anything**, and it names
**which** refusal fired. The domain transition carries the **mechanical**
refusals. It cannot carry the PR check — that needs a host, and stays a
precondition an adapter supplies as a reading.

**`approvable(plan)` stays callable alone, and `approve()` does not trust it.**
The board's Approve button needs to know whether to *offer* the action before
anyone takes it. But a caller that checked is indistinguishable from one that
did not, so `approve()` re-checks. **The separation is deliberate and narrow** —
do not collapse the two into one function, and do not make `approve()` assume
`approvable()` ran.

**One value, because the pairing came apart in practice.** The measured defect:
*a phase flip without its record made a delivered plan invisible to the scan,
reporting zero.* Today the pairing is a rule **four call sites** must remember.
Here it is one value that **cannot** come apart — so a `Decision` carries the
phase **and** its record together, or it is not a `Decision`.

**Return, never write.** The domain reaches nothing. CI greps for
`node:`/`fs`/`child_process`/`http` under `packages/domain/src/` and fails on a
hit. A transition that writes has become an adapter.

### Done when

The plan's `## Done when` for this slice:

- a transition's output is **assertable as a value**
- **no transition can produce a phase without its record** — make this
  structurally impossible in the type, not merely untested
- **every refusal is individually triggerable by a named test** — one test per
  refusal, named for it, so a refusal that stops firing fails loudly rather than
  silently widening what is allowed
- coverage of `src/transitions/` is **100%**

**The coverage gate will bite here.** Slice 1's 100% covered 8 statements and 0
branches (zod declarations are not executable). Refusal paths are branches —
expect to write a test per refusal, which is exactly what the third clause asks.

Plus the repo's gates: Node 24 (`nvm use`, `corepack pnpm`), `pnpm run
typecheck`, `pnpm run test:board`, a changeset.

### The independent check, if a moved rule feels wrong

`plot-reconcile-scan.sh` **section 2 derives merged-ness from git and from
merged PR heads — never from `allWavesMerged`.** So if the domain calls a plan
undeliverable while its branches have in fact merged, the scan says so. Use it
as the arbiter rather than trusting the tests you just wrote.

**And a halt is allowed.** The plan's own *"When to stop rather than continue"*
says the two dependent plans are Draft **precisely so this can happen** — a
design failing its first real contact should not have two approved plans behind
it. If the `Decision | Refusal` shape does not survive contact with
`plot-approve.sh`'s real refusals, **stop and report** rather than bending it.

### House rules — the terminology one changed since this brief was written

`CLAUDE.md` › **The Domain Package**, all CI-gated:

1. **The spec's vocabulary is binding.** `infra/the-domain-names-a-slice` lands
   `FleetSliceSchema`, `SliceVerdictSchema` and `plan.slices`. **Write Slice,
   never Wave.** A gate counts `wave` under `packages/domain/src/` and fails on
   an increase over `allowed=` in `.github/workflows/ci.yml`; do not raise it.

   The rule this replaces said *"keep the names as they are"* — correct when
   written, wrong since the review made the terminology binding.

   `allWavesMerged` is being renamed to `allSlicesMerged` by
   `feature/one-deliver-rule-decides-in-the-domain`. Import whichever name
   exists when you rebase; do not rename it yourself.
2. **Arrow functions.** `export const f = (…) => …`. A `function` declaration
   under `packages/domain/src/` fails the build.
3. **Factual API docs.** TSDoc says what an export does, its parameters, its
   return, its failure modes — and stops. Reasoning goes in the plan and the
   commit message, dated and findable with `git log -S`. The measured problem:
   **28 lines of code under 109 lines of comment.**

### Two traps this plan's earlier slices fell into

**`tsc` is a strong gate with one hole: a cast.** Slice 2's brief promised its
rename was *"purely mechanical, and gated by `tsc` — the compiler names every
site that has not moved"*. It could not name one: a fixture built with
`as never` switches type checking off for that literal, so the compiler saw a
valid assertion and CI died at runtime with
`Cannot read properties of undefined (reading 'flatMap')`.

So when you change a shape, **run the suite** — `tsc` alone does not close it.
Grep for `as never`, `as unknown as` and `as any` in the tests you touch.

**Read occurrences; do not count them.** A `grep` for `.waves` finds ~21 sites
and reads like unfinished work. Four are `meta.waves` (the parser's output),
several are the board's own `WaveSchema` (a DIFFERENT entity that keeps its
name), and most of the rest are prose. **Seven were real, and they were already
correct.** A mechanical replace would have erased a distinction the schema
documents at `contract/schema.ts`.

The same applies to your own work: `allSlicesMerged` is the rule's name. It is
not a licence to rename every `wave` you find.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Transitions (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn, and a
  background job's completion never reaches you.

### Scope guard

**This branch owns:** new files under `packages/domain/src/transitions/`.

**The sibling slices run one at a time, not beside you** — the wave gate
serialises them —
`feature/one-deliver-rule-decides-in-the-domain` (`src/rules/`) and
`feature/the-entities-carry-their-states` (`src/entities/`). Expect a trivial
conflict in `packages/domain/src/index.ts` if all three export from it; rebase,
never revert.

**Do not touch `fleet.ts`**, and do not move `allWavesMerged` — that is slice
2's.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
