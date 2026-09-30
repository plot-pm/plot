## Implementation brief — every-temp-directory-has-an-owner (slice 3 of 3: Layer 5, every state file declares its bound)

- **Plan (canonical):** `docs/plans/2026-09-30-every-temp-directory-has-an-owner.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session (over a round-3 `amend`; the round-3 fixes to the ledger reader and the lock breaker are folded into the plan and no juror has measured them, so each Done-when fixture is their first proof)
- **Branch:** `bug/every-state-file-declares-its-bound` (base: `main`, claimed at `2dba99ae`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session
- **Issue:** #1083

This slice sits in the first wave beside `bug/scripts-share-one-temp-helper` (#1102, draft, currently `CONFLICTING` with `main`) and waits for no slice. `bug/the-suites-own-their-temp-root` waits for #1102, and its inventory gate's manifest declares the bounds this slice makes true. The order of the two first-wave merges is not fixed; see the scope guard for the one file whose edit depends on it.

### What to build

Layer 5 of the plan, in three parts:

1. **Two-generation rotation of the budget ledger** in `skills/plot/scripts/plot-budget.sh` (`budget_append` at `:135`, `budget_rate_read` at `:224`) and in the domain adapter `packages/domain/src/adapters/budget/budget-file.ts`. The ledger becomes `budget.tsv`, `budget.tsv.1` and `budget.gen` in `$PLOT_BUDGET_HOME`, with a `budget.lock` directory, stale-lock recovery, and a `budget-lock-broken.tsv` record of each break.
2. **Process-owned log rotation** for `registryd` (`packages/board/src/server/entry/registryd-main.ts`) and the board. Each process opens its own log with `O_APPEND`, rotates at a size bound (default 10 MB) to `.1`..`.3`, deletes the fourth, and reopens. At start, each process truncates its inherited stdout and stderr when they pass the bound.
3. **The board-project cache move**: `plot-update-board.sh:66`'s `/tmp/plot-board-cache-*.json` fallback moves to `~/.plot/state/board-cache/`. The `$GIT_DIR` cache at `:64` stays.

The failures it fixes, measured 2026-09-30: `~/.plot/state/budget.tsv` held 46 MB, 828,680 lines over 27 days, and every GitHub call paid about 1.1 s to read it (`budget_rate github jwloka graphql` 1.11 s against 0.01 s over the last 2,000 lines). `registryd.log` reached 131 MB in 13 days and a person rotated it with `mv`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Rotation by rename, not the port's `truncate()`.** The write-aside-and-rename in `budget-file.ts:132` lost **59 of 600** concurrent appends in one 660 ms window: an append between the read and the rename is not in the kept set, and an `O_APPEND` descriptor on the old inode writes into the unlinked file. A rename loses nothing, because an append that races it lands in one of the two files and the reader reads both (11 of 11 trials, 600 of 600 visible). So `truncate()` leaves `ports/budget.ts:93` and the adapter, `truncationOwed()` and `PRUNE_THRESHOLD` leave `rules/budget-record.ts`, and `pruneOwed` leaves `SpendRate` and `AccountSpend` (`:305`, `:342`, `:374`, `:407-415`). Measured at dispatch: `pruneOwed` has no reader outside that file, and `truncate()`, `lines()`, `survivors()` and `budgetFile` have no production caller. `lines()` stays and reads both generations under the counter check.

**The appender never waits.** `plot-budget.sh` depends on `O_APPEND` atomicity below `PIPE_BUF` (512 on macOS). An appender that finds the lock held by a live owner appends and moves on. The lock is a `mkdir` directory holding pid and start time; do not use `flock`, which macOS does not ship.

**The age condition is re-read immediately before the `mv`, together with the rotator's own owner line.** This one check makes a second rotation within a generation impossible, whoever holds the lock. Round 3 forced a second rotation 0.4 s after the first and lost 3 of 600 lines in 5 of 5 trials. That is the discard the check exists to refuse.

**A breaker renames the lock and then compares owner lines.** Rename is atomic, so at most one process moves a given directory. On a match, it records the break once and repairs an odd `budget.gen`. On a mismatch, it has moved a fresh owner's live lock, so it records nothing and does not rotate; the fresh owner's pre-`mv` check then fails. Round 3 measured the unguarded version: two breakers both rotated, and 20 live-window lines read as 0.

**An odd `budget.gen` seen by any appender or reader triggers the stale-lock check.** A rotator killed after its `mv` leaves a young `budget.tsv`, so no rotation is due for 24 h. A trigger on a due rotation alone leaves the lock and the odd counter in place for that long.

**The reader reads current first, through one pipe.** Use `{ cat budget.tsv; cat budget.tsv.1; } 2>/dev/null | awk …`, and never pass a file name to `awk`. BSD awk 20200816 and gawk both exit 2 before `END` on a missing file, and `budget_rate_read`'s `|| echo '{"spent":0,…}'` fallback turns that into spent 0, which is the direction that grants headroom. Both files are missing in normal states. The reverse order (`.1` first) read `spent` 0 for the live generation in round 2. After three retries on a counter change, answer from the last read and add `"rotating":true`. That answer can only over-count.

**The braces around the first-line read matter.** `{ read …; } 2>/dev/null < budget.tsv` catches the redirection error after a rename, and a trailing `2>/dev/null` does not.

**The generation is 24 h and every window is at most 1 h.** `FALLBACK_WINDOW_MS` (`rules/budget-record.ts:23`) and `BUDGET_FALLBACK_WINDOW_MS` (`plot-budget.sh:210`) are both 1 h, and no connector declares a window. A contract test asserts that the generation length exceeds `FALLBACK_WINDOW_MS`, so a later longer window fails loudly and does not drop live lines.

**The first rotation keeps the 46 MB file for one generation.** Do not special-case it away: it holds the live window.

**The size bound is on bytes, not ticks or days.** Tick size ranged from 290 bytes to 10 KB with the estate.

**The writer rotates because only the opener can.** launchd opens `registryd.log` and `.err` (`com.plot-pm.registryd.plist:80-83`), `plot-boardctl.sh:423-425` opens `board.log` with `>>`, and a hand-started `nohup … >> registryd.log` loop also exists. A writer that inherited its descriptor follows the inode across a rename and never creates the new name, so external rotation (`newsyslog`, `logrotate`, `mv`) cannot work. Truncating the inherited stdout at start is safe only because every opener uses `O_APPEND` (`lsof +fg` showed `AP` on all four). Under a plain `>` writer, a truncate leaves a hole of NUL bytes (415 bytes measured).

**Carried rules.** Absent is not zero: a missing generation, a missing `budget.gen` (reads as 0) and a missing `.1` are normal states and answer their true count. Read the exit code, not emptiness. Delete only a path you hold by name: the lock break renames to a unique `budget.lock.broken.<pid>.<random>` and removes that exact path, never a glob. Tests set `PLOT_BUDGET_HOME` and `HOME` to a scratch directory. The suites currently write the operator's ledger (430 lines per `host.test.mjs` run), and this slice's tests must not add to it.

### Done when

The plan's `## Done when` list is the specification. These items belong to this slice: *no append is lost across a rotation*, *the reader tolerates a missing generation*, *a reader is exact across a rotation*, the two SIGKILL cases, *two concurrent breakers*, *a reader reads at most two generations*, and *registryd.log and board.log rotate at the bound and keep 3 files*. The inventory gate and its manifest belong to `bug/the-suites-own-their-temp-root`.

Assertions that a naive implementation passes without:

- **Force the rotation between the reader's two reads.** A reader that reads `.1` first passes every quiescent test and answers 0 for the live generation under a real race. The fixture must inject the rename at that exact point, for example through a hook or a stubbed `cat` that renames on its first call.
- **The second-rotation refusal.** Force a second rotation while the new `budget.tsv` is younger than 24 h, and assert that it is refused and all 600 lines stay readable. An implementation without the pre-`mv` re-check passes the one-rotation race.
- **Kill before `mv` and kill after `mv` are two tests.** Only the second one proves the odd-counter trigger, and only it fails an implementation that checks staleness on a due rotation alone.
- **Two breakers, one descheduled.** Stop one breaker between its inspection and its rename (a `SIGSTOP` or a fifo barrier) while the other breaks, locks and rotates. Assert one line in `budget-lock-broken.tsv` and no second rotation.
- **Missing files through the real fallback.** Run `budget_rate_read` itself, not a copy of its `awk`, against a ledger with no `.1` and a ledger with no `budget.tsv`. This proves the `|| echo spent 0` path is not reached.
- **The `read` field** equals the line count of `budget.tsv` plus `budget.tsv.1` after three rotations. This is the bound that replaced the 0.2 s timing claim, which measured machine load.
- **Log rotation under both writer shapes**: a unit-shaped redirect (`>>` inherited) and a hand start. With only one shape, the inherited-descriptor defect goes unseen.
- **The generation-length contract test** reads `FALLBACK_WINDOW_MS` from the domain and does not hardcode 1 h.

Plus the repo gates: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (which rebuilds `board-server.mjs` and `plot-registryd.mjs`; commit the rebuilt artifacts), and `pnpm run typecheck`. Do not run `test:e2e` locally. Domain code is arrow functions with factual TSDoc (see `CLAUDE.md`, *The Domain Package*). Add a changeset with the description first, a `plan:` line, and the `bumps:` block last. Update the `CLAUDE.md` text that describes the ledger or `plot-update-board.sh` where its behaviour changes. `plot-budget.sh`'s header changes from *"IT APPENDS AND READS, AND IT NEVER PRUNES"* to the plan's wording.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Never run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`, from a detached scratch worktree on `origin/main`, pushed with `skills/plot/scripts/plot-push-main.sh`.

### Scope guard

This branch owns: `skills/plot/scripts/plot-budget.sh`, `skills/plot/scripts/plot-update-board.sh`, `skills/plot/scripts/plot-boardctl.sh` (log open), `packages/domain/src/{ports/budget.ts,adapters/budget/,rules/budget-record.ts}` and their tests, the board's and registryd's log writers, and new contract tests (for example `test/reconcile/budget-rotation.test.mjs`).

Verified at dispatch against `origin/bug/scripts-share-one-temp-helper` (`d06d655c`). The plan says this slice touches none of that slice's files, which holds for the ledger and does not hold in three places:

- **`scripts/check-temp-paths.sh`** exists only on #1102. Its exception list names `plot-update-board.sh`'s `CACHE_FILE="/tmp/plot-board-cache-` line, and the gate **fails when an exception's line no longer matches**. If #1102 merges first, rebase and delete that exception entry in this branch. If this branch merges first, #1102 must delete it before it merges. Report which case applied.
- **`packages/board/src/server/entry/registryd-main.ts`** and its test: #1102 adds `--sweep-temp` (+42 lines). Registryd's log writer lands in the same file. Expect a textual conflict, and rebase onto whichever landed.
- **`skills/plot/units/com.plot-pm.registryd.plist`, `plot-registryd.service`, `README.md`**: #1102 adds `--sweep-temp` to `ProgramArguments`. If the log writer needs a path argument, it goes in the same array. Keep `StandardOutPath` and `StandardErrorPath`: they still catch output printed before the writer opens, and crash traces.
- `skills/plot/scripts/board/*.mjs` artifacts: rebuild them, and never hand-merge them (see `CLAUDE.md` › Testing).

`plot-host.sh` belongs to #1102, which changes 110 of its lines. This slice needs no change there, because `graphql_budget_spent` reaches the ledger through `budget_rate` in `plot-budget.sh`. If a change there becomes necessary, report it and do not make it.

`bug/the-suites-own-their-temp-root` has claimed its ref and has no commits yet. It will own `scripts/owned-run.sh` and the inventory manifest.

If you find something the plan did not anticipate, report it and do not improvise outside scope.
