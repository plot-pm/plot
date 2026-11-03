# Testability juror: 2026-11-03-who-may-approve-a-release-and

Position: amend

The plan is a Draft that states its own approach is "Not chosen" (plan:39). Through the testability lens it is sound as a holding pen for three trust-boundary questions, but it names no test for any slice and misses the entrance that actually sets the `release-approve` caller. It must not move to Approved in its current shape. The amendments below make each slice buildable by an unattended agent once the persons' decisions exist.

Code references are against `origin/main` at `f017f976e`. `git diff --stat a518552f1 f017f976e -- packages/` is empty, so the plan's line numbers still hold for code.

## Findings

### F1. No slice names a test, so none can be checked against origin/main (HIGH)

The plan has no test section, and each slice line (plan:61, :65, :69) names an outcome only. Rubric question 6 cannot be answered for any slice: there is no named test to fail before and pass after. Only one test requirement appears, as an open question (plan:50, "a review run still writes `plot/review` on a head end to end"), and it names no file.

### F2. The `release-approve` caller is set in `main.ts`, which the plan does not cite (HIGH)

The plan cites `deliver.ts:791`, `restart.ts:70` and `release.ts:211` (plan:29). `plot-ask.mjs release-approve` gets its caller from `mergePortsFor` at `packages/board/src/server/entry/main.ts:156` (`caller: process.env.PLOT_UNATTENDED === '1' ? 'unattended' : 'person'`), called before `releaseApproveAt` at `main.ts:222`. `mergePortsFor` also serves `plot-ask.mjs merge`. A slice that changes the caller reading there changes `merge`'s caller too, unless the slice splits the port builder. The plan must name `main.ts:156` and decide whether `merge` takes the same reading.

The same ternary sits in seven places: `deliver.ts:791`, `main.ts:156`, `main.ts:260` (repair-pr), `restart.ts:70`, `fleet/.../continue-command.ts:103`, `restart-command.ts:91`, `restart-stopped-command.ts:105`. A new caller value that only some entrances produce leaves the others reading a master agent as `person`. The slice must list which entrances change and which stay, each with a reason.

### F3. The decision is a domain property; the reading that feeds it is not yet one (MEDIUM)

The refusal itself is testable without a process: `releaseApprove(readings, input)` is pure and `packages/domain/test/workflows-release-approve.test.ts:54` already proves the `unattended` refusal from a readings object. A new `Caller` member (`decision.ts:23`) or a new refusal word is one more case there, and it fails on origin/main because the word does not exist.

The hard part is the reading. No observable in the process tells a master agent from a person today. One candidate exists in the environment: Claude Code sets `CLAUDECODE` (and `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_ENTRYPOINT`) in every child shell, and this juror's own shell carries them. `git grep CLAUDECODE origin/main -- 'packages/*/src/**' 'skills/plot/scripts/*.sh'` returns nothing, so no Plot code reads it. It is not proof of identity: `env -u CLAUDECODE` removes it, and a person's `!` command inside a session carries it. Whether a forgeable signal is acceptable is a person's decision (see below). Whatever the reading is, the slice must put the env-to-caller mapping in one pure function (for example `callerOf(env)`) so the seven entrances call one rule and a unit test asserts each env shape without a process.

For the board's routes (plan:44, a token only the served page holds), the testable unit is the comparison "request token equals board token", which is a pure function. The routes' tests then need one HTTP test per route proving a request without the token refuses by name. The plan names neither.

### F4. The lens line's named test covers a different entrance (MEDIUM)

`packages/board/test/unit/release-caller-gate.test.ts` tests the `--release` arm of `deliver.ts` (`run(['--release', ...])`, line 56), which is `release`, not `release-approve`. It changes only if the release slice also changes `deliver.ts:791`. The tests that the three slices change, read from origin/main:

- Release caller: `packages/domain/test/workflows-release-approve.test.ts` (fixtures `caller: 'person'` at :42 and :125; refusal at :54 and :136), `packages/board/test/unit/ask-release-approve-argv.test.ts`, `packages/board/test/unit/release-caller-gate.test.ts:47`, `packages/board/test/unit/ask-repair-pr.test.ts:120` (if `main.ts:260` changes), `packages/fleet/test/unit/continue-command.test.ts:71` (same mapping pattern), `test/reconcile/restart.test.mjs`, `packages/board/test/release.test.mjs`. No existing test proves a person's click on a board started under `PLOT_UNATTENDED=1`; the LOW defect at plan:29 needs a new one that fails on origin/main.
- Release finish scope: `packages/domain/test/workflows-release-finish.test.ts` (scope cases :94 to :115) and `packages/board/test/unit/release-finish-real-repo.test.ts`. The `plan:` line reader exists (`packages/domain/src/rules/changeset.ts:77`), so "books a plan a changeset names" is a pure readings test: a Delivered plan outside the sprint, a changeset naming it, and a second Delivered plan no changeset names. The first is booked, the second is named and not booked. That test fails on origin/main because `releaseFinish` reads only `scope`.
- Reviewer role: `packages/board/test/unit/review.test.ts:318-321` asserts the reviewer command string and changes when the command gains an agent file. `packages/fleet/test/unit/auto-fixer.test.ts:196` fakes `readRoleFile(main, role)`; moving the fixer onto `Refs.showFile` replaces that fake. `packages/fleet/test/unit/repair-role.test.ts` covers the existing `origin/<default>` load. `packages/fleet/test/unit/auto-review.test.ts` covers fleetd's review start.

### F5. The reviewer's "end to end" proof is undefined (MEDIUM)

Plan:50 asks for proof that "a review run still writes `plot/review` on a head end to end". `review.test.ts` runs the entry with a fake `agentRun` (line 145), so it can prove the command carries the role file and that a status write follows a verdict, with no process. A real agent run is out of reach of a unit test and of CI. The plan must say which of the two it means. The process-free form is sufficient if it also asserts the refusal when `reviewer.md` is absent on `origin/<default>` names the file, so `review-not-passed` never stands alone as the only signal.

### F6. A shared loader moves three callers at once (LOW)

`auto-fixer.ts:455` reads `fixer.md` through `world.readRoleFile` from the main checkout; `repair-role.ts:112` reads from `origin/<default>` through `Refs.showFile`. A shared loader changes where the fixer reads from. That is a behaviour change with its own test: a fixer role file that differs between the checkout and `origin/<default>` must start with the `origin/<default>` text. Without that fixture the arms do not disagree and the test passes on both sides.

## Amendments required

1. Add a `## Tests` (or per-slice test lines) naming, for each slice, at least one test that fails on origin/main `f017f976e` and the file it lives in. Use the files listed in F4.
2. Name `packages/board/src/server/entry/main.ts:156` as the `release-approve` caller site, state whether `merge` (same `mergePortsFor`) takes the new reading, and list which of the seven entrances in F2 change.
3. Require one pure caller-reading function in the domain (or one rule the entrances share), with a unit test per input shape, so the decision and its reading are both testable without a process.
4. For the release finish slice, state the readings fixture from F4 (one plan a changeset names, one it does not) and that the named-but-unbooked plan appears in the finish output.
5. For the reviewer slice, define "end to end" as the process-free `review.test.ts` form, add the absent-role-file refusal case, and add the F6 fixture where the checkout and `origin/<default>` texts differ.
6. Move the plan to Design before approval. Plan:39 says the approach is not chosen; an unattended Sonnet agent cannot build slice 1 without the answers to plan:43 and :44.

## Decisions that need a person

- Which reading tells a master agent from a person at `plot-ask.mjs release-approve`, and whether a forgeable signal such as `CLAUDECODE` is acceptable, or whether `release-approve` moves to the board only (behind a page token) and the CLI arm refuses every caller.
- Whether `merge` takes the same caller rule as `release-approve`.
- Whether `releaseFinish` books plans outside the sprint, or only names them (plan:45).

## What I ran versus what I read

Ran (read-only): `git fetch origin main`; `git show` and `git grep` against `origin/main` for every cited file, the seven caller sites, the test files in F4, `reviewerCommand`, `readRoleFile`, the changeset `plan:` reader and `CLAUDECODE`; `git diff --stat a518552f1 origin/main -- packages/` (empty); `gh issue view 3077`; `env` to check which Claude Code variables a session child carries. Read only: the plan and the juror brief. I ran no test suite, so "fails on origin/main" in F3 and F4 is inferred from the source: the refusal word and the new readings do not exist there.
