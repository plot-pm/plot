## Implementation brief — board-readings-take-the-domain-answer (wave 8: Escalation post)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/the-escalation-reads-the-issue-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last wave of the plan (slice 8, issue #3163). It waits on no other branch: the plan names no `waits:`, and the slices touch different files. The one shared file is `packages/board/src/server/fleet.ts`, which slice 7 (`bug/the-quiet-invariant-reads-the-placement`) edits at `:5774-5776` and `:5793-5795`; this branch edits only the `questionNote` declaration near `:4642`. Whichever lands second rebases.

### What to build

The escalation post duplicates one parse and one read. Measured on `origin/main` 192c9d151:

- `planIssueId` (`packages/domain/src/rules/escalation.ts:80-84`) and `planIssue` (`packages/domain/src/transitions/sprint-member.ts:128-132`) repeat the same two regexes (`## Status` body, then `- **Issue:**` line). They differ only in the id step: `planIssueId` also accepts a Jira key and answers `null`; `planIssue` takes the first `#<number>` and answers `''`.
- `workerQuestions` (`packages/fleet/src/shared/worker-question.ts`, ~`:252-263`) calls `escalationOf` once per marked desk, and `escalationOf` (~`:271-274`) builds a new `answerRecordFile({ cwd: repoRoot })` each time. Each refresh therefore runs one `git rev-parse --git-common-dir` and one full read of `answers.tsv` per desk with a marker.
- `packages/fleet/test/unit/escalation-post.test.ts` types its stub answer as `{ ok: true; value: 'commented' }` and returns it `as never` (`:7`, `:14`). The real answer is `PortResult<IssueCommentOutcome>`, which carries `{ outcome: 'commented' }` — the cast hides that difference, so the stub proves nothing about the port's shape.
- `question-renders-waiting-on-you.browser.test.ts` (in `packages/board/test/integration/`, not `test/browser/`) hard-codes the note `… · escalated: test` at `:41`. It proves only that the page renders a string it was handed.

The change, in four parts:

1. `escalation.ts` exports `planIssueValue(planText): string` — the raw `Issue:` value, or `''`. `planIssueId` and `sprint-member.ts`'s `planIssue` both call it and keep their own id step. Neither changes behaviour.
2. `workerQuestions` builds one `answerRecordFile({ cwd: repoRoot })` per call and passes it to `escalationOf`, which stops building one per question.
3. `escalation-post.test.ts` builds its tracker from `trackerFixture` (`packages/domain/src/adapters/tracker/tracker-fixture.ts`) and drops both `as never` casts.
4. `questionNote` (`packages/board/src/server/fleet.ts`, declared near `:4642`) is exported. The browser row at `question-renders-waiting-on-you.browser.test.ts:41` takes its note from `questionNote` over the fixture's question and escalation. The assertion at `:97` stays.

The plan is canonical; this is orientation. Line numbers above were re-read on `origin/main` 192c9d151 and are 19 lines off the plan's for `questionNote` (`:4623` in the plan).

### Decisions the plan settles — do not re-derive them

**`planIssueValue` returns the raw value, and the id step stays in each caller.** Merging the two functions into one was the obvious move and it is wrong: the two answer different types (`string | null` against `string`) and accept different id shapes (Jira key against `#<number>` only). Unifying them changes the sprint-member path, which has its own callers and tests. Share the parse, not the interpretation.

**The store is built once per `workerQuestions` call, not once per process.** A module-level singleton would outlive `repoRoot` and leak one repository's record into another's test. One per call removes the per-desk repeat and nothing more. `escalationOf` takes the store as an argument; do not give it a lazy getter.

**The tracker stub comes from `trackerFixture`, not from a new local type.** `TrackerFixture` already carries `commented` (every `issueComment` recorded, `:73-74`) and `issueCommentFails` (`:76`), and its `issueComment` answers `answered({ outcome: 'commented' })` (`:212-216`). That is the real port shape, so the cast has nothing left to hide. The existing stub's `{ ok: false; why: 'unaskable' | 'failed' }` arm maps onto `issueCommentFails` for `failed`; for `unaskable`, check how the fixture answers a tracker with no scheme before inventing a flag. `lastRefusal` is `null` in the fixture (`:256`); a test that needs a refusal text must say so rather than reach for `as never` again.

**The browser test asserts the note through `questionNote`, not through a second literal.** The row's `note` field is today a hand-written string that nothing connects to the function that builds it. Computing it from `questionNote(firstLine, ageMinutes, 'test')` makes the row follow the function. The `it` count must not change, so `EXPECTED_TESTS` stays as it is.

Rules carried over, unchanged:

- `packages/domain/**` is arrow functions and factual TSDoc — no decision history in comments; that goes in the commit message. A function you write or rewrite in the board or in a test is an arrow too; do not convert its neighbours.
- Absent is not false: `escalationOf` answers `null` where the record cannot be read, and that stays. An unread record is no reason, never a false one.
- `planIssueValue` answers `''` for a plan with no `## Status` section and for one with no `Issue:` line; it never throws.

### Done when

The plan's `## Done when` list is the specification. Beyond it, these assertions exist because a naive implementation would pass without them:

- **`planIssueValue` cells for four inputs:** no `## Status` section, no `Issue:` line, `#12, #13`, and `ABC-1`. The last two catch an implementation that returns the id instead of the raw value — `planIssueId` would then lose its Jira-key arm.
- **A counting test in `worker-question.test.ts`.** It mocks `@plot-pm/domain/adapters/answer-record/answer-record-file` with `vi.mock`, counts `answerRecordFile` calls, and expects **1** for a pulse with **two** marked desks. Without two desks the test passes on the old code too, since one marked desk already builds one store. Check the mock path against the module's real export path before relying on it.
- **`sprint-member` still reads `''` for a Jira key.** `planIssue` must keep answering `''` where the line names only `ABC-1`; a test that pins this catches a refactor that routes `planIssue` through `planIssueId`.
- **The browser row's note comes from `questionNote`.** Break `questionNote`'s wording locally and confirm the browser test's assertion at `:97` still reads the same function's output; that it does not pass by a second literal is the point.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base; this slice touches no `.sh` file, so it adds none.

A changeset is needed only if a skill or the `@plot-pm/board` package changes behaviour a user sees. `planIssueValue` changes none, and `questionNote` is exported with no change to its output; if the check-script `check-changeset-packages.sh` asks for one, name `@plot-pm/board` or `plot`, description first and the `bumps:` block last.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/rules/escalation.ts` and its test
- `packages/domain/src/transitions/sprint-member.ts` and its test
- `packages/fleet/src/shared/worker-question.ts` and `packages/fleet/test/unit/worker-question.test.ts`
- `packages/fleet/test/unit/escalation-post.test.ts`
- the `questionNote` declaration in `packages/board/src/server/fleet.ts` (export only; no change to its output)
- `packages/board/test/integration/question-renders-waiting-on-you.browser.test.ts`

Other branches of the plan in flight: `bug/the-quiet-invariant-reads-the-placement` (slice 7) edits `classifier-is-total.test.ts`, two comments in `fleet.ts` at `:5774-5776` and `:5793-5795`, and `docs/board-domain-model.md`. The other six slices of this plan are open or merged and touch the sprint annotation, `delivery-readings.ts`, the spike card, the plan-store corpus, `verdicts.ts` and `plot-ask.mjs`. None edits a file in the list above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
