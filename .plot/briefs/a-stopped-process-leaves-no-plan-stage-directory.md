## Implementation brief — two-test-teardowns-turn-main-red (Plan stage)

- **Plan (canonical):** docs/plans/2026-11-01-two-test-teardowns-turn-main-red.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3008 merged
- **Branch:** `bug/a-stopped-process-leaves-no-plan-stage-directory` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This branch does not wait on the sibling slice (`bug/the-continuation-tests-remove-desks-after-the-last-write`) and vice versa — the plan's Notes say "Neither slice waits on the other: the files are disjoint." But merge this one first: it is the slice that fails CI more often (about 1 run in 6, against the sibling's rarer failure), and the plan names that as the reason for the order, not a dependency.

### What to build

`main` went red twice on 2026-11-01 with every assertion passing, from two unrelated leaked-directory bugs. This slice fixes the first: a `plot-plan-store-ref-*` directory survives in `TMPDIR` whenever the process holding it is killed by SIGTERM mid-parse, because the directory is created with a raw `mkdtempSync` and removed only in a `finally` that a signal never reaches. CI hit this on 7 of 44 board-integration runs since `c1fb09ac8` (merge of #2992) — 0 of the 40 runs before it, because #2992 is what made the board server call `planStoreRef` in-process.

The fix is one stage-directory registry, moved into the domain, with two installers (exit-only, and exit-plus-signal-reraise) that each call site picks between based on whether it already owns a SIGTERM handler.

### The decisions the plan settles — do not re-derive them

**One registry module, not a copy per package.** `stage-dirs.ts` moves wholesale from `packages/board/src/server/` to `packages/domain/src/adapters/stage-dirs.ts`. The board's copy is deleted, not kept as a second implementation — a second live-set would double-remove or double-reraise the signal in the same process. `board.ts` and `index.ts` import the domain module instead.

**Why the domain, and not the board or the fleet.** It reaches the filesystem and the process table, so it is adapter code (CLAUDE.md, *The Layering Rule*): the domain owns the port, adapters reach the world, and this file is the only adapter among the three packages touching the registry. Per CLAUDE.md's domain-package rules, new/moved code here is **arrow functions**, with factual TSDoc — not the narrative kind. The board's own style (function declarations) is explicitly not the model for this file now that it has moved.

**`parseBlobs` stages through the registry, not a bare `mkdtempSync`.** `packages/domain/src/adapters/plan-store/plan-store-ref.ts:113` currently creates its directory directly and relies on its own `finally` at `:149` — which a SIGTERM never reaches, because Node's default SIGTERM action terminates the process before any `finally` in the current call stack runs. Route creation through `makeStageDir('plot-plan-store-ref-')` and removal through `removeStageDir` by the exact path `mkdtempSync` returned — never a glob or prefix match, which could remove a directory a concurrent parse still owns.

**Two installers, and the choice belongs to the entry point, never the adapter.** The registry module exposes:
- an **exit-only** installer (one `process.on('exit', ...)` listener) — for a process that already has its own SIGTERM handling and would double-handle the signal if the registry re-raised it.
- a **signal** installer (SIGTERM/SIGINT/SIGHUP listeners that remove live directories, then re-raise the same signal) — for a process with no other handler, where Node's default action would otherwise skip every `finally` and every `exit` listener.

Installing the wrong one breaks a specific process differently:
- **fleetd gets the exit-only installer, never the signal one.** `registryd-main.ts`'s `stopOnSignals` (`:2378`) already treats a first SIGTERM as "finish this tick, then stop" and a second as `exit(143)`. If fleetd also installed the signal installer, running both listeners in the same process on Node 26.13.0 made one SIGTERM `exit(143)` immediately with no graceful stop — measured directly in this plan's own safety juror run. fleetd's own first-SIGTERM path lets the tick finish, so `parseBlobs`'s `finally` already runs there; the exit-only installer covers the second-signal (`process.exit`) path only.
- **The board server and `plot-scan-walk.mjs` get the signal installer.** Neither has another SIGTERM handler today, so without the signal installer, the default action ends the process before any `exit` listener fires, and the directory leaks exactly as measured. `scan-walk.ts` installs nothing today — this slice adds it.

**Every other call site that reaches `planStoreRef` needs the same choice, and the brief does not enumerate them exhaustively — the plan says to list them in the PR body.** `fleet.ts:1614` (`plot-default-plans-`) and `fleet.ts:1792` (`plot-draft-plans-`) stage through the same registry because they run on the same poll path in the same process as the board server — they do not get their own installer choice, they inherit whichever the board server already installed. `refs-git.ts:400` (`readEstate` for the pulse) is named in the plan as a site to check. Audit for any other `planStoreRef` caller, and record each one's installer choice and reasoning in the PR body — that enumeration is part of this slice's done-when, not optional follow-up.

**Which bug this is not.** This is not the same failure mode as #1802 (`fb75fdd31`, 2026-10-15), which fixed `plot-board-plans-` leaking the same way — that fix is the direct precedent for this one (same registry pattern) but `plot-board-plans-` itself is already handled and out of scope here. Also not in scope: `docs/plans/2026-09-01-a-teardown-does-not-fail-a-suite.md`'s retrying-removal pattern — the plan explicitly says that approach does not apply here, because this leak is a production defect no test can route around (no test starts the parser spawn directly).

**Which test exposed this, and why that rules out a test-side fix.** The plan's own open-question investigation found the leaked directories are *created* about 4s before the end of specific serial browser tests (`stuck-rows.browser.test.ts`, `tiny-garden.browser.test.ts`, `dead-fetch.browser.test.ts`) that stop a real board server — but the *creating* process is the board server itself, which the tests already wait on correctly. The defect is in `parseBlobs` and the entries' installer wiring, not in any test's teardown.

### Done when

The plan's `## Done when` table (rows tagged "Plan stage") is the specification — each row names its exact test file and what it asserts. Lift these because a naive fix passes without them:

- **The SIGTERM test must assert the directory is gone AND that `origin/main`'s current (unfixed) behavior leaves it** — i.e. the test is written to fail against today's `plan-store-ref.ts` before the fix lands, proving it exercises the real defect rather than a mocked-away version of it.
- **The fleetd test must assert fleetd does NOT exit 143 on the first SIGTERM** — this is the regression the wrong installer choice caused in the plan's own measurement; a test that only checks "directory is removed eventually" would miss a correctness break in fleetd's existing graceful-stop contract.
- **Every wait on a state needs a bound and must fail by name** — per the plan's table preamble, no row may assert elapsed time instead of a state.
- **Mutation check:** revert `parseBlobs` to a raw `mkdtempSync` and confirm the 1st, 2nd and 6th Done-when rows fail. Run this before considering the slice done, not just the suite green once.

Plus: this slice **carries a changeset** (production code changes in `packages/domain`, `packages/board` and `packages/fleet`) — the plan's Constraints section states this explicitly; the sibling slice (test-only) carries none. Also update the comment at `packages/board/test/helpers.mjs:291-300` that currently names `stage-dirs.ts` by its old board-side path — point it at the new domain module path instead.

For tests, run `node ../plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the repo's `CI suites` config key run in CI; a failure there comes back as a correction. Do not run the full local `test:e2e` — it is CI's gate, not a local one (CLAUDE.md, Testing).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice is TypeScript-only (no `.sh` files touched per its branch name), so this gate should not trigger — but if any `.sh` file ends up touched, growth must be paid for in the same change.

### Bookkeeping

Open the PR through the controller once there is a real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — don't wait for the slice to be "done" to make it visible. When the PR is created, append `→ #<number>` to this branch's line under the plan's `## Slices` → `### Plan stage` heading.

### Scope guard

This branch owns:
- `packages/domain/src/adapters/stage-dirs.ts` (new — moved from `packages/board/src/server/stage-dirs.ts`, which this branch deletes)
- `packages/domain/src/adapters/plan-store/plan-store-ref.ts` (route `parseBlobs` through the registry)
- `packages/board/src/server/fleet.ts` (lines ~1614, ~1792 — stage through the registry; `board.ts`/`index.ts` import path change)
- `packages/fleet/src/server/entry/registryd-main.ts` (install exit-only)
- entry point for `plot-scan-walk.mjs` / `entry/scan-walk.ts` (install signal installer)
- `refs-git.ts` around `:400` (`readEstate`) — audit and wire per the Approach
- `packages/board/test/helpers.mjs:291-300` (comment update only)
- the moved/new test files: `packages/domain/test/plan-store-ref.test.ts`, `packages/domain/test/stage-dirs.test.ts`, `packages/fleet/test/unit/registryd-stage-dirs.test.ts`, `packages/board/test/unit/server-stage-dirs.test.ts`, `packages/board/test/unit/fleet.test.ts`
- a changeset

The sibling slice, `bug/the-continuation-tests-remove-desks-after-the-last-write`, touches only `packages/fleet/test/unit/continuation.test.ts` — no file overlap with this branch. No other open PR (#3009, #3007, #3005) or in-flight branch (`feature/the-scan-script-is-a-launcher`) touches a file this branch owns, per the plan's own Notes — though `feature/the-scan-script-is-a-launcher` is worth a glance since it also touches `plot-scan-walk.mjs`'s entry shape; the plan says that's exactly why this slice's Approach section covers `scan-walk.ts` directly rather than assuming it will stay a thin launcher.

If you find something the plan did not anticipate — e.g. another `planStoreRef` caller the audit missed, or a process where neither installer choice fits cleanly — report it rather than improvising outside scope.
