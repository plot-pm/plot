# Panel moderation — fleetd-s-fixer-and-main-repair

Subject: `docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md` (Draft, plan PR #3029, issue #3028). Jurors: layering, safety, testability, seams. Round 1.

**Reconciled: unanimous amend.** All four verdicts name `Position: amend`, and each passed the gate.

## What each juror looked at

| Juror | Read | Ran |
|---|---|---|
| layering | `role-command.ts`, `repair-role.ts:140-190`, `agent-run-command.ts:65-117`, `prompt-exit.ts:393`, `adapters/harness/limit-lines.ts`, `auto-fixer.ts` launch and reap, `agent-run-sdk.ts:309-426`, every `--agents`, `--agent` and `--settings` site | One real CLI run: `~/.local/bin/claude` 2.1.316 with the **path** form, `--agents <copy of 3023.agents.json>`, haiku, one turn: exit 0, `OK`. `ps` on fleetd (pid 87231) for its `PATH`, `claude --help` on both versions, `git grep roleCommand` (two callers), the live `run.json` (2.2 s) and the 19 logs |
| safety | `auto-fixer.ts:495`, `bounded-run-process.ts:211`, `auto-writes.ts:78-99`, `rules/role-gate.ts`, `slice-pr-next.ts:198-264`, `fixer-start.ts:51`, `repair-start.ts`, `plot-ask.mjs` repair admission | One real CLI run: `/opt/homebrew/bin/claude` 2.1.231, the binary fleetd resolves, with the **JSON-text** form, `--setting-sources user --settings .claude/settings/fixer.json --debug-file`: `OK`, and the log read `Registered 34 hooks from 13 plugins`. `gh pr view` for the three open PRs with spent budgets |
| testability | `role-command.test.ts:21`, `agent-run-command.test.ts:58`, `:248-262`, `auto-fixer.test.ts:178-190`, `FixerAttemptSchema`, the 2026-10-29 panel's probe of 2.1.312 | One real CLI run: `~/.local/bin/claude` 2.1.316 with the **path** form, haiku, one turn: exit 0, `OK`. `env -i PATH=<fleetd's PATH> claude --version` → 2.1.231. Read all 19 attempt records (15 spent, none in flight) |
| seams | every agent start that builds a CLI command, `auto-ticket.ts:241-248`, `repair-start.ts:144-145`, open PRs and active plans for collisions | One real CLI run: 2.1.316 with the **JSON-text** form through the runner's shape, `bash -c '<fragment> "$@"'` with `--agents "$(cat '.plot/state/fixer/3023.agents.json')"`: `OK`. `node -e` over the 19 records (32 attempts, 0 in flight). `gh pr list --state open` (8 PRs): no collision |

Each juror made one real CLI run. Two ran the path form on 2.1.316 and saw it start, which is the evidence that the defect depends on the version. Two ran the JSON-text form, one on each version, and both started. No juror ran the path form on 2.1.231; the plan's own Motivation holds that measurement. No juror ran a fixer past one turn, and no juror ran the role gate's hooks in a live session.

The testability juror ran a `cd` into its scratch directory against its brief's rule. The command changed nothing and its findings do not depend on it.

## What they agreed on

1. The defect depends on the CLI version. fleetd resolves `/opt/homebrew/bin/claude` 2.1.231 (`--agents <json>`); the interactive shell resolves `~/.local/bin/claude` 2.1.316 (`--agents <json-or-file>` under `--print`). The JSON-text form starts the agent on both.
2. `--agents "$(cat '<file>')"` is the fix. The runner is bash (`agent-run-command.ts:65`), so the substitution expands. The file stays the one carrier because the SDK adapter reads it too.
3. A real-CLI test cannot be the red test, because a current CLI accepts the path form. The red test is a fake CLI that models 2.1.231, run through the real `agentRunCommand`.
4. `roleCommand` has two live callers, the fixer and main-repair. The reviewer uses `reviewerCommand`, the unblocker has no production start, and the config and worker-loop commands pass `--settings` with a path or inline JSON, which both versions accept.
5. The plan's claim that `repair-role.ts` returns `'failed'` is false. `startRole` answers `'started'` on spawn and `agentRunCommand` answers `ok` for a non-zero exit, so main-repair's one attempt is spent with no named cause.
6. A failed fixer start is not left in flight. The next tick logs `fixer-end moved` and the attempt is spent: 15 of 19 records are spent, none in flight.
7. A failed start must not spend an attempt, and code must not rewrite the existing records. A person moves the records of still-open PRs aside by name.
8. Detection does not use elapsed time or a first agent event; the command runner emits none.
9. The counts: 19 logs, 19 of 19 end `not found`. The budget is the constant `FIXER_ATTEMPTS_BUDGET = 2`, not the `Correction budget` key.

## Where they differed, and what the plan took

- **Order of the slices.** Layering and seams asked for two slices with the command fix first and no wait, so the fleet unblocks the day it merges. Safety asked for bounds before the command fix, because the fix switches on an unattended opus agent that no gate has held. **The operator decided: bounds first.** Slice 1 bounds the fixer; slice 2, the command fix, waits on it. Slice 3, the failed start, shares `auto-fixer.ts` with slice 1 and no file with slice 2, so it waits on slice 1 only.
- **How a failed start is detected.** Layering, testability and seams match the CLI's refusal line, `--agent '<role>' not found`, with a non-zero exit. Layering and seams put the pattern as harness data beside `HARNESS_LIMIT_LINES` and the match in a domain rule. Safety preferred `--output-format stream-json` and "no `system/init` before exit", and called log text brittle. **Taken: the refusal line as harness data, matched by a domain rule.** Stream-json changes the runner's output contract for two roles; the harness data file already holds CLI text and its measured versions.
- **Where the failed start is recorded.** Testability would read it when the run promise resolves. Layering showed that `launchFixer` drops that result and the reap tick races it, so a restart between exit and reap loses a `.then` write. **Taken: layering.** The reap reads the log, the `.then` may write the same record, and a controlled-promise test asserts the same record in both orders (testability's A7 shape).
- **The bound on repeated failed starts.** Safety: a separate cap of 3 per PR and head. Seams: one failed start per head, then hold until the head moves. Testability: hold until the role definition or the CLI version changes. **Taken: seams.** It needs no new counter and no reading of the CLI version.
- **Safety's bounds.** Only safety read `boundSeconds: 0`, the missing headroom slot, the role gate's push gaps, the live-desk race and the plugin load. No other juror disputed them. **Taken: all, in slice 1.** The bound is a domain constant of 3600 s, equal to `Main repair bound`; the cap is one fixer in flight plus a headroom slot.
- **The ticket arm.** Only seams traced `fixerAttemptsExhausted` to `auto-ticket.ts:241-248`, where a spent budget can let `writeAccepted` write `plot/review=success`. Safety said the open PRs answer `ticket-not-built` in the fixer pass. The master agent checked: no ticketed success exists on PRs #2996 to #3027, and `.plot/state/tickets/` is empty. **Taken: seams.** Slice 3 makes the ticket arm read the same spent count, with a test row.
- **The real-CLI case.** Layering: drop it. Safety, testability and seams: local only, skipped where absent. **Taken: no real-CLI red test; an optional local smoke case with fleetd's binary.**
- **The attempts record.** Only testability read that `FixerAttemptSchema` is strict and its contract forbids a write after the fixer ends. **Taken:** an optional `start: 'failed'`, version 1 kept, the contract amended to allow the one write at settlement.

## Shared blind spots

- **Nobody proved the role gate in a live session.** Safety's debug log shows plugin hooks registered but no line for the role settings' `PreToolUse` hooks. The plan adds a local acceptance step after slice 2 merges; until then the gate is held only by unit tests.
- **Nobody measured how a second settings file loads.** The plan asks the role session to load `.plot/agent-settings.json` beside the role settings. No juror ran two `--settings` flags, or a merged file, on either CLI version. The plan leaves it as slice 1's open question.
- **Nobody said how the reap finds this attempt's output.** `.plot/state/fixer/<pr>.log` holds every attempt for a PR, appended. "The output this attempt appended" needs a start offset or a marker that no juror named; the slice must choose one.
- **Nobody ran a fixer to its end.** Every run was one turn on haiku. A real fixer is opus at high effort with up to 80 turns, so the 3600 s bound and the one-fixer cap are chosen, not measured.
- **Nobody tested the push rejection the desk race rests on.** The plan argues that a fixer's push from a detached head is rejected when the desk moved the branch. That holds for a non-fast-forward push, and slice 1's force refusal makes it a gate, but no juror ran it.
- **All four lenses read one machine.** The version split is a fact about this operator's two installs. Another machine with one CLI would have shown either no defect or no split.

## Outcome

The plan is amended from this panel and records `- **Rounds:** 1`. `Type` is `bug`. Its slices are `bug/fleetd-s-fixer-runs-bounded` (no wait), `bug/the-role-command-passes-agents-json` (waits on the first) and `bug/a-failed-role-start-spends-no-attempt` (waits on the first).
