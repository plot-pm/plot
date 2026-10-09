## Implementation brief — the-fleet-runs-without-the-board (wave 2: The fleet package exists)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-fleet-package-exists` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave follows `feature/the-fleet-bundles-import-no-board` (#1413, merged 2026-10-09 as `1e6123c94`), which cut the board out of the fleet's import graph. Every later wave builds on the package this one creates: `the-supervisor-is-plot-fleetd` renames its bundle, and `the-fleet-owns-the-scan-and-pr-index` adds the scan clock to it. No sibling branch for this plan is pushed (`git ls-remote` on 2026-10-09).

### What to build

`plot-registryd.mjs`, `plot-worker-loop.mjs` and `plot-fleet-size.mjs` are built by `packages/board/build.mjs` from `entry/registryd-main.ts`, `entry/worker-loop.ts` and `entry/fleet-size.ts`. A workspace package `@plot-pm/fleet` (`packages/fleet`) takes those entries and everything they import that is neither the domain nor a Node builtin, and builds the same three bundles to the same three paths under `skills/plot/scripts/board/`. Nothing changes at runtime.

Measured 2026-10-09 on `main` at `aa87539d3`, the move set is:

- Entries: `registryd-main.ts` (2,061 lines), `registryd.ts` (1,292), `worker-loop.ts` (2,397), `fleet-size.ts` (148). `worker-loop.ts` also imports `entry/loop-writes.ts` and `entry/prompt.ts`; they move with it.
- Shared modules: `packages/board/src/shared/` holds 13 files. The three entries import `config-reader`, `continuation`, `escalations`, `fleet-settings-store`, `process-log`, `queue-reading`, `registry`, `release-claim-reader`, `supervisor` and `worker-question`, and those pull in `manifest-stamp`, `brief-path` and `transcript`.
- Callers that stay in the board: 8 files under `src/server/`, 20 unit tests and `app/components/ContinueWithAnAnswer.tsx` import from `shared/`. After the move they import `@plot-pm/fleet`, so `packages/board/package.json` gains `@plot-pm/fleet` as a `workspace:*` dependency. The direction is board → fleet. The fleet never imports the board.
- Tests: 13 unit tests under `packages/board/test/unit/` import the moved entries (`registryd-main`, `registryd-tick`, `worker-loop*`, `fresh-agent-tick`, `nothing-done-tick`, `continue-route` and others), and so do `worker-loop-bundle.test.mjs`, `worker-loop-restart.test.mjs` and `entry-module-graph.test.mjs`. Tests that exercise a moved entry move with it. A test about the board that happens to import a shared constant stays and changes its import path.

### Decisions the plan settles — do not re-derive them

**A fleet package, not the domain.** The domain takes readings as values and spawns nothing (`CLAUDE.md`, *A note on shape*). The supervisor tick and the agent loop are clocks that spawn, so they are runtime and get a package of their own. Rules stay in `@plot-pm/domain`. Do not move a loop into the domain to avoid creating a package.

**The bundle names and paths do not change.** `plot-fleetctl.sh:117`, `plot-worker-loop.sh:15` and `plot-dispatch.sh:2409` launch them by path. The rename to `plot-fleetd` is wave 3's job. If you rename anything, a launcher breaks and a separate wave loses its reason to exist.

**`@plot-pm/fleet` imports nothing from `packages/board`, and the proof is the module graph.** `entry-module-graph.test.mjs` from wave 1 builds each entry with an esbuild metafile and fails on any `src/server/` input outside `entry/`. Move it into the fleet package and change its predicate: the fleet's metafile holds no input whose path contains `packages/board/`. A grep of the shipped bundle proves nothing, because the minifier drops unused exports and `legalComments: 'none'` strips the source markers (wave 1 measured both bundles at zero `node:http` before it changed anything).

**The one edge the plan did not name: `contract/schema.ts`.** Two shared modules import the board's contract. `registry.ts:6` takes `AgentStateSchema`, `AgentState` and `AgentIdentity`, and `worker-question.ts:3` takes the type `FleetReading`. `contract/schema.ts` is 4,693 lines, and wave 1's test did not see this edge because it only forbids `src/server/`. Moving `shared/` as it is would give the fleet package an import of `packages/board/src/contract/`, and the metafile test above would fail. The cut is small. `FleetReading` is already a domain type that the contract only re-exports (`schema.ts:1777-1803`). `AgentStateSchema` is the domain's `AgentStateSchema.options` plus `'unknown'` (`schema.ts:3380`), and `AgentIdentitySchema` is a two-value enum (`schema.ts:3521`). Define the two enums where the fleet can import them, and make the board's contract re-export them so its 53 importers stay as they are. Do not copy the 4,693-line file or leave a reverse import "for now".

**The build is the gates' input; do not hide the three bundles from them.** `check-bundle-attributes.sh`, `check-no-bundle-diff.sh`, `main-bundles.sh` and `bundles.generated.ts` derive the generated set from `shipped* = path.join(...)` declarations in `packages/board/build.mjs`. Three bundles built by a second builder that those greps cannot see would drop out of the `-merge` attribute, out of the PR-diff refusal and out of `main`'s post-merge build, and nothing would fail. Pick one of two shapes and prove it: (a) `packages/board/build.mjs` keeps the three `shipped*` declarations and calls the fleet's build function, or (b) the fleet has its own `build.mjs` and the four consumers read both files. Shape (a) touches fewer gates. Whichever you choose, the test that proves it is `test/reconcile/bundle-attribute-gate.test.mjs` plus a check that `skills/plot/scripts/board/plot-registryd.mjs`, `plot-worker-loop.mjs` and `plot-fleet-size.mjs` are still in `BOARD_ARTIFACT_PATHS` and still carry `-merge` in `.gitattributes`.

**The CI ratchets name `packages/board/src packages/domain/src` literally, so a new package is invisible to them.** The plan says "CI's purity and spawn ratchets extend to the new package". Measured in `.github/workflows/ci.yml` on 2026-10-09: *One place reaches a process* greps `packages/board/src packages/domain/src` with `allowed=11` (the `allowed=28` in `CLAUDE.md` is stale), *One place reaches a script* greps `packages/board/src` only, and the *Domain purity gate* and the arrow-function gate grep `packages/domain/src`. Add `packages/fleet/src` to the roots of the two board-side ratchets. Moving a spawning module from the board to the fleet must leave the total unchanged, so run the grep before and after and state both counts in the PR. Do not raise `allowed` to absorb a move. The fleet is not the domain, so do not add it to the purity gate. The fleet is allowed to import `node:` modules.

**The shape rules from `CLAUDE.md` apply to the new package, not retroactively to what moves.** A function you write is an arrow, and TSDoc is factual API documentation. A moved `function` declaration keeps its form, because the unit is the function and a rewrite destroys `git blame` for no behaviour change.

**Rules carried over unchanged:**

- The fleet-settings reader reads fresh on every call and caches nothing (`fleet-settings.ts:180-186`). The supervisor and a board process read the same file.
- Absent is not false. A config key that is missing returns its fallback.
- Read the exit code, not the emptiness of stdout.
- `plot-worker-loop.mjs` is built with `external: ['@anthropic-ai/claude-agent-sdk-*']` and `define: { PLOT_EMBEDDED: 'true' }` (`build.mjs:430-440`), and it is the only bundle other than `board-server.mjs` that carries the Agent SDK. Keep both options. `worker-loop-bundle.test.mjs` proves the SDK ships in no other bundle.

### Done when

The plan's slice line is the specification: `@plot-pm/fleet` holds the fleet entries and builds the same three bundle names, and CI ratchets cover it.

Assertions that exist because a naive implementation would pass without them:

- **The shipped bytes are the same program.** Build the three bundles on `main` and on the branch in separate worktrees and compare behaviour, not bytes (paths inside the minified output differ). Run the moved unit tests and `worker-loop-bundle.test.mjs` unmodified except for import paths. A test edited beyond its import path means the move changed behaviour.
- **The fleet's metafile names a board path when one exists.** Before you commit the contract cut, run the moved graph test with `registry.ts` still importing `../contract/schema.js` and see it fail with that path. A test never seen failing is not a test of this change.
- **The board still builds and its tests still pass.** The 8 server files and the app component that import `shared/` keep working through `@plot-pm/fleet`. `pnpm run typecheck` runs `tsc --noEmit` for `@plot-pm/board` only, so it does not typecheck the new package; add a `typecheck` script to `packages/fleet` and run `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`. Add the fleet's typecheck and unit tests to the `Local checks` line in `CLAUDE.md`'s `## Plot Config`, in the form the `packages/domain/**` rows use.
- **The generated set is unchanged.** `BOARD_ARTIFACT_PATHS` holds the same 34 paths before and after. A diff of `bundles.generated.ts` in this PR means a bundle dropped out or a new one appeared.
- **The workspace resolves from a clean install.** `pnpm install --frozen-lockfile` passes with the new `pnpm-lock.yaml`. Linux CI installs `supportedArchitectures` binaries that a Mac-only lockfile does not hold, so check that the lockfile diff adds the new importer and removes no platform entry (`pnpm-workspace.yaml` explains the 2026-08-29 failure).

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.
- Add a changeset under `.changeset/` with package `plot` or `'@plot-pm/board'`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md`. `@plot-pm/fleet` is not a changeset package unless you make it publishable; keep it `"private": true` like the domain. Run `./scripts/check-changeset-packages.sh`.
- Do not commit rebuilt bundles. `main` builds them after each merge, and `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Run `pnpm build:board` to test, then restore the generated paths from the merge base before you push.
- `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file under `skills/`.
- Do not run the board's tests while an operator's board is open on this machine, and clear `PLOT_REPO_ROOT` in any sandbox test you add.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, with `--draft` while the work moves. Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### The fleet package exists` in the plan's `## Slices` section.

Push the first real commit as soon as it exists, so the claim shows work.

### Scope guard

This branch owns:

- `packages/fleet/` (new): `package.json`, `tsconfig.json`, `build.mjs` or the build function, `src/`, `test/`
- the moved entries `registryd-main.ts`, `registryd.ts`, `worker-loop.ts`, `fleet-size.ts`, `loop-writes.ts`, `prompt.ts` and the `shared/` modules listed above, removed from `packages/board/src/`
- import lines in the board files and tests that used them, and `@plot-pm/fleet` in `packages/board/package.json`
- the two enums moved out of `contract/schema.ts` (`AgentStateSchema`, `AgentIdentitySchema`) and their re-export
- `packages/board/build.mjs` (the three entries), the four gates that read it if you choose shape (b), and the roots in `.github/workflows/ci.yml`'s *One place reaches a process* and *One place reaches a script*
- `pnpm-lock.yaml`, and the `Local checks` line in `CLAUDE.md`

This branch does not own, and must not edit:

- bundle names or launcher paths (`plot-fleetctl.sh`, `plot-worker-loop.sh`, `plot-dispatch.sh`, `plot-boardctl.sh`), which wave 3 renames
- `fleet.ts`, `auto-dispatch.ts`, `auto-deliver.ts` and the PR index write, which stay in the board until waves 4 and 5
- `plot-ask.mjs` and its `CLAUDE.md` sentence (wave 5)
- `controllers/` and `continue.ts`, except the import line of a moved constant

Branches in flight: `feature/a-declared-bundle-is-evidence` (plan `the-shell-sheds-its-decisions`) edits `scripts/check-decision-count.sh`, `skills/plot/scripts/README.md` and `test/reconcile/decision-count.test.mjs`. If you choose shape (b) and edit `check-bundle-attributes.sh` or `main-bundles.sh`, no file overlaps. `one-agent-pass-costs-what-its` measures `plot-worker-loop` through `scripts/measure-pass.mjs`, so keep the loop's behaviour unchanged here.

If you find something the plan did not anticipate — the `contract/schema.ts` edge above is the first such find, and a cut that needs a behaviour change would be the next — report it rather than improvising outside scope.
