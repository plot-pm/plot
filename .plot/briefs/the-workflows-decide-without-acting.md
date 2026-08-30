## Implementation brief — the-domain-runs-the-workflows-in-a-sandbox (slice 3: Deciding)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md` on `main`
- **Branch:** `feature/the-workflows-decide-without-acting` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/the-ports-have-adapters` merged. Runs in parallel with Agreeing
and Dispatching. **`dispatch` is NOT yours** — it has its own slice, because it
is 2028 of the 3430 lines.

### What to build

Five workflows as `readings → Decision | Refusal`, refusals named individually:
`approve`, `deliver`, `reap`, `implement`, `release`.

```
workflow(readings) → Decision            // proceed, with what to write
                   | Refusal             // which rule fired, and why
```

**A `Decision` is inert.** It says *merge PR #42, set Phase: Approved, write
this record* and does nothing. That is what makes every workflow testable end
to end with no host and no repository.

### The decisions the plan settles — do not re-derive them

**Two of your five have no script, and that changes the EVIDENCE, not the
expression.** `plot-implement` and `plot-release` exist only as skill prose —
312 and 482 lines, six and nine numbered steps, five and fifteen refusal
statements, two and four `PLOT-UNASKED` shapes. **That prose IS the
specification**: it is what every agent running these workflows follows today,
so a domain that disagrees with it disagrees with production.

**But prose has no exit code.** There is no corpus comparison and no sandbox
check for those two — a disagreement between the domain and a paragraph is a
reading, and readings are how a promise nobody implemented survives review.
**Mark them in the code as fixture-verified only.** Do not let them borrow the
word "verified" that the three scripted workflows earn.

**Where a prose step is genuinely ambiguous, that is a finding about the
skill** — record it, do not resolve it by guessing. The numbered steps and named
refusals are what make this transcription rather than interpretation.

**Every `Decision` must name every write it would make**, and the Writing slice
proves it by diffing the filesystem. Do not rely on having thought of them all:
a write you forget while writing the code you forget again while reviewing it.
Read each script's write paths deliberately.

### Done when

Plan's Deciding `Done when`: each of the five workflows' refusals assertable
without a repository, each `Decision` naming every write, and the two
prose-derived workflows marked fixture-verified only.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

**Domain style** (CLAUDE.md § The Domain Package): arrow functions; factual
TSDoc; the reasoning goes in the commit. A **Slice** holds one branch and
belongs to one plan; a **Wave** is the fleet's cross-plan cohort. Do not add to
the existing `Wave`-where-`Slice`-is-meant defect.

### Scope guard

Owns the five workflows' deciding half in `packages/domain/`. Does NOT touch
`plot-dispatch.sh` (its own slice), and does NOT perform anything — no writes,
no host calls, no process starts.
