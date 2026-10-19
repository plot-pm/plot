## Implementation brief — a-desk-can-be-continued-once (wave 1: Reproduction)

- **Plan (canonical):** [docs/plans/2026-10-19-a-desk-can-be-continued-once.md](../../docs/plans/2026-10-19-a-desk-can-be-continued-once.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2114 merged
- **Branch:** `bug/a-desk-can-be-continued-once-test` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR
- **Issue:** #2107

`bug/a-desk-can-be-continued-once-fix` waits on this branch (wave 2). The fix cannot be chosen until this branch has measured which endings refuse. Another branch in flight, `bug/an-unstarted-continue-resumes-no-stranger` (plan `manifest-retry-and-race-findings`, wave 4), edits `packages/fleet/src/shared/continuation.ts` and may touch `continue-target.ts`. This branch edits neither.

### What to build

A desk whose continued run ends with a new question cannot be continued again. On 2026-10-19 `.worktrees/free-fcd71bc3` (`bug/a-click-on-a-plan-story`) was continued, opened PR #2104, wrote a new `PLOT-BLOCKED` marker, and the second `plot-continue-command.mjs` refused `no-manifest: no manifest names .../free-fcd71bc3`. `.worktrees/free-7edb8d31` refused the same way earlier that day.

Build one test that continues one desk twice, once per ending reason in `NEEDS_PERSON_ENDINGS` (`packages/domain/src/rules/ending-action.ts:213`): `blocked`, `spend-limit`, `unstarted`, `run-limit`, `checks-unanswered`. For each reason: first continue, the loop ends and removes its own manifest, the desk holds a `PLOT-BLOCKED` marker and an ending record of that reason for the asked branch, then a second continue is asked. The test records the second continue's answer per reason. That table is this slice's deliverable, because it is the measured scope of the bug and it picks fix A or B for the next slice.

The test fails today for every reason the fallback at `continue-target.ts:122-125` does not accept (`spend-limit`, `run-limit`, `checks-unanswered`). Do not fix `continueTarget` on this branch.

### Decisions the plan settles — do not re-derive them

**The test goes through `continueOnDesk`, not only through `continueTarget`.** `packages/domain/test/continue-target.test.ts` already holds `refuses no-manifest when the ending reads a reason other than blocked` (`:141`), so a pure-rule test proves the refusal and not that a real desk reaches it after a real first continue. The issue asks for the two-continue shape by name. Put the test beside the other desk-continuation tests (`packages/board/test/unit/continue-route.test.ts`, which already writes an ending record at `:1338`, or `packages/board/test/unit/continue.test.ts`) and read how those fixtures build a desk before writing a new one.

**The test must not race a child process.** `continue-route.test.ts` states the rule in its header: assert on state the handler writes synchronously (the 202 body, the pid file, the prompt file), never on output the spawned worker produces. Simulate "the loop ended" by removing the manifest and writing `.plot-worker.ending.json` yourself, as the existing cases do. A test that waits for a real loop to end has a budget that is a guess.

**Report refusals by name.** The second continue's answer is `continueOnDesk`'s refusal reason (`no-manifest`, `loop-alive`, `several`, `no-question`) or an accepted start. The plan's third Open Point says `spend-limit` and `run-limit` may refuse for the budget (the `runs` check in `continuation.ts`) and not for the manifest. If a second continue refuses with a name other than `no-manifest`, record that name in the test title or comment rather than treating it as the bug.

**Open Point 1: read the real endings.** Before the fix is chosen, read `.plot-worker.ending.json` in `.worktrees/free-fcd71bc3` and `.worktrees/free-7edb8d31` if they still exist, and put the reason in the PR body. The plan's leading hypothesis is `checks-unanswered` for `free-fcd71bc3` (PR #2104 was `CONFLICTING`; compare plan `a-desk-waits-for-ci-on`, #2106). It is a hypothesis: if the file is gone or reads another reason, say so in the PR body, and say the table above stands on the code alone.

**Guard cases stay refusals.** The plan's approach step 3 keeps three: an absent or unreadable ending record answers `no-manifest`, and a different branch answers `no-manifest`. Add them to the same test table as rows that must keep refusing after the fix, so wave 2 cannot widen the rule past its evidence.

**Rules carried over unchanged:** *absent is not false* — an ending that could not be read is never a fallback. `continueTarget` is pure and does no I/O; the caller reads the desk. A refused continuation leaves no `.plot-continuation.md`, no appended log and no removed `.plot-worker.exit` (`continuation.ts:731`); assert that on the refusing rows, so a fix that refuses late is caught.

### Done when

The plan's `## Slices` entry for this branch is the specification: a test continues one desk twice for each ending reason in `NEEDS_PERSON_ENDINGS` and records which second continues refuse.

- **The reproduction fails on `main` for the right reason.** Run it against `main` and confirm the failing rows are exactly the reasons the fallback rejects, each with `no-manifest`. A test that fails on all five, or on a different refusal, measures the fixture, not the bug.
- **`blocked`, `unstarted` pass today.** They are the control rows: they prove the fixture reaches the second continue and that the harness itself accepts a valid desk. Without them a broken fixture reads as five reproductions.
- **The failing rows are marked, not skipped.** This branch must merge with CI green, so the rows that reproduce the bug are `it.fails` (or the file's equivalent) with a comment naming wave 2, `bug/a-desk-can-be-continued-once-fix`, which flips them to plain `it`. Do not delete a failing row and do not use `it.skip`: a skipped row measures nothing.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use `nvm use` (Node 24) before any `pnpm` command. This branch changes tests only: no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count, and no changeset is needed unless `check-changeset-packages.sh` asks for one.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not use `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`.
- Do not `git add -A` after a suite run: board tests rewrite the tracked `tiny-garden/.plot/state` fixture.

### Scope guard

This branch owns one new test and its fixtures in `packages/board/test/unit/` (`continue-route.test.ts` or `continue.test.ts`, whichever holds the desk fixtures it reuses). It does not edit `packages/domain/src/rules/continue-target.ts`, `packages/fleet/src/shared/continuation.ts`, `worker-loop.ts` or `ending-action.ts`: those belong to wave 2 and to `bug/an-unstarted-continue-resumes-no-stranger`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
