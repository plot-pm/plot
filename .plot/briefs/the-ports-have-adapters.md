## Implementation brief — the-domain-runs-the-workflows-in-a-sandbox (slice 1: Reading)

- **Plan (canonical):** `docs/plans/2026-08-28-the-domain-runs-the-workflows-in-a-sandbox.md` on `main`
- **Branch:** `feature/the-ports-have-adapters` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** repo convention (CI green + review)

This slice blocks all four others. Agreeing, Deciding and Dispatching each need
the ports to exist and can then run in parallel; Writing needs those two.

### What to build

Seven ports as pure TypeScript interfaces under `packages/domain/src/ports/`,
and an adapter directory for each under `packages/domain/src/adapters/`:
`PlanStore`, `Refs`, `Host`, `Processes`, `Trees`, `Clock`, `Machine`.
Plus one new operation on `plot-host.sh`.

**Measured 2026-08-30: there is no `ports/` directory at all.** The package has
`entities/`, `rules/` and `transitions/`. So this slice creates the contract as
well as the implementations — that is not scope creep, it is what the plan's
gate turned out to require.

### The decisions the plan settles — do not re-derive them

**The adapters wrap the scripts; they do not reimplement them.** `plot-plan-meta.sh`
already parses the plan format and IS the contract; `plot-fleet-scan.sh` already
derives slice verdicts; `plot-host.sh` already speaks to both hosts. A TypeScript
adapter spawns the script and maps its exit code. Rewriting a parser in
TypeScript is the exact duplication this design forbids.

**The exit-code mapping is written ONCE, in `runScript()`:**

```
0 → { ok: true, value }        // NONE is a payload, not a miss
1 → { ok: false, why: 'failed' }
3 → { ok: false, why: 'failed' }      // could not be asked
4 → { ok: false, why: 'unaskable' }   // structurally has no answer
```

Seven adapters writing that mapping seven times is how 3 and 4 collapse into
each other — and collapsing them turns a permanent configuration fact into a
transient incident, which `plot-host.sh` warns against in its own header.

**`PortResult<T>` has three outcomes, never two.** `unaskable` is not a
failure: a Bitbucket repo has no issues to list, and reporting that as an error
makes callers retry something that will never succeed.

**The completeness gate is two-sided, and that is not decoration.** Asserting
only "every `ports/*.ts` has an adapter directory" passes vacuously against the
empty `ports/` this slice starts from — it would report success before a line
was written. It also asserts a floor of at least seven ports. A check you can
answer yes to without doing the work is a rule, not a gate.

**The purity grep now excludes `adapters/`:**

```bash
grep -rlE "from '(node:|fs|child_process)" packages/domain/src/ \
  | grep -v '^packages/domain/src/adapters/'
```

Empty output still means the domain is pure, and now also means every
world-reaching import lives in exactly one directory.

**`plot-host.sh` gains exactly one operation** — *has any PR for this branch
merged?* It reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and
never ancestry (squash-merge leaves a branch ahead of main forever). This is
the only production file this slice touches, and it adds an operation without
changing one.

### Done when

The plan's `## Slices` → Reading `Done when` is the specification. Plus:

- the seven ports exist as interfaces and each has an adapter directory
- both gates pass: purity-except-adapters, and the two-sided completeness check
- the domain can be handed this repository's real state through ports only

Repo gates: `pnpm test`, `pnpm run typecheck`, `pnpm build:board` if the board
changed, and a changeset. Node 24 (`nvm use`), `corepack pnpm`.

**Domain package style is stricter than the board's** (CLAUDE.md § The Domain
Package): arrow functions, not declarations; factual TSDoc that says what an
export does — not why it was decided. The reasoning goes in the commit message.
CI enforces three gates: vocabulary (`allowed=10`), actor-name, function-style.

### Scope guard

This branch owns `packages/domain/src/ports/`, `packages/domain/src/adapters/`,
and the one new `plot-host.sh` operation. It does NOT touch the board's 51
spawn call sites — that is plan 3's Spawning slice, and repointing them here
would change the board before the domain it calls is proven.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
