## Implementation brief — the-fleet-runs-without-the-board (wave 7: The controllers are commands)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-controllers-are-commands` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This is the last wave of the plan. Waves 1-3, 5 and 6 are merged (#1413, #1421, #1428, #1444, #1452), and wave 4 merged as #1442 (the plan line lacks its `→ #1442`; leave it, it is not this branch's line). `plot-fleet-scan.sh --next` names this branch as eligible at `af4f6ccf9`. The plan text still says `plot-registryd`; the process, bundle and unit are `plot-fleetd`. Measured 2026-10-10: the only pushed `feature/*` ref besides this one is `a-merged-pending-check-is-asked-again`, which is deferred (PR #1425 is closed); do not build on it. The one open plan PR, #1451, is a plan file only.

### What to build

A master agent has no route to `dispatch` and `continue` that works without the board. `packages/board/src/server/index.ts` reaches both only as `POST /api/dispatch` and `POST /api/continue`; `plot-ask.mjs` accepts `board`, `fleet`, `deliverable` and `release-claim` (`entry/main.ts:89`, `:120`). Since wave 6 the fleet dispatches and delivers with no board process, so a machine can now run a fleet and have no controller for the master agent to call. The gate shows the cost: `plot-controller-gate.sh` refuses a bare `plot-dispatch.sh`, names `POST /api/dispatch` as the route, and offers `plot-state-receipt.sh --unowned-action` as the exit when no board runs. That exit is counted in `.plot/state/unowned-action-writes.tsv`, and a gate whose only legitimate path needs the process it was meant to outlive is the shape people route around.

This wave adds two JS entries under `packages/fleet/` that hold what the two routes decide, and makes the routes call them:

- **dispatch.** The entry holds `handleDispatch`'s decisions, minus `node:http`: the `Implement command` must be usable, a second dispatch of a slug whose implement still runs is refused (`implementRunning`), the branch to brief comes from `nextBriefBranch`, the implement starts detached, and only on exit 0 does the entry write the `dispatch` action receipt and start `plot-dispatch.sh --max <MAX_PER_CLICK> <slug>`. Its refusals keep the reasons `no-implement-command` and `implement-running`. The route keeps `isSameOrigin`, `readJsonBody`, the 202 body and the HTTP status mapping.
- **continue.** `continueOnDesk` already lives in `@plot-pm/fleet/shared/continuation` with no `node:http`. What is missing is the part of `handleContinue` that is not HTTP: reading the branch's worktree from the pulse (`branchFromPulse`) and the refusals `unknown-branch` and `no-worktree`. The entry takes a branch and an answer, reads the pulse from the bridge file (not from the board's cache, `pulseFor`), calls `continueOnDesk` and returns its result. `/api/continue` calls the entry, so the board is never the agent's parent through a path of its own.

Each entry follows the shape `plot-approve.mjs` and `plot-deliver.mjs` set: an `entry/*.ts` with an exported `run(argv, …)` returning an exit code, built to a named bundle under `skills/plot/scripts/board/`, and a `.sh` launcher that resolves the bundle and `exec`s it. The `.sh` launcher is optional here; a skill or the master agent may call the bundle.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**`release` needs no new entry. Measured 2026-10-10.** `release.ts:37` sets `RELEASE_SCRIPT = 'plot-deliver.sh'` and spawns it with `--release <version> <slug>`; that script is a launcher over `plot-deliver.mjs`, and `entry/deliver.ts:100` parses `--release`. `approve.ts:72` likewise spawns `plot-approve.sh`, a launcher over `plot-approve.mjs`. The plan's P9 table lists the HTTP routes and the `builds:` line says "dispatch, continue and release", and for approve, deliver and release the entry exists. Verify that on `main` and build nothing for them. If something is missing for release, report what, and do not write a second entry beside `plot-deliver.mjs`.

**The commands are the legitimate caller of the gate, so they are not gated.** `ci-suite.ts` `GATED` lists `plot-dispatch.sh`, `plot-approve.sh`, `plot-approve.mjs`, `plot-deliver.sh` and `plot-deliver.mjs`: those are the work a controller starts, and they are refused without a receipt. A dispatch command is the controller that writes the receipt (`recordActionReceipt(repoRoot, 'dispatch', slug)` in `@plot-pm/fleet/shared/action-receipt`, immediately before the spawn, as `dispatch.ts:473` does today). Adding the new entry's name to `GATED` would refuse the controller with the gate meant to admit it. Do not add it. Test it: `controllerInvocation('node …/<the new bundle> <slug>')` returns `null`, and a command line running `plot-dispatch.sh` with no receipt still returns `'dispatch'`.

**The receipt is written by the process that spawns, after the implement exits 0.** The route wrote it in the exit listener, "with the spawn it announces", because a receipt written at request time announces a dispatch the implement may yet refuse (`dispatch.ts:462-471`). The entry keeps that order. A refactor that moves the receipt to the start of the entry passes every test that mocks the spawn and opens the gate for a dispatch that never happens.

**The gate's refusal names the command.** `plot-controller-gate.sh` tells the caller to `POST /api/dispatch` and offers the counted exit for a machine with no board. After this wave a command exists, so the refusal names it first and keeps the HTTP route as the board's own path. The gate header says *"a refusal naming a route that refuses back is the defect"*; the same holds for naming a route that needs a process the fleet no longer requires. Keep `--unowned-action`: this wave does not remove the counted exit.

**The board's route calls the entry; it does not keep a copy.** Moving the code means `handleDispatch` and `handleContinue` shrink to the HTTP half, and `dispatch.ts` and `continue.ts` lose the logic that moved. Duplicating it "for safety" gives two implementations of the brief gate, which is the failure wave 6's brief named for two spenders. Dependencies run board → fleet; `packages/fleet/test/entry-module-graph.test.mjs` fails when a fleet entry reaches a `packages/board` file, so an entry cannot import `startImplement`, `scriptsFor` or `readConfig` from the board. Their fleet-side counterparts exist (`config-reader.ts`, `action-log.ts`, `board-run.ts`, `brief-ask.ts`); move what is missing into `packages/fleet/src/shared/`, do not copy it.

**No `@plot-pm/commands` package in this wave.** The plan's open question settled that approve, idea, deliver and release go to a third package, and dispatch and continue to `@plot-pm/fleet`. This wave builds only the two fleet controllers, so it creates no third package. Creating it to move `plot-approve` and `plot-deliver` would be a diff with no behaviour change. The remaining routes (`idea`, `commission`, `reslice`, `implement`, `drop`, `claim`, `transition`, `fleet-controls`) are out of scope; see the scope guard. The plan said slice 5 *"may split during interrogation"*; this is that split, decided at brief time. Report the remainder in the PR body so `/plot-reslice` or a plan amendment can name it.

**Name the dispatch entry so it leaves `plot-dispatch.mjs` free.** The story `the-shell-holds-no-behavior` (Phase 4) gives `plot-dispatch.sh` (1,639 code lines) a plan of its own, and its launcher's bundle would be `plot-dispatch.mjs`. A controller entry holding that name now makes that conversion rename a shipped bundle. Pick a name that says it is the controller (for example `plot-dispatch-command.mjs`); this is a recommendation from reading the story, not a measurement.

**Rules carried over unchanged.** Absent is not false: a missing pulse file is *unknown*, so `continue` refuses with `no-worktree` and does not start an agent in a directory it guessed. Read the exit code, not the emptiness of the output. New code is arrow functions; TSDoc states what an export does, takes and returns, and the reasoning goes in the commit message. New code says Slice where it means Slice; `Agent` names the actor and `Worker` the process. A bundle is generated: do not commit one.

**Correct the `plot-ask.mjs` claim again, from the other side.** Wave 6 rewrote the `CLAUDE.md` sentence to the measured state and said wave 7 closes it. Rewrite it to what is now true: name which actions are reachable without HTTP and by which entry, and say plainly that the other routes are still HTTP only. Then run `./scripts/check-agents-md.sh --write`; CI refuses an `AGENTS.md` that differs.

### Done when

The plan's `## Slices` line for this wave is the specification: the lifecycle routes it names become JS entries that the master agent and the board both call, and `/api/continue` starts agents through the fleet entry. The assertions below exist because a naive implementation passes without them:

- **A command runs with no board.** Drive each entry with no board process and no HTTP server: dispatch against a sandbox repository with a stub `Implement command` and `Scripts` port ends with one `plot-dispatch.sh` start; continue against a desk with a `PLOT-BLOCKED` marker starts one new agent whose pid differs from `previousPid`. It catches an entry that still reaches the board's cache or server.
- **No receipt before the implement exits 0.** A stub implement that exits 1 leaves no file under `.plot/state/action-receipts/` and starts no dispatch. It catches the receipt moved to the top of the entry.
- **The receipt precedes the dispatch start.** With a stub implement that exits 0, the receipt file exists when `Scripts.start` is called. It catches a spawn that the gate would refuse.
- **The refusals keep their reasons.** `no-implement-command`, `implement-running`, `unknown-branch` and `no-worktree` come out of the entry with the reason strings and the HTTP statuses the route's tests assert today (409, 409, 404, 404). It catches a refusal collapsed into a generic failure.
- **The route is a thin caller.** `dispatch.ts` and `continue.ts` import the entry's function and hold no `Implement command` read and no `continueOnDesk` call of their own. A test greps the import lists. It catches the duplicated copy.
- **`controllerInvocation` is unchanged for the old names and `null` for the new one.** It catches the new entry added to `GATED`.
- **The gate's refusal names the command.** A test over `plot-controller-gate.sh`'s stderr for a bare `plot-dispatch.sh` call contains the command's bundle name and still contains the `--unowned-action` exit. It catches a message that still sends the caller to a board.
- **Moved tests still run.** The existing `dispatch*.test.ts` and `continue*.test.ts` assertions move with the code or keep calling the route; do not weaken or delete an assertion to make a move pass.
- **`entry-module-graph.test.mjs` still passes**, and a built entry carries no `node:http`. It catches a board import smuggled in by the move.
- **The shipped bundle contains the entry.** Build in a scratch worktree and grep the bundle for the strings `no-implement-command` and `unknown-branch`. A module the build never imports passes every unit test and ships nothing.

Plus: add a changeset (`./scripts/check-changeset-packages.sh`; package `plot` or `@plot-pm/board`; the description first, the `plan:` line and the `bumps:` block last). The bundles under `skills/plot/scripts/board/` are generated: do not commit a rebuilt bundle (`scripts/check-no-bundle-diff.sh`); a new bundle must be declared in a `build.mjs`, which is the evidence the story's decision of 2026-10-09 accepts. Register the new entry in `skills/plot/scripts/README.md` if it ships as a `.sh` launcher (`scripts/check-helper-table.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite and do not run `pnpm run test:e2e` locally. Run `pnpm install` first if `node_modules` is missing, and `nvm use` (Node 24).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. The edit to `plot-controller-gate.sh` (the refusal text) and any new launcher add shell lines; pay for them in the same change by removing shell elsewhere, or by writing the text where the domain can return it (`controllerInvocation` already answers through a bundle). The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. When this PR merges, every wave of the plan is merged, and `/plot-deliver the-fleet-runs-without-the-board` closes the loop; the plan's own `Done when` is the check.

### Scope guard

This branch owns: the new `dispatch` and `continue` entries and their tests under `packages/fleet/`; the code that moves out of `packages/board/src/server/dispatch.ts` and `continue.ts` (the routes stay and shrink); `packages/domain/src/rules/ci-suite.ts` only if a test shows `controllerInvocation` needs a change (expected: none); the refusal text in `skills/plot/scripts/plot-controller-gate.sh`; the build declarations for the new bundle; the `CLAUDE.md` sentence and the regenerated `AGENTS.md`.

This branch does not own: `entry/approve.ts` and `entry/deliver.ts` and their launchers (they are commands already); the routes `idea`, `commission`, `reslice`, `implement`, `drop`, `claim`, `transition`, `fleet-controls` and `release-claim`; a `@plot-pm/commands` package; `plot-dispatch.sh` itself (Phase 4 of the story); the scan clock, the bridge, the PR index writer and the auto-dispatch and auto-delivery wiring (waves 5 and 6, merged).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
