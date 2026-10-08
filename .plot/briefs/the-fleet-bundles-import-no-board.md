## Implementation brief — the-fleet-runs-without-the-board (wave 1: The bundles stop importing the board)

- **Plan (canonical):** docs/plans/2026-10-09-the-fleet-runs-without-the-board.md on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-fleet-bundles-import-no-board` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session, per the plan's Review answer

This is wave 1 of 6. Every later wave (the `@plot-pm/fleet` package, `plot-fleetd`, the scan and PR index, the automatic writes, the controllers) moves code that this wave first untangles. Nothing runs differently after this wave.

### What to build

`plot-registryd.mjs` and `plot-worker-loop.mjs` are built from `packages/board`, and their entries import board modules that pull `node:http` and `board.ts` into the bundle. Measured on `main` at `485feeed6`: `entry/registryd-main.ts` imports `registry`, `fleet-settings`, `board` (`readConfig`, `readConfigAsync`), `worker-question`, `escalations`, `supervisor`, `queue-reading`, `release-claim`, `process-log` and `continue` (lines 52-114). `entry/worker-loop.ts:75` imports `continue.js` for one constant, `CONTINUATION_NAME` (`continue.ts:76`). `fleet-settings.ts`, `release-claim.ts` and `continue.ts` each import `node:http` for their HTTP handlers, and `board.ts` reaches `dispatch.ts` and `fleet.ts`.

The change: the pieces the two entries use move out of those modules into modules with no `node:http` and no `board.ts` import, and the entries import the new modules. The HTTP handlers stay where they are and import the moved pieces back.

- `CONTINUATION_NAME` goes to the domain or to a small shared module. The worker loop then needs nothing from `continue.ts`.
- `readFleetSettings` (`fleet-settings.ts:186`), `gatherReadingsAndRelease` (`release-claim.ts:116`), `readConfig` / `readConfigAsync` (`board.ts:521`) and `continueOnDesk` (`continue.ts:821`) are real runtime calls in `registryd-main.ts` (lines 1698-1803), not constants. Each moves with its own helpers. Split a module by the line between "reads or acts" and "answers an HTTP request" — do not wrap the HTTP code in a lazy import to hide it from the bundler.

Finish by verifying issue #1307 (*Stopping the board kills every agent /api/continue started*, still open). `continue.ts:1049` re-parents the started loop since `9c344e414` (#1351), so `plot-boardctl.sh`'s `tree_pids` (`:174`) should no longer find it. Prove it in a sandbox: start a board, continue an agent under it, stop the board, check the agent's pid. If the agent survives, close #1307 with that evidence. If it does not, file what remains and link it from the PR.

### Settled decisions — do not re-derive them

**The fix is the import graph, not a bundler flag.** Marking `node:http` external or tree-shaking harder would pass the bundle test and leave the dependency in the source, and waves 2-5 then move the same tangle into a new package. The test measures the shipped bundle; the source change is what makes the test pass honestly.

**`plot-fleet-size.mjs` is already clean.** It imports only `rules/fleet-size` and `entities/machine` (plan table). Do not touch it in this wave. A test that includes it is welcome as a guard.

**`plot-ask.mjs` is out of scope.** It imports `board.js`, `estate.js` and `controllers/fleet-state.js` and stays that way until the scan wave replaces what `fleet-state.ts` reads.

**Do not rewrite neighbours.** `CLAUDE.md` § *The Domain Package*: the unit is the function. A function you move keeps its form (the board is not migrated to arrows wholesale), but any new helper you write is an arrow.

**Layering holds.** A moved reader in the domain takes readings as values and spawns nothing. A moved piece that spawns or reads files stays outside `packages/domain/src/` outside `adapters/`, and the CI spawn ratchet (`ci.yml`, `allowed=28`) must not grow.

### Done when

The plan's `Done when` for this wave is the specification: `registryd-main.ts` and `worker-loop.ts` import nothing from `packages/board/src/server/` outside `entry/`, and a bundle test proves the shipped `plot-registryd.mjs` and `plot-worker-loop.mjs` carry no `node:http` and no `board.ts` code. Lifted assertions:

- **Read the shipped files under `skills/plot/scripts/board/`, not `dist/`.** The shipped copy is what a project runs; `dist/` can be fresh while the copy is stale (`build.mjs:415` copies it). This catches a build that forgets the copy.
- **Assert on content that only `board.ts` carries**, such as an exported-name string unique to it, and not on the word `board`, which appears in comments and paths. A naive grep for `board` fails on a clean bundle; a grep for `node:http` alone passes if `http` is bundled under another specifier. Assert both, and mutate each source import back in to prove the test fails (see memory *Mutation-test a gate before believing its tests*).
- **The runtime does not change.** `node --test test/reconcile/*.test.mjs` cases that start `plot-registryd` and the worker loop must pass unchanged.

Plus: a changeset for `@plot-pm/board` (description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Do not commit rebuilt bundles under `skills/plot/scripts/board/` — `scripts/check-no-bundle-diff.sh` refuses them; `main` builds them. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. `test:e2e` is not a local check.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This wave should touch no `.sh` file; if it does, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/registryd-main.ts`, `entry/worker-loop.ts`, the modules named above (`continue.ts`, `fleet-settings.ts`, `release-claim.ts`, `board.ts` only for `readConfig`), any new module they move into, and one new bundle test under `packages/board/test/`.

Branches in flight: the five later waves of this plan (`the-fleet-package-exists`, `the-supervisor-is-plot-fleetd`, `the-fleet-owns-the-scan-and-pr-index`, `the-fleet-owns-its-automatic-writes`, `the-controllers-are-commands`) wait on this one and hold nothing yet. `feature/the-pass-is-measured` (plan `one-agent-pass-costs-what-its`) measures the agent pass and touches the shell launchers, not these modules. Re-check `git branch -r` before the first push.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
