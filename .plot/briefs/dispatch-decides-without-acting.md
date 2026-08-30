## Implementation brief — the-domain-runs-the-workflows-in-a-sandbox (slice 4: Dispatching)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md` on `main`
- **Branch:** `feature/dispatch-decides-without-acting` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/the-ports-have-adapters` merged. Parallel with Agreeing and
Deciding.

### What to build

`plot-dispatch.sh` alone, expressed as `readings → Decision | Refusal`.

### Why this is its own slice — do not fold it back

**Measured 2026-08-30: `plot-dispatch.sh` is 2028 of the 3430 lines across the
four scripted workflows, and carries ~46 of the ~104 error paths.** Folding it
into Deciding would make one branch larger than the other three workflows
combined. This story exists because agents stall on branches that size — one
measured stall left 324 finished lines uncommitted.

### The decisions the plan settles — do not re-derive them

**Its refusals are MEASUREMENTS, not judgements, and that is why they are
expressible:**

- a live worker pid
- a `PLOT-BLOCKED` marker
- a worktree holding unlanded work — commits not in the default branch OR
  uncommitted changes
- the phase gate, read from `origin/<main>` and never the working tree

**The phase gate reads `origin/<main>`, never the working tree.** An approval
nobody else can see is not one. It fails CLOSED when that ref is unreadable;
`--allow-local` is the explicit, named escape for a repo with no remote.

**The worktree is found by asking git which one holds the branch**, never by
rebuilding the path from the branch name. Hand-made worktrees are the population
with no claim ref, and they rarely follow dispatch's naming.

**`--restart` asks the PR FIRST, before the state word.** Five of five `failed`
worktrees measured here held a PR (four open, one merged), because
`plot-worker-state.sh` refines `finished` by the tree and deliberately does not
refine `failed`. A gate on the state word alone would restart all five and
destroy what the `finished` refusal protects.

**A `Decision` is inert** — it names what dispatch WOULD do and starts nothing.
No worktree is created, no worker spawned, no ref pushed.

### Done when

Plan's Dispatching `Done when`: every `plot-dispatch.sh` refusal is a named
`Refusal` assertable without a repository, and the `--dry-run` reasoning is
reproducible from the domain alone.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.
Domain style per CLAUDE.md § The Domain Package.

### The sprint's goal changed on 2026-08-30 — three conditions, not one

**Every existing function replaced by a domain CONCEPT, with full unit and mock
coverage, and production calling it.** Two bear on this slice.

**Coverage is 100% and the threshold applies to you.**
`packages/domain/vitest.config.ts` excludes `src/adapters/**` only; pure
`readings → Decision | Refusal` code is not an adapter, so every branch is
reachable from a plain call. **A refusal you cannot trigger in a test is a
refusal you have not expressed.** Where one needs a port to fail, mock the port
— that is what unit AND mock means here.

**Express concepts, do not relocate functions.** `board.ts` still carries a
`TEMPORARY ALIAS` exporting `allSlicesMerged as allWavesMerged` — that is what
relocation looks like when the vocabulary did not follow: it compiles, it
passes, and the defect survives. A **Slice** holds one branch and belongs to one
plan; a **Wave** is the fleet's cross-plan cohort. Do not add a second alias.

### Scope guard

Owns dispatch's deciding half. `plot-dispatch.sh` itself is NOT repointed here —
that is plan 3. This slice only expresses; the script keeps working unchanged.
