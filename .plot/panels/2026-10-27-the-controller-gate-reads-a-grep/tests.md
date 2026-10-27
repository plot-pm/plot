# Juror: tests

Position: amend

Lens: the proof. Does each acceptance fail on today's code, do the fixtures make the old and new arms disagree, is the gate change mutation-tested, and are reads and runs both covered?

## Method

- **Read:** the plan, issue #2706, `packages/domain/src/rules/ci-suite.ts` (pmain), `packages/domain/src/rules/controller-gate.ts`, `packages/board/src/server/entry/gate.ts:648-700`, `packages/domain/test/ci-suite.test.ts`, `packages/domain/test/controller-gate.test.ts`, `test/reconcile/controller-gate.test.mjs:808-827`, commit `115a29e33` (#1268).
- **Ran:** a copy of `packages/domain/src` in my own scratch dir, imports rewritten to `.ts`, probed with `node` on (a) today's code, (b) the plan's change (`isReadSegment` = `READERS` ∪ `git` + `GIT_READERS`), (c) the plan's change plus the substitution guard that `withoutDataLists` already uses (`ci-suite.ts:99`). I ran the two existing domain test files (`ci-suite.test.ts`, `controller-gate.test.ts`, 195 tests) with vitest against (b) and (c). Nothing in pmain or p2759 was modified, apart from this file.

## 1. The problem

**Ran, today's code.** `grep -n x skills/plot/scripts/plot-dispatch.sh` → `'dispatch'`. `head -5 skills/plot/scripts/plot-approve.sh` → `'approve'`. The issue's measured command → `'dispatch'`. `env grep x plot-dispatch.sh`, `git diff -- …plot-dispatch.sh`, `git log -p …plot-deliver.sh` → an action. The plan's account reproduces.

**Read.** The plan omits that the refusal is deliberate and pinned by two tests. `ci-suite.test.ts:206-209` (*"a known false positive stays refused on purpose: grep and sed are not carved out"*) and `test/reconcile/controller-gate.test.mjs:808-818` (*"a bare grep or sed read still refuses, on purpose"*, status 2) both came from #1268 (`115a29e33`), which kept the carve-out to the three reads #1245 measured. Issue #2706 is the measurement that justifies widening it. The plan must name both tests, say they flip, and state why (#2706 is the new measurement). **Ran:** under (b), exactly one domain test fails, and it is that one. The reconcile test would fail the same way through the bundle.

## 2. The approach, as the tests see it

**Ran: the plan's change opens a hole that today's code closes.** Under (b), four commands that run a gated script stop being refused:

| command | today | plan (b) | (b) + guard (c) |
|---|---|---|---|
| `grep x $(plot-dispatch.sh y)` | `dispatch` | **null** | `dispatch` |
| `diff <(bash plot-dispatch.sh x) y` | `dispatch` | **null** | `dispatch` |
| `test -n $(plot-deliver.sh x)` | `deliver` | **null** | `deliver` |
| `wc -l $(plot-deliver.sh --release 1.0 x)` | `release` | **null** | `release` |
| `cat $(plot-approve.sh y)` | null (existing hole) | null | `approve` |

The cause: `controllerInvocation` splits on `&&`, `||`, `;`, `|`, newline only, so a `$( )` stays inside a reader's segment, and a reader segment is skipped whole. Today a `grep` segment is not skipped, so `wordBasename('$(plot-dispatch.sh')` finds the script. The plan's Open Question 2 frames this as an existing `cat` hole to decide on. For `grep`, `diff`, `test` and `wc` it is not existing: the change creates it. The merge check does not regress (**ran**: `grep x $(gh pr merge 12)` stays `['gh']`), because `unpinnedMerges` falls back to `readShell`; `controllerInvocation` has no such fallback.

**The fix already exists in the same file.** `withoutDataLists` refuses a reader body that holds `$(`, a backtick, `<(` or `>(` (`ci-suite.ts:99`). Applying that guard inside `isReadSegment` restores all four runs, closes the `cat $( )` hole, and passes all 194 other existing domain tests (**ran**, variant (c)). Open Question 2 has an answer, and it is a test-backed one.

Pre-existing holes the guard does not reach (**ran**, null on today's code and on (c)): `` grep x `plot-dispatch.sh y` ``, `head <(plot-dispatch.sh y)`, `[ "$(plot-approve.sh x)" = y ]`. They come from `wordBasename` not stripping a backtick or `<(`. They are out of scope; the plan should record them as known rather than imply the substitution question is closed.

## 3. The merge-pin claim has no disagreeing fixture

The plan says "a `grep` whose text names `gh pr merge` stops counting as an unpinned merge … the plan's tests cover it." **Ran, today's code:** `grep 'gh pr merge' x` → `[]` and `grep -rn gh pr merge .` → `[]`. Both arms agree, so such a test proves nothing. `unpinnedProgram` only checks `gh` as the program word (`controller-gate.ts:247`). The fixture that disagrees is the `plot-host` arm: `grep -n pr-merge skills/plot/scripts/plot-host.sh` → `['plot-host']` today, `[]` under (b) and (c). Same for `head plot-host.sh pr-merge`. The slice must name that fixture, and keep `grep x $(gh pr merge 12)` → `['gh']` as the guard.

## 4. Slice and acceptance

One slice, observable result, order trivially right. The acceptance as written:

- `grep -n x …plot-dispatch.sh` → null, `head -5 …plot-approve.sh` → null: **fail on today's code (ran)**. Good.
- `bash …plot-dispatch.sh x`, `xargs …plot-dispatch.sh` → `'dispatch'`: pass today and after. They are regression guards, not proof of the change; they only bite under an over-widening mutation.
- No substitution fixture: the regression in §2 passes the plan's acceptance. This is the main defect.
- No fixture for each newly admitted reader. `diff`, `test`, `[`, `stat`, `git diff|show|log` join silently; a row per program in the existing `it.each` table (`ci-suite.test.ts:57-65`) costs one line each.
- `sed` stays out: the existing `sed -n '1,5p'` assertion must survive the flip (split the deliberate-refusal test, keep its `sed` half), so the Open Question 1 answer is pinned.
- `find … -exec bash {}` stays a run (**ran**: `'dispatch'` under all variants). Open Question 4 can be closed with that row.

**Reads and runs, both layers.** The plan names only the domain unit. The run through the hook is `test/reconcile/controller-gate.test.mjs`, which spawns `plot-controller-gate.sh` and the built bundle; its line 815 assertion must move from status 2 to status 0 for `grep -c foo ${D}`, and a status-2 row for `grep x $(${D} slug)` belongs beside it. A local run of that file needs `pnpm build:board` first; the PR carries no bundle diff. The merge-pin read has a board-side ask test (`packages/board/test/unit/controller-gate-readings.test.ts:85-110`); one allow row for `grep -n pr-merge …plot-host.sh` covers the read through `controllerGateOf`.

## 5. Mutation testing

The plan states none. The gate is a refusal path, so this repo's practice (mutation-test a gate before believing its tests) applies. The named mutations and the fixture that must kill each:

1. Revert `isReadSegment` to `ls|cat|git grep` → the `grep`/`head` null rows fail.
2. Drop the substitution guard → `grep x $(plot-dispatch.sh y)` and `test -n $(plot-deliver.sh x)` fail.
3. `isReadSegment` returns true when any word is a reader (not the program) → `bash plot-dispatch.sh x` is unaffected, so add `bash plot-dispatch.sh grep` → `'dispatch'`.
4. Admit `sed` → the kept `sed -n` refusal fails.
5. Treat every `git` subcommand as a read (drop the `GIT_READERS` check) → add `git rebase --exec plot-dispatch.sh main` → `'dispatch'`, which only this mutation turns to null.

The PR should record that each mutation was run and which test failed.

## 6. New defects through this lens

- No bash 3.2, shell-line or layering cost: the change lives in `packages/domain/src/rules/`, behind the existing bundle. Host-neutral; Bitbucket and GitHub read the same rule.
- The deliverable reaches adopting repos only with a plugin release (the measurement was on 2.28.1); not a test issue.

## Amendments

1. Name `ci-suite.test.ts:206-209` and `test/reconcile/controller-gate.test.mjs:808-818` as tests this slice flips for `grep`, keeping each one's `sed` assertion as a refusal, and cite #2706 as the measurement that overrides #1268's scope.
2. Make `isReadSegment` refuse a segment that holds `$(`, a backtick, `<(` or `>(`, reusing the guard at `ci-suite.ts:99`, and add acceptance rows that return an action on today's code and must still: `grep x $(plot-dispatch.sh y)` → `dispatch`, `diff <(bash plot-dispatch.sh x) y` → `dispatch`, `test -n $(plot-deliver.sh x)` → `deliver`, `wc -l $(plot-deliver.sh --release 1.0 x)` → `release`. Add `cat $(plot-approve.sh y)` → `approve` as the closed existing hole. Close Open Question 2 with this.
3. Replace the merge-pin claim's fixture with one that disagrees across arms: `grep -n pr-merge skills/plot/scripts/plot-host.sh` → `[]` (today `['plot-host']`), plus `grep x $(gh pr merge 12)` → `['gh']` as the guard. Drop the "grep whose text names gh pr merge" wording; today already allows it.
4. Add one null row per newly admitted reader (`diff`, `wc`, `stat`, `test`, `[`, `tail`, `shasum`, `git diff|show|log`) and keep `find … -exec bash {}` → `dispatch` to close Open Question 4.
5. Cover the run layer: flip the reconcile gate test to status 0 for `grep -c foo ${D}` and add a status-2 row for a reader over `$(${D} slug)`; add one allow row in `controller-gate-readings.test.ts` for `grep -n pr-merge …plot-host.sh`.
6. State the mutations in §5 in the slice's acceptance and record in the PR which test killed each.
7. Record the remaining known holes (backtick, `<(`, a quoted `"$(…)"` inside `[`) as out of scope, with their rows asserting today's `null` marked as known, or a follow-up issue.
