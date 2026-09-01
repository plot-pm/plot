## Implementation brief — the-gates-read-what-was-left-behind (wave Judging)

- **Plan (canonical):** `docs/plans/2026-08-31-the-registry-supervises-its-agents.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/the-gates-read-what-was-left-behind` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

The plan's second wave. `Declaring` landed as #609 — `packages/domain/src/entities/declaration.ts` is on main and holds `readDeclaration(text)`, the four-outcome `DeclarationReading`, `isComplete()` and `isBlocked()`. Consume them; do not re-parse the declaration file, and do not add a fifth outcome. The `Remembering` and `Supervising` waves are later and depend on this one: `Supervising` writes the failure strings this slice produces into a correction prompt, so the string is an interface and not a log line.

### What to build

A gate interface and the plan's five gates in `packages/domain/src/rules/`, each a pure function over readings of one desk. A gate returns `null` when it passed, or a failure string written to be pasted into a prompt.

The five gates and the source each one's reading comes from:

| Gate | Reading available today |
|---|---|
| a PR exists for this branch | `Host.prMerged(branch)` / `Host.prList(state, limit)` — `ports/host.ts:86,95` |
| a changeset was added | `checkChangeset(text, workspacePackages)` — `rules/changeset.ts`, already on main |
| the tree is clean | `Trees.isClean(path)` — `ports/trees.ts:36`; `plot_worker_dirty` is the shell reading at `plot-worker-state.sh:363` |
| the branch is not blocked | `Trees.markers(path, prefix)` — `ports/trees.ts:49`; `plot_worker_blocked` at `plot-worker-state.sh:314` |
| the plan line is annotated | `PlanRecordBranch` — `ports/plan-store.ts:67`, carrying `branch`, `deferred`, `deferredReason` and `claimed`; the plan's own landed line reads `` `feature/a-worker-declares-what-it-finished` — the envelope: worker writes → #609 `` |

Nothing consumes the gates yet. This slice is the interface and the five implementations, so the shape is settled before a daemon reads it.

### The decisions the plan settles — do not re-derive them

**A gate verifies post-execution claims, never predictions.** The plan states the constraint that makes gates worth having: they run AFTER the agent finishes and look only at the files it left behind. A check that runs before, or that reads the agent's own account of its work, is not a gate. So the declaration is an input to the *supervisor's* decision and never a gate's evidence — a gate that believed `artifacts` would be trusting the thing it exists to check.

**Readings as values, not ports.** `gate(readings)` in the shape `rules/reapable.ts` and `rules/eligible.ts` already use. `reapProblems(readings: TreeReadings): ReapProblem[]` is the closest precedent and its `{ refusal, detail }` pair is the model: the refusal names which measurement failed, the detail carries the pid or the path the message quotes. No gate awaits anything, and no gate imports a port.

**`TreeReadings` already carries two of the five.** `rules/reapable.ts` reads `dirtyPath` — *"the reading is the path and not a flag … the refusal quotes it, and a boolean cannot be quoted"* — and `blockedMarker`. Reuse that vocabulary rather than inventing a second name for the same measurement.

**The failure text goes verbatim into the correction prompt.** The plan says so, and it is why the return type is a string rather than an enum: the next attempt is told what is missing rather than asked to re-derive it. Write each message as an instruction a reader can act on.

**Five gates, and each wraps a measurement Plot already owns.** The plan's table names the existing implementation for every one. Do not write a new PR reader: `plot-pr-merged.sh` is the one answer to *did the host merge any PR for this branch?*, it reads `mergedAt` and never `state`, and `Host.prMerged` is its port. A merged PR reports `CLOSED`, and squash-merge leaves a branch permanently ahead of the default branch.

**A host that could not be asked refuses.** `MergeReading` in `rules/reapable.ts` keeps `unreachable` apart from `not-merged` because the readings differ even though the verdict does not. Silence is never permission, so an unaskable host fails the PR gate — and says which of the two it was.

**Arrow functions, and factual TSDoc.** `export const f = (…) => …` in the domain package, enforced by the CI grep at `ci.yml:369`. A TSDoc block says what an export does, what its parameters mean, what it returns and how it fails. The argument for the design belongs in this PR's commit message, not in the comment.

### Out of scope

`feature/the-registry-supervises-its-agents` is the `Supervising` wave and is deferred behind a measurement. Do not write the daemon, the tick, the bounds or the resume path here. Do not add a spawn to `registry.ts`, which the plan records as already holding 7 `spawn`/`execFile` calls while every export is a reader.

### Done when

- Each of the five gates is a pure function in `packages/domain/src/rules/`, returning `null` or a failure string, with no `await` and no port import.
- **A gate failure message is legible as a prompt** — the plan's own `Done when` says this is checked by reading one, not by asserting a substring. Read all five aloud.
- The PR gate refuses an unreachable host and **says which** — `unreachable` and `not-merged` reach the same verdict by different readings, and a test that cannot tell them apart has not tested the distinction.
- The changeset gate calls `checkChangeset` rather than re-implementing it, and reports every problem the rule returns rather than the first.
- **The pure side of the domain is gated at 100% lines, branches, functions and statements** (`packages/domain/vitest.config.ts`, globs `src/!(adapters)/**/*.ts` and `src/*.ts`). A new rule file with an uncovered branch fails the build.
- **Prove each test is discriminating.** Break one gate deliberately — make a desk with no PR pass — and confirm the test fails. Three inert mutations were caught in this repo on 2026-09-01 alone; a passing test against unchanged behaviour proves nothing.

### Repo gates

Node 24 (`nvm use`; `pnpm` crashes on Node 26). Run `pnpm test`, `pnpm --filter @plot-pm/domain exec vitest run --coverage`, `pnpm --filter @plot-pm/domain typecheck`, `pnpm run test:reconcile` and `pnpm run typecheck`. Run `pnpm run test:board` and `pnpm build:board` if you touch anything the board reads.

**Do not run `pnpm run test:e2e`.** It is CI's gate, it dispatches real workers into sandbox repositories, and two agents running it here produced 53 concurrent `node --test` processes and a board that could not answer a request in 25 seconds.

### Changeset

One changeset, **description FIRST and the `bumps:` block LAST** — Changesets publishes the first line after the frontmatter, so a `bumps:` block written first becomes the release note and the description behind it never ships. Name `plot` and `@plot-pm/domain`. Run `./scripts/check-changeset-packages.sh` before pushing; it refuses a description shorter than 20 characters.
