# Panel moderation: a-missing-plot-worker-prompt-sh

Round 1, 2026-11-04. Four jurors: layering, safety, testability, seams. Every verdict names a position, and all four name `amend`. The gate refused no verdict.

## Agreement

All four jurors found the same three defects, each from its own lens:

- The plan names a fixed path, `.plot/worker-prompt.sh`. `resolvePrompt` (`packages/domain/src/rules/prompt.ts:40`) answers a charter's own prompt for a declared agent, so the fixed path refuses a working chartered agent and passes a chartered agent whose prompt is absent.
- The `sdk` runner falls back to Plot's shipped `templates/worker-prompt.md` (`worker-loop.ts:2181-2190`) and the `command` runner does not, so the refusal needs the runner as a reading. Open question 2 has an answer in the code.
- A domain rule for this decision already exists: `startCommand` (`packages/domain/src/rules/start-command.ts:54`), reached through `plot-start-command.mjs` from `ask_start_command` (`plot-dispatch.sh:1010-1033`). The plan's slice marker names a second rule.

Three jurors (layering, safety, seams) placed slice 2 at the existing `refusing to launch` site (`worker-loop.ts:1550-1553`) rather than at the two retry lines.

## Disagreements

1. **Whether `plot-fleetctl.sh` needs its own check.** Testability (finding 5, amendment A) asks for a `fleetctl.test.mjs` case and names `plot-fleetctl.sh` start, beside REFUSAL 5, as a start path to change or to prove. Seams (finding 2) says `/plot-fleet --start` reaches `plot-dispatch.sh --start`, so no caller changes, and an edit to `plot-fleetctl.sh` collides with plans #3113 and #3128. Layering (finding 4) agrees with seams. Resolution (caller): no edit to `plot-fleetctl.sh`; the plan states that `/plot-fleet --start` reaches `ask_start_command` through `plot-dispatch.sh --start` (`plot-fleetctl.sh:17-18`). No `fleetctl.test.mjs` case is added: the `dispatch.test.mjs` case proves the refusal, and a fleetctl case would prove only that fleetctl calls dispatch, which existing tests hold.
2. **Whether the adapter may ask `plot-install-prompt.sh` at all.** Safety (amendment A) allows it if the adapter matches the word `absent` only. Layering (finding 1) rejects the call outright, because the word parse is a decision in shell. Resolution (caller): the start path does not ask `plot-install-prompt.sh`; the entry reads existence directly.
3. **Whether fleetd's own dispatch needs its own test in `packages/fleet`.** Testability lists it as a decision for a person and asks for a fleet unit test if it counts. Seams and layering show that fleetd starts through `performer-shell.ts:93` (`plot-dispatch.sh --start 1`). Resolution (caller): fleetd counts, and the `dispatch.test.mjs` case covers it, because fleetd reaches the same line; no fleet-package test is added for slice 1.
4. **Whether `--restart` needs the slice 1 check.** Layering (finding 4) says `--restart` calls `startCommand` as `assigned`. The moderator checked origin/main: `--restart` runs `plot-restart-command.mjs` → `continueOnDesk` (`packages/fleet/src/shared/continuation.ts:908`), which does not ask `startCommand`; `start_worker`'s `assigned` call is the branch path, not `--restart`. Resolution (moderator): `--restart` gets no slice 1 check; slice 2's loop check ends that run after one named line, and the claim already exists there.

## Corrections to juror claims

- Layering and safety placed the `--start` refusal arm at `plot-dispatch.sh:2323-2331` / `:2321`; on origin/main the call is `:2326` and the arm is `:2329-2336`.
- Safety placed the final retry line at `worker-loop.ts:1825`; layering and seams placed it at `:1814`. On origin/main it is `:1814`.
- The entry that `startCommand` runs through lives in `packages/board/src/server/entry/start-command.ts`, not in `packages/fleet`.

## Shared blind spot

No juror noticed that the existing `refusing to launch` site returns `exit: { answer: 'unstarted' }`, which `agentLoop` row 7 (`packages/domain/src/workflows/agent-loop.ts:777-797`) retries up to `maxStartRetries` times. A check added at that site alone would log the named line on each of three attempts, not once. The plan adds an optional `refused` field to the `unstarted` arm of `PromptExit` (`prompt-exit.ts:110`), and row 7 ends at once when it is set. This also stops the existing charter refusal from retrying.

A second blind spot: the `--start` refusal arm prints `worker=no-loop` and a `--restart` hint for every `startCommand` refusal (`plot-dispatch.sh:2333-2334`), and the performer matches that word (`performer-shell.ts:103`). The new refusal inherits a footer that names the wrong defect. Filed as #3141; the plan keeps the footer to keep the shell at zero net lines.

## Ran versus read

- Layering: ran `git show` / `git grep` on origin/main; read the plan and `CLAUDE.md`; did not read the issue.
- Safety: ran `gh issue view 2529` and `git show` / `git grep` on origin/main; read the plan.
- Testability: ran `gh issue view 2529` and `git show` / `git grep`; read the write-probe claim from a comment (`plot-fleetctl.sh:1142`) and did not execute it.
- Seams: ran `git show` / `git grep`, `gh pr list`, `gh pr view` on 13 open PRs and #3128, and `gh issue view 2529`.
- No juror ran a test. The moderator ran `git show` / `git grep` and `sed` over the worktree at the idea branch head, `gh issue view 2529`, and the two plan gates; no tests.

## Decisions

| Decision | By |
|---|---|
| Extend `startCommand` with a prompt reading (runner, `resolvePrompt` answer, existence) passed as a value; no new rule | caller |
| Refuse only on the `command` runner when the resolved prompt file is absent; `sdk` runs | caller |
| Never gate on `plot-install-prompt.sh --check` | caller |
| No edit to `plot-fleetctl.sh`; zero net shell lines; `check-shell-lines.sh pr` in the gates | caller |
| The refusal runs before any desk or claim, in every start path including fleetd | caller |
| Changelog says a stranded claim still needs `--restart` | caller |
| Slice 2 refuses at the existing launch refusal and ends `unstarted` after one line; the `PLOT-BLOCKED` text names the file | caller |
| Open questions 1-3 closed with the code's answers; `## Tests` section added | caller |
| `refused?: string` on the `unstarted` arm of `PromptExit`, so row 7 ends at once | moderator: required to meet the caller's "one line"; an optional field leaves every other `unstarted` producer unchanged |
| A charter `refused` resolution also refuses in `startCommand` | moderator: fail-closed, and `resolve_launch` already refuses it on the branch path |
| `startCommand`'s prompt parameter is required | moderator: an optional reading would pass silently when a caller omits it |
| The entry gets the repo root and `Agent runner` as arguments on the existing `node` call lines; `PLOT_AGENT` from the environment | moderator: zero net shell lines, and the same root `plot-prompt.mjs --launch` receives |
| `--restart` covered by slice 2 only | moderator: `continueOnDesk` does not ask `startCommand`, and the claim pre-exists |
| Footer word `worker=no-loop` kept; #3141 filed | moderator: the performer matches it, and a change costs shell lines |
| No `fleetctl.test.mjs` case | moderator: the `dispatch.test.mjs` case covers the line every start path reaches |
