## Implementation brief — the-fleet-runs-without-the-board (wave 6: The fleet owns its automatic writes)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-fleet-owns-its-automatic-writes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave follows `feature/the-fleet-owns-the-scan-and-pr-index` (#1444, merged 2026-10-09). `feature/the-controllers-are-commands` (wave 7) waits on this wave. The plan text still says `plot-registryd`; the process, bundle and unit are `plot-fleetd`, and the source files keep the names `registryd-main.ts` and `registryd.ts`. Measured 2026-10-10 on `main` at `dbd6b3e6e`: no open pull request touches `fleet.ts`, `auto-dispatch.ts`, `auto-deliver.ts` or `packages/fleet/`, and the only other pushed `feature/*` ref is `a-merged-pending-check-is-asked-again`, which is deferred (PR #1425 is closed). Do not build on it.

### What to build

Today auto-dispatch and auto-delivery run in the board process. `refresh()` in `packages/board/src/server/fleet.ts` calls `maybeAutoDispatch` (`:2044`) and `maybeAutoDeliver` (`:2074`) at the end of its success path, from the pulse it just read. Wave 5 already made `plot-fleetd` the scan's owner, so the board reads the bridged pulse and acts once per new `bridged.at` (`bridgeActedAt`, `:2013`). A stopped board therefore still stops dispatch and delivery, although the scan no longer depends on it. Observed failure to remove: stop the board with `plot-fleetd` up and an eligible slice, and no agent starts.

This wave moves both calls into `plot-fleetd` and deletes them from `fleet.ts`. The fleet runs them from its own scan clock (`startFleetClock`, `packages/fleet/src/shared/fleet-clock.ts`; wired at `registryd-main.ts:1732`), on the pulse its scan just wrote, in the same success path that writes the bridge. The plan's line is the specification: auto-dispatch and auto-delivery run in the fleet's tick with their in-flight state under `.plot/state/`; the board's automatic writes are removed; `planAutoDispatch` moves to `packages/domain/src/rules/` as an arrow function; and the `plot-ask.mjs` sentence in `CLAUDE.md` is corrected.

**Move the code; do not copy it.** `packages/board/package.json` depends on `@plot-pm/fleet`, and `packages/fleet/test/entry-module-graph.test.mjs` fails when a fleet entry pulls in any `packages/board` file. So the dependency runs board → fleet only.

### Decisions the plan settles — do not re-derive them

**The seam is files under `.plot/state/` read through a port, not a socket.** Settled 2026-10-09: a socket makes the board depend on a live fleet process. The fleet writes; the board reads and starts nothing.

**With no fleet running, the board dispatches and delivers nothing.** The operator's decision of 2026-10-09 is that the board starts no process after this wave, except the on-demand display scan from wave 5. The board already names an absent fleet in its header (`the-board-says-the-fleet-is-stopped`). Test it: a board with no live supervisor makes zero `Scripts.start` calls for `plot-dispatch.sh` and `plot-deliver.sh`.

**Wave 5's brief named the trap that this wave inherits in the opposite direction.** Last wave the failure was *the board stops scanning and nothing triggers dispatch*. This wave it is *the board's calls are deleted and the fleet's are never wired*. Every unit test of the moved functions still passes in that state, because they call `maybeAutoDispatch` directly. It is the shape measured on 2026-10-01, when three slices sat with no worker. Prove the wiring: a test drives `registryd-main`'s scan clock with a fake `Scripts` port, an eligible slice and the switch on, and asserts one `plot-dispatch.sh` start per new pulse.

**The inverse trap: two processes dispatch.** Leaving the board's calls in place "for safety" makes both processes spend the budget. The cross-pulse cap (`parallelAgents − live`) is the property that two spenders break. Delete the board's calls in this same change and assert that `fleet.ts` no longer imports `auto-dispatch` or `auto-deliver`.

**The fleet acts from its own scan, not from `tick()`.** A scan has a 90 s budget; the supervision loop is `await tick(...)` then `await sleep(...)`. Dispatch and delivery are quick detached starts and belong in the scan's success path. They must not sit inside `tick()`, and they must not run when the scan failed: a dispatch from a failed scan acts on refs that may have moved (`auto-dispatch.ts` header). Keep the scan clock's in-flight guard. A slow pass never starts a second.

**Order inside the pass is fixed: dispatch, then deliver.** `maybeAutoDispatch` starts work and `maybeAutoDeliver` finishes it, so a branch dispatched this pass is already counted live before anything asks whether its plan is done. Delivery also reaps, which removes worktrees dispatch reads (`fleet.ts:2060-2073` explains it). Keep the order.

**What is already persisted and what is not.** The plan says the in-flight sets "persist under `.plot/state/` instead of in board memory". Measured on `main`: `autoInFlight` already persists as marks in `.plot/state/auto-in-flight.json` (`in-flight-store.ts`, 90 s TTL, temp-plus-`rename` write, read fresh each pass at `auto-dispatch.ts:1045`). `deliverInFlight` and `briefsAsked` are in memory only, and `auto-dispatch.ts:1032` says *"no state file, deliberately"* for `briefsAsked`. So: reuse `in-flight-store.ts` for `deliverInFlight`, and decide `briefsAsked` explicitly. A mark that expires on its own TTL is the only safe shape; a persisted set that never expires holds budget forever after a crash. Whichever you choose for `briefsAsked`, update the comment at `:1032` so it does not contradict the code, and state the choice and its reason in the PR.

**Marks are not claims.** `in-flight-store.ts` states why: a mark is machine-local, gitignored and blocks no push. Do not turn it into a claim ref. `plot-dispatch.sh` stopped pushing a claim at dispatch when the hand-over became the registry's.

**Pure planners go to the domain as arrows; the spawning stays out of it.** `planAutoDispatch` (`auto-dispatch.ts:465`) is pure and moves to `packages/domain/src/rules/`. Check `planAutoDeliver` (`auto-deliver.ts:258`) for the same property and move it too if it holds. The domain imports `zod` and nothing else outside `adapters/`. `maybeAutoDispatch`, `runAutoDispatch` and `runAutoDeliver` call `scriptsFor(opts).start(...)`; in the fleet they call the `Scripts` port the daemon already holds (`scripts` in `registryd-main.ts`). Add no direct `spawn` or `execFile` site: CI's spawn ratchet (`ci.yml`, `allowed=11` at 2026-10-10) counts `packages/board/src`, `packages/domain/src` and `packages/fleet/src`, and a moved site must leave the total unchanged.

**The move has a dependency cost the plan does not state.** `auto-dispatch.ts` and `auto-deliver.ts` import board-only modules, and the module-graph test refuses each of them in a fleet entry. Measured 2026-10-10:

| imported | from | what it drags in | direction |
|---|---|---|---|
| `scriptsFor`, `readConfig`, `BuildBoardOptions` | `board.ts` | the board | the fleet has `shared/config-reader.ts` and its own `Scripts`; use them |
| `DISPATCH_SCRIPT`, `dispatchLogPath` | `dispatch.ts` | `node:http`, `controllers/caller.js` | move the two constants and the path function; leave the route |
| `deliverLogPath` | `deliver.ts` | `node:http`, `fleet.js` | same |
| `usableCommand` | `idea.ts` | `node:http`, `execFileSync` | move the function alone |
| `startBoardRun` | `board-run.ts` | `board.js` (`agentRunFor`) | the brief-ask and delivery agents record a board run; the fleet must write the same record so the board still shows it |
| `askForBrief`, `briefCommand` | `brief-ask.ts` | `board-run.js`, `idea.js` | moves with the caller |
| `recordActionReceipt` | `action-receipt.ts` | `fs`, `path` only | moves as is |
| `readInFlight`, `writeInFlight` | `in-flight-store.ts` | `fs`, `path` only | moves as is |
| `allSlicesConfirmed`, `allSlicesMerged` | `board.ts` | re-exports from `@plot-pm/domain` | import from the domain |

The board's routes (`/api/dispatch`, `/api/deliver`, `/api/idea`) keep calling the moved pieces by importing them from `@plot-pm/fleet`. Do not move the routes: that is wave 7. If the cut forces a move that wave 7 owns, report it and stop.

**Board-run records: write them where the board reads them.** `maybeAutoDeliver` and the brief ask start an agent through `startBoardRun`. `plot-ask.mjs` calls `leaveBoardRunsToTheBoard(true)` (`entry/main.ts`) so a one-shot process starts none, because its agent would end with it. `plot-fleetd` is long-lived, so it does start them. Check what `leaveBoardRunsToTheBoard` guards and that the fleet process does not set it.

**`/api/fleet-controls` writes the settings file and nothing else.** `handleFleetSettings` (`fleet-settings.ts`) already imports the store from `@plot-pm/fleet/shared/fleet-settings-store`. Verify it spawns and calls nothing else; the fleet reads the file fresh on every pass, so a switch flipped in the board takes effect on the next pass.

**The index never says no; answers, never verdicts.** Persist no verdict, no "dispatch due" flag and no wave eligibility in `.plot/state/`. Marks record an already-spent slot, which is an answer. Rules carried over unchanged: new code is arrow functions; TSDoc states what an export does and returns, and the reasoning goes in the commit message; new code says Slice where it means Slice; `Agent` names the actor and `Worker` the process; an absent field stays absent; read an exit code, not the emptiness of output.

**Correct the `plot-ask.mjs` sentence.** `CLAUDE.md` § *The Master Agent Uses The Controllers* says nine actions are reachable *without HTTP through `plot-ask.mjs`*. Measured 2026-10-10: `questionFrom` accepts `board`, `fleet` and `deliverable`, and `run` adds `release-claim`. No lifecycle controller is reachable. Rewrite the sentence to the measured state and say wave 7 closes it. Then run `./scripts/check-agents-md.sh --write`: `AGENTS.md` is generated from `CLAUDE.md` and CI refuses a mirror that differs.

### Done when

The plan's `## Slices` line for this wave is the specification: auto-dispatch and auto-delivery run in the fleet with in-flight state under `.plot/state/`, and the board's automatic writes are removed. The assertions below exist because a naive implementation passes without them:

- **The fleet dispatches from its own scan.** Fake clock, fake `Scripts`, an eligible slice, the switch on: one `plot-dispatch.sh` start per new pulse. It catches deleted board calls with no fleet calls.
- **A failed scan dispatches nothing and delivers nothing.** It catches the pass moved out of the success path.
- **The board makes zero dispatch and zero deliver starts**, with a live fleet and with none. It catches a second spender and a surviving board call.
- **`fleet.ts` imports neither `auto-dispatch` nor `auto-deliver`.** A test greps the import list. It catches the call re-added later.
- **The cap holds across a `plot-fleetd` restart.** Dispatch, rebuild the fleet's state from disk, run the next pass: the marks count against `parallelAgents`. It catches in-flight state that lives only in memory.
- **A dead fleet's marks expire.** After `IN_FLIGHT_TTL_MS` with nothing renewing, the budget returns. It catches a persisted set with no retirement.
- **Dispatch runs before delivery in one pass.** A fixture where a branch is dispatched and its plan is otherwise deliverable shows the branch counted live. It catches the order reversed.
- **Moved tests still run.** `packages/board/test/unit/auto-dispatch*.test.ts` and `auto-deliver.test.ts` (3,292 lines) move with the code to `packages/fleet/test/unit/`. Do not weaken or delete an assertion to make the move pass.
- **`entry-module-graph.test.mjs` still passes.** It catches a board import smuggled in by the move.
- **The shipped `plot-fleetd.mjs` contains the dispatch code.** Grep the built bundle for `plot-dispatch.sh` in a scratch build. A moved module the entry never imports passes every test and ships nothing.

Plus: add a changeset (`./scripts/check-changeset-packages.sh`; package `plot` or `@plot-pm/board`; the description first, the `plan:` line and the `bumps:` block last). The bundles under `skills/plot/scripts/board/` are generated: do not commit a rebuilt bundle (`scripts/check-no-bundle-diff.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite and do not run `pnpm run test:e2e` locally. Run `pnpm install` first if `node_modules` is missing, and `nvm use` (Node 24).

This wave touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If you find you must edit a script under `skills/`, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `auto-dispatch.ts`, `auto-deliver.ts`, `brief-ask.ts`, `in-flight-store.ts`, `action-receipt.ts` and their tests (moved into `packages/fleet/`); the new rules under `packages/domain/src/rules/`; the wiring in `packages/fleet/src/server/entry/registryd-main.ts`; the removal of the two calls, the three in-flight fields and their imports from `packages/board/src/server/fleet.ts`; the sentence in `CLAUDE.md` and the regenerated `AGENTS.md`.

This branch does not own: the controller routes in `index.ts` and the extraction of `dispatch`, `continue`, `release`, `approve` and the rest of P9 into commands (wave 7); `controllers/fleet-state.ts`; the scan clock, the bridge and the PR index writer (wave 5, merged); the `plot-fleetd` rename (merged).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
