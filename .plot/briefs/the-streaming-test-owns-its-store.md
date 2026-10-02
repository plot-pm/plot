## Implementation brief — the-board-reads-its-own-repositorys-pr-store (wave 1: The streaming test owns its store)

- **Plan (canonical):** `docs/plans/2026-10-01-the-board-reads-its-own-repositorys-pr-store.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-streaming-test-owns-its-store` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave does not wait on wave 2, `bug/a-fleet-entry-reads-its-repositorys-store`. Wave 2 builds on this one: the fleet rule opens it after this PR merges.

### What to build

`packages/board/test/unit/streaming-scan.test.ts` fails on a machine whose repository has an open PR. Every case builds a fleet with `repoRoot` set to a fresh `git init` directory (`fakeScan`, `:50-80`), but `fleet.ts:2567` (`packages/board/src/server/fleet.ts`) holds one module-level `prStore = prIndexFile()` with no `cwd`. That store resolves `git rev-parse --git-common-dir` in the vitest worker's cwd, which is `packages/board`, so the fleet reads the operator's real store. On 2026-09-30 (#1112) the test failed with three extra rows from three open PRs. Reproduced 2026-10-01: `PLOT_PR_INDEX_HOME` set to a store with one OPEN row for `bug/from-the-machine`, then `npx vitest run test/unit/streaming-scan.test.ts` in `packages/board` gives 1 failed, 17 passed, and the failure shows `+ "bug/from-the-machine"`.

The change is test-only:

1. `fakeScan` creates `<fixture>/pr-index` next to the other fixture files and calls `vi.stubEnv('PLOT_PR_INDEX_HOME', <that directory>)`.
2. The file's existing `afterEach` (`:83`) calls `vi.unstubAllEnvs()`.
3. `vi` joins the `vitest` import on line 1.

Every `buildFleet(` call in the file (`:203` to `:328`) takes its `repoRoot` from `fakeScan`, so the one stub in `fakeScan` covers all 18 cases. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The test stubs the environment variable; it does not change `fleet.ts`.** The obvious fix is to make the fleet read its own repository's store. That is wave 2, and it is a separate branch because it changes production code, needs a changeset and has its own tests. This wave fixes the one test that #1112 names and does not wait for wave 2.

**Use `vi.stubEnv`, not a direct `process.env` assignment.** `prIndexFile`'s `dirOf` reads `env[PR_INDEX_HOME_ENV]` on every call, before its cached `git` answer (`pr-index-file.ts:79-81`), and `env` defaults to the live `process.env`. A stub set after the module loaded therefore takes effect, which is why a `vi.stubEnv` inside `fakeScan` works although `prStore` is built at import time. A direct assignment would leak into every later file in the same vitest worker.

**`vi.unstubAllEnvs()` is required in `afterEach`.** `packages/board/vitest.config.ts` sets no `unstubEnvs`, and no other board test uses `vi.stubEnv` (grep returns nothing), so nothing restores the variable for you. Without the restore, case N+1 reads case N's deleted directory. `rmTree` removes the fixture in the same `afterEach`, so order the calls so the stub is released before or with the removal.

**The directory lives inside the fixture, not in `os.tmpdir()` directly.** `scripts/owned-run.sh:230` points `PLOT_PR_INDEX_HOME` at one shared `$root/pr-index` for the whole `test:board` run. Every file shares it, so a file that writes a fixture store there changes what this file reads, depending on order. A per-fixture directory makes this file independent of that, and `temps` cleans it with the fixture. Do not touch `owned-run.sh`.

**An empty directory is a valid empty store.** The store adapter answers *no store* for a missing file, and the fleet then asks the host or reads nothing. Do not seed a file. The `pr-index` directory can stay empty or be created lazily by the adapter; creating it in `fakeScan` is what keeps the path inside the fixture.

**Rules carried over from the estate:**

- Absent is not false. An empty store means *nothing recorded*, and the test must not assert on a PR map being empty as proof the fleet found no PRs.
- A fleet refresh writes after `complete` (see `landed`, `:127`). The PR store write at `fleet.ts:2776` now lands in the fixture's `pr-index`, where before this change it could land in the operator's real store. Keep `await landed(scripts)` in every case that already has it so `rmTree` does not race that write.
- Write any helper you add as an arrow function. The `fakeScan` declaration is not yours to convert.

### Done when

The plan's `## Done when` list is the specification: `PLOT_PR_INDEX_HOME=<a store holding one OPEN row> npx vitest run test/unit/streaming-scan.test.ts` in `packages/board` passes. On `origin/main` it fails at `:325` with the extra row.

Assertions and checks that exist because a naive change would pass without them:

- **Run the reproduction both ways.** Build a store with one OPEN row, for example by copying `.git/.plot/state/index/github.json` and setting one row's state to OPEN, or by writing it through `prIndexFile`. Run the test with `PLOT_PR_INDEX_HOME` pointing at it before your change (must fail) and after (must pass). A pass before the change means the fixture row did not reach the fleet, and the check proves nothing.
- **Run the file twice in one vitest invocation order**, for example `npx vitest run test/unit/streaming-scan.test.ts test/unit/pr-store.test.ts`. A missing `unstubAllEnvs` shows up as the second file reading a deleted directory.
- **Run it without `PLOT_PR_INDEX_HOME` set.** It must still pass, as it does on `main` today.

Plus: `pnpm run test:board` and `pnpm run typecheck` pass. Run `nvm use` first: pnpm crashes on Node 26. No changeset, because the change is test-only. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/test/unit/streaming-scan.test.ts` and nothing else. In flight: `bug/a-fleet-entry-reads-its-repositorys-store` (wave 2) owns `packages/board/src/server/fleet.ts` and a new unit test, and does not start before this PR merges, so no collision is expected. Do not edit `fleet.ts`, `prIndexFile`, `owned-run.sh` or `plot-resolve-artifact.sh`. The plan's open point about other tests that build a fleet with a fixture `repoRoot` belongs to wave 2's review.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
