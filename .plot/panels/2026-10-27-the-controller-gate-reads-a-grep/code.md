# Juror: code

Position: amend

Lens: the approach against the code. Tree: `pmain` at `4a1b8a5fa`. Probes ran against an esbuild bundle of `packages/domain/src/rules/ci-suite.ts` and `controller-gate.ts` from that tree, written to my scratch `probe/` directory.

## 1. The problem

The account is correct. **Ran** `controllerInvocation` on the issue's command: it returns `"dispatch"`. `grep -n x skills/plot/scripts/plot-dispatch.sh` returns `"dispatch"` and `head -5 skills/plot/scripts/plot-approve.sh` returns `"approve"`. `cat` on the same file returns `null`.

The cause is the real one. **Read**: `controllerInvocation` is at `ci-suite.ts:208`, skips a segment when `isReadSegment` (`ci-suite.ts:302`) says read, and `isReadSegment` accepts `ls`, `cat` and `git grep` only (`:305-306`). `READERS` is at `:60`, `GIT_READERS` at `:65`. All four line numbers in the plan match.

Scope is complete for the dispatch/approve/deliver reading. **Read**: `isReadSegment` has two callers, `ci-suite.ts:212` and `controller-gate.ts:242` (`unpinnedProgram`). The board gate (`packages/board/src/server/entry/gate.ts:663`, `:689`) calls `controllerInvocation` and has no second reader list. `plot-controller-gate.sh` is a 19-line launcher and holds no copy of the rule.

## 2. The approach against the code

**The layer is right.** The rule lives in `packages/domain/src/rules/ci-suite.ts`, the change is TypeScript in the domain, and no adapter or shell changes. `check-shell-lines.sh` costs nothing.

**An existing function already does what the plan describes, and the plan should name it.** `isReader` (`ci-suite.ts:68-73`, **read**) is exactly "`READERS`, or `git diff|show|log|grep`", built on the same `programWords` and `wordBasename`. "Make `isReadSegment` agree with `READERS`" is best done as `isReadSegment = isReader` (or one exported function), not as a third list. Two predicates over the same question drift.

**The merge-pin claim names the wrong example.** The plan says a `grep` whose text names `gh pr merge` stops counting as an unpinned merge. **Ran** `unpinnedMerges`: `grep 'gh pr merge' x.md` and unquoted `grep gh pr merge` both return `[]` today, because `unpinnedMerges` blanks quotes and the `gh` arm requires `gh` as the program. The real false positive is the `plot-host` arm: `grep -n pr-merge skills/plot/scripts/plot-host.sh` and `git log -S pr-merge -- skills/plot/scripts/plot-host.sh` both return `["plot-host"]` today. The widening fixes those; the test must use them, or it passes on today's code.

**An existing test asserts the opposite and the plan does not mention it.** **Read** `test/reconcile/controller-gate.test.mjs:808-818`: *"a bare grep or sed read still refuses, on purpose"* asserts exit 2 for `grep -c foo ${D}` and `sed -n '1,5p' ${D}`. The slice must invert the `grep` half and keep the `sed` half (if `sed` stays out). The TSDoc text that names the three reads must change too: `ci-suite.ts:186-187`, `ci-suite.ts:301`, `controller-gate.ts:259-261` (**read**).

## 3. Safety

The change only turns refusals into allows; it cannot merge, deliver or remove anything itself. The risk is a new bypass of the gate. Two paths exist.

**Substitution in a reader segment.** **Ran**: `cat $(skills/plot/scripts/plot-approve.sh y)`, ``cat `…plot-approve.sh y` `` and `cat <(…plot-approve.sh y)` all return `null` today, and each runs `plot-approve.sh`. `controllerInvocation` has no `readShell` fallback (unlike `unpinnedMerges`, `controller-gate.ts:280`). Widening the set copies this hole to eleven more programs. The mechanism to close it already exists one function up: `withoutDataLists` refuses a reader body that holds `$(`, a backtick, or `<(`/`>(` (`ci-suite.ts:105`). A reader segment with any word matching that same pattern must not be a read. `wordBasename` already strips the `$(` prefix (`:259`), so the gated name inside the substitution then reads as a run. This closes the `cat` hole as well. Open Question 2 should be answered "close it", not "record it".

**Assignment prefix that names a gated script.** `programWords` drops `NAME=value` words before the program, but `controllerInvocation` scans every word of a non-read segment. **Ran**: `GIT_EXTERNAL_DIFF=plot-dispatch.sh git diff` returns `"dispatch"` today and would return `null` once `git diff` joins the set. `git diff` runs `GIT_EXTERNAL_DIFF`, so this is a real new bypass. `GIT_PAGER=…plot-dispatch.sh git grep x` and `PAGER=plot-dispatch.sh cat x` already return `null` today. A reader segment whose words before the program name a gated script must not be a read; test it with `GIT_EXTERNAL_DIFF=` and `GIT_PAGER=`.

A lesser case, already present for `git grep` and not made worse: `git grep -O<pager>` / `--open-files-in-pager=` runs its value (**ran**: `git grep -Oskills/plot/scripts/plot-dispatch.sh foo` returns `null`). Worth one line in the plan as known, or one guard.

No path reads ancestry or a host answer; question 3's `mergedAt` rule does not apply.

## 4. Slices, Changelog, acceptance

One slice, one observable result, order trivial. The plan's own tests fail on today's code for `grep` and `head` (**ran**). The merge-pin test as described does not fail on today's code (see 2). The Changelog line matches the change. Four Open Questions are still unchecked; a Draft going to approval should answer them. My answers: `sed` stays out; substitution is closed for every reader including `cat`; one reader set serves both checks (the merge check benefits, shown above); `find` stays out and gets a test (`find . -name plot-dispatch.sh -exec {} \;` stays a run).

## 5. New defects

- No shell, so bash 3.2 and the line ratchet are untouched.
- Generated bundles (`skills/plot/scripts/board/plot-gate.mjs`) must not appear in the PR diff; `main` rebuilds them.
- Host-neutral: the rule reads command text only, so GitHub and Bitbucket behave the same. The `plot-host` merge arm covers both backends.
- Project-agnostic: the gated names are Plot's own scripts; adopting repos see no config change.
- Arrow-function rule: any new helper in `ci-suite.ts` is an arrow; reusing `isReader` adds none.

## Amendments

1. State that `isReadSegment` becomes (or delegates to) the existing `isReader` (`ci-suite.ts:68`), so one predicate answers "is this a reader".
2. A reader segment holding a command or process substitution (`$(`, backtick, `<(`, `>(`, the pattern at `ci-suite.ts:105`) is not a read. Add tests: `cat $(plot-approve.sh y)` and `grep x <(plot-dispatch.sh y)` read as a run.
3. A reader segment whose prefix assignments name a gated script is not a read. Add a test: `GIT_EXTERNAL_DIFF=plot-dispatch.sh git diff` stays `'dispatch'`.
4. Replace the merge-pin example with one that fails today: `grep -n pr-merge skills/plot/scripts/plot-host.sh` and `git log -S pr-merge -- …/plot-host.sh` give `[]`.
5. Name `test/reconcile/controller-gate.test.mjs:808-818` as changed (the `grep` case inverts, the `sed` case stays) and the three TSDoc sites (`ci-suite.ts:186`, `:301`, `controller-gate.ts:261`) as updated.
6. Close the four Open Questions with the answers in section 4, and record `git grep -O` as known or guard it.
