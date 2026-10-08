## Implementation brief — a-blocked-agent-s-question-has (wave 3: The loop resumes a continuation)

- **Plan (canonical):** `docs/plans/2026-10-08-a-blocked-agent-s-question-has.md` on `main`
- **Approved:** 2026-10-08, jwloka, in-session
- **Branch:** `bug/the-loop-resumes-a-continuation` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** in-session, per the plan's `Review:` answer; issue #1375

This wave waits on `feature/a-blocked-desk-is-not-held-by-a-free-wait`, which merged as #1376. It is the last wave of the plan; nothing waits on it.

### What to build

On 2026-10-08 16:43, `POST /api/continue` on desk `.worktrees/free-b5f1581a` answered `ok` and started a loop. The loop ignored the answer: it ran the take-up path, found uncommitted changes on the desk, and ended `holding-work` (`the desk holds unlanded work (uncommitted-changes); bug/local-checks-find-tests-in-a-temp-worktree is not taken up`). That ending overwrote the `blocked` ending, so `continueTarget` no longer routes an answer to the desk. `PLOT-BLOCKED.md` and `.plot-worker.continue.md` were still on disk and no new transcript was written (#1375).

Two defects, one per bullet:

1. **The JS loop has no continuation path.** `git grep CONTINUATION_NAME` finds the name only in `packages/board/src/server/continue.ts:75`, which writes the file. No reader exists in `packages/board/src/server/entry/worker-loop.ts` or `packages/domain/src/workflows/agent-loop.ts`: the shell loop read it, and #1337 removed the shell loop. Build the reader. A loop that finds `.plot-worker.continue.md` in its desk resumes the blocked session — `resumeId` from the manifest — with the file's text as the prompt, instead of taking the slice up again. `runPrompt` already accepts `resume: { resumeId, text } | null` (`worker-loop.ts:1283`) and feeds it to the SDK request (`:1352`); the correction path (`resume.kind === 'agent-resume'`, `:1644`) is the model to follow.
2. **Take-up reads the desk's own work as foreign work.** `agent-loop.ts:451` turns every `resetRefusals` entry other than `blocked-marker` into `holding-work`. On a desk whose assigned branch is the branch it is already on, uncommitted changes and unpushed commits are the slice's own work. Only unlanded work on a *different* branch is foreign.

An answer must also route when the desk's ending already reads `holding-work` while its `PLOT-BLOCKED.md` is unanswered. That is the state defect 2 left on `free-b5f1581a`, and `continueTarget` (`packages/domain/src/rules/continue-target.ts`) accepts only a `blocked` ending today.

### Settled decisions — do not re-derive them

- **The reader reads the file the controller writes; the controller does not change.** `continue.ts` already writes `.plot-worker.continue.md` (`CONTINUATION_NAME`) and the manifest, and the file name carries the `.plot-worker.` prefix on purpose so a marker search excludes it. Do not rename the file and do not add a second carrier. `continue.ts` changes only where the `holding-work` routing needs it.
- **Resume the blocked session; do not start a fresh one.** The answer is meaningful only in the conversation that asked the question. `fresh: true` (`continue.ts:886`) exists for the opposite case and stays opt-in.
- **Delete the continuation file once the turn has consumed it.** A file that stays makes every later pass resume the same answer. Delete it after the prompt has started, not before: a crash between read and run leaves the answer on disk for the next loop. Test both orders by name.
- **The continuation must not lose the `blocked` ending before the turn runs.** Observed failure: the loop wrote `holding-work` over `blocked` before any prompt. The continuation path runs before the take-up readings are decided, so no ending is written until the resumed turn has exited.
- **"Own work" is decided by branch equality, in the domain.** A reading carries the desk's checked-out branch and the assigned branch; the rule compares them. Do not decide it in `worker-loop.ts`, and do not drop `uncommitted-changes` from `readResetRefusals` — the reset gate (`desk_reset_refusal`) keeps its three reasons for every other caller.
- **Absent is not own.** A desk whose checked-out branch cannot be read, or is detached, counts as foreign: it ends `holding-work` as today. Only a branch read and equal to the assignment licenses taking the work up.
- **The rule stays pure and one test per answer.** `agent-loop.ts` and `continue-target.ts` import `zod` and nothing else. A mutation that makes foreign work count as own must fail a test.
- **Rejected: skip the take-up path whenever `PLOT-BLOCKED.md` exists.** That hides the foreign-work case for a blocked desk and leaves the `holding-work` defect in place for a desk with no marker.
- **Carried-over invariants:** absent is not false; read the exit code, not the emptiness; `EPERM` on a pid reads as alive (`pidAliveEverywhere`); a refused continuation writes and stops nothing. Open Question 3 of the plan stays open and is not this wave's to answer.

### Done when

The plan's `## Notes › Done when` list is the specification. Its first bullet belongs to this branch: given a desk with `PLOT-BLOCKED.md`, uncommitted work on its own branch and `.plot-worker.continue.md`, the loop resumes the blocked session with the continuation text, does not end `holding-work`, and does not overwrite the ending before the turn runs. The other bullets are waves 1 and 2 and must still pass.

Assertions that exist because a naive implementation passes without them:

- **The prompt the runner receives is the file's text and its `resumeId` is the manifest's.** A loop that resumes with the default prompt passes "the loop ran a turn".
- **The ending file is unchanged until the turn exits.** A loop that writes `holding-work` first and runs the turn second passes a check on the final ending only.
- **Uncommitted work on a different branch still ends `holding-work`.** An "own branch" rule that ignores the branch passes the first test and loses foreign work.
- **A detached or unreadable branch is foreign.** Absent-safe, as above.
- **The continuation file is gone after a completed turn and present after a crash before the turn.**
- **A desk whose ending reads `holding-work` with an unanswered marker is routed `continue`; the same desk with no marker is still refused.**

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Add a changeset (description first, `bumps:` block last). A PR carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of lines elsewhere in the same change, or write the rule in the domain and ask it through a bundle; the gate has no override.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/workflows/agent-loop.ts` and its test, `packages/domain/src/rules/continue-target.ts` and its test, the continuation reader in `packages/board/src/server/entry/worker-loop.ts`, `packages/board/src/server/continue.ts` where the `holding-work` routing needs it, and their tests.

Branches of other plans that touch the same files, verified 2026-10-08 against `origin/main` and `git ls-remote`:

- `infra/an-ending-that-held-nothing-releases-its-claim` (ref on origin) changes `worker-loop.ts` and the ending reasons. Rebase onto `main` before the PR, keep both sides on a conflict, and re-read `EndingReason` and `readEnding` from `main`.
- `bug/local-checks-find-tests-in-a-temp-worktree` is the blocked desk of the measured case. It touches none of this wave's files. Do not answer its question and do not edit its desk from this branch.

Issue #1373 lists follow-up findings from the review of #1372. They belong to #1373. Report any this branch makes worse instead of folding them in.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
