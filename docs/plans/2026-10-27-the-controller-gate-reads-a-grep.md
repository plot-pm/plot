# The controller gate reads a grep over a gated script as a run

> The controller gate refuses a read-only `grep` whose file operand is a gated script, although the command runs no script.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #2706
- **Rounds:** 1
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-27, Jan Wloka, plan-PR #2759 merged
- **Started:** 2026-10-27, Jan Wloka, `feature/the-controller-gate-reads-a-grep`

## Changelog

- The controller gate treats a segment whose program is a reader (`cat`, `ls`, `grep`, `head`, `tail`, `wc`, `diff`, `cmp`, `stat`, `shasum`, `sha256sum`, `test`, `[`, `git diff|show|log|grep`) as a read, whichever gated script it names. A reader segment that holds a command or process substitution, starts with an assignment or `env`, or passes a git option that runs or writes a program still counts as a run, and `bash`, `sh` and `xargs` over a gated script are still refused.

<!-- Board impact: none. A matching rule in `packages/domain/src/rules/`. No plan format, no template, no layout. -->

## Motivation

Issue #2706 measured on 2026-10-26, in a master session on `main` with the plugin gate `plot@plot-marketplace` 2.28.1:

```
grep -n 'orphaned claim' skills/plot/scripts/plot-reap.sh | head; grep -n 'holds no claim' skills/plot/scripts/plot-dispatch.sh | head -3
```

The gate answered `plot-controller-gate: plot-dispatch.sh is a controller-owned action.` and printed the dispatch route. The command runs no script. The same search as `grep -rn '…' skills/plot/scripts/*.sh` passed, because the glob matches all three gated scripts and so names none.

An agent that wants to read a controller script has two exits. It rewrites the command to avoid the name (a glob, a directory search), or it takes the unowned-action receipt, which counts a bypass in `.plot/state/unowned-action-writes.tsv` for an action that never ran. Both teach routing around the gate.

Panel round 1 reproduced the account on `origin/main` (`4a1b8a5fa`). Refused today through the shipped `plot-gate.mjs --all`: `grep -n x …/plot-dispatch.sh`, `head -5 …/plot-approve.sh`, `wc -l …/plot-deliver.sh`, `diff …/plot-approve.sh /dev/null`, `git show HEAD:…/plot-dispatch.sh`, `git log -p -- …/plot-deliver.sh`, `git diff main -- …/plot-deliver.sh`, `[ -x …/plot-dispatch.sh ]`, `tail -f …/plot-dispatch.sh`. The live plugin gate also refused a juror's own probe, which held gated names only as data.

The refusal of `grep` is deliberate today. #1268 (`115a29e33`) kept the carve-out to the three reads #1245 measured, and two tests pin it. Issue #2706 is the measurement that widens it.

## Design

### Approach

`controllerInvocation` (`packages/domain/src/rules/ci-suite.ts:208`) reads every segment that names a gated script as a run, unless `isReadSegment` (`ci-suite.ts:302`) says the segment is a read. `isReadSegment` accepts three programs: `ls`, `cat` and `git grep`. The same file already holds `isReader` (`ci-suite.ts:68`), which answers `READERS` (`:60`) plus `git diff|show|log|grep` (`GIT_READERS`, `:65`), and uses it only for the body of a `for` loop.

1. **One reader predicate.** `isReadSegment` delegates to `isReader`. No third list exists, so the loop-body reading and the segment reading cannot drift again.
2. **A substitution is a run.** A reader segment in which any word holds `$(`, a backtick, `<(` or `>(` is not a read. The guard reuses the pattern `withoutDataLists` applies at `ci-suite.ts:99-105`, extracted once and called from both places. `controllerInvocation` has no `readShell` fallback, unlike `unpinnedMerges` (`controller-gate.ts:280-283`), so without the guard a reader segment hides the script its substitution runs. `wordBasename` (`ci-suite.ts:249`) strips a leading `$(` and a quote today but not a backtick, `<(` or `>(`; the slice strips those three too, so a bare `` `plot-dispatch.sh y` `` or `<(plot-dispatch.sh y)` names its script. This also closes the existing `cat $(…/plot-approve.sh y)` hole.
3. **An assignment prefix is a run.** A reader segment with a leading `NAME=value` word, or with `env` before its program, is not a read. `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff` runs the script with no flag (measured by the safety juror in a throwaway repo), and `programWords` (`ci-suite.ts:114`) strips the assignment before the program word. This also turns `PAGER=…/plot-dispatch.sh cat x` and `GIT_PAGER=…/plot-dispatch.sh git grep x`, which pass today, into runs.
4. **A git option that runs or writes is a run.** A `git` reader segment with `--ext-diff`, `--output` or `--output=…`, `-O` or `-O…`, `--open-files-in-pager` or `--open-files-in-pager=…`, or `--textconv` is not a read. This applies to `git diff`, `git show`, `git log` and the existing `git grep`. `git grep -O./probe.sh b` and `git log --ext-diff -p -1` ran a program in the safety juror's throwaway repo; `git show --output=…` overwrites a file.

`unpinnedProgram` (`controller-gate.ts:242`) also calls `isReadSegment`, so the merge-pin check uses the same predicate. Today `grep -n pr-merge skills/plot/scripts/plot-host.sh` and `git log -S pr-merge -- skills/plot/scripts/plot-host.sh` count as an unpinned `plot-host` merge; after the change both read as `[]`. A quoted `grep 'gh pr merge' x.md` already passes today, because `unpinnedMerges` blanks quotes and the `gh` arm needs `gh` as the program. The merge check keeps its `readShell` fallback, so `grep x $(gh pr merge 12)` stays `['gh']`.

### Why a doubtful shape stays a read

The gate keeps the master agent on its controllers (`CLAUDE.md`, *The Master Agent Uses The Controllers*). It is not a security boundary against an adversarial agent. Each extra guard turns an honest read back into the refusal #2706 reports. The slice closes the shapes that a widened reader set would newly hide, and the shapes whose program word gives no sign of a run (a substitution, an environment program, a git run option). It leaves open the shapes below, which need a second command to run anything and which `cat` already lets through today.

### Known holes, not closed here

Each hole gets a test that pins today's answer, so a later change to it is a decision and not a drift.

- **A reader piped into a shell or `xargs`.** `cat …/plot-dispatch.sh | bash -s s` passes today, and `grep . …/plot-dispatch.sh | bash -s s` passes after the change. The downstream `bash -s s` segment names no script. Closing it means reading the whole pipeline, and refuses every honest `grep … | xargs grep …`.
- **A reader redirected to a file other than `/dev/null`.** `head -n 9999 …/plot-dispatch.sh > /tmp/d.sh; bash /tmp/d.sh s` is a copy then a run of an ungated name, in two steps.
- **A shell function that shadows a reader name.** `grep() { bash "$@"; }; grep …/plot-dispatch.sh s`.

### Reads that stay refused (out of scope)

- `sed`, `awk` and `rg`. `sed` runs with an `e` command and writes with a `w` flag, `awk` runs through `system()`, and a gate that parses either script is more code than one rewrite per use justifies.
- `git -C . grep` and any git global option before the subcommand. `isReader` takes the second program word as the subcommand.
- A gated name inside quoted text (`echo "see plot-dispatch.sh"`, `gh pr comment 1 --body "plot-approve.sh reads x"`). `controllerInvocation` reads quoted words.
- `nl`, `less`, `md5`, `file`, `git blame`, `time grep`, `command grep`, `bash -n`, `shellcheck`, `node --check`.

### Tests that invert

- `packages/domain/test/ci-suite.test.ts:206-209` (*"a known false positive stays refused on purpose: grep and sed are not carved out"*): the `grep` row flips to `null`, the `sed` row stays `'dispatch'`. The test is split and renamed to cite #2706.
- `test/reconcile/controller-gate.test.mjs:808-818` (*"a bare grep or sed read still refuses, on purpose"*): `grep -c foo ${D}` flips from status 2 to status 0, `sed -n '1,5p' ${D}` stays status 2. A local run needs `pnpm build:board` first; the PR carries no bundle diff.

### TSDoc that changes

`ci-suite.ts:186` (the `controllerInvocation` block that names "`ls`, `cat` or `git grep`"), `ci-suite.ts:301` (`isReadSegment`) and `controller-gate.ts:261` (`unpinnedMerges`). Each names the reader set by reference to `isReader` and states the three guards.

### Acceptance

Rows that fail on today's code (each returns an action today and `null` after the slice), in the `it.each` table at `ci-suite.test.ts:57-65`:

- `grep -n x skills/plot/scripts/plot-dispatch.sh`, `head -5 skills/plot/scripts/plot-approve.sh`, `tail -f …/plot-dispatch.sh`, `wc -l …/plot-deliver.sh`, `diff …/plot-approve.sh /dev/null`, `stat …/plot-deliver.sh`, `shasum …/plot-dispatch.sh`, `test -x …/plot-dispatch.sh`, `[ -x …/plot-dispatch.sh ]`, `git diff main -- …/plot-deliver.sh`, `git show HEAD:…/plot-dispatch.sh`, `git log -p -- …/plot-deliver.sh` → `null`.
- The issue's command → `null`.
- `unpinnedMerges('grep -n pr-merge skills/plot/scripts/plot-host.sh')` and `unpinnedMerges('git log -S pr-merge -- skills/plot/scripts/plot-host.sh')` → `[]` (today `['plot-host']`), with one allow row in `packages/board/test/unit/controller-gate-readings.test.ts:85-110`.

Rows that fail on the naive widening (`isReadSegment = isReader` with no guard) and must return their action:

- Substitution: `grep x $(…/plot-dispatch.sh s)` → `'dispatch'`, ``wc -c `…/plot-dispatch.sh s` `` → `'dispatch'`, `diff <(…/plot-dispatch.sh s) f` → `'dispatch'`, `tail -f /dev/null >(…/plot-dispatch.sh s)` → `'dispatch'`, `[ -n "$(…/plot-deliver.sh s)" ]` → `'deliver'`, `wc -l $(plot-deliver.sh --release 1.0 x)` → `'release'`, ``grep x `plot-dispatch.sh y` `` → `'dispatch'`, `head <(plot-dispatch.sh y)` → `'dispatch'`.
- The closed existing hole: `cat $(…/plot-approve.sh y)` → `'approve'` (today `null`).
- Assignment: `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff` → `'dispatch'`, `GIT_PAGER=…/plot-dispatch.sh git grep x` → `'dispatch'`, `env PAGER=…/plot-dispatch.sh cat x` → `'dispatch'`.
- Git run options: `git log --ext-diff -p -1 -- …/plot-dispatch.sh`, `git grep -O…/plot-dispatch.sh x`, `git grep --open-files-in-pager=…/plot-dispatch.sh x`, `git show -1 --output=…/plot-dispatch.sh`, `git diff --textconv -- …/plot-dispatch.sh` → `'dispatch'`.
- The reconcile gate test gains a status-2 row for `grep x $(${D} slug)`.

Rows that pass today and after, as regression guards:

- `bash …/plot-dispatch.sh x`, `xargs …/plot-dispatch.sh`, `bash …/plot-dispatch.sh grep`, `find . -name plot-dispatch.sh -exec bash {} s \;`, `git rebase --exec …/plot-dispatch.sh main` → `'dispatch'`.
- `sed -n '1,5p' …/plot-dispatch.sh`, `awk 1 …/plot-dispatch.sh`, `rg -n x …/plot-dispatch.sh` → `'dispatch'`.
- `grep x $(gh pr merge 12)` → `unpinnedMerges` `['gh']`.
- Known holes, pinned at today's answer: `cat …/plot-dispatch.sh | bash -s s` → `null`, `grep . …/plot-dispatch.sh | bash -s s` → `null`, `head -n 9999 …/plot-dispatch.sh > /tmp/d.sh` → `null`.

### Mutations the acceptance kills

The PR records that each mutation ran and which test failed.

1. Revert `isReadSegment` to `ls|cat|git grep` → the `grep`, `head` and `git diff` null rows fail.
2. Drop the substitution guard → `grep x $(…/plot-dispatch.sh s)` and `cat $(…/plot-approve.sh y)` fail.
3. Drop the backtick and `<(` stripping in `wordBasename` → ``grep x `plot-dispatch.sh y` `` and `head <(plot-dispatch.sh y)` fail.
4. Drop the assignment guard → `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff` fails.
5. Drop the git-option guard → `git grep -O…/plot-dispatch.sh x` and `git show -1 --output=…/plot-dispatch.sh` fail.
6. Read a segment when any word is a reader, not the program → `bash …/plot-dispatch.sh grep` fails.
7. Admit `sed` → the kept `sed -n` refusal fails.
8. Treat every `git` subcommand as a read → `git rebase --exec …/plot-dispatch.sh main` fails.

### Open Questions

- [x] Does `sed` join the set? — No. `sed`, `awk` and `rg` stay refused, and acceptance rows pin it. Panel round 1, unanimous.
- [x] A reader whose operand holds a substitution runs it. Does the change close it for all readers? — Yes, for every reader including `cat` and `ls`, reusing the guard at `ci-suite.ts:99-105`. Operator decision, panel round 1.
- [x] Does one reader set serve both the controller check and the merge-pin check? — Yes. One predicate serves both, and the controller check carries the guards, because it has no `readShell` fallback.
- [x] Does `find … -exec` stay out of the set? — Yes. `find` is not in `READERS`, and `find . -name plot-dispatch.sh -exec bash {} s \;` stays `'dispatch'` as an acceptance row.

## Slices

### Reader set

- `feature/the-controller-gate-reads-a-grep` — `isReadSegment` agrees with `READERS`, with tests for the reads and the runs above <!-- builds: isReadSegment reading the full READERS set -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2706. The plan writes nothing to the tracker.
- This plan's panel, round 1: `.plot/panels/2026-10-27-the-controller-gate-reads-a-grep/` (rootcause, code, safety, tests; unanimous amend). The operator chose to close substitution, assignment prefixes and git run options in this slice, and to record pipes into a shell and file redirects as known holes.
- The change is domain TypeScript only. It adds no shell lines, and the PR carries no generated bundle (`check-no-bundle-diff.sh`).
- The fix reaches adopting repositories with the next plugin release; the measurement was on 2.28.1.
