# Panel: restart refuses unknown-branch when it has no current pulse

Round 1, 2026-11-04. Jurors: layering, safety, testability, seams. Result: unanimous amend. The plan is amended in the same commit as this file.

## Agreement

All four jurors found the same three defects, and the moderator verified each on origin/main:

- "Board impact: none" is false. `POST /api/restart` (`packages/board/src/server/restart.ts:64-68`) shares `restartBranch`, `pulseFor` (`packages/board/src/server/fleet.ts:3301-3303`) is `null` on a cold cache, and `refusalWord` (`ContinueWithAnAnswer.tsx:34-76`) is an exhaustive switch with no `default` under `strict: true`.
- The planned detail `the fleet has written no current reading` is false for the board caller, whose `null` is its own scan cache.
- `skills/plot/scripts/README.md:86` and the TSDoc at `packages/fleet/src/shared/restart-command.ts:105` and `packages/fleet/src/server/entry/restart-command.ts:18` list only `unknown-branch` and `no-worktree`.

## Disagreements

- **The board's wording.** Layering preferred that the board render the refusal's `detail` instead of growing `refusalWord`, because that switch is a decision made in a component. Safety, testability and seams asked for a `refusalWord` case. The plan adds the case. Reason: it is the existing pattern for every restart refusal, and moving the board to `detail` changes every refusal's text, which is a separate plan.
- **Who decides 404 against 503.** Layering and safety recommended 404, since no caller reads the status. Seams and testability left it to a person; seams argued that a board caller reads the status. Verified: `RestartTheWorker.tsx:55-58` reads `body.ok` and `body.reason`, not the status. The caller left the choice to the moderator, who took 404.
- **The reconcile test at `test/reconcile/restart.test.mjs:478-483`.** Safety named it and offered two fixes (assert `no-pulse`, or write a bridged pulse to keep `unknown-branch`). Testability and seams did not name it. The plan asserts `no-pulse`, because the sandbox has no bridge and the test then states the real cause.
- **The scope of the null-pulse mislabel.** Seams named the agent panel (`agent-panel.ts:161-162`) beside `continue`; the other three named `continue` only. Both go to #3117.
- **A partial pulse.** Safety alone named the partial-pulse mislabel (`fleet.ts:3305-3322`). No other juror looked at completeness. Filed as #3118.

## Shared blind spots

- No juror ran `tsc` or a test. Every TS2366 claim is inferred from the switch shape and `strict: true`. The slice's own `pnpm run typecheck` is the first observation.
- No juror named the null-pulse-with-worktree path as a test except testability, and its proposed test (`reached-review` through `continueOnDesk`) reads the desk on disk. The plan uses `caller: 'unattended'`, which `continueOnDesk` refuses at `continuation.ts:917-919` before any file read.
- No juror named `restart-stopped-command.ts` as a third caller except layering. It passes a recorded worktree where it has one, so its no-worktree, no-pulse branches now print `no-pulse`. It branches on no reason, so no change is needed there.

## What each juror ran versus read

- Layering: ran `git show origin/main:` and `git grep`; read the plan and CLAUDE.md. No typecheck or test.
- Safety: ran `git fetch`, `git show`, `git grep`; read the board route, `fleet.ts`, `plot-dispatch.sh` and the reconcile tests. No typecheck or test; did not read #3100.
- Testability: ran `git show`, `git grep`, `gh issue view 3100`; read the test bodies. No typecheck or test.
- Seams: ran `gh pr list`, `gh pr view --json files` for open PRs, `gh pr diff 3109`, `git grep`. No typecheck or test.

## Decisions

- Board impact, the board files, `pnpm run typecheck` and the board tests in the slice: caller.
- Rewrite `restart-command.test.ts:54-57` and `restart.test.mjs:478-483`, add the null-pulse-with-worktree case: caller. Both test lines verified on origin/main.
- The slice waits on `bug/an-answer-records-its-true-author` (#3109, open at amend time); #3112 touches `skills/plot/scripts/README.md`: caller. Both PRs verified open with `gh pr view`.
- README row and TSDoc refusal lists: caller.
- Status 404 for `no-pulse`: moderator. Reason: no caller branches on the status, and one literal changes it later.
- `continue` and the agent panel as follow-up #3117, not this slice: moderator, with all jurors leaning the same way. Reason: the issue scopes `restart`, and the follow-up reuses this slice's union member and sentence.
- The caller-neutral detail `no current fleet reading to look the branch up in` and the board sentence: moderator.
