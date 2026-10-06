## Implementation brief — the-worker-loop-runs-in-js (wave 4: The loop restarts on new code)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-loop-restarts-on-new-code` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

Slices 1 to 3 merged on 2026-10-05 (#1279, #1282, #1292), so `agentLoop`, `performLoopWrites`, the `boundedRun` and `desk` ports and the entry `packages/board/src/server/entry/worker-loop.ts` exist on `main`. This slice adds the restart to that entry. Slice 5 (`js-is-the-default-loop`) and slice 6 wait behind it.

### What to build

A loop that runs old code. The board ran a day and a half on the code it loaded at start and kept a repair that #1263 had retired (plan, Motivation, failure 5). The JS loop lives as long as its agent, so it has the same exposure, and it holds 58 to 81 MB resident where the shell loop held 2 to 5 MB. This slice makes a waiting loop replace its own process image when a newer, loadable bundle sits in this repository's main checkout, and when its memory passes 300 MB. It keeps its pid, because the dispatch wrapper's `wait` and the manifest's `pid` depend on that pid.

The parts:

- **`restartAnswer(readings)`** in `packages/domain/src/rules/loop-restart.ts`. It answers `stay`, `restart`, or `stay-and-log` with a reason, from: first check or later, the four conditions, the two bundle hashes, the resident memory, and whether `process.execve` exists. It is a rule, so it is synchronous, reads no port and has its own unit test. Failure 5 (a process that runs old code) is its test case.
- **The `reexec` port** (`packages/domain/src/ports/reexec.ts`, an `interface`) and its adapter `packages/domain/src/adapters/process-exec.ts`, which calls `process.execve`. It has exactly one caller, the entry. A Node without `process.execve` makes the adapter answer `unaskable`, never `failed`.
- **The main checkout's bundle path and the loaded commit**, resolved through `trees.list()`: the main checkout is the first entry. The loop pins the bundle path there and records the main checkout's `HEAD` at that moment as the loaded commit. Squash-merge never puts a desk's commit on main, so the loaded commit is never the desk's.
- **The first check**, before the first pass. It asks only whether the main checkout is on the default branch with clean bundle paths, and whether the pinned bundle's content hash differs from the running one. A loop started from a desk's older bundle moves to main's bundle at once.
- **Later checks**, in the free wait only. A restart happens when all four hold: the main checkout is on the default branch; its bundle paths are clean; its `HEAD` contains the loaded commit (`refs.contains`, whose adapter already declares `plot-ancestry: evidence`; the caller of that answer declares its own kind within five lines above the call, per `scripts/check-ancestry-decisions.sh`); and the pinned bundle's content hash differs from the loaded one.
- **The self-check.** Before any restart the loop runs `node <bundle> --self-check` through `boundedRun` and requires exit 0 within 10 s. The entry has no `--self-check` argument today: add one that loads the module and exits 0 before it reads any manifest or touches any desk. A bundle that fails is logged once and not used.
- **`reexec` with the same arguments and `PLOT_WAIT_STARTED`.** The wait's start is `WaitClock.since` (`worker-loop.ts:81`), a module-level field the slice-3 doc comment names for this purpose. The new process reads `PLOT_WAIT_STARTED` into `clock.since` at start and the restart writes it, so a restart cannot extend `Worker bound` (Manifesto principle 13).
- **The memory ceiling.** The same check restarts the loop in a free wait when its resident memory passes 300 MB. `processes` has no resident-size read today (`ports/processes.ts` holds `isAlive`, `startedAt`, `childrenOf`, `uptimeSeconds`, `activity` and `workerState`): add one operation for it, or read `process.memoryUsage().rss` in the entry. Choose by the layering rule — a process reading its own memory reaches nothing outside itself, so the second needs no adapter, but say which you chose in the PR.
- **The logged no-restart path.** On a Node without `process.execve` the loop runs, never restarts, and logs that once. The cost jurors measured on 2026-10-04 that it keeps the pid on v24.4.1 and is absent on v20.19.4. This machine's Node 24 (v24.21.0, checked 2026-10-06) has it.
- **The board's coverage block** (`packages/board/vitest.config.ts`, `coverage.include`) already holds `worker-loop.ts` at 100%. The restart's entry code joins that file or a new one added to the block. The domain's 100% gate covers `loop-restart.ts` and the new port's types.

### The decisions the plan settles — do not re-derive them

**`process.execve` is the only restart that keeps the pid.** The alternatives each break something. `spawn` plus `exit` gives the loop a new pid, so the wrapper's `wait` returns and reads the old process's exit as the loop's ending, and the manifest's `pid` names a dead process. A supervisor relaunch loses the free wait's start. `process.execve` exists from Node 22.15 and is experimental; do not wrap it in a fallback that spawns.

**Do not restart outside a free wait.** A prompt running, a checks wait and a usage-limit wait hold state the new process would have to rebuild. The plan restarts "while it waits for work" and nowhere else. The first check is the one exception, and it runs before there is any state.

**Do not restart on `HEAD` changing alone.** The four conditions are the whole rule. A main checkout that moved backwards, sits on another branch, or has a dirty bundle path triggers no restart, and each case is a test. Equality of content hash, not a version string or a timestamp, decides whether a bundle is newer: `main` rebuilds the bundle after every merge, and a rebuild with identical content must not restart a loop.

**The restart does not extend the wait.** A loop that restarted every time main moved and reset `clock.since` would never reach `Worker bound`. The test: start a free wait, restart partway, and assert the wait ends at the original start plus the bound.

**A broken bundle stops no loop.** The self-check runs before `reexec`, and a failure leaves the running process alone. Without it, one bad build on main kills every waiting agent on the machine at once, which is the failure the self-check exists to prevent.

**Restart scope is this repository's main checkout.** In an adopting repository a plugin upgrade installs a new versioned directory and leaves the old bundle unchanged, so the loop there runs old code until the supervisor relaunches it. Do not try to find a bundle outside the main checkout. The Changelog line already says "this repository's main checkout" for that reason.

**The entry spawns nothing, and the ratchet does not grow.** *One place reaches a process* (`ci.yml`, `allowed=28`) counts direct `spawn`/`execFile` sites outside `adapters/`. The self-check goes through `boundedRun`; the restart goes through `reexec`, whose adapter lives under `adapters/`. Do not raise `allowed`.

**Rules carried over unchanged.** Absent is not false: an `unaskable` or `failed` answer from `trees`, `refs` or `reexec` is not `no`, and a loop that cannot read the main checkout stays and logs, it does not restart. Read the exit code, not the emptiness: the self-check passes on exit 0 and nothing else. The loop carries no state between passes: the loaded commit and hash are re-derived from the pinned path and the running bundle, and the one field that crosses a restart is `PLOT_WAIT_STARTED`. A function you write is an arrow (`export const f = (…) => …`), in the board too. TSDoc says what an export does, how it fails and what it returns; the history goes into the commit message.

### Done when

The plan's slice 4 list is the specification: `restartAnswer` with failure 5 as its test case, the `reexec` port and adapter, the main-checkout bundle path and loaded commit through `trees`, the first check and the four later conditions, the `--self-check` load test through `boundedRun`, `reexec` with `PLOT_WAIT_STARTED` and the logged no-restart path, and the memory ceiling.

Assertions that exist because a naive implementation passes without them:

- **A restart keeps the pid and does not extend the free wait's `Worker bound`.** Start the entry as a process, let it enter a free wait, change the pinned bundle, and assert the pid is unchanged after the restart and the wait ends at its original bound. A test that restarts and resets the clock passes every other test.
- **A bundle that fails the self-check stops no loop.** Replace the pinned bundle with one that exits 1, and assert the loop is still waiting, the pid is unchanged, and the log names the failure once. Asserting only that no restart happened misses a loop that exited.
- **A checkout that moved backwards or is dirty triggers no restart.** One case each: `HEAD` does not contain the loaded commit; a bundle path is modified; the main checkout is on another branch. A rule that compared hashes alone restarts in all three.
- **A loop started from a claimed desk's bundle moves to the main checkout's bundle before its first pass, and restarts again after main moves.** The first-check path and the later-check path are different code, and one test passing does not prove the other.
- **No `process.execve`: the loop runs, never restarts, logs once.** Delete the function in the test (`process.execve = undefined`), and assert one log line over several passes, not one per pass.
- **An identical rebuild restarts nothing.** Write the same bytes to the pinned path with a newer mtime. A rule that compared mtimes restarts every loop on every merge.
- **The memory ceiling restarts only in a free wait.** At 301 MB during a prompt run or a checks wait, no restart happens.
- **`restartAnswer` is pure.** No port import, no clock, no `process` read: the readings carry everything. The domain's purity gate holds this, and the unit test calls it with plain objects.

Plus the repo gates. Before each push, run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints: the tests that name a changed file, `vitest related` and the typecheck of the board and the domain, the gate tests and the `scripts/check-*.sh` gates. The suites in the `CI suites` key, including the board's coverage run and `loop-js`, run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Check that the operator's board is not running before you run a board test: a local board test run takes the operator's board down. Run `pnpm board --status` first and stop if the board answers.

Shell gate: `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it must, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

Add a changeset with package `@plot-pm/board`, description first, and `plan: docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` in the trailing comment block. Copy the format from `.changeset/` and from `git log -p -- .changeset`. `./scripts/check-changeset-packages.sh` refuses a description under 20 characters and a `bumps:` or `plan:` block written first. Do not commit `plot-worker-loop.mjs` or any generated bundle: `scripts/check-no-bundle-diff.sh` refuses it, and `main` builds it after the merge. If you add a script, it needs a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the `infra/the-loop-restarts-on-new-code` line under `## Slices` in the plan, on `main`.
- The PR records a local run of the restart test against a real Node 24 process, with its command and output, because CI cannot prove the pid stays on this machine's Node.

### Scope guard

This branch owns:
- `packages/domain/src/rules/loop-restart.ts`, `packages/domain/src/ports/reexec.ts`, `packages/domain/src/adapters/process-exec.ts`, their exports from the domain's index, and their tests
- the restart code and the `--self-check` argument in `packages/board/src/server/entry/worker-loop.ts`, and its tests under `packages/board/test/unit/`
- a resident-size operation on the `processes` port and its adapter, if you choose that route
- the changeset

It does not touch:
- `packages/domain/src/workflows/agent-loop.ts`, `decision.ts`, `entry/loop-writes.ts` and the slice-1 and slice-2 ports, except to read them. If the restart needs a reading `AgentLoopReadings` does not carry, or a write `LoopWrite` does not name, report it with `PLOT-BLOCKED`: the restart is an entry decision from `restartAnswer`, not a `Write`
- `rules/desk-lifecycle.ts`, `rules/supervision.ts`, `workflows/supervise.ts` and `rules/checks-reading.ts`
- `plot-worker-loop.sh` (the launcher is slice 3's), `plot-build-monitor.sh`, `plot-agent-monitor.sh` and `plot-dispatch.sh`
- the default of `Worker loop` (slice 5) and the removal of the shell body (slice 6)
- the manifests, logs and findings files the board reads

Branches in flight, verified 2026-10-06 with `gh pr list --state open` and `git ls-remote --heads origin 'infra/*'`: no `infra/*` branch exists, and the only open PR is #1278 (`changeset-release/main`, changelog and version files only). #1285 and #1286, which the slice-3 brief named, are no longer open.

If you find something the plan did not anticipate, report it with `PLOT-BLOCKED` rather than improvising outside scope.
