# The board reads its own repository's PR store

> The board reads one PR store for the whole process, and that store belongs to the directory the process started in, not to the repository each fleet entry serves. A test that builds a fleet over a fixture repository therefore reads the machine's real open PRs, and `streaming-scan.test.ts` fails on a machine with open PRs.

## Status

- **State:** Released
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1112
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/the-streaming-test-owns-its-store`
- **Started:** 2026-10-02, Jan Wloka, `bug/a-fleet-entry-reads-its-repositorys-store`
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- The board reads and writes the PR store of the repository a fleet entry serves, not the store of the directory the board process started in. A fleet built over another repository no longer shows that directory's open PRs.
- `streaming-scan.test.ts` reads no PR store outside its fixture, so `test:board` gives the same answer on a developer machine as on CI, and `plot-resolve-artifact.sh` can push its repair.

<!-- Board impact: the board's PR store lookup changes from per-process to per-entry; no plan format, template, helper script or docs/plans layout change. -->

## Motivation

Measured 2026-10-01 on origin/main `0d2b4d5c`:

- **The store is chosen once, from the process's cwd.** `fleet.ts:2566` constructs `const prStore = prIndexFile();` at module level with no `cwd`. `prIndexFile` (`packages/domain/src/adapters/pr-index/pr-index-file.ts:69-94`) then takes `PLOT_PR_INDEX_HOME` when it is set, and otherwise runs `git rev-parse --git-common-dir` in `process.cwd()`. The fleet entry's `repoRoot` never reaches it. The three reads are `fleet.ts:2656` (`seedPrsFromStore`), `:2758` (`writePrStore`) and `:2866` (`refreshPrs`), and the one write is `:2775`.
- **The supervisor already does it right.** `registryd-main.ts:533` builds `prIndexFile({ cwd: repoRoot })`. The board is the only reader whose store does not follow its repository.
- **A fleet entry is keyed by its repository.** `fleet.ts:935` keys the cache by `repoRoot` and `scriptsDir`, so one process can hold entries for different repositories, and all of them share one store today.
- **The test reads the machine.** `streaming-scan.test.ts:325` builds a fleet with `repoRoot` set to a fresh `git init` directory (`:50-80`), and the vitest worker's cwd is `packages/board`, whose common git dir is the operator's checkout. On 2026-09-30 (#1112) the test failed on `d1c36337` with the three PRs open in this repository at that moment as extra rows. Reproduced 2026-10-01: `PLOT_PR_INDEX_HOME` set to a store holding one OPEN row for `bug/from-the-machine`, then `npx vitest run test/unit/streaming-scan.test.ts` in `packages/board`: 1 failed, 17 passed, and the failure shows `+ "bug/from-the-machine"`. Without the variable the test passes today, because this checkout's store (`.git/.plot/state/index/github.json`, v2, 1000 rows) holds no OPEN row at the moment.
- **`owned-run.sh` hides it under `pnpm run test:board`, and only there.** Commit 95724923 (2026-09-30 20:19, after the #1112 measurement) makes `test:board` set `PLOT_PR_INDEX_HOME` to `$root/pr-index` (`scripts/owned-run.sh:230`). A direct `vitest run` still reads the operator's store, and under `owned-run.sh` every test file of one run shares the one `$root/pr-index` directory, so a file that writes a fixture store there can change what `streaming-scan.test.ts` reads, depending on order. `pr-author.test.mjs` and `unit/pr-store.test.ts` set the variable themselves.

## Design

### Approach

**No domain rule changes.** No decision moves: which store a fleet reads is adapter wiring, and `prIndexFile` already takes `cwd`. No new script.

**Slice 1: the test owns its store.** `fakeScan` (`streaming-scan.test.ts:50`) creates a `pr-index` directory inside its fixture, and the file sets `PLOT_PR_INDEX_HOME` to it for each case with `vi.stubEnv`, restored in `afterEach`. The test then reads an empty store whatever the machine or the run holds. This slice is test-only and does not wait for slice 2.

**Slice 2: a fleet entry reads its repository's store.** The module-level `prStore` is replaced by a store per `repoRoot`: `prStoreFor(repoRoot)` returns `prIndexFile({ cwd: repoRoot })`, held in a `Map` keyed by `repoRoot`, so the `--git-common-dir` lookup still runs once per repository and not once per refresh (the reason `fleet.ts:2558-2565` gives for the module level). `seedPrsFromStore`, `writePrStore` and the read in `refreshPrs` take the entry's `repoRoot` (or the store) as a parameter. `PLOT_PR_INDEX_HOME` keeps priority over `cwd`, because `prIndexFile` checks it first, so every test that moves the store keeps working. The comment at `:2556-2565` is rewritten to say the store follows the entry's repository.

**One writer stays one writer.** The board remains the only process that folds the store (*A Decision Reads The Index* in `CLAUDE.md`). Slice 2 changes which file the board writes for a given repository, not how many processes write it. For a board started from its repository root, which is how `plot-boardctl.sh --start` and `pnpm board` start it, the file is the same one as today.

### What this does NOT do

- It does not change `prIndexFile`, `PrIndexStore` or the store format.
- It does not change `owned-run.sh`. Its shared `$root/pr-index` stays the default for a run, and slice 1 is what makes this one file independent of it.
- It does not change `plot-resolve-artifact.sh`. The script's gate stays `pnpm run test:board` green; the issue is that the gate answered for the machine.

### Open Points

- [ ] Other board unit tests build a fleet with a fixture `repoRoot` and no `PLOT_PR_INDEX_HOME` of their own. Slice 2 makes all of them read their fixture's store; slice 1 fixes only the one file #1112 names. A sweep for `buildFleet(` in `packages/board/test/` with a fixture `repoRoot` is part of slice 2's review.

## Slices

### The streaming test owns its store (Branch: bug/the-streaming-test-owns-its-store, PR: #1211) <!-- builds: a fixture-local PR store for streaming-scan.test.ts -->

`fakeScan` creates `<fixture>/pr-index`, and each case stubs `PLOT_PR_INDEX_HOME` to it with `vi.stubEnv`, restored in `afterEach`. Test-only; no changeset. Answers #1112's test half.

### A fleet entry reads its repository's store (Branch: bug/a-fleet-entry-reads-its-repositorys-store, PR: #1216) <!-- builds: prStoreFor, a per-repository PR store lookup in fleet.ts -->

`prStoreFor(repoRoot)` replaces the module-level `prStore` at `fleet.ts:2566`; the reads at `:2656`, `:2758` and `:2866` and the write at `:2775` use the entry's store; the comment at `:2556-2565` is rewritten; the two unit tests in Done when; an `@plot-pm/board` patch changeset.

## Done when

- Slice 1: `PLOT_PR_INDEX_HOME=<a store holding one OPEN row> npx vitest run test/unit/streaming-scan.test.ts` in `packages/board` passes. On origin/main today it fails at `:325` with the extra row (measured above).
- Slice 2: a new unit test builds a fleet over a fixture repository whose `.git/.plot/state/index/github.json` holds one OPEN row, with `PLOT_PR_INDEX_HOME` removed through `vi.stubEnv`, and asserts that the fleet's PR map holds that row. On origin/main today it fails, because the fleet reads the store of `packages/board`'s common git dir instead. A second case asserts that `PLOT_PR_INDEX_HOME` still takes priority over the fixture's store.
- Both: `pnpm run test:board` and `pnpm run typecheck` pass.

## Notes

#1112 found the defect through `plot-resolve-artifact.sh`: four artifact repairs (#1105, #1106, #1109, #1110) were abandoned with *tests-failed* and repaired by hand. Planned 2026-10-01; the reproduction with `PLOT_PR_INDEX_HOME` is this plan's own.
