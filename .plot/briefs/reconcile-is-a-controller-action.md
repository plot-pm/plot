## Implementation brief — reconcile-is-a-controller-action (wave 2: Reconciling)

- **Plan (canonical):** `docs/plans/2026-09-09-reconcile-is-a-controller-action.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #860 merged
- **Branch:** `feature/reconcile-is-a-controller-action` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer who knows the layering rule

Wave 1 (**Naming**, `infra/the-test-suite-says-what-it-tests`) merged as #874 and is on `main`. Wave 3 (**Sweeping**, `feature/a-finished-desk-is-a-finding`) waits on this branch, because this is where a finding is defined: it supplies `isDispatchTree` from the shell and turns desks into findings, and it cannot start until the finding type exists.

### What to build

`reconcile(readings, input)` — a domain rule that takes a **scope** and returns **findings** — plus `board/plot-reconcile.mjs`, the bundle that reaches it without HTTP. Nothing else. The shell that takes the readings is **not** this slice.

The concrete failure behind it: measured 2026-09-09, this estate held 18 worktrees, 11 of them finished desks with merged PRs. `plot-reap.sh --dry-run` reported `kept=3`. Ten were removed by hand, using the reaper's own conditions, because the tool that holds those conditions never looked at them. The recognition test at `plot-reap.sh:384` refused fifteen trees it could not classify — safely, deliberately, and **silently**. Silence is what a reconciliation pass exists to remove.

`/plot-reconcile` is the tenth lifecycle action with no controller endpoint, and `CLAUDE.md:472` says what that is: *"Where no controller exists, the gap is the finding."* This plan is that finding, filed rather than worked around.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Its own bundle, not a verb on `plot-ask.mjs`.** `plot-ask.mjs` answers `board` and `fleet` by *running* `plot-fleet-scan.sh` — it spawns. A script asking that artifact to reconcile would be a script calling an artifact that calls a script. Measured sizes: `plot-slice-pr.mjs` is 2.7 KB against `plot-ask.mjs`'s 491 KB, because the small bundle imports no entity schemas and no fleet controller. Copy `packages/board/src/server/entry/slice-pr.ts` as the shape — JSON in on stdin, JSON out on stdout, **spawning nothing and reading nothing**.

**The bundle spawns nothing because the sweep is the worst possible candidate for spawning.** Measured 2026-09-09: ~26 executable git call sites and exactly one host op (`pr-state`), sitting inside **31 loops** iterated per plan and per branch over 253 plans. That multiplier — not the call count — is the sweep's 279.9 s. An earlier draft of the plan said "72 shell and host calls"; that number counted source lines and included the `git rm` / `git push` / `git add` text inside the remediation strings the scan *prints for a person to run*. Do not re-count from source lines.

**A scope is not a filter over one output.** A plan-scoped reconcile can afford to ask the host about that plan's PRs; an estate-scoped one cannot ask 253 times, which is why the current sweep bundles a single `pr-list`. The scope changes what is *cheap*, so it belongs in the rule and not in a `grep` after it. This is also why `--plan` on the scan was rejected: eighteen sections each decide what to fetch, a flag is eighteen conditionals, and the sprint scope needs sections the estate sweep never runs.

**It performs nothing, and there is no `--yes` at any scope.** A gated apply was considered and refused: the value of a sweep an operator runs casually is that running it cannot cost anything, and a flag that *sometimes* acts turns every invocation into a decision. Acting stays with the tools that own each repair — `/plot-reap --yes`, `/plot-deliver`, `/plot-reslice` — each of which the findings name.

**`reap()` returns `writes: Write[]` and reconcile discards them.** Deliberate, not wasteful: one condition set serves two blast radii. `/plot-reap --yes` performs the writes; reconcile reports what they would have been. Taking the decision without taking the writes is what lets reconcile sweep the whole estate while the reaper stays per-invocation.

**Merged, not pushed, is the boundary for a free desk.** Measured 2026-09-09 across the last eight merged PRs here: every one carried 2–7 commits, and PRs stayed open 14–202 minutes (median ~60). A PR is opened early and pushed to afterwards, so freeing a desk at PR-open would reset a desk out from under a worker still committing. Cost of waiting: ~an hour of idleness per desk. Cost of not waiting: a reset desk mid-work. Merge is also the only unforgeable half — *pushed* and *PR open* are both readable locally and both ambiguous about whether the work is done.

#### `rules/sweepable.ts` is the other half of the composition, and the plan does not name it

**Verified 2026-09-10 on this branch's base.** The plan says reconcile "composes existing rules and adds none" and names only `reap()`. There is a second: `packages/domain/src/rules/sweepable.ts` already answers three finding kinds with their own refusals —

- `local-branch` — `branchSweepProblems`, refusing `default-branch` / `no-merged-pr` / `checked-out`
- `claim-ref` — `claimSweepProblems`, refusing `not-an-empty-claim` / `needs-judgment`
- `dirty-tree` — `unownedDirtyTrees`, `dirtyTreeOwner`

and its header already draws the exact boundary the plan re-argues: *"`worktree` is not here. `reapable.ts` owns that kind and stays untouched: a backstop that guesses is worse than none."* Its `LeftoverKind` union is a finding taxonomy in all but name.

**So the composition is `reap()` + `sweepable.ts`, and a fourth copy of those conditions is the defect this plan exists to prevent.** Reuse `LeftoverKind` and the three refusal types rather than declaring parallel ones. Where the finding type genuinely needs a wider kind set than `LeftoverKind`, extend that union — do not shadow it.

#### Carried over unchanged — the invariants this repo keeps re-learning

- **The host answers *did this land*, never git.** `mergedAt` only: a merged PR reports `CLOSED`, and squash-merge leaves a branch permanently ahead of `main` (10 of 10 disagreements measured 2026-09-04). Any ancestry call needs a `# plot-ancestry:` declaration within five lines above it or `scripts/check-ancestry-decisions.sh` fails CI.
- **An unreachable host answers *not merged*.** Silence is never permission. A degraded reading must not become a list of deletion candidates.
- **Absent is not false.** An unaskable condition and a false one are different answers. `plot-board-probe.sh` uses `ok`/`failed`/`unknown` for exactly this reason.
- **A dirty desk whose agent died is NOT free.** `uncommitted-changes` is its own refusal (`plot-reap.sh:77` — *"work that exists nowhere else"*) and it **outranks** the absence of a worker. Measured twice on 2026-09-09: one desk held 75 lines of correct tests with no PR, another held 324 finished lines; both were rescued by a person reading the tree. That desk's finding says *needs a person*, never *free*.
- **The layering rule.** `controller → domain → port ← adapter → script`. The rule imports no port and awaits nothing; readings arrive as values (`reap(readings, input)`, not `reap(ports)`). The purity gate (`ci.yml:186`) allows only `zod` outside `adapters/`.
- **Arrow functions in `packages/domain/`** — `export const f = (…) => …`. The unit is the function you write, not the file.
- **TSDoc is factual.** What it does, what the parameters mean, what it returns, how it fails. The reasoning goes in the plan and the commit message — measured 4:1 comment-to-code on the first rule moved into this package, most of it argument rather than interface.

### Done when

The plan's `## Done when` list is the specification. This slice's three asserted properties, and what each catches:

- **The three scopes return different finding sets for one estate.** A plan scope reports that plan's drift and not the estate's. Catches a scope implemented as a post-hoc filter — the thing the plan explicitly says a scope is not.
- **It performs nothing.** No write, no removal, no fetch the caller did not ask for; the findings name commands and run none. Catches the `reap()` writes leaking through instead of being discarded.
- **A scope naming a plan that does not exist is REFUSED, not answered with an empty sweep.** An empty finding list reads as *nothing has drifted*, which is the one direction this must never be lenient in. This is the assertion a naive implementation passes without: `findings: []` looks like success on every test that only counts findings.

Two more that a naive implementation also passes without:

- **The bundle spawns nothing.** Assert it, do not assume it — an import of the fleet controller compiles fine and silently drags in the spawn path plus ~490 KB.
- **A new bundle joins the shipped-bundle contract.** `packages/board/src/contract/bundles.generated.ts` is generated from `build.mjs` and **committed**; `test/reconcile/resolveartifact.test.mjs` compares that file, the shell's `bundle_set` and `build.mjs` as sets. The plan does not name this touchpoint. Declare the bundle in `build.mjs`, run `pnpm build:board`, and let the generated file follow — never hand-edit it. Skipping this fails an unrelated branch's CI, which is the failure that file was created to remove.

Plus the repo's gates:

```bash
nvm use                     # Node 24 — pnpm crashes on 26
pnpm install
pnpm test                   # skills parse
pnpm run typecheck
pnpm run test:board         # rebuilds the artifact, then tests
pnpm run test:contracts     # the shell/helper contract suite (75 files)
```

**`test:reconcile` no longer exists** — wave 1 (#874) renamed it to `test:contracts`. The *directory* is still `test/reconcile/`. Do not run `pnpm run test:e2e`: it is CI's gate, it dispatches real workers into sandbox repos, and two agents running it once produced 53 concurrent `node --test` processes and a board that could not answer in 25 s.

A changeset is required: package `plot` or `@plot-pm/board`, **description first and the `bumps:` block last** (a `bumps:` block written first becomes the published release note). `.changeset/` in a fresh worktree holds siblings' files — add yours, touch none.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Branches` section. Push the first real commit as soon as it exists — a branch with no pushed commit reads as unstarted.

### Scope guard

**This branch owns:**

- `packages/domain/src/workflows/reconcile.ts` (new) and its test
- `packages/domain/src/rules/` — only if a genuinely new condition is needed, which the plan says there is none; prefer extending `sweepable.ts`'s taxonomy
- `packages/domain/src/index.ts` — the export
- `packages/board/src/server/entry/reconcile.ts` (new)
- `packages/board/build.mjs` — the bundle declaration
- `skills/plot/scripts/board/plot-reconcile.mjs` and `bundles.generated.ts` — both **build outputs**, committed but never hand-edited

**Explicitly not this branch:**

- **The reading side.** `plot-reconcile-scan.sh` keeps its ~26 git calls and its own name. Supplying `isDispatchTree` from the shell and reporting unrecognised desks is wave 3 (`feature/a-finished-desk-is-a-finding`).
- **The cost targets.** The plan's table (plan scope under 5 s, sprint under 30 s) is asserted against the *shell* that narrows the population. This slice builds the rule and the endpoint; it cannot make the sweep faster, and it must not be judged on a number it does not control.
- **`/plot-deliver` step 7b.** Replacing the 279 s estate sweep with a plan-scoped call is downstream of a working plan scope in the shell. Do not edit the delivery gate here.
- **`plot-estate-changed.sh`.** It stays for its other callers.
- **The `test:contracts` hang.** Wave 1's territory, and it may legitimately not have finished.

**Other branches in flight** — verified against `origin` 2026-09-10, not guessed:

| branch | holds | collision |
|---|---|---|
| `feature/an-installed-gate-fires-once` | `ci.yml`, `package.json`, `AGENTS.md`, `CLAUDE.md`, `docs/definition-of-done.md`, `skills/plot-reconcile/README.md` | none in code. It removes wave 1's changeset and edits `ci.yml`; if you add a CI reference, expect a textual conflict there. |
| `feature/the-working-header-separates-doing-from-reading` | `packages/board/src/contract/schema.ts`, `src/app/`, `src/server/registry.ts`, `packages/domain/src/entities/agent.ts`, **and the built `plot-ask.mjs` + `board-server.mjs` artifacts** | **the artifacts.** Both branches rebuild `skills/plot/scripts/board/*.mjs`. On a conflict there, do not read the diff — take either side, run `pnpm build:board`, commit the result. Never phrase it "take ours": *ours* inverts between merge and rebase. |

The artifact conflict is expected rather than surprising, and `.gitattributes` marks those files `-merge` so git keeps one whole version instead of splicing markers. Note that GitHub ignores `-merge`, so a PR can read `CONFLICTING` while local git says clean.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
