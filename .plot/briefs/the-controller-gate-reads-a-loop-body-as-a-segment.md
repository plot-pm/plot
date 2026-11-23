## Implementation brief — the-controller-gate-reads-every-command-segment (wave 1: Segment)

- **Plan (canonical):** docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3610 merged
- **Branch:** `bug/the-controller-gate-reads-a-loop-body-as-a-segment` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan Review: `pr`

Slice 1 of 2. Slice 2, `bug/a-reserved-word-hides-no-program`, waits on this branch because both edit `isReader` and `isReadSegment` in `ci-suite.ts`. Do not start any slice 2 work here.

### What to build

The controller gate answers one segment two ways, and four defects follow. All answers below are pure-function calls to `controllerInvocation` on `origin/main` `b21961602`: `for f in plot-deliver.sh; do git diff --ext-diff -- $f; done` answers `null` while the same `git diff --ext-diff -- plot-deliver.sh` answers `'deliver'`; `while X=pgrep plot-approve.mjs x; do break; done` answers `null` though bash assigns `X` and runs the word after it; `awk 'BEGIN{system("plot-approve.sh x")}'` and `python3 -c 'import os; os.system("plot-approve.sh x")'` answer `null`; and the read `git -C . grep -n "…--restart <branch>)…" origin/main -- skills/plot/scripts/plot-dispatch.sh` answers `'dispatch'` and is refused. Issues #3145, #3146 and #3165.

The change is in `packages/domain/src/rules/ci-suite.ts` only, plus tests. The gate (`packages/board/src/server/entry/gate.ts`) and `plot-controller-gate.sh` call it and do not change.

1. **The loop body asks `isReadSegment`.** In `withoutDataLists` (`ci-suite.ts:177`) replace `body.every(isReader)` with `body.every(isReadSegment)`. The `git` option guard (`GIT_RUN_OPTIONS`), the assignment and `env` guard and the substitution guard then hold in a loop body as at top level. The `body.some(hasSubstitution)` test becomes redundant: remove it.
2. **`isProcessRead` refuses an assignment and a code-running word.** Where the word after the optional `while`/`until` has a `value` of `null` or contains `=`, return `false` (`ci-suite.ts:96-99`). `wordBasename` drops a leading `NAME=`, which is why `X=pgrep` read as `pgrep`.
3. **`gluedScript` splits program text for `RUNS_TEXT` programs only.** Add an exported `RUNS_TEXT` set: `awk`, `gawk`, `mawk`, `python`, `python3` (and `python3.<n>`), `node`, `perl`, `ruby`, `eval`, and `sh`, `bash`, `zsh`, `dash` where a `-c` follows. Read the program with `programWords`, so `X=1 python3 -c …` is covered. For these, split a word on every character outside `[A-Za-z0-9_./*?[\]-]` and try `scriptNamed` on each piece. Every other program keeps today's `[;&|]` split.
4. **`gitSubcommand(program)`, a new arrow.** It skips each `-C <dir>` pair and each `--no-pager` after `git` and returns the next word. `isReader` uses it in place of the second program word (`ci-suite.ts:109-112`). `GIT_RUN_OPTIONS` still applies to every word of the segment.
5. **The merge-path test reads an unquoted form.** "the merge path sees the same answer" (`packages/domain/test/ci-suite.test.ts:452-454`) quotes `"gh pr merge 12"`, and `mergesBy` empties quoted text first, so it passes with `isProcessRead` removed. Use `unpinnedMerges('while pgrep -f plot-host.sh pr-merge; do sleep 1; done')`.

Functions are arrows, and TSDoc states behaviour only. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**`RUNS_TEXT` is narrow on purpose; do not split program text for every program.** Measured as a pure function on `origin/main` `6362b9d43`: splitting at every non-path character for every program turns these from `null` into a refusal, and none runs a gated script: `gh pr comment 12 --body 'see skills/plot/scripts/plot-deliver.sh:120 for the guard'`, ``gh issue comment 3145 --body 'The fix is in `plot-deliver.sh` now'``, ``gh api repos/o/r/issues -f body='`plot-approve.mjs` refuses'``, `gh issue create --title x --body "plot-approve.sh:42 refuses"`, `printf '%s\n' plot-deliver.sh:12`, `echo plot-deliver.sh:12`. `withoutMessageSinks` (`controller-gate.ts:196-205`) blanks only a `git commit` message and a receipt reason, so a `gh` body reaches `controllerInvocation` unblanked. The six citation rows must stay `null`.

**An interpreter that only reads a gated file is accepted as a run.** `node -e "require('fs').readFileSync('skills/plot/scripts/plot-deliver.sh','utf8')"` answers `'deliver'` after this slice. The gate cannot tell a read from a run inside an interpreter's text. Do not add a guard for it.

**`gitSubcommand` skips `-C <dir>` and `--no-pager` and nothing else, and must not reuse an existing option set.** `-c <key>=<value>` can set `diff.external` or `core.pager`, which runs a program, so a segment with `-c`, `--git-dir`, `--work-tree` or any other global option stays a run. `GIT_VALUE_OPTIONS`/`GIT_FLAG_OPTIONS` (`controller-gate.ts:43-48`) and `GLOBAL_VALUE_OPTIONS` (`main-checkout-write.ts:65`) are wider and answer a different question. Reusing either reopens the `-c` hole. `git -C . -c core.pager=cat log -- plot-deliver.sh` must stay `'deliver'`.

**The quoted pattern did not cause the `git grep` refusal.** The same `git grep` without `-C` answers `null`. The cause is that `isReader` takes `-C` as the subcommand, which is not in `GIT_READERS`. Do not change quote handling.

**`sed`, `rg` and `awk` with a script operand stay refused as reads.** #2706 decided it and `ci-suite.test.ts:302-306` pins it. This slice reverses only the `git -C . grep` line of that decision (`docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:68`), for `-C <dir>` and `--no-pager` only.

**A process read keeps its `while`/`until` reading.** The 2026-11-04 decision stands: only a leading `while` or `until` is admitted. Do not widen `isProcessRead`.

**Rules carried over:** absent is not false; a doubtful shape stays a read only where #2706 said so; every new refusal needs a red row, and every over-wide-fix risk needs a guard row.

### Done when

The plan's slice 1 test list is the specification. *Red* means the row fails on `origin/main` and passes after the slice; *guard* means it passes on both and stops an over-wide fix. The assertions that exist because a naive implementation would pass without them:

- **The six citation rows → `null`** (`gh pr comment`, `gh issue comment`, `gh api -f body=`, `printf`, `echo`, `grep -n 'system("plot-approve.sh x")' README.md`) catch a `gluedScript` that splits for every program.
- **`git -c diff.external=x diff -- plot-deliver.sh`, `git -C . -c core.pager=cat log -- plot-deliver.sh` and `git -C . diff --ext-diff -- plot-deliver.sh` → `'deliver'`** catch a `gitSubcommand` that skips `-c` or drops the `GIT_RUN_OPTIONS` check.
- **`while $(echo pgrep) plot-approve.mjs x; do break; done` → `'approve'`** (guard) catches an `isProcessRead` fix that tests `=` only and not `value === null`.
- **`bash -c "plot-deliver.sh x"` → `'deliver'`** (guard) catches a `RUNS_TEXT` that drops `-c` handling.
- **The three loop-body rows** (`git diff --ext-diff`, `git log --textconv`, `X=1 cat $f` inside `for f in plot-deliver.sh`) catch a fix that guards `git` only and not the assignment prefix.
- **The merge-path test:** run the mutation once (remove `isProcessRead` from `isReader`), confirm it answers `['plot-host']`, and record the result in the PR body.
- **One end-to-end row** in `test/reconcile/controller-gate.test.mjs`: the `git -C . grep` read exits 0 through the hook, and `for f in <D>; do git diff --ext-diff -- $f; done` exits 2.
- Every other existing row in `ci-suite.test.ts` keeps its answer.

Plus: add a changeset for package `plot`, patch, description first and the `bumps:` block last, with `plan: docs/plans/2026-11-21-the-controller-gate-reads-every-command-segment.md` inside the block; the description comes from the plan's Changelog entries for this slice. Neither slice bumps a skill. The PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`); `test/reconcile/controller-gate.test.mjs` reads the `plot-gate.mjs` bundle, so run `pnpm build:board` only to test locally, then restore the generated paths before you push.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Use Node 26 (`nvm use`).

The change is domain TypeScript and tests only and adds no shell, so `scripts/check-shell-lines.sh` is untouched. If the slice ever touches a `.sh` file, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to the branch line under `## Slices` in the plan. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ci-suite.ts`, `packages/domain/test/ci-suite.test.ts`, `test/reconcile/controller-gate.test.mjs` and one changeset.

In flight: `bug/a-reserved-word-hides-no-program` (slice 2, same plan) owns `LEADING_KEYWORDS`, `commandWords`, the `programWords` change, `main-checkout-write.ts`, `poll-refusal.ts` and `controller-gate.ts`. It is not started and waits on this branch. Do not touch those files or add a keyword set here. `ci-suite.ts`, `controller-gate.ts`, `main-checkout-write.ts`, `poll-refusal.ts` and `ci-suite.test.ts` have no commit since `b21961602`, so the plan's line numbers hold.

Out of scope, filed as a follow-up in the plan: `controllerInvocation` throws `Invalid regular expression` from `globToRegExp` for `jq '.["plot-deliver.sh"]' f.json`. Do not fix it here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
