# Controller gate refuses read-only commands that name a gated script

> The controller gate refuses a process-table read (`pgrep`, `ps`, `lsof`) whose argument names a gated script or bundle, although the command runs no script.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #2530
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3135 merged

## Changelog

- The controller gate reads a `pgrep`, `ps` or `lsof` command as a read when its argument names a gated script or bundle, also as the condition of a `while` or `until` loop. `pkill`, `kill`, a pipe into `xargs` or `sh`, and any command that runs the named script still refuse.

<!-- Board impact: none. The change is one predicate in `packages/domain/src/rules/ci-suite.ts` and its tests. No plan format, template, layout, `.tsx` or board type changes. The gate bundle under `skills/plot/scripts/board/` is generated output that `main` rebuilds after the merge; the PR carries no bundle. -->

## Motivation

Issue #2530 (2026-10-23, Plot 2.28.0) reported `grep` and `sed` reads of `plot-approve.sh` refused. #2706 (`the-controller-gate-reads-a-grep`, Released 2.29.0) answered the `grep` half: `isReader` over `READERS` (`packages/domain/src/rules/ci-suite.ts:66-68`) admits `grep`, `cat`, `head`, `tail`, `wc`, `diff`, `cmp`, `stat`, `shasum`, `sha256sum`, `ls`, `test`, `[` and `git diff|show|log|grep`.

The residual is a process-table read. The issue's comment of 2026-11-04 reports this command from the master session on Plot 2.30.0, refused with `plot-approve.sh is a controller-owned action`:

```
while pgrep -f "plot-approve.mjs the-pulse-s-tracer-flag-means" >/dev/null; do /bin/sleep 15; done
```

The command waits for a bundle to exit and runs nothing. The master session had to split the name (`"plot-appr""ove.mjs …"`) to pass the gate. Each such wait is a manual rewrite or an unowned-action receipt, which counts a bypass for an action that never ran. The sprint goal (zero interventions by a person) counts that cost.

### Measurement

Measured 2026-11-04 on `fbf670eaf` (`origin/main`). Pure-function rows are `controllerInvocation(cmd)` from `packages/domain/src/rules/ci-suite.ts`. Hook rows are `plot-gate.mjs controller` on the main checkout with `PLOT_UNATTENDED` and `PLOT_REPO_ROOT` unset (safety juror, `.plot/panels/2026-11-04-controller-gate-refuses-read-only-commands/safety.md`).

| command | `controllerInvocation` | hook exit |
|---|---|---|
| `while pgrep -f "plot-approve.mjs the-x" >/dev/null; do /bin/sleep 15; done` | `'approve'` | not run |
| `pgrep -f "plot-approve.mjs the-x"` | `'approve'` | 2 |
| `ps -o pid= -C plot-deliver.mjs` | `'deliver'` | not run |
| `lsof -c plot-deliver.mjs` | `'deliver'` | 2 |
| `ps aux \| grep plot-approve.mjs` | `null` | 0 |
| `pkill -f plot-approve.mjs` | `'approve'` | 2 |
| `pgrep -f plot-approve.mjs \| xargs kill` | `'approve'` | not run |

Two causes. The segment's program is `while`, which no reader list holds. And `controllerInvocation` splits words on whitespace and keeps the quotes, so `wordBasename` (`ci-suite.ts:299`) strips the leading `"` of `"plot-approve.mjs` and `scriptNamed` (`ci-suite.ts:340`) reads a run. Adding `pgrep` to `READERS` alone fixes neither the `while` form nor the quoted pattern in a loop condition.

`ps aux | grep <bundle>` is already `null` today: the pipe splits it into `ps aux` and `grep <bundle>`, and `grep` is a reader. It is a regression row, not a fails-before row.

### Where a probe proves nothing

A probe in a linked worktree proves nothing: `controllerGateOf` returns `null` for a linked worktree (`packages/board/src/server/entry/gate.ts:999`, `if (linked) return null;`) and allows every call there. The first draft of this plan read "a local run allowed even a plain `plot-approve.sh foo`" from a linked worktree, and the issue's first 2026-11-04 comment read "#2706 fixed `sed -n` and `awk`" from the same kind of probe. Its second comment corrects that. The slice proves the behaviour with pure-function rows and one hook case run as a main checkout (`repo()` in `test/reconcile/controller-gate.test.mjs:38`), never through the operator's hooks.

## Design

### Approach

One predicate decides a process-table read, and every path that asks "is this segment a read" asks it.

1. **`isProcessRead(words)`** in `packages/domain/src/rules/ci-suite.ts`, an arrow function, not exported unless a test needs it. It joins `words` with one space and reads the result with `readShell` (`packages/domain/src/rules/shell-reading.ts:92`). It answers `true` only when all of these hold:
   - `readShell` returns a reading (not `null`) with exactly one simple command and no heredoc.
   - No word has `executes: true` (no `$( )`, backtick, `${ }`, `$'…'`).
   - After at most one leading word `while` or `until`, the next word's `value` is non-null, has no `=`, and its basename is `pgrep`, `ps` or `lsof`.
   - For `pgrep`, no word is a signal form: `--signal` or `--signal=…`, `-<digits>`, or `-` followed by two or more capital letters (`-KILL`, `-SIGTERM`). Single-letter capitals (`-F`, `-G`, `-P`, `-U`) are `pgrep` options and pass.
   - Anything `readShell` cannot read reads as a run. That includes a pattern with `|`, `;` or `&&` inside quotes, because the segment split at `ci-suite.ts:225` cuts it before quotes are read.
2. **`isReader`** (`ci-suite.ts:74`) returns `READERS.has(name) || (git reader) || isProcessRead(words)`. So `isReadSegment` (`ci-suite.ts:359`), `withoutDataLists` (`ci-suite.ts:111`, the `for` loop body), `controllerHttpAction` (`ci-suite.ts:254`) and the merge path (`mergeCall`, `packages/domain/src/rules/controller-gate.ts:247`, through `isReadSegment`) all see one answer. `isReadSegment` keeps its own guards (substitution, assignment or `env` prefix) on top.
3. **A pipe into a non-read keeps the name a run.** `controllerInvocation` (`ci-suite.ts:224`) and `controllerHttpAction` (`ci-suite.ts:254`) split the command on `&&`, `||`, `;` and new lines into lists, then each list on single `|` into segments. A segment that `isProcessRead` admits counts as a read only when every other segment of its pipeline passes `isReadSegment`; otherwise its words go through `scriptNamed` as today. One helper serves both functions, so the split stays one reading. This keeps `pgrep -f plot-approve.mjs | xargs kill` refused. `READERS` segments keep today's behaviour: the #2706 plan accepts `grep . <script> | bash -s s` as a known gap (`docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:61`), and this plan does not change it.
4. **TSDoc.** Update the reader lists in the TSDoc of `withoutDataLists` (`ci-suite.ts:96-99`) and `controllerInvocation` (`ci-suite.ts:197-205`) to name the process-table read and the pipe rule.

### Out of scope

- **`sed`, `rg` and `awk` stay refused.** #2706's panel decided this unanimously (`docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md:65-67`, `:119`): `sed` runs with an `e` command and writes with `w`, `awk` runs through `system()`, `rg` runs `--pre`, and a gate that parses their scripts costs more than one rewrite per use. Nothing measured since changes that cost. The pins stay unchanged: `packages/domain/test/ci-suite.test.ts:287-291` and `test/reconcile/controller-gate.test.mjs:841-847`.
- **`pkill`, `kill`, `pkill -0`.** They signal processes; they stay runs.
- **`if`, `!`, `elif` before a process read.** Only a leading `while` or `until` is admitted, because that is the measured form. `until ! pgrep …` stays refused.
- **A gated name inside another program's text** (`awk 'BEGIN{system("plot-approve.sh x")}'`, `python3 -c '…os.system("plot-approve.sh x")'`) reads `null` today and runs the script. Filed as #3145.
- **The `git` run-option guard on a `for` loop body.** `GIT_RUN_OPTIONS` (`ci-suite.ts:352`) is checked in `isReadSegment` only, so `withoutDataLists` blanks a loop list whose body is `git diff --ext-diff`. Filed as #3146. This plan puts its own predicate in `isReader` and does not move the `git` guard.

### Decisions

- [x] Does the gate refuse a process-table read today? — Yes. Measured above from the main checkout and as pure-function rows; no hook session is needed.
- [x] Do `sed`, `rg` and `awk` join the reader set? — No. #2706's unanimous decision stands. Caller, 2026-11-04.
- [x] Do `find`, `jq` and `column` join? — No. No report names them; they wait for one.
- [x] Is `RIPGREP_CONFIG_PATH` (an `rg --pre` set by configuration) a risk? — Moot, because `rg` stays refused.
- [x] Where does the predicate sit? — In `isReader`, so the loop-body path and the merge path see the same answer. Caller, 2026-11-04.
- [x] How are quoted words read? — Through `readShell`, never by whitespace split; a `null` reading is a run. Caller, 2026-11-04.
- [x] Does a pipe from a process read into `xargs` or a shell pass? — No. The pipeline rule in Approach step 3 keeps it refused. Fail-closed; caller required `pgrep … | xargs kill` refused.
- [x] Which loop keywords are admitted? — `while` and `until` only. Fail-closed; `!` and `if` were not measured.

## Slices

### Process-table read

- `feature/controller-gate-reads-a-process-lookup` — admit `pgrep`, `ps` and `lsof` as a read in `isReader`, including as a `while`/`until` condition, read through `readShell`, with the pipe rule and the rows below <!-- builds: isProcessRead in ci-suite.ts, called from isReader, and the pipeline rule shared by controllerInvocation and controllerHttpAction -->

Files the slice touches:

- `packages/domain/src/rules/ci-suite.ts` — `isProcessRead`, `isReader`, the pipeline helper, `controllerInvocation`, `controllerHttpAction`, two TSDoc blocks.
- `packages/domain/test/ci-suite.test.ts` — a new `describe` block, `a process-table read is a read (#2530)`, and rows in the `#1341` table (`:313`).
- `test/reconcile/controller-gate.test.mjs` — one hook case.
- `.changeset/<name>.md` — package `plot`, description first, `plan:` and `bumps:` last.

Tests that fail before and pass after (`packages/domain/test/ci-suite.test.ts`, `controllerInvocation(cmd)`):

| command | before | after |
|---|---|---|
| `while pgrep -f "plot-approve.mjs the-x" >/dev/null; do /bin/sleep 15; done` | `'approve'` | `null` |
| `pgrep -f "plot-approve.mjs the-x"` | `'approve'` | `null` |
| `ps -o pid= -C plot-deliver.mjs` | `'deliver'` | `null` |
| `lsof -c plot-deliver.mjs` | `'deliver'` | `null` |

Rows that hold before and after (same file):

| command | answer |
|---|---|
| `ps aux \| grep plot-approve.mjs` | `null` |
| `pkill -f plot-approve.mjs` | `'approve'` |
| `pgrep -f plot-approve.mjs \| xargs kill` | `'approve'` — the pipe rule; fails if the rule is missing |
| `pgrep -f "plot-approve.mjs\|plot-deliver.mjs"` | `'approve'` — the split cuts the quote |
| `until ! pgrep -f "plot-deliver.mjs x"; do sleep 1; done` | `'deliver'` — `!` not admitted |
| `pgrep -KILL -f plot-approve.mjs` | `'approve'` — signal form |
| `X=1 pgrep -f plot-approve.mjs` | `'approve'` — assignment prefix |
| `pgrep -f "$(plot-approve.mjs x)"` | `'approve'` — substitution |
| `for f in plot-approve.sh; do sed "1e $f slug" /dev/null; done` | `'approve'` — `#1341` table; `sed` is not a reader |
| `for f in plot-approve.mjs; do pgrep -f "$f" \| xargs kill; done` | `'approve'` — `#1341` table; loop body is not all reads |
| `unpinnedMerges('while pgrep -f "gh pr merge 12" >/dev/null; do sleep 1; done')` | `[]` — merge path |

`ci-suite.test.ts:287-291` (`sed`, `awk`, `rg` stay `'dispatch'`) stays unchanged.

Hook case (`test/reconcile/controller-gate.test.mjs`, beside `:841`): `run(repo(), 'while pgrep -f "plot-approve.mjs x" >/dev/null; do sleep 1; done').status` is `2` before and `0` after. `repo()` is a main checkout, so the gate bites. The hook runs the built bundle: run `pnpm build:board` before the local run, and restore the generated paths before the push. `:841-847` (`sed` stays refused) stays unchanged.

Gates before the push:

- `node skills/plot/scripts/board/plot-local-checks.mjs`, and every command it prints: `pnpm --filter @plot-pm/domain exec vitest related --run <changed>`, `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`, `node --test test/reconcile/controller-gate.test.mjs`, the gate tests and the `scripts/check-*.sh` list.
- `./scripts/check-changeset-packages.sh`.
- `./scripts/check-no-bundle-diff.sh`: the PR carries no generated bundle.
- No shell script changes, so `scripts/check-shell-lines.sh` does not move. No board type changes, so `pnpm run typecheck` is not required.

## Notes

Related: #2440, #1852, #2706, #3145, #3146.
