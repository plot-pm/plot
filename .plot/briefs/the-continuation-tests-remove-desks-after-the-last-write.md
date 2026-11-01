## Implementation brief — two-test-teardowns-turn-main-red (Continuation desks)

- **Plan (canonical):** docs/plans/2026-11-01-two-test-teardowns-turn-main-red.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3008 merged
- **Branch:** `bug/the-continuation-tests-remove-desks-after-the-last-write` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This branch does not wait on the sibling slice (`bug/a-stopped-process-leaves-no-plan-stage-directory`, PR #3011) and vice versa — the plan's Notes say "Neither slice waits on the other: the files are disjoint." The plan recommends merging the sibling first because it fails CI more often (about 1 run in 6, against this slice's rarer failure); that is an ordering preference, not a dependency, so this branch can start and merge on its own schedule.

### What to build

One test file, `packages/fleet/test/unit/continuation.test.ts`, has two describe blocks whose `afterEach` removes a desk directory before every process that was writing into it has finished. CI hit `ENOTEMPTY` from this in runs 41312576926 and 41322195284 (2 of 48 runs) with every assertion in the file passing — the failure is in teardown timing, not in `continueOnDesk` itself.

`continueOnDesk` (`packages/fleet/src/shared/continuation.ts:1390-1398`) spawns two detached, sibling (not parent/child) subshells sharing one process group: an **agent** subshell that runs the real `Worker command` and writes `.plot-worker.pid`, and a **reporter** subshell that polls `kill -0` on the agent's pid every 50ms and, once the agent exits, appends one `WorkerMonitor` line to `<desk>/.plot-worker.monitor.worker.jsonl` (the `reporterTail` built at `:1376-1389`). The reporter's pid is never recorded anywhere — unlike the agent, it has no `.plot-worker.pid`-equivalent file a test can wait on by pid.

Two tests in the file are affected:

1. **`continueOnDesk accepts a fleetd caller` › `proceeds past the refusal "unattended" would hit`** (`:71-74` for the `afterEach`, test body starting `:76`). This case passes `caller: 'fleetd'` but injects **no fake `spawn`** — unlike its three sibling describes, which all pass a `fakeSpawn`. That means it runs a real `Worker command` (`readCfg` returns `'true'`), so `continueOnDesk` really spawns the agent-plus-reporter pair into a real desk directory. The `afterEach` at `:72-74` is a bare `for (const desk of desks.splice(0)) rmSync(desk, { recursive: true, force: true })` with no wait at all — it races the reporter (and the agent) from the moment the test's `await continueOnDesk(...)` resolves, which per the design above is before either subshell has necessarily finished writing.

2. **`continueOnDesk records the spawned pid's own start time` › writes `.plot-worker.pid.startedAt`...** (the real-spawn case starting around line 155). Its `afterEach` (just above the test) waits for the **agent's own pid** to die (`isAlive`/`SIGKILL`/poll loop) but never waits for the **reporter's** last write. The reporter is a distinct process from the agent (see the design comment in `continuation.ts:1283-1298`): once the agent dies, the reporter still has its own `kill -0` polling cycle (up to ~50ms) plus the `reporterTail` file write left to do. Waiting out the agent's death says nothing about whether the reporter has finished; the last writer into the desk is the reporter, not the agent, so this `afterEach` can call `removeTree` while the reporter is still appending to `.plot-worker.monitor.worker.jsonl`.

The production design of `continueOnDesk` — detached siblings, reporter self-elects as the one that fills in a crash code the agent can't self-report — stays as-is. **This is a test-only fix.**

### The decisions the plan settles — do not re-derive them

**The fleetd-caller case needs a fake `spawn`, not a wait.** The assertion it makes is `result.kind === 'started'` — it is testing that a `fleetd` caller gets past the `unattended` refusal, nothing about what the spawned process does. There is no reason this case needs a real process at all; its three sibling describes in the same file already inject `fakeSpawn` (see `:125`, `:224` for the pattern — an `EventEmitter` that synchronously emits `'exit'` on a `queueMicrotask`). Give this case the same `fakeSpawn` via the `spawn:` option on `continueOnDesk`'s input. Once no real process is spawned, the desk is never written into beyond what `continueOnDesk` itself writes synchronously before returning, and the existing bare `rmSync` in its `afterEach` is correct again — because nothing outlives the call.

**The pid-start-time case needs to wait for the reporter's last write, not just the agent's death.** The fix is **not** a longer poll on the agent's pid — the two processes are genuinely independent (continuation.ts's own comment block at `:1283-1298` is explicit that the reporter is a sibling, never a parent, and is the one that does the `WorkerMonitor` write). The correct wait is on the **effect** the reporter produces: poll for the `WorkerMonitor` line to appear in `<desk>/.plot-worker.monitor.worker.jsonl`, bounded, and fail by name (per the plan's `## Done when` preamble: "every row asserts a state, never an elapsed time; every wait on a state has a bound and fails by name" — a bare `setTimeout` guess is not acceptable here). Only once that line is present does `afterEach` call `removeTree` (`packages/fleet/test/rm-tree.mjs`) to remove the desk — `removeTree` already retries through `ENOTEMPTY`/`EBUSY`/`EPERM` for *other* stray writers (git maintenance, wrapper processes), but it is not a substitute for waiting on a writer this test itself knows about and can name.

**Why `removeTree`, not a bare `rmSync`, for this afterEach.** `packages/fleet/test/rm-tree.mjs` is the one recursive removal CI's teardown-race step allows for this package; it already handles a wrapper's own grandchildren and transient git lockfiles. Once the reporter's write is confirmed finished, there should be no live writer left, but using `removeTree` here anyway is the defensive match for the *first* `afterEach` discussed above (the "one failed removal does not leak its siblings" row below is about this same file) — consistent with the existing pid-start-time `afterEach`, which already calls `removeTree` after its pid-death wait.

**Each `afterEach` must remove every recorded directory even when one throws.** The plan's Done-when table has a dedicated row for this (see below) — it is a correctness property of the teardown loop itself, independent of the two specific timing fixes above. Run 41312576926 showed exactly this: the first throw in an `afterEach` loop left a sibling `-repo-` directory behind because the loop (or the test author's `for` body) stopped at the first failure instead of attempting every recorded path and only then re-raising. Audit every `afterEach` in this file for this shape, not only the two already named.

**Which test leaks this way, and why that is settled, not re-derivable here.** The plan's investigation (Open Questions, now answered) already identified both failing cases exactly as named above — do not re-derive from the CI run logs; the plan's Motivation section (`## Motivation`, item 2) is the citation if you need the original run numbers (41312576926, 41322195284).

### Done when

The plan's `## Done when` table (rows tagged "Continuation desks") is the specification:

| Claim | Test |
|---|---|
| A reporter writes after `continueOnDesk` returns — real spawn, `Worker command` waits for a file `go` in the desk; the test creates `go` after the call returns; no `.plot-worker.monitor.worker.jsonl` when the call returns, and the file holds one `WorkerMonitor` line after `go` | `packages/fleet/test/unit/continuation.test.ts` (new case) |
| The fleetd case starts no process — fleetd caller case with a fake `spawn`; `started`; the fake was called once; the desk holds no `.plot-worker.*` file | `packages/fleet/test/unit/continuation.test.ts` |
| The real-spawn case removes its desk after the last write — *records the spawned pid's own start time*; the `afterEach` waits for the `WorkerMonitor` line, then `removeTree` removes the desk; the file holds no bare `rmSync(...recursive` | `packages/fleet/test/unit/continuation.test.ts` |
| One failed removal does not leak its siblings — an `afterEach` with two recorded directories, the first removal throws; the second directory is gone; the first error is thrown | `packages/fleet/test/unit/continuation.test.ts` |

Lift these because a naive fix passes without them:

- **The new reporter-timing case is the regression test for the actual race**, not just a cleanup fix — it must assert the negative (`.plot-worker.monitor.worker.jsonl` absent) at the moment `continueOnDesk` resolves, and only then trigger the write via the `go` file, to prove the reporter genuinely outlives the call rather than merely asserting the eventual state.
- **"No bare `rmSync(...recursive`"** is an explicit assertion target for the real-spawn case's `afterEach` — the fix must go through `removeTree`, and the test (or a reviewer) should confirm the file no longer contains a direct recursive `rmSync` call outside `removeTree` itself for that case.
- **The fleetd case's desk must hold no `.plot-worker.*` file at all** once the fake `spawn` is wired in — this is what proves no real process ever touched the desk, not merely that the test didn't crash.
- Every wait needs a bound and must fail by name, per the plan's table preamble — no elapsed-time assertions.

**No production change and no changeset** — the plan's Constraints section states this explicitly for this slice (it changes one test file only). Do not touch `packages/fleet/src/shared/continuation.ts`.

For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — this slice's only touched file is `packages/fleet/test/unit/continuation.test.ts`, under `packages/fleet/**`, so expect it to select `pnpm --filter @plot-pm/fleet exec vitest related --run {changed}`. The suites in the repo's `CI suites` config key run in CI; a failure there comes back as a correction. Do not run the full local `test:e2e` — it is CI's gate, not a local one (CLAUDE.md, Testing).

`scripts/check-shell-lines.sh` only matters for `.sh` files under `skills/`; this slice touches none, so it should not trigger.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists. When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Continuation desks` heading.

### Scope guard

This branch owns exactly one file:

- `packages/fleet/test/unit/continuation.test.ts`

The sibling slice, `bug/a-stopped-process-leaves-no-plan-stage-directory` (PR #3011), touches `packages/domain/src/adapters/stage-dirs.ts`, `packages/domain/src/adapters/plan-store/plan-store-ref.ts`, `packages/board/src/server/fleet.ts`, `packages/fleet/src/server/entry/registryd-main.ts`, `packages/board/test/helpers.mjs` (comment only), and several new/moved test files under `packages/domain/test/`, `packages/fleet/test/unit/` and `packages/board/test/unit/` — none of those overlap this branch's one file. No other open PR (#3009, #3007, #3005) or in-flight branch (`feature/the-scan-script-is-a-launcher`) touches `continuation.test.ts`, per the plan's own Notes.

If you find something the plan did not anticipate — e.g. a third `afterEach` in this file with the same race, or evidence the reporter mechanism itself needs to change rather than just the test's wait — report it rather than improvising outside scope; the plan is explicit that the production design stays as it is for this slice.
