# Panel: controller gate refuses read-only commands

Subject: `docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md` (plan PR #3135, issue #2530)
Convened: 2026-11-04, round 1, against `origin/main` at `fbf670eaf`
Lenses: layering, safety, testability, seams. Four jurors, one rubric, persona varied only.

## Outcome: unanimous amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read (source traced, nothing executed) |
| safety | **amend** | executed (`plot-gate.mjs controller` on the main checkout, 13 commands) |
| testability | **amend** | read (source and tests traced) |
| seams | **amend** | read (source, tests, 13 open PRs) |

Every verdict file names a committed position. The gate refused none.

## Where all four agree

1. **The plan missed the live residual.** The issue's comment of 2026-11-04 reports `while pgrep -f "plot-approve.mjs <slug>" >/dev/null; do …; done` refused. The draft built `sed` and `rg` and did not reach it. All four traced the same cause: the segment's program is `while`, and `wordBasename` (`ci-suite.ts:299`) strips the leading `"` so `scriptNamed` (`ci-suite.ts:340`) reads a run.
2. **The draft put its guards on one of two reader paths.** The draft placed the guards beside the `git` run-option guard in `isReadSegment` (`ci-suite.ts:359-366`). `withoutDataLists` (`ci-suite.ts:111`) calls `isReader`, so a loop body would bypass them.
3. **Changelog, Approach and slice disagreed on `awk`.**
4. **`READERS` sits at `ci-suite.ts:66`, not `:60`.**

## Disagreements

- **Reverse #2706 on `sed`/`rg`/`awk`, or not.** Seams alone named that the draft reversed a unanimous #2706 panel decision (`2026-10-27-the-controller-gate-reads-a-grep.md:65-67`, `:119`) and that tests pin it (`ci-suite.test.ts:287-291`, `controller-gate.test.mjs:841-847`). Layering and safety proposed exact `sed` and `awk` guards, which assumes the reversal. Testability asked for the `ci-suite.test.ts:287` row to be inverted. Resolved by the caller: `sed`, `rg` and `awk` stay refused.
- **How to read quoted words.** Safety asked for `readShell` word values. Testability proposed a print-only regex over whitespace-split words for `sed`. Layering proposed a regex over the script word. Resolved by the caller: `readShell`; a `null` reading is a run.
- **Whether the reproduction needs a hook session.** Testability and seams said the pure-function test at `ci-suite.test.ts:287` already answers it. Layering asked for a recorded main-checkout hook run. Safety ran one. Resolved: pure-function rows plus one `controller-gate.test.mjs` hook case through `repo()`, which is a main checkout.
- **`ps aux | grep <bundle>`.** Safety measured exit 0 (allowed today). Testability said "already null". The caller listed it as a fails-before case. The moderator re-measured `controllerInvocation` on `fbf670eaf`: `null`, because the pipe makes `grep <bundle>` its own segment and `grep` is a reader. The plan keeps it as a row that holds before and after, and uses `ps -o pid= -C plot-deliver.mjs` (`'deliver'` today) as the `ps` fails-before row.

## Shared blind spots

- **A pipe from a process read into `xargs kill`.** No juror noticed that segment-level admission of `pgrep` turns `pgrep -f plot-approve.mjs | xargs kill` from `'approve'` into `null`, because `xargs kill` names no script. The caller required it refused. The plan adds a pipeline rule (Approach step 3).
- **A quoted pattern that holds `|`.** `pgrep -f "plot-approve.mjs|plot-deliver.mjs"` is cut by the segment split before quotes are read. It stays refused; the plan pins it.
- **A gated name inside program text runs today.** Safety measured `awk 'BEGIN{system("plot-approve.sh x")}'` allowed, as a side note. The moderator measured `python3 -c '…os.system("plot-approve.sh x")'` allowed too. No juror filed it. Filed as #3145.
- **The `git` guard misses a loop body today.** Safety and seams named it as inherited. Filed as #3146.

## What each juror ran versus read

- layering: ran `gh issue view`, `git show` and `git grep` over `origin/main`. Executed no gate or test.
- safety: ran `plot-gate.mjs controller` on the main checkout for 13 commands with hook JSON on stdin, `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` unset. The loop-body bypasses are read from source.
- testability: ran `git fetch`, `git show`, `git grep`, `gh issue view`, `gh pr view`. Executed no test or gate.
- seams: ran `git show`, `git grep`, `gh issue view`, `gh pr list`, `gh pr view --json files` for 13 open PRs. Executed no test or gate.
- moderator: ran `controllerInvocation` and `unpinnedMerges` from the worktree's TypeScript source (Node 26 type stripping, a `.js`→`.ts` resolve hook) for 17 commands. Executed no test suite.

## Decisions

| Decision | By |
|---|---|
| Scope narrows to process-table reads (`pgrep` without a signal form, `ps`, `lsof`), also as a `while`/`until` condition | caller |
| `sed`, `rg`, `awk` stay refused; #2706's tests stay unchanged | caller |
| The predicate sits in `isReader`; quoted words go through `readShell`; a `null` reading is a run | caller |
| Tests are pure-function rows plus one main-checkout hook case; a linked-worktree probe proves nothing | caller |
| Open questions closed; `RIPGREP_CONFIG_PATH` moot | caller |
| `ps aux \| grep <bundle>` is a holds row, not a fails-before row; `ps -o pid= -C plot-deliver.mjs` is the `ps` fails-before row | moderator (measured) |
| A process read piped into a non-read stays a run (pipeline rule) | moderator (fail-closed, to keep `\| xargs kill` refused) |
| Only `while` and `until` are admitted before the program; `!`, `if` and `elif` stay runs | moderator (fail-closed; only the measured form) |
| `pgrep` signal forms: `--signal`, `-<digits>`, `-` plus two or more capitals | moderator (fail-closed) |
| Slice branch renamed to `feature/controller-gate-reads-a-process-lookup`; the H1 drops "(grep, sed)" | moderator (the old name described work the plan no longer builds; the branch did not exist on `origin`) |
| `find`, `jq`, `column` do not join | moderator (no report names them) |
