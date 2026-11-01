## Implementation brief — the-board-starts-processes-on-the (wave 2: Held config)

- **Plan (canonical):** `docs/plans/2026-11-01-the-board-starts-processes-on-the.md` on `main`
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3018 merged
- **Branch:** `feature/the-board-holds-its-config` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`)

This slice does not wait on `feature/a-board-request-counts-its-processes`. The plan's last decision (changed 2026-11-01 by the operator) dispatches the held config beside the ratchet, because the board answered no request for over 90 s. `feature/the-board-reads-git-through-cached-refs` waits on the ratchet, not on this slice. Whichever of this slice and the ratchet lands second rebases and edits the ratchet list in its own diff.

### What to build

`GET /api/board` reads `## Plot Config` about 24 times per request through four routes, and each `plot-config.sh get` starts about five processes (`bash`, `grep -q`, `awk`, `grep -m1`, `sed`). Measured 2026-11-01: requests took 7.8 s to 61 s at load 6 to 9, with 0 % board CPU. Each start cost about 180 ms while `syspolicyd` ran hot. The board waits on starts, so the request time follows the start count. The four routes are `readConfigAsync` (`packages/fleet/src/shared/config-reader.ts`), `scriptsFor(opts).config` (`fleet.ts`), `planStoreFor(opts).config` (`server-info.ts`) and the synchronous `readConfig`. `CI` and `People` are held for the process life with no invalidation (`cachedCi`, `cachedPeople`, `server-info.ts`), including a failed read.

1. Add one adapter decorator over `Scripts.config` in `packages/domain/src/adapters/scripts/`, beside `scripts-shell.ts`. It holds `plot-config.sh` answers keyed by (stamp, `get` or `get-raw`, key, fallback). The stamp is the repository root plus, for each of `CLAUDE.md` and `AGENTS.md`, presence, `mtimeMs`, `size` and `ino`. Record absence as a fact. Stat both files on every read, never on a timer. A changed stamp clears the held answers. Never store the answer of a failed or timed-out read.
2. Build `config-reader.ts`'s reader with the decorator, so `readConfig`, `readConfigAsync`, `scriptsFor(opts).config` and fleetd's `walkOnce` share it.
3. Add an optional `config` field to `BuildBoardOptions` (`board.ts`). `planStoreFor(opts).config` and every board route read the same instance, and a test can inject a counting fake.
4. `cachedCi` and `cachedPeople` read through the adapter and stop holding a value for the process life. A failed read is asked again.
5. Edit the ratchet list: remove the `plot-config.sh` lines. If the ratchet slice has not landed yet, record the start list you find in the PR and tell the reviewer which slice lowers it.

### Settled decisions — do not re-derive them

- **`plot-config.sh` stays the one parser.** No TypeScript parser, so no duplicate and no corpus pair. The safety juror allowed a TypeScript parser with a corpus pair; the plan did not take it.
- **A stat on every read, not a timer.** A timer would show a config edit late. The stamp check costs two `stat` calls and no process.
- **The stamp holds `repoRoot`, `size` and `ino`, not only `mtimeMs`.** The cache `the-read-path-stops-spawning` removed (`board.ts:621-626`) wrapped the synchronous `readConfig`, which the hot path had stopped calling, so nothing read it. Its `configStamp` held `repoRoot` after two temp repositories with equal mtimes read each other's answers in CI on 2026-08-31. This adapter sits on the seam every route uses, and the read path now makes about 24 async reads per request.
- **A failed read is never held.** Absent is not false. A missing key answers the fallback and a failure answers the fallback, and neither may become a stored decision.
- **Write routes read through the same adapter.** It is stamp-checked, so a write route never acts on a stale value. Do not add a bypass.
- **No held payload.** The request reads held values keyed by inputs it checks, so the page carries no age. Do not hold a built board.
- **Do not touch `refresh` (`fleet.ts`).** The supervisor reading is not on the request path.

### Done when

The plan's `## Done when` rows tagged *Held config* are the specification. Domain rows run in `pnpm --filter @plot-pm/domain exec vitest run <file>` and board rows in `pnpm --filter @plot-pm/board exec vitest run --project parallel <file>`:

- A held config read starts nothing: two reads of one key make one inner call (`packages/domain/test/config-held.test.ts`).
- A config edit is seen on the next read: `fs.utimesSync` on `CLAUDE.md`, a same-size rewrite in the same mtime tick, and `CLAUDE.md` created where only `AGENTS.md` held the section each cost one more inner call.
- Two repositories never share an answer: two temp repos with equal mtimes and sizes make one inner call per repo.
- A failed config read is not held: the second read asks again and answers the success.
- `CI` and `People` follow the config: `serverInfo` twice with `CLAUDE.md` edited between, and a first read that failed at startup is re-asked (`board-request-starts.test.ts`).
- The warm list loses config: no `plot-config.sh` line remains.

The assertions a naive implementation passes without: the same-size rewrite in the same mtime tick catches a stamp of `mtimeMs` alone, and the two-repository row catches a stamp without `repoRoot`. Run each mutation once (drop `ino` and `size`, drop `repoRoot`), see the row fail, then restore.

Plus: add a changeset (`@plot-pm/board` patch, description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in `CI suites` run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not commit the rebuilt board artifact. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to pay.

New functions are arrow functions with factual TSDoc, and the decorator is domain code under the layering rule: it reaches the file system for config and no process. Add no `spawn` or `execFile` site outside `adapters/`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the decorator in `packages/domain/src/adapters/scripts/`, `packages/fleet/src/shared/config-reader.ts`, the config wiring in `board.ts` (`BuildBoardOptions.config`, `readConfig`, `readConfigAsync`, `scriptsFor`, `planStoreFor`), `server-info.ts` (`cachedCi`, `cachedPeople`), and the two test files above. In flight: `feature/a-board-request-counts-its-processes` (#3020) holds `boardAnswer`, the refresh-pause seam, `interrogate.ts` and the ratchet test, so rebase on it or on `origin/main` before review. `feature/the-last-scan-modes-run-the-walk` and `feature/the-scan-script-is-a-launcher` edit `refresh` and the fleetless scan in `fleet.ts`, and `fleet.ts` changed in 24 commits in one week. The git-read and parse slices of this plan hold the walk cache, and this slice adds none.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
