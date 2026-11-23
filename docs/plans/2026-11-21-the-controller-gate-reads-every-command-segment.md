# The controller gate reads every command segment

> The controller gate reads a loop body, a process read, a program's own text and a `git -C` read the same way it reads a bare segment, so three forms that run a gated script stop passing and one read stops being refused.

## Status

- **State:** Delivered
- **Type:** bug
- **Issue:** #3145, #3146, #3165
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3610 merged
- **Started:** 2026-11-21, Jan Wloka, `bug/the-controller-gate-reads-a-loop-body-as-a-segment`
- **Started:** 2026-11-23, Jan Wloka, `bug/a-reserved-word-hides-no-program`
- **Delivered:** 2026-11-23

## Changelog

- The controller gate refuses `git diff --ext-diff` (and every other `git` run option) inside a `for` loop body, as it already refuses it outside one.
- The controller gate refuses an assignment that only looks like a process read, such as `while X=pgrep plot-approve.mjs x`, because bash runs the word after it.
- The controller gate refuses a gated script named inside the text of a program that runs its argument text (`awk`, `python`, `node`, `perl`, `ruby`, `sh -c`, `bash -c`, `zsh -c`, `eval`), such as `awk 'BEGIN{system("plot-approve.sh x")}'` or `python3 -c 'import os; os.system("plot-approve.sh x")'`. A `gh` comment, a `gh api` body, `echo` and `printf` that cite a gated script as `path:line` or in backticks still pass.
- The controller gate passes a read-only `git -C <dir> grep|diff|show|log` that names a gated script, as it already passes the same read without `-C`.
- The controller gate, the merge-pin check and the CI-suite check read the program after a shell reserved word (`do`, `then`, `else`, `if`, `while`, `until`, `!`, `{`, `(`, `time`), so `for i in 1; do curl -X POST …/api/release; done` and `if true; then gh pr merge 12; fi` stop passing. This also closes the HTTP form of #3165, `while X=ps curl -X POST …/api/release`.
- The controller gate passes a read after a reserved word, such as `if [ -f skills/plot/scripts/plot-deliver.sh ]; then echo yes; fi`.

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

Slice 1 changes the domain rule `packages/domain/src/rules/ci-suite.ts`. Slice 2 changes it and the two domain rules that hold a copy of its keyword set, `main-checkout-write.ts` and `poll-refusal.ts`. The gate (`packages/board/src/server/entry/gate.ts:981`) and `plot-controller-gate.sh` call it and do not change. The functions stay arrows, and TSDoc states behaviour only.

**Slice 1, one segment reading for the loop body, the process read, program text and `git -C`:**

- **The loop body asks `isReadSegment`.** `withoutDataLists` replaces `body.every(isReader)` with `body.every(isReadSegment)` (`ci-suite.ts:177`). The `git` option guard, the assignment and `env` guard and the substitution guard then hold in a loop body as at top level. The separate `body.some(hasSubstitution)` test becomes redundant and is removed.
- **A process read starts with a plain program word.** `isProcessRead` refuses where the word after the optional `while` or `until` has a `value` of `null` (it runs code) or contains `=` (`ci-suite.ts:96-99`).
- **Program text splits only for a program that runs its argument text.** `gluedScript` (`ci-suite.ts:443`) keeps its `[;&|]` split for every non-read segment. Where the segment's program is one of `RUNS_TEXT`, it also splits a word on every character outside `[A-Za-z0-9_./*?[\]-]` and tries `scriptNamed` on each piece. `RUNS_TEXT` is a new exported set in `ci-suite.ts`: `awk`, `gawk`, `mawk`, `python`, `python3` (and `python3.<n>`), `node`, `perl`, `ruby`, `eval`, and `sh`, `bash`, `zsh` and `dash` where a `-c` follows. The program is read with `programWords`, so `X=1 python3 -c …` is covered. `gh`, `echo`, `printf` and every other program keep today's split. The reason is measured: a split at every non-path character for every program, run as a pure function on `origin/main` `6362b9d43`, changes these commands from `null` to a refusal, and none of them runs a gated script: `gh pr comment 12 --body 'see skills/plot/scripts/plot-deliver.sh:120 for the guard'`, ``gh issue comment 3145 --body 'The fix is in `plot-deliver.sh` now'``, ``gh api repos/o/r/issues -f body='`plot-approve.mjs` refuses'``, `gh issue create --title x --body "plot-approve.sh:42 refuses"`, `printf '%s\n' plot-deliver.sh:12` and `echo plot-deliver.sh:12`. `withoutMessageSinks` (`controller-gate.ts:196-205`) blanks only a `git commit` message and a receipt reason, so a `gh` body reaches `controllerInvocation` unblanked. The narrow split keeps all of these at `null`. An interpreter that only reads a gated file, such as `node -e "require('fs').readFileSync('skills/plot/scripts/plot-deliver.sh','utf8')"`, answers `'deliver'` after this slice. That is accepted: the gate cannot tell a read from a run inside an interpreter's text.
- **`git -C <dir>` and `--no-pager` precede the subcommand.** A new arrow `gitSubcommand(program)` skips each `-C <dir>` pair and each `--no-pager` after `git` and returns the next word. `isReader` uses it in place of the second program word (`ci-suite.ts:109-112`). `gitSubcommand` does not skip `-c`, and it is narrower than the two option sets that exist, `GIT_VALUE_OPTIONS`/`GIT_FLAG_OPTIONS` (`controller-gate.ts:43-48`) and `GLOBAL_VALUE_OPTIONS` (`main-checkout-write.ts:65`), on purpose: the builder must not reuse either. `-c <key>=<value>` can set `diff.external` or `core.pager`, which runs a program, so a segment with `-c`, `--git-dir`, `--work-tree` or any other global option stays a run. `GIT_RUN_OPTIONS` still applies to every word of the segment.
- **The merge-path test reads an unquoted form.** It asks `unpinnedMerges('while pgrep -f plot-host.sh pr-merge; do sleep 1; done')`. That answers `[]` on `origin/main`, and `['plot-host']` when `isProcessRead` is removed from `isReader` (measured by the testability juror). The builder runs that mutation once and records the result in the PR.
- **Tests,** in `packages/domain/test/ci-suite.test.ts`. *Red* means the row fails on `origin/main` and passes after the slice. *Guard* means it passes on both and stops an over-wide fix.
  - the `#1341` "answers %s" table (`:341`) gains, all red: `for f in plot-deliver.sh; do git diff --ext-diff -- $f; done` → `'deliver'`, `for f in plot-deliver.sh; do git log --textconv -- $f; done` → `'deliver'`, `for f in plot-deliver.sh; do X=1 cat $f; done` → `'deliver'`;
  - the `#2530` "stays a run" table (`:434`) gains `while X=pgrep plot-approve.mjs x; do break; done` → `'approve'` (red), `for f in plot-approve.mjs; do X=pgrep $f x; done` → `'approve'` (red) and `while $(echo pgrep) plot-approve.mjs x; do break; done` → `'approve'` (guard);
  - a new table "a gated name inside program text is a run": `awk 'BEGIN{system("plot-approve.sh x")}'` → `'approve'` (red), `python3 -c 'import os; os.system("plot-approve.sh x")'` → `'approve'` (red), `node -e 'require("child_process").execSync("plot-deliver.sh x")'` → `'deliver'` (red), `node -e "require('fs').readFileSync('skills/plot/scripts/plot-deliver.sh','utf8')"` → `'deliver'` (red, the accepted cost above), and `bash -c "plot-deliver.sh x"` → `'deliver'` (guard);
  - a new table "a citation in a message is not a run", all guard and all `null`: `gh pr comment 12 --body 'see skills/plot/scripts/plot-deliver.sh:120 for the guard'`, ``gh issue comment 3145 --body 'The fix is in `plot-deliver.sh` now'``, ``gh api repos/o/r/issues -f body='`plot-approve.mjs` refuses'``, `printf '%s\n' plot-deliver.sh:12`, `echo plot-deliver.sh:12` and `grep -n 'system("plot-approve.sh x")' README.md`;
  - the "a read or mention returns null" table (`:57`) gains, all red: `git -C . grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh`, `git -C /tmp/x diff -- plot-deliver.sh`, `git -C . log --oneline -- skills/plot/scripts/plot-deliver.sh | head` and `git --no-pager log -1 -- plot-approve.sh`;
  - the `#2706` "a git option that runs or writes is still a run" table (`:114`) gains, all guard: `git -C . diff --ext-diff -- plot-deliver.sh` → `'deliver'`, `git -c diff.external=x diff -- plot-deliver.sh` → `'deliver'` and `git -C . -c core.pager=cat log -- plot-deliver.sh` → `'deliver'`;
  - the merge-path test as above (guard, with the mutation recorded).
- **One end-to-end row** in `test/reconcile/controller-gate.test.mjs`, both red: the `git -C . grep` read above exits 0 through the hook, and `for f in <D>; do git diff --ext-diff -- $f; done` exits 2.

**Slice 2, the program after a reserved word:**

- **One exported keyword set.** `ci-suite.ts` exports `LEADING_KEYWORDS`: `!`, `{`, `(`, `do`, `then`, `else`, `elif`, `if`, `while`, `until` and `time`. `programWords` skips any run of them before the assignment loop, skips `-p` after `time`, drops a `(` glued to the first word, and drops a `)` glued to the segment's last word (`ci-suite.ts:191-205`). The last strip is what makes `(curl -X POST …/api/release)` read the route: `routeIn` accepts only the end of the word, `/`, `?` or `#` after it (`ci-suite.ts:527-535`).
- **The two copies of the set go.** `main-checkout-write.ts:155-170` holds `LEADING_KEYWORDS` (without `then`, `else` and `(`) and `withoutLeadingKeywords`, used as `programWords(withoutLeadingKeywords(…))` at `:186` and `:508`. After this slice `programWords` does the same skip, so both call sites call `programWords` alone and the local set and arrow are removed. `poll-refusal.ts:39` holds a third set (without `time`) and applies it at `:89`; it imports the shared set instead.
- **The assignment test in `isReadSegment` counts assignments, not words.** `isReadSegment` compares `programWords(words).length` with `words.length` to detect an assignment or `env` prefix (`ci-suite.ts:472-473`). With keywords skipped, that test would read `do cat x` as prefixed. A new arrow `commandWords(words)` returns the words after the leading keywords. `isReader` and `isReadSegment` read their program from it, and the prefix test compares `programWords(words)` against `commandWords(words)`.
- **A process read keeps its own `while`/`until` reading.** `isReader` passes the segment's original words to `isProcessRead`, not `commandWords`, and `isProcessRead` keeps stepping over one `while` or `until` and nothing else. So the pinned row `ci-suite.test.ts:437`, `until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done` → `'deliver'`, keeps its answer, and the decision at `docs/plans/2026-11-04-controller-gate-refuses-read-only-commands.md:79` ("Only a leading `while` or `until` is admitted … `until ! pgrep …` stays refused") stands. Had `isProcessRead` read through `commandWords`, both that row and `if pgrep -f plot-deliver.mjs; then :; fi` would change from `'deliver'` to `null` (measured by the estate juror).
- **The callers that gain the reading.** `httpRouteAction` (`ci-suite.ts:667`), `mergeCall` (`controller-gate.ts:249`), `ciSuiteRefusal` (`ci-suite.ts:223`), `programIndex` (`controller-gate.ts:80`), `cdOf` (`main-checkout-write.ts:141`) and `subAndArgsOf` (`main-checkout-write.ts:186`) all call `programWords` and need no change of their own. `programIndex` then finds the commit message of `do git commit -m "…"`, and `cdOf` reads `then cd x`.
- **Tests.** *Red* and *guard* mean the same as in slice 1.
  - `packages/domain/test/ci-suite.test.ts`, a new table "a reserved word does not hide the program", all red, each `'release'` from `controllerInvocation` and from `controllerHttpAction`: `for i in 1; do curl -X POST http://localhost:4000/api/release; done`, `while curl -X POST …/api/release; do break; done`, `if curl -X POST …/api/release; then :; fi`, `! curl -X POST …/api/release`, `(curl -X POST …/api/release)`, `time curl -X POST …/api/release` and the #3165 form `while X=ps curl -X POST http://localhost:4000/api/release; do break; done`;
  - the same file, reads that become `null`, all red: `if true; then cat plot-deliver.sh; fi`, `while true; do cat plot-deliver.sh; done`, `{ cat plot-deliver.sh; }`, `if [ -f skills/plot/scripts/plot-deliver.sh ]; then echo yes; fi` and `if git -C . grep -q x -- plot-dispatch.sh; then :; fi`;
  - the same file, process reads that stay runs, both guard: the pinned row `:437` → `'deliver'`, and `if pgrep -f plot-deliver.mjs; then :; fi` → `'deliver'`;
  - the same file, `ciSuiteRefusal`, all red: `for i in 1; do pnpm run test:e2e; done`, `if true; then pnpm run test:e2e; fi`, `! pnpm run test:e2e` and `time pnpm run test:e2e` each refuse the suite;
  - `packages/domain/test/controller-gate.test.ts`: `unpinnedMerges` answers `['gh']` for `if true; then gh pr merge 12; fi`, `for i in 1; do gh pr merge 12; done` and `! gh pr merge 12` (red), and `[]` for `for i in 1; do gh pr merge 12 --match-head-commit abc; done` (guard); `withoutMessageSinks` blanks the message of `for i in 1; do git commit -m "plot-deliver.sh"; done` (red);
  - `packages/domain/test/main-checkout-write.test.ts`: `if true; then cd <dir>; fi; git commit -m x` reads `<dir>` as a bare `cd <dir>` does (red, `then` is not in the local set today); every existing row keeps its answer;
  - `packages/domain/test/poll-refusal.test.ts`: `time gh run watch` refuses as `gh run watch` does (red, `time` is not in the local set today); every existing row keeps its answer;
  - every other existing row in `ci-suite.test.ts` and `controller-gate.test.ts` keeps its answer.

A changeset `'plot': patch` names the plan; neither slice bumps a skill.

### Open Questions

- [x] Keep slice 2 in this plan? — Yes (coordinator decision after panel round 1, 2026-11-21).
- [x] Keep `time` and the glued `(` in the keyword set? — Yes, both (coordinator decision after panel round 1, 2026-11-21). A glued `)` on the last word is stripped as well.

## Slices

### Segment

- `bug/the-controller-gate-reads-a-loop-body-as-a-segment` — the loop body asks `isReadSegment`, `isProcessRead` refuses an assignment or a code-running word, `gluedScript` splits program text for the `RUNS_TEXT` programs only, `gitSubcommand` skips `-C <dir>` and `--no-pager` and not `-c`, the merge-path test reads an unquoted form, and the red and guard rows above <!-- builds: gitSubcommand, the git subcommand past -C and --no-pager --> → #3627

### Reserved word

- `bug/a-reserved-word-hides-no-program` — one exported `LEADING_KEYWORDS` set that `programWords` skips with a glued `(` and `)`, `commandWords` for the assignment test, `isProcessRead` kept on `while`/`until`, the copies in `main-checkout-write.ts` and `poll-refusal.ts` folded in, and the HTTP, merge, CI-suite, read and poll rows above <!-- builds: LEADING_KEYWORDS, one shared set of shell keywords before a program --> <!-- waits: bug/the-controller-gate-reads-a-loop-body-as-a-segment --> → #3680

## Notes

- Created 2026-11-21 from the triage of #3145. #3146 and #3165 are closed as `not_planned` with the comment "Merged into #3145" (2026-11-05); #3145's body holds their findings, so this plan names all three.
- Slice 2 waits on slice 1 because both edit `isReader` and `isReadSegment` in `ci-suite.ts`; run in parallel they would conflict on the same lines.
- The triage brief guessed that the quoted pattern text (`--restart` beside a gated name) caused the `git grep` refusal. Measured on `b21961602`, it does not: `git grep -n "A branch dispatch (--restart <branch>) starts a worker on any command." origin/main -- skills/plot/scripts/plot-dispatch.sh` answers `null` with and without `| head`, `2>&1` or a `cd … &&` before it, and only the `git -C <dir>` form answers `'dispatch'`. The quoted word reads as `(--restart`, so `actionFor` (`ci-suite.ts:493-500`) answers `'dispatch'` and not `'restart'`.
- `sed`, `rg` and `awk` with a script operand stay reads that are refused, as #2706 decided (`docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:67`) and `ci-suite.test.ts:302-306` pins. Slice 1 reverses the next decision in that list, `:68`, which kept `git -C . grep` and every git global option before the subcommand refused; it reverses it for `-C <dir>` and `--no-pager` only.
- `plot-deliverable-search.sh`, 2026-11-21, searched for the new names: `gitSubcommand` and `commandWords` found nothing of that name (the hits were the word "subcommand" in `design.ts`, `verify.ts` and `prompt.ts`); `gluedScript` and `isProcessRead` found only their own definitions in `ci-suite.ts`. The search for names missed the behaviour: the estate juror found two keyword sets (`main-checkout-write.ts:155`, `poll-refusal.ts:39`) and two git-option sets (`controller-gate.ts:43-48`, `main-checkout-write.ts:65`). Slice 2 folds both keyword sets into one; slice 1 keeps `gitSubcommand` apart from the option sets for the `-c` reason above.
- Follow-up, out of scope: `controllerInvocation` throws `Invalid regular expression` from `globToRegExp` (`ci-suite.ts:405-411`, reached from `scriptNamed` at `:454`) for `jq '.["plot-deliver.sh"]' f.json`, today and after both slices (testability juror). How the gate answers a throw decides whether it refuses or allows; it needs its own issue.
- Panel round 1, 2026-11-21: estate, testability and user jurors all answered `amend`; verdicts are in `.plot/panels/2026-11-21-the-controller-gate-reads-every-command-segment/`. Each finding is answered above: the pinned `until ! pgrep` row and the 2026-11-04 decision (slice 2, process-read bullet); the keyword and git-option copies (slice 2 copies bullet, `gitSubcommand` bullet); the false "no new refusal class" claim, replaced by the measured list and the `RUNS_TEXT` bound; the #3165 `while X=ps curl` row; the trailing `)`; red and guard marks on every new row; the `:66`/`:67` citation, measured here as `:67`/`:68`; the `if [ -f … ]` row; and the `jq` throw as a follow-up. The references the jurors checked on `origin/main` `6362b9d43` hold, and the rule and test files carry no change since `b21961602`.
- Measurements ran the rule as a pure function: `ci-suite.ts`, `shell-reading.ts` and `controller-gate.ts` copied from `b21961602` and imported by Node 26 with type stripping. No hook read the probe commands, and no gated script ran.
