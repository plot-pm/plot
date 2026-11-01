# Two test teardowns turn main red with every assertion passing

> A board server stopped mid-scan leaves a `plot-plan-store-ref-*` directory behind, and a fleet test removes a desk while a detached reporter still writes into it. Both turned `main` red on 2026-11-01 with every assertion passing.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** delivery-loop
- **Issue:** #3006
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3008 merged
- **Started:** 2026-11-01, Jan Wloka, `bug/a-stopped-process-leaves-no-plan-stage-directory`
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- A board server, `plot-scan-walk.mjs` or fleetd stopped while it parses plans no longer leaves a `plot-plan-store-ref-*`, `plot-default-plans-` or `plot-draft-plans-` directory in `TMPDIR`. The stage-directory registry moves from the board into the domain adapters, and fleetd removes live stage directories at exit without changing its graceful stop.
- The fleet's continuation tests remove their desks only after every process they started has written its last line.

Board impact: the board server imports its stage-directory registry from `@plot-pm/domain` instead of `packages/board/src/server/stage-dirs.ts`, and its SIGTERM cleanup also removes the plan-store stage directories. No change to the plan format, template, helper scripts, or `docs/plans` layout.

## Motivation

`owned-run.sh` fails a CI job when the run leaves an entry in its private `TMPDIR`. Two such leaks turned `main` red on 2026-11-01 while every assertion passed. A red `main` refuses every merge through `plot-ask.mjs merge` until a later commit reads green, so each leak blocks the whole fleet.

1. **`plot-plan-store-ref-*` (7 runs).** The board-integration job left exactly one `plot-plan-store-ref-*` entry in runs 41303723233, 41304794037, 41310373655, 41314420918, 41319588779, 41322195284 and 41323069974. That is 7 of 44 completed board-integration runs on `main` since `c1fb09ac8`, the merge of #2992, and 0 of the 40 runs before it. #2992 (`0846ab0e1`, *scanOnce walks the plan in process*) made the board server call `planStoreRef` in its own process at `packages/board/src/server/fleet.ts:2936`. `parseBlobs` (`packages/domain/src/adapters/plan-store/plan-store-ref.ts:113`) creates the directory with a raw `mkdtempSync` and removes it in the `finally` at `:149`. The board server's only SIGTERM handler, `removeStageDirsOnExit` (`packages/board/src/server/stage-dirs.ts:62`, installed at `index.ts:1055`), removes only the directories made through `makeStageDir` and then raises the signal again, so the `finally` never runs. The test helper `startServer().kill()` (`packages/board/test/helpers.mjs:269-288`) already waits for the server's whole tree to exit. No test starts the parser spawn, so no test teardown can fix this: the defect is in production code.
2. **`plot-continue-fleetd-*` (2 runs).** `continuation.test.ts`'s `afterEach` (`packages/fleet/test/unit/continuation.test.ts:74`, case *continueOnDesk accepts a fleetd caller* › *proceeds past the refusal "unattended" would hit*) threw `ENOTEMPTY` in runs 41312576926 and 41322195284. `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:1394-1398`) starts two detached subshells that `init` re-parents: the agent, whose pid goes to `.plot-worker.pid`, and a reporter, whose pid goes nowhere. The reporter polls `kill -0` every 50 ms and, after the agent exits, appends a `WorkerMonitor` line to `.plot-worker.monitor.worker.jsonl` in the desk. With `Worker command` = `true` the agent exits at once and the reporter writes while the `afterEach` removes the desk. The last writer is the reporter, so a wait on the agent's pid still races.

The same exposure exists outside CI. `pnpm board` runs under `node --watch`, so every rebuild restarts the server, and `/plot-board --stop` sends SIGTERM. Each stop during a scan leaves one directory in the operator's `TMPDIR` until fleetd's hourly `--sweep-temp` removes it after 24 h (`packages/board/src/server/entry/reap.ts:283-300`). With no fleetd running, nothing removes it.

## Design

### Approach

The two leaks have two different mechanisms and two different fixes.

**Leak 1 is a production fix: one stage-directory registry in the domain.**

- `stage-dirs.ts` moves from `packages/board/src/server/` to `packages/domain/src/adapters/stage-dirs.ts`. It reaches the filesystem and the process, so it is adapter code, and the domain may not import from `packages/board` (CLAUDE.md, *The Layering Rule*). One implementation remains; the board file goes, and `board.ts` and `index.ts` import from the domain. One registry per process also means one signal re-raise per process.
- `parseBlobs` creates its directory with `makeStageDir('plot-plan-store-ref-')` and removes it with `removeStageDir` by the exact path `mkdtempSync` returned, on success and on failure. `fleet.ts:1614` (`plot-default-plans-`, added by #3003) and `fleet.ts:1792` (`plot-draft-plans-`) stage through the same registry, because they run on the same poll path in the same process. Nothing removes by glob or prefix.
- The registry module offers two installers: an exit-only installer (one `process.on('exit')` listener) and the signal installer, which adds the SIGTERM, SIGINT and SIGHUP listeners that remove live directories and raise the signal again. Installing a listener is an entry's job, never the adapter's.
- **The board server and `plot-scan-walk.mjs` (`entry/scan-walk.ts`) install both.** Neither has another SIGTERM handler, so without the signal installer the default action ends the process before any `exit` listener runs. `scan-walk.ts` installs nothing today.
- **fleetd (`packages/fleet/src/server/entry/registryd-main.ts`) installs the exit-only installer and never the signal installer.** fleetd's `stopOnSignals` (`registryd-main.ts:2378`) treats a first SIGTERM as a request to stop after the current tick and a second as `exit(143)` at once. The signal installer's re-raise is that second signal: the safety juror ran both listeners in one process on Node 26.13.0, and one SIGTERM ended it with exit 143 and no graceful stop. In fleetd the first SIGTERM lets the tick finish, so `parseBlobs`'s own `finally` runs, and the exit listener covers the second-signal path, which goes through `process.exit`.
- Any other entry the slice finds that reaches `planStoreRef`, including through `refs-git.ts:400` (`readEstate` for the pulse), installs the signal installer when it has no SIGTERM handler of its own, and the exit-only installer when it has one. The PR body lists each entry and its choice.

The direct precedent is #1802 (`fb75fdd31`), which fixed the same symptom for `plot-board-plans-` on 2026-10-15. `docs/plans/2026-09-01-a-teardown-does-not-fail-a-suite.md` is a retrying removal and does not apply to leak 1.

**Leak 2 is a test fix: the fleetd case starts no process, and the real-spawn case waits for the reporter's last write.**

- *continueOnDesk accepts a fleetd caller* asserts only `result.kind === 'started'`, so it injects a fake `spawn` the way its three sibling describes do (`continuation.test.ts:125`, `:224`). Then no process writes into its desk.
- *continueOnDesk records the spawned pid's own start time* (`:158-211`) needs a real pid. After it ends the agent, its `afterEach` waits, with a bound, for the `WorkerMonitor` line in `<desk>/.plot-worker.monitor.worker.jsonl`, which is the reporter's last write. It then removes the desk with `removeTree` from `packages/fleet/test/rm-tree.mjs`. On the bound the wait fails with the desk path and sends no signal.
- Each `afterEach` in the file removes every recorded directory even when one removal throws, then throws the first error. Run 41312576926 showed the first throw leaving the sibling `-repo-` directory behind.
- The production design of `continueOnDesk` (detached, answered at once) stays.

### Constraints

- fleetd never installs the signal installer. A test holds this (Done when).
- The registry stays one module with one live set. A copy in the board or the fleet would raise each signal twice.
- New and moved code in `packages/domain/src/` is arrow functions with factual TSDoc. The comment at `packages/board/test/helpers.mjs:291-300` that names `stage-dirs.ts` names the domain module instead.
- The Plan stage slice changes production code in `packages/domain`, `packages/board` and `packages/fleet`, so it carries a changeset. The Continuation desks slice changes one test file and carries none.

### Open Questions

- [x] Which test leaks `plot-plan-store-ref-*`? Not one test. Each leaked directory holds the 9 plans of `packages/board/test/fixtures/tiny-garden/`, and its creation time falls about 4 s before the end of a serial browser file that stops a real board on that fixture: `stuck-rows.browser.test.ts` (3 runs), `tiny-garden.browser.test.ts` (2) and `dead-fetch.browser.test.ts` (2). The creating process is the board server, and the test already waits for it, so the fix is in `parseBlobs` and the entries, not in a test.

## Done when

Domain rows run in `pnpm --filter @plot-pm/domain exec vitest run <file>`, board rows in `pnpm --filter @plot-pm/board exec vitest run <file>`, and fleet rows in `pnpm --filter @plot-pm/fleet exec vitest run <file>`. Every row asserts a state, never an elapsed time; every wait on a state has a bound and fails by name.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| A SIGTERM mid-parse removes the stage directory | child `node` with a private `TMPDIR` installs the signal installer and calls `planStoreRef(...).readPlansAt` with a fake `Refs`; a copied stub `plot-plan-meta.sh` writes its pid to a ready file and sleeps; the parent waits for the ready file, sends SIGTERM to its own child, awaits exit, then ends the stub by the pid it wrote | the child's `TMPDIR` holds no `plot-plan-store-ref-*`; the child ended by SIGTERM; on `origin/main` the directory stays | `packages/domain/test/plan-store-ref.test.ts` | Plan stage |
| `process.exit` mid-parse removes it too | the same child with the exit-only installer calls `process.exit(0)` once the ready file exists | no `plot-plan-store-ref-*` remains | `packages/domain/test/plan-store-ref.test.ts` | Plan stage |
| A finished parse leaves the registry empty | one parse that succeeds, one whose parser exits 1 | `removeLiveStageDirs()` returns `[]` after each | `packages/domain/test/plan-store-ref.test.ts` | Plan stage |
| The board's own stage directories still clean up | the existing `stage-dirs.test.ts` cases, moved | they pass against the domain module | `packages/domain/test/stage-dirs.test.ts` | Plan stage |
| fleetd keeps its graceful stop | child with `stopOnSignals` and the exit-only installer, one live stage directory, one SIGTERM | the child does not exit 143 on the first signal; after its stop completes, the directory is gone | `packages/fleet/test/unit/registryd-stage-dirs.test.ts` | Plan stage |
| The board server cleans up a plan-store stage | `startServer` on a fixture whose script directory holds a `plot-plan-meta.sh` stub that blocks only for paths under `plot-plan-store-ref-`; wait for that entry; `server.kill()` | the entry is gone | `packages/board/test/unit/server-stage-dirs.test.ts` | Plan stage |
| The default-branch and draft stages use the registry | `planMetasAtDefault` with one blob and one draft plan, parser stub blocking | both directories are in the live set while the parse runs, and absent after | `packages/board/test/unit/fleet.test.ts` | Plan stage |
| A reporter writes after `continueOnDesk` returns | real spawn, `Worker command` waits for a file `go` in the desk; the test creates `go` after the call returns | no `.plot-worker.monitor.worker.jsonl` when the call returns; the file holds one `WorkerMonitor` line after `go` | `packages/fleet/test/unit/continuation.test.ts` | Continuation desks |
| The fleetd case starts no process | the fleetd caller case with a fake `spawn` | `started`; the fake was called once; the desk holds no `.plot-worker.*` file | `packages/fleet/test/unit/continuation.test.ts` | Continuation desks |
| The real-spawn case removes its desk after the last write | *records the spawned pid's own start time* | the `afterEach` waits for the `WorkerMonitor` line, then `removeTree` removes the desk; the file holds no bare `rmSync(...recursive` | `packages/fleet/test/unit/continuation.test.ts` | Continuation desks |
| One failed removal does not leak its siblings | an `afterEach` with two recorded directories, the first removal throws | the second directory is gone; the first error is thrown | `packages/fleet/test/unit/continuation.test.ts` | Continuation desks |

Mutation check for the Plan stage slice: revert `parseBlobs` to a raw `mkdtempSync`, and the first, second and sixth rows fail.

**Delivery observation, not a test.** Before `/plot-deliver`, the deliverer reads the next 30 `ci.yml` runs on `main` after both slices merge and records how many left a `plot-plan-store-ref-`, `plot-default-plans-`, `plot-draft-plans-` or `plot-continue-fleetd-` entry. The expected count is 0. The baseline on 2026-11-01 is 7 of 44 for `plot-plan-store-ref-` and 2 of 48 for `plot-continue-fleetd-`; at 7 in 44, 30 clean runs by chance have a probability of about 1 %.

## Slices

### Plan stage

- `bug/a-stopped-process-leaves-no-plan-stage-directory` — move `packages/board/src/server/stage-dirs.ts` to `packages/domain/src/adapters/stage-dirs.ts` and split its installer into exit-only and signal; `parseBlobs` in `packages/domain/src/adapters/plan-store/plan-store-ref.ts` stages through it; `fleet.ts:1614` and `fleet.ts:1792` stage through it; `board.ts` and `index.ts` import it from the domain; `entry/scan-walk.ts` installs the signal installer; `registryd-main.ts` installs the exit-only installer; any further `planStoreRef` entry per the Approach, listed in the PR body; the comment at `packages/board/test/helpers.mjs:291-300`; a changeset. Tests: `packages/domain/test/plan-store-ref.test.ts`, `packages/domain/test/stage-dirs.test.ts` (moved from `packages/board/test/unit/`), `packages/fleet/test/unit/registryd-stage-dirs.test.ts`, `packages/board/test/unit/server-stage-dirs.test.ts`, `packages/board/test/unit/fleet.test.ts`. → #3011

### Continuation desks

- `bug/the-continuation-tests-remove-desks-after-the-last-write` — `packages/fleet/test/unit/continuation.test.ts` only: the fleetd caller case injects a fake `spawn`; the pid-start-time case waits for the reporter's `WorkerMonitor` line and removes its desks with `removeTree`; every `afterEach` removes all recorded directories before it throws; the new reporter case. No production change and no changeset.

## Notes

Filed from tracker issue #3006. Amended from panel round 1 (`.plot/panels/2026-11-01-two-test-teardowns-turn-main-red/panel.md`, unanimous amend).

**Order.** Neither slice waits on the other: the files are disjoint. Merge `bug/a-stopped-process-leaves-no-plan-stage-directory` first, because it fails about one `main` run in six. Neither slice touches a file of the open PRs #3009, #3007 or #3005, or of `feature/the-scan-script-is-a-launcher`. That slice makes `plot-scan-walk.mjs` the only scan path, which is why the Plan stage slice covers `scan-walk.ts`.

**Left out, each a follow-up rather than a slice here:**

- The CI step *A teardown does not race a child* (`ci.yml:1736-1753`) counts only `fs.rmSync(...recursive)`. A bare named-import `rmSync(...recursive` escapes it: 94 sites in 35 files under `packages/{board,fleet}/test` at `eeea594c6`, and 60 more under `packages/domain/test`, which the step does not scan. Widening the regex to `(^|[^.A-Za-z])(fs\.)?rmSync\s*\([^)]*recursive` with `allowed` set to the measured count is a ratchet that refuses a new site and converts none. All four jurors marked it optional; it gets its own issue.
- A gate that refuses a bare `mkdtempSync(join(tmpdir(), ...))` in production source outside the registry. `plot-board-plans-` (2026-10-15) and `plot-plan-store-ref-` (2026-11-01) leaked this way, and `auto-verify.ts:278` (`plot-verify-meta-`) has the same shape and has not leaked yet.
- A pid file for the continuation reporter (`.plot-worker.reporter.pid`), so a test can wait on it by pid. This is a production change to `continuation.ts`.
- A third teardown race outside this plan: `test/reconcile/pushmain.test.mjs:463` threw `ENOTEMPTY` on `.git/plot-push-main.lock` in run 41312576926 (helper-contracts). It needs its own issue.
- A SIGKILL still leaves a stage directory. fleetd's hourly `--sweep-temp` remains the only removal for that case.
