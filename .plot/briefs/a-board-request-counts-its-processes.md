## Implementation brief — the-board-starts-processes-on-the (wave 1: Proof)

- **Plan (canonical):** `docs/plans/2026-11-01-the-board-starts-processes-on-the.md` on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3018 merged
- **Branch:** `feature/a-board-request-counts-its-processes` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`)

Three slices wait on this one: `feature/the-board-holds-its-config` and `feature/the-board-reads-git-through-cached-refs` wait on it directly, and `feature/the-board-parses-a-plan-once-per-blob` waits on the git-reads slice. Each later slice edits the list this slice records, so the list's format is their interface.

### What to build

`GET /api/board` waits on dozens of short processes started one after another (issue #3017). Measured 2026-11-01: 7.8 s to 61 s per request at load 6 to 9, 0 % board CPU, about 180 ms per start while `syspolicyd` ran hot. This slice removes no start. It makes the count visible and fails on growth, so each later slice proves its own relief by deleting lines from a list.

1. Move the `/api/board` handler body (`packages/board/src/server/index.ts`, the block from `boardState(...)` to the `JSON.stringify`) into a controller `boardAnswer(opts, host, port, archived)` in `packages/board/src/server/controllers/`. The handler keeps parse, call, serialise and the 500 path. The result stays a value, so a test runs it without a server.
2. Add a refresh-pause seam beside `stopFleetRefresh` in `fleet.ts`. It stops the refresh clocks and keeps the caches. `stopFleetRefresh` calls `caches.clear()`, which is the reason it cannot serve the count.
3. Move `interrogateAvailability` (`interrogate.ts:57`) from the synchronous `readConfig` to `readConfigAsync`. One async start replaces one synchronous start, so the count is unchanged and the read-route gate passes. Its callers in `index.ts` and `boardAnswer` await it.
4. Add `boardAnswer` to `ENTRIES` in `packages/board/test/unit/a-read-route-spawns-nothing.test.ts` and correct the route table there.
5. Write `packages/board/test/unit/board-request-starts.test.ts` (vitest project `parallel`). Mock `node:child_process` with a pass-through that records command lines from `spawn`, `execFile`, `execFileSync` and `spawnSync`. Use a fixture estate with Delivered plans and one draft branch. Pause the refresh with the new seam, pin time with `vi.setSystemTime` so the 5 s and 60 s holds in `serverInfo` do not expire, call `boardAnswer` once to warm, then assert the exact list of starts of the second call. Record today's list as it measures. Assert no duration.

### Settled decisions — do not re-derive them

- **A module mock, not a counting port.** Thirteen board modules import `node:child_process` directly. A port sees adapters only, so it undercounts.
- **In-process, not a PATH shim.** The shim in `plan-read-shape.test.mjs` also counts the refresh loop, and `stopFleetRefresh` clears the warm caches the count needs. The loop's own starts (`plot-fleetctl.sh --status`, 3.9 s to 12.8 s) are not on the request path; `readSupervisor` has one caller, `refresh` (`fleet.ts`). Do not add supervisor work to this plan.
- **The list is exact.** Any extra line fails with the full list printed. A "count ≤ N" assertion hides a swap of one start for another.
- **The module mock counts starts, not what a script starts inside itself.** `plot-config.sh get` is one line and about five processes. Do not read the line count as a process count.
- **Record, do not fix.** If the warm list shows a start the plan did not name, record it and report it in the PR. Do not remove it here.
- **No gate lowering.** The CI spawn ratchet (`ci.yml`, `allowed=28`) does not see this test and is not touched.

### Done when

The plan's `## Done when` rows tagged *Proof* are the specification:

- A warm request starts only its listed processes (`board-request-starts.test.ts`).
- The handler's callees are walked by the gate: no synchronous spawn below `boardAnswer`. With the old `interrogate.ts:57` read restored, the gate fails. Run that mutation once, then restore.

The assertion a naive implementation passes without: the second call must be warm. Check the first call lists more starts than the second; if the two lists are equal the seam cleared the caches and the test measures nothing.

Plus: add a changeset (`@plot-pm/board` patch, description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not commit the rebuilt board artifact. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to pay.

New functions are arrow functions. The domain has no change here; `boardAnswer` is board code.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/index.ts` (handler only), `controllers/board-answer.ts` (new), the seam in `fleet.ts`, `interrogate.ts`, and the two test files above. Do not edit `refresh` (`fleet.ts`): `feature/the-last-scan-modes-run-the-walk` and `feature/the-scan-script-is-a-launcher` edit it, and `fleet.ts` changed in 24 commits in one week, so rebase on `origin/main` before review. The three later slices of this plan hold the config adapter, the walk cache and the parse cache. This slice adds none.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
