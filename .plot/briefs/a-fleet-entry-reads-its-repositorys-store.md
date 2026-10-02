## Implementation brief — the-board-reads-its-own-repositorys-pr-store (wave 2: A fleet entry reads its repository's store)

- **Plan (canonical):** `docs/plans/2026-10-01-the-board-reads-its-own-repositorys-pr-store.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-fleet-entry-reads-its-repositorys-store` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave waits on wave 1, `bug/the-streaming-test-owns-its-store` (PR #1211), and the fleet rule opens it after that PR merges. Nothing waits on this wave.

### What to build

The board reads and writes one PR store for the whole process, and the store belongs to the directory the process started in. `packages/board/src/server/fleet.ts:2708` holds `const prStore = prIndexFile();` at module level with no `cwd`. The adapter (`packages/domain/src/adapters/pr-index/pr-index-file.ts:69-94`) takes `PLOT_PR_INDEX_HOME` when it is set and otherwise runs `git rev-parse --git-common-dir` in `process.cwd()`. The fleet entry's `repoRoot` never reaches it, although `fleet.ts:1021` keys the cache by `repoRoot` and `scriptsDir`, so one process can hold entries for different repositories that all share one store. The supervisor already does it right: `registryd-main.ts:533` builds `prIndexFile({ cwd: repoRoot })`.

The change replaces the module-level `prStore` with `prStoreFor(repoRoot)`, which returns `prIndexFile({ cwd: repoRoot })` held in a `Map` keyed by `repoRoot`. The plan's line numbers have drifted since 2026-10-01; on `origin/main` at `b1a41e60e` the sites are:

- `:2708` the module-level `prStore` and the comment above it (`:2698-2707`), which is rewritten to say the store follows the entry's repository.
- `:2798` the read in `seedPrsFromStore(entry, connector)`, called at `:2994`.
- `:2900` the read and `:2917` the write in `writePrStore(connector, rows, kind)`, called at `:3181`.
- `:3008` the read in `refreshPrs`.

`refreshPrs(opts, entry)` already holds `opts.repoRoot`, so each of the three helpers takes the store (or the `repoRoot`) as a parameter and `refreshPrs` resolves it once per pass with `prStoreFor(opts.repoRoot)`. Grep `prStore` again before editing: a sibling may have added a fifth site. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**A `Map` keyed by `repoRoot`, not a store built per refresh.** The adapter caches its `--git-common-dir` answer per instance (`pr-index-file.ts:73-90`), and the reason the module-level constant exists (`fleet.ts:2706-2707`) is that a per-refresh instance would fork `git` once a minute. A `Map` keeps one fork per repository per process. Do not key it by `scriptsDir`: the store follows the repository and `scriptsDir` does not name one.

**`PLOT_PR_INDEX_HOME` keeps priority, and no code is added for that.** `dirOf` checks `options.home`, then `env[PR_INDEX_HOME_ENV]`, and only then the git lookup, on every call (`pr-index-file.ts:79-81`). Passing `cwd` therefore changes nothing for a process or test that sets the variable, which is why `owned-run.sh:230` and `pr-store.test.ts`, which set it, keep working. Do not read the variable in `fleet.ts`.

**No change to `prIndexFile`, `PrIndexStore`, the store format, `owned-run.sh` or `plot-resolve-artifact.sh`.** Which store a fleet reads is adapter wiring and no rule moves. A board started from its repository root, which is how `plot-boardctl.sh --start` and `pnpm board` start it, resolves to the same file as today.

**One writer stays one writer.** The board is the only process that folds the store (*A Decision Reads The Index*, `CLAUDE.md`). This wave changes which file the board writes for a given repository and adds no second writer. Do not make a shell script or the supervisor write it.

**Rules carried over from the estate.** The index never says no: an unreadable store reads as `null` and `prWindowFor` asks for everything, and `writePrStore` merges into an unreadable store as if it were absent. Keep both paths exactly as they are, including the `catch` arms. A refresh writes after it completes, so a test that asserts on the store file awaits the refresh first.

**Style.** Write `prStoreFor` and any helper as arrows. The surrounding `async function` declarations are not yours to convert, and `refreshPrs` stays a declaration.

### Done when

The plan's `## Done when` list is the specification:

- A new unit test builds a fleet over a fixture repository whose `.git/.plot/state/index/github.json` holds one OPEN row, with `PLOT_PR_INDEX_HOME` removed through `vi.stubEnv('PLOT_PR_INDEX_HOME', '')`, and asserts that the fleet's PR map holds that row. On `origin/main` it fails, because the fleet reads the store of `packages/board`'s common git dir.
- A second case asserts that `PLOT_PR_INDEX_HOME` still takes priority over the fixture's store.

Assertions that exist because a naive change would pass without them:

- **Run the first case against `origin/main`'s `fleet.ts` before the change.** It must fail. A pass means the fixture row never reached the fleet and the test proves nothing. Write the store through `prIndexFile({ cwd: fixture })` or copy `pr-store.test.ts`'s fixture helper, so the file is in the v2 format the board reads; a hand-written v1 file reads as unreadable and gives a false pass.
- **Assert two repositories in one process.** Build two fleets with two fixture `repoRoot` values holding different OPEN rows and assert each map holds only its own. A module-level store keyed wrongly passes the single-repository case and fails this one.
- **Sweep the open point.** Run `grep -rn "buildFleet(" packages/board/test` and check each file that sets a fixture `repoRoot` without `PLOT_PR_INDEX_HOME`: after this change it reads its fixture's store, and one that relied on the machine's store fails. The sweep is this wave's review, not wave 1's. Fix such a test by giving it an empty fixture store, not by editing `fleet.ts`.

Plus: add a changeset `.changeset/<slug>.md` with `'@plot-pm/board': patch` frontmatter and no `bumps:` block, the description first and at least 20 characters; copy the format from a neighbouring file. Run `nvm use` first (pnpm crashes on Node 26). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `fleet.ts` is source, not the generated artifact; if `plot-local-checks.mjs` names `board-server.mjs`, rebuild with `pnpm build:board` and commit the result.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/fleet.ts`, one new unit test under `packages/board/test/unit/`, any fixture-only edits the sweep requires in other board tests, and its changeset. Wave 1 owns `packages/board/test/unit/streaming-scan.test.ts` and is merged before this branch starts, so no collision is expected. `fleet.ts` is large and shared: other open branches may touch it, so rebase before the first push and keep the diff to the four sites above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
