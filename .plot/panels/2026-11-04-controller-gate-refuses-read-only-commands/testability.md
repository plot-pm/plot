# Testability juror: controller-gate-refuses-read-only-commands

Position: amend

Lens: is every behaviour asserted on a domain property or a script contract without a browser, does each named test fail before the change and pass after, and can the test run without touching the operator's real fleet, launchd or port 7777?

## Findings

1. **The behaviour is a pure domain function, so the slice needs no live gate.** `controllerInvocation(command)` (`packages/domain/src/rules/ci-suite.ts`, origin/main `fbf670eaf`) takes a string and returns an action or `null`. `isReadSegment` (`ci-suite.ts:359`) and `isReader` (`ci-suite.ts:74`) are synchronous and read no world. A vitest row in `packages/domain/test/ci-suite.test.ts` touches no fleet, no launchd and no port 7777. This passes the lens.

2. **Open Question 1 is already answered by a test on main, and the plan does not say so.** `packages/domain/test/ci-suite.test.ts:287-291` asserts `sed -n '1,5p' …/plot-dispatch.sh`, `awk 1 …` and `rg -n x …` each return `'dispatch'`, under the title "sed and awk stay refused on purpose". That is the reproduction the plan asks for "in a session with the hooks active". No hook session is needed. The plan's note that a local `plot-gate.mjs` run allowed `plot-approve.sh foo` has a reading in the source: `controllerGateOf` returns `null` for a linked worktree (`packages/board/src/server/entry/gate.ts`, `if (linked) return null;`) and for a checkout with no `.plot/state/`. A run from `.worktrees/…` allows every action by design. The plan should not send an unattended agent to reproduce through the operator's hooks.

3. **The slice must invert an existing test, and the plan does not name it.** `ci-suite.test.ts:287` asserts the opposite of the slice's goal. A Sonnet agent that adds new rows and leaves that test sees a red suite and must decide alone whether the old assertion is a guard or a stale pin. The plan must name the inversion: the `sed -n` and `rg -n` rows move to the read table; the `awk` row stays `'dispatch'` (the slice does not build `awk`).

4. **The guard placement the plan names misses the loop path, and no named test would catch it.** The plan puts the guards "beside the `git` run-option guard", which is inside `isReadSegment` (`ci-suite.ts:352-364`). `withoutDataLists` (`ci-suite.ts:105-111`) calls `isReader`, not `isReadSegment`, and checks only `hasSubstitution`. So once `sed` joins `READERS`, `for f in plot-deliver.sh; do sed "1e $f" x; done` reads as a data loop, the list is blanked, and the run is missed. The guard must sit where both callers see it (in `isReader`, or `withoutDataLists` must call `isReadSegment`), and a row in the `#1341` table (`ci-suite.test.ts:313`) must pin it. That row is `null` before and after the change only if the guard is in the wrong place, so it is the row that proves placement.

5. **The `sed` guard has no decidable test oracle as written.** `controllerInvocation` splits on whitespace without reading quotes (`ci-suite.ts`, `segment.trim().split(/\s+/)`). A sed script such as `'1e plot-approve.sh x'` arrives as three words. "No `e` or `w` command in its script" does not say which words are the script (`-e` values, `-f` file, the first non-option word), nor how to tell the `w` command from a `w` in a regex (`sed -n '/worker/p'`). Each answer gives different test rows. The plan must fix the rule, for example: a `sed` segment is a read only with `-n` and a script word that matches `^'?(\d+(,\d+)?|/[^/]*/)?p'?$`-style print-only forms; anything else is a run. Then each row has one expected value.

6. **The option table has cases the tests must pin, and the plan names none.** In-place on `sed`: `-i`, `-i.bak`, `-i ''` (BSD), `-I` (BSD in-place), `--in-place`, `--in-place=.bak`, a cluster `-ni` / `-Ei`. On `rg`: `--pre cmd`, `--pre=cmd`, and `--pre-glob` (which only has effect with `--pre`). The Changelog's "`-s` write forms" is wrong: `-s` is `--separate` and writes nothing; the line should go.

7. **The plan scopes out the issue's latest comment, and that case is also a pure-function row.** The comment of 2026-11-04 reports `while pgrep -f "plot-approve.mjs slug" >/dev/null; do /bin/sleep 15; done` refused. From the source: the segment's program is `while` (not a reader), and `wordBasename('"plot-approve.mjs')` strips the leading quote (`controller-gate.ts`, `wordBasename`), so the result is `'approve'`. Adding `pgrep` to `READERS` alone does not fix it, because `while`/`until`/`if`/`!` keep the segment off the reader path. The comment's claim that "#2706 fixed `grep`, `sed -n`, `awk` and `cat`" is false for `sed` and `awk`, per `ci-suite.test.ts:287`. The plan should either take the `pgrep` case as a second slice with its own rows (`pgrep -f`, `pgrep -f … | xargs kill` stays a run, `pkill -0`, `ps aux | grep plot-approve.mjs` already null), or say in Notes that it is out of scope and where it goes. As written, the issue closes with its newest reported shape still refused.

8. **Changelog and slice disagree on `awk`.** The Changelog promises `awk` reads; the only slice builds `sed` and `rg`; Open Question 2 asks whether to admit `awk`. A delivery verifier reading the Changelog would test `awk` and find it refused. One of the three must change before approval.

9. **Line reference.** The plan cites `READERS` at `ci-suite.ts:60`; on `fbf670eaf` the set is at `:66` (its doc comment at `:65`).

## Amendments required

- A1. Name the test file `packages/domain/test/ci-suite.test.ts` and the inversion of `:287-291` (sed and rg rows move to the read table; awk stays a run unless awk is in scope).
- A2. Put the new guards where both `isReadSegment` and `withoutDataLists` see them, and add a `for … do sed "1e $f" …; done` row (expect `'deliver'`) to the `#1341` table.
- A3. State the `sed` read rule as a decidable predicate over whitespace-split words, with the in-place option table of finding 6 as rows that each expect `'dispatch'`, and drop "`-s` write forms".
- A4. Replace Open Question 1 with the existing test as the reproduction, and state that no slice step runs against the operator's hooks or a worktree gate.
- A5. Resolve `awk` in one place: either a slice builds it, or the Changelog drops it.
- A6. Decide the `pgrep` residual: a second slice with rows, or a Notes line naming where it goes.

## Decisions that need a person

- Whether the `pgrep`/`while` residual from the issue's latest comment belongs to this plan or to a follow-up issue (it widens the gate past "reader programs" to shell keywords).
- Whether `awk` is admitted at all.

## Ran versus read

Ran: `git fetch`, `git show`/`git grep` over origin/main `fbf670eaf`, `gh issue view 2530 --comments`, `gh pr view 3135`. Read: the plan, `ci-suite.ts`, `controller-gate.ts`, `gate.ts` (controller gate), `ci-suite.test.ts`. Did not run any test suite or the gate; the outcomes in findings 2, 4 and 7 are read from source, not executed.
