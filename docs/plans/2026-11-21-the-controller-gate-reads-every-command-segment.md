# The controller gate reads every command segment

> The controller gate reads a loop body, a process read, a program's own text and a `git -C` read the same way it reads a bare segment, so three forms that run a gated script stop passing and one read stops being refused.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3145, #3146, #3165
- **Review:** pr
- **Impl:** own branches

## Changelog

- The controller gate refuses `git diff --ext-diff` (and every other `git` run option) inside a `for` loop body, as it already refuses it outside one.
- The controller gate refuses an assignment that only looks like a process read, such as `while X=pgrep plot-approve.mjs x`, because bash runs the word after it.
- The controller gate refuses a gated script named inside another program's text, such as `awk 'BEGIN{system("plot-approve.sh x")}'` or `python3 -c 'import os; os.system("plot-approve.sh x")'`.
- The controller gate passes a read-only `git -C <dir> grep|diff|show|log` that names a gated script, as it already passes the same read without `-C`.
- The controller gate, the merge-pin check and the CI-suite check read the program after a shell reserved word (`do`, `then`, `else`, `if`, `while`, `until`, `!`, `{`, `(`, `time`), so `for i in 1; do curl -X POST …/api/release; done` and `if true; then gh pr merge 12; fi` stop passing.

<!-- Board impact: none. The change is in `packages/domain/src/rules/ci-suite.ts` and its tests; the gate reaches it through the `plot-gate.mjs` bundle, which `main` rebuilds after the merge. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

`controllerInvocation` (`packages/domain/src/rules/ci-suite.ts:300`) decides which gated action a command runs. All answers below are pure-function calls on `origin/main` `b21961602` (2026-11-21), made with no hook and no gated script run.

| Command | Answer today | Should be |
|---|---|---|
| `git diff --ext-diff -- plot-deliver.sh` | `'deliver'` | `'deliver'` |
| `for f in plot-deliver.sh; do git diff --ext-diff -- $f; done` | `null` | `'deliver'` |
| `while X=pgrep plot-approve.mjs x; do break; done` | `null` | `'approve'` |
| `for f in plot-approve.mjs; do X=pgrep $f x; done` | `null` | `'approve'` |
| `awk 'BEGIN{system("plot-approve.sh x")}'` | `null` | `'approve'` |
| `python3 -c 'import os; os.system("plot-approve.sh x")'` | `null` | `'approve'` |
| `git -C . grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh` | `'dispatch'` | `null` |
| `for i in 1; do curl -X POST http://localhost:4000/api/release; done` | `null` | `'release'` |
| `if true; then cat plot-deliver.sh; fi` | `'deliver'` | `null` |

The defects, one per row group:

- **The loop body skips the `git` option guard (#3146).** `withoutDataLists` empties a loop's word list when `body.every(isReader)` holds (`ci-suite.ts:177`). The `git` run-option guard (`GIT_RUN_OPTIONS`, `ci-suite.ts:462`) and the assignment-prefix guard sit in `isReadSegment` only (`ci-suite.ts:469-476`). So one segment gets two answers: a run at top level, a read in a loop body.
- **An assignment reads as a process read (#3165).** `isProcessRead` takes the word after an optional `while` or `until` and asks `PROCESS_READERS.has(wordBasename(...))` (`ci-suite.ts:99`). `wordBasename` drops a leading `NAME=` (`ci-suite.ts:395`), so `X=pgrep` reads as `pgrep`. Bash assigns `X` and runs the next word. In a loop body the same form also passes, because `withoutDataLists` calls `isReader` and not `isReadSegment`.
- **A gated name glued to program text matches nothing.** `scriptNamed` compares the whole basename (`ci-suite.ts:450-458`). `wordBasename` drops only a leading quote, `$`, `(` or backtick and trailing `)];,"'` (`ci-suite.ts:393-400`), so `'BEGIN{system("plot-approve.sh` keeps its program text. `gluedScript` splits a word only on `;`, `&` and `|` (`ci-suite.ts:443`). The released plan `docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md:80` left this case out of scope and filed it as #3145.
- **`git -C <dir>` hides the subcommand.** `isReader` takes the second program word as the `git` subcommand (`ci-suite.ts:109-112`). For `git -C . grep` that word is `-C`, which is not in `GIT_READERS`, so the segment is a run and `scriptNamed` finds `plot-dispatch.sh` in its pathspec. The triage on 2026-11-21 saw this read refused as a dispatch run. The cause is `-C`, not the quoted pattern: the same `git grep` without `-C`, with the same quoted `--restart <branch>)` text, answers `null`.
- **A reserved word hides the program.** `httpRouteAction` reads `programWords(words)[0]` as the HTTP program (`ci-suite.ts:667-668`), `mergeCall` reads it as `gh` (`packages/domain/src/rules/controller-gate.ts:249-254`), and `ciSuiteRefusal` matches suite words from it (`ci-suite.ts:223`). `programWords` skips assignments and `env` only (`ci-suite.ts:191-205`). After a split on `;`, a loop body segment starts with `do` and an `if` branch with `then`, so the program is never read. Measured on `b21961602`: `controllerHttpAction` answers `null` for `while curl -X POST …/api/release; do break; done`, `if curl -X POST …/api/release; then :; fi`, `! curl -X POST …/api/release`, `(curl -X POST …/api/release)` and `time curl -X POST …/api/release`; `unpinnedMerges` answers `[]` for `if true; then gh pr merge 12; fi`, `for i in 1; do gh pr merge 12; done` and `! gh pr merge 12`; `ciSuiteRefusal` answers `null` for `for i in 1; do pnpm run test:e2e; done`. The same blind spot refuses reads: `if true; then cat plot-deliver.sh; fi`, `while true; do cat plot-deliver.sh; done` and `{ cat plot-deliver.sh; }` answer `'deliver'`. No issue names this group; the triage for this plan found it.
- **One test proves nothing (#3165, LOW).** "the merge path sees the same answer" (`packages/domain/test/ci-suite.test.ts:452-454`) quotes `"gh pr merge 12"`, and `mergesBy` empties quoted text first (`controller-gate.ts:273`), so it passes with `isProcessRead` removed.

## Design

### Approach

All changes are in the domain rule `packages/domain/src/rules/ci-suite.ts`. The gate (`packages/board/src/server/entry/gate.ts:981`) and `plot-controller-gate.sh` call it and do not change. The functions stay arrows, and TSDoc states behaviour only.

**Slice 1, one segment reading for the loop body, the process read, program text and `git -C`:**

- **The loop body asks `isReadSegment`.** `withoutDataLists` replaces `body.every(isReader)` with `body.every(isReadSegment)` (`ci-suite.ts:177`). The `git` option guard, the assignment and `env` guard and the substitution guard then hold in a loop body as at top level, and the separate `body.some(hasSubstitution)` test becomes redundant and goes.
- **A process read starts with a plain program word.** `isProcessRead` refuses where the word after the optional `while` or `until` has a `value` of `null` (it runs code) or contains `=` (`ci-suite.ts:96-99`).
- **Program text splits at every non-path character.** `gluedScript` splits a word on every character outside `[A-Za-z0-9_./*?[\]-]` and not only on `[;&|]` (`ci-suite.ts:443`), and tries `scriptNamed` on each piece. It runs only on a segment that is not a read (`ci-suite.ts:301-306`), so `grep 'system("plot-approve.sh")' x` stays a read. `echo "run plot-approve.sh"` answers `'approve'` today already (the trailing quote is dropped), so the wider split adds no new refusal class for a non-read segment.
- **`git -C <dir>` and `--no-pager` precede the subcommand.** A new arrow `gitSubcommand(program)` skips each `-C <dir>` pair and each `--no-pager` after `git` and returns the next word. `isReader` uses it in place of the second program word (`ci-suite.ts:109-112`). Every other global option keeps the segment a run: `-c <key>=<value>` can set `diff.external` or `core.pager`, which runs a program, so it stays outside the reader set. `GIT_RUN_OPTIONS` still applies to every word of the segment.
- **The merge-path test reads an unquoted form.** It asks `unpinnedMerges('while pgrep -f plot-host.sh pr-merge; do sleep 1; done')`, which answers `[]` on `b21961602` and answers `['plot-host']` when `isProcessRead` is removed from `isReader`; the builder runs that mutation once and records the result in the PR.
- **Tests,** in `packages/domain/test/ci-suite.test.ts`:
  - the `#1341` "answers %s" table gains `for f in plot-deliver.sh; do git diff --ext-diff -- $f; done` → `'deliver'`, `for f in plot-deliver.sh; do git log --textconv -- $f; done` → `'deliver'` and `for f in plot-deliver.sh; do X=1 cat $f; done` → `'deliver'`; its "answers null" table keeps every row;
  - the `#2530` "stays a run" table gains `while X=pgrep plot-approve.mjs x; do break; done` → `'approve'`, `for f in plot-approve.mjs; do X=pgrep $f x; done` → `'approve'` and `while $(echo pgrep) plot-approve.mjs x; do break; done` → `'approve'`; its "is not a run" table keeps every row;
  - a new table "a gated name inside program text is a run": `awk 'BEGIN{system("plot-approve.sh x")}'` → `'approve'`, `python3 -c 'import os; os.system("plot-approve.sh x")'` → `'approve'`, `node -e 'require("child_process").execSync("plot-deliver.sh x")'` → `'deliver'`, and the existing `bash -c "plot-deliver.sh x"` row unchanged;
  - a read row that stays `null`: `grep -n 'system("plot-approve.sh x")' README.md`;
  - the "a read or mention returns null" table gains `git -C . grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh`, `git -C /tmp/x diff -- plot-deliver.sh` and `git --no-pager log -1 -- plot-approve.sh`;
  - the `#2706` "a git option that runs or writes is still a run" table gains `git -C . diff --ext-diff -- plot-deliver.sh` → `'deliver'` and `git -c diff.external=x diff -- plot-deliver.sh` → `'deliver'`;
  - the merge-path test as above.
- **One end-to-end row** in `test/reconcile/controller-gate.test.mjs`: the `git -C . grep` read above exits 0 through the hook, and `for f in <D>; do git diff --ext-diff -- $f; done` exits 2.

**Slice 2, the program after a reserved word:**

- **`programWords` skips a leading reserved word.** Before the assignment loop, `programWords` skips any run of `!`, `{`, `do`, `then`, `else`, `elif`, `if`, `while`, `until` and `time` (with its `-p`), and drops a leading `(` glued to the first word (`ci-suite.ts:191-205`). A shell reads none of these as a program; each is a keyword or a grouping before the command.
- **The assignment test in `isReadSegment` counts assignments, not words.** `isReadSegment` compares `programWords(words).length` with `words.length` to detect an assignment or `env` prefix (`ci-suite.ts:472-473`). With reserved words skipped, that test would read `do cat x` as prefixed. A new arrow `commandWords(words)` returns the words after the reserved words; `isReader`, `isReadSegment` and `isProcessRead` read from it, and the prefix test compares `programWords` against `commandWords`. `isProcessRead`'s own `while`/`until` step then folds into `commandWords`.
- **The callers that gain the reading.** `httpRouteAction` (`ci-suite.ts:667`), `mergeCall` (`controller-gate.ts:249`), `ciSuiteRefusal` (`ci-suite.ts:223`), `programIndex` (`controller-gate.ts:80`) and `cdOf` (`packages/domain/src/rules/main-checkout-write.ts:141`) all call `programWords` and need no change of their own. `programIndex` then finds the commit message of `do git commit -m "…"`, and `cdOf` reads `then cd x`.
- **Tests:**
  - `packages/domain/test/ci-suite.test.ts`, a new table "a reserved word does not hide the program": `for i in 1; do curl -X POST http://localhost:4000/api/release; done`, `while curl -X POST …/api/release; do break; done`, `if curl -X POST …/api/release; then :; fi`, `! curl -X POST …/api/release`, `(curl -X POST …/api/release)` and `time curl -X POST …/api/release` each answer `'release'` from `controllerInvocation` and from `controllerHttpAction`;
  - the same file, reads that become `null`: `if true; then cat plot-deliver.sh; fi`, `while true; do cat plot-deliver.sh; done`, `{ cat plot-deliver.sh; }` and `if git -C . grep -q x -- plot-dispatch.sh; then :; fi`;
  - the same file, `ciSuiteRefusal`: `for i in 1; do pnpm run test:e2e; done`, `if true; then pnpm run test:e2e; fi`, `! pnpm run test:e2e` and `time pnpm run test:e2e` each refuse the suite;
  - `packages/domain/test/controller-gate.test.ts`: `unpinnedMerges` answers `['gh']` for `if true; then gh pr merge 12; fi`, `for i in 1; do gh pr merge 12; done` and `! gh pr merge 12`, and `[]` for `for i in 1; do gh pr merge 12 --match-head-commit abc; done`; `withoutMessageSinks` blanks the message of `for i in 1; do git commit -m "plot-deliver.sh"; done`;
  - `packages/domain/test/main-checkout-write.test.ts`: one row where `if true; then cd <dir>; fi` moves the read directory as a bare `cd <dir>` does;
  - every existing row in the four files keeps its answer.

A changeset `'plot': patch` names the plan; neither slice bumps a skill.

### Open Questions

- [ ] Slice 2 answers no filed issue: the triage for this plan measured it. Keep it in this plan, or file it as its own issue and plan?
- [ ] `time` and a glued `(` are the two prefixes slice 2 adds beyond the shell's reserved words. Keep both, or keep the reserved words only?

## Slices

### Segment

- `bug/the-controller-gate-reads-a-loop-body-as-a-segment` — the loop body asks `isReadSegment`, `isProcessRead` refuses an assignment or a code-running word, `gluedScript` splits at every non-path character, `gitSubcommand` skips `-C <dir>` and `--no-pager`, the merge-path test reads an unquoted form, and the table rows above <!-- builds: gitSubcommand, the git subcommand past -C and --no-pager -->

### Reserved word

- `bug/a-reserved-word-hides-no-program` — `programWords` skips a leading reserved word, `commandWords` keeps the assignment test in `isReadSegment`, and the HTTP, merge, CI-suite and read rows above <!-- builds: commandWords, a simple command's words past its reserved words --> <!-- waits: bug/the-controller-gate-reads-a-loop-body-as-a-segment -->

## Notes

- Created 2026-11-21 from the triage of #3145. #3146 and #3165 are closed as `not_planned` with the comment "Merged into #3145" (2026-11-05); #3145's body holds their findings, so this plan names all three.
- Slice 2 waits on slice 1 because both edit `isReader` and `isReadSegment` in `ci-suite.ts`; run in parallel they would conflict on the same lines.
- The triage brief guessed that the quoted pattern text (`--restart` beside a gated name) caused the `git grep` refusal. Measured on `b21961602`, it does not: `git grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh` answers `null` with and without `| head`, `2>&1` or a `cd … &&` before it, and only the `git -C <dir>` form answers `'dispatch'`. The quoted word reads as `(--restart`, so `actionFor` (`ci-suite.ts:493-500`) answers `'dispatch'` and not `'restart'`.
- `sed`, `rg` and `awk` with a script operand stay runs, as #2706 decided (`docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:65-67`) and `ci-suite.test.ts:302-306` pins. Slice 1 changes only what a non-read segment's words match.
- `plot-deliverable-search.sh`, 2026-11-21: `gitSubcommand` and `commandWords` found nothing of that name (the hits were the word "subcommand" in `design.ts`, `verify.ts` and `prompt.ts`); `gluedScript` and `isProcessRead` found only their own definitions in `ci-suite.ts`.
- Measurements ran the rule as a pure function: `ci-suite.ts`, `shell-reading.ts` and `controller-gate.ts` copied from `b21961602` and imported by Node 26 with type stripping. No hook read the probe commands, and no gated script ran.
