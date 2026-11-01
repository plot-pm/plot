# fleetd's fixer and main-repair agents never start

> `roleCommand` passes `--agents` a file path. The Claude Code CLI that fleetd runs (2.1.231) reads only JSON text there, so every fixer and main-repair start ends with `--agent '<role>' not found`. The fix is one argument, but it turns on an unattended opus agent that has never run, so the fixer is bounded first: a run-time bound, one fixer at a time, and a role gate that refuses force pushes and pushes to another branch. A start that dies before its agent runs is then recorded as a failed start and spends no attempt.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** delivery-loop
- **Issue:** #3028
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A fixer run ends after 3600 s, fleetd runs at most one fixer at a time and only when the machine has an agent slot, and the fixer and main-repair roles cannot force-push, push to another branch or delete a branch. Role sessions load the agent settings that limit plugins.
- fleetd's fixer and main-repair agents start on every Claude Code version: the role command hands the CLI the role definition as JSON text.
- A role start that dies before its agent runs is recorded as a failed start. It spends no fixer attempt and no main-repair attempt, it holds its PR head after one failure, and it cannot lead the ticket arm to write `plot/review=success`.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

`roleCommand` (`packages/domain/src/rules/role-command.ts:55-75`, added in `26100bfb8` on 2026-10-30) builds `claude -p --setting-sources user --agent <role> --agents '<path to agents.json>' --settings '<path>' [--max-turns N]`.

**The defect depends on the CLI version.** fleetd's `PATH` reaches `claude` through the cmux shim and then `/opt/homebrew/bin/claude` 2.1.231, whose help reads `--agents <json>`. The operator's `~/.local/bin/claude` 2.1.316 reads `--agents <json-or-file>` ("with --print the path to a file that holds one"). The 2026-10-29 panel probed 2.1.312, where the path form loaded the agent, so the path form was correct for the CLI it was probed on and wrong for the CLI fleetd runs. The JSON text, `--agents "$(cat '<file>')"` expanded by the runner's `bash -c` (`agent-run-command.ts:65`), starts the agent on both versions.

Measured 2026-11-01:

- `.plot/state/fixer/` holds 19 logs (#2975 has a lock and no log). 19 of 19 end with `--agent 'fixer' not found. Available agents: claude, ...`.
- `.plot/state/main-repair/run.log` ends with `--agent 'main-repair' not found`. `run.json` records a run of 2.2 s (`startedAt 1793557942178`, `endedAt 1793557944336`).
- With 2.1.231 and the same `.plot/state/fixer/3023.agents.json`, `--agents <path>` printed `--agent 'fixer' not found`, and `--agents "$(cat <path>)"` started the fixer, which answered.
- 8 of 12 slice PRs on 2026-11-01 got at least one HIGH review finding. Each waited until the master agent saw it and started a fix agent by hand. From the HIGH to the merge took 19 to about 100 minutes (#3003 40, #3004 53, #3005 19, #3013 about 100 over two rounds, #3020 29, #3023 29). #3012 stayed open for more than 3 hours.
- The review is not the slow part: it ran 2.5 to 4.5 minutes per head and started while CI still ran.

**Two live callers.** `roleCommand` has two production callers: the fixer (`packages/fleet/src/shared/auto-fixer.ts:383`) and main-repair (`packages/fleet/src/shared/repair-role.ts:133`). Both write the JSON from `roleAgentsJson` to `agentsFile` before they call it, and both run the fragment through `agentRunCommand`. The reviewer builds its command with `reviewerCommand` (`review-verdict.ts:157`), which passes no `--agents`, `--agent` or `--settings`, so reviews run. The unblocker is in `ROLE_NAMES` but has no production start. The config commands (idea, brief, implement and the others) pass `--settings "$PLOT_AGENT_SETTINGS"`, a path that both CLI versions accept, and the worker loop passes inline settings. None of them is affected.

**What a failed start costs today.** A failed start is not left in flight.

- The fixer: `launchFixer` resolves on `onStarted` at spawn and drops the run's result (`auto-fixer.ts:508`). The next tick reads the pid as dead, clears the mark and logs `fixer-end moved` (`auto-fixer.ts:244-247`). The attempt is spent. Of 19 records in `.plot/state/fixer-attempts/`, none holds `inFlight` and 15 hold both attempts of `FIXER_ATTEMPTS_BUDGET = 2` (`rules/fixer-attempts.ts:4`). `3023.json` holds two attempts on one head and one finding, because the second tick retried at once. The open PRs #3012, #3021 and #3022 have spent budgets.
- The ticket arm reads the same budget. `auto-ticket.ts:241` and `:248` pass `fixerAttemptsExhausted` to `writeAccepted`, which can write `plot/review=success` on a PR whose HIGH no agent ever fixed. On 2026-11-01 no PR from #2996 to #3027 carries such a ticketed success, and `.plot/state/tickets/` is empty.
- Main-repair: `startRole` resolves `'started'` on spawn (`repair-role.ts:140-144`), and `agentRunOf` returns `result.ok`, which `agentRunCommand` answers for any non-zero exit (`end: unstarted`). The warning "ended without a result" (`:146`) never fires for this failure. `repairStartStep` reads the record as `ended`, and the episode's one attempt is spent with no log line that names the cause.

**What the fix turns on.** No fixer or main-repair agent has run, so the role gate, the in-flight mark and the attempts budget have never held a live agent. Main-repair is bounded already: it claims `bug/main-repair-<12 hex>` by ref push before it starts, waits for a red re-run, makes one attempt per episode and runs under `Main repair bound` 3600 s. The fixer is not bounded:

- `launchFixer` passes `boundSeconds: 0` (`auto-fixer.ts:495`), and `bounded-run-process.ts:211` arms no timer for 0. While the run lives, `fixerInFlightArm` (`slice-pr-next.ts:198`) holds its PR, so a hung fixer holds the PR with no end.
- `runAutoFixerPass` runs behind `stopped()` only (`auto-writes.ts:78`). Verify takes a slot from `machine.headroom` (`:90`), and the fixer takes none. With 8 HIGHs in a day, one pass could start 8 opus/high fixers beside the desks and reviewers.
- `roleDeniesCommand` (`rules/role-gate.ts`) refuses a status write, a reviewer run, a merge, a push to the default branch and a closing keyword. It does not refuse `--force`, `-f`, `--force-with-lease`, a `+` refspec, a push to another branch or a branch deletion. "Never force-push" is prose in `fixerPrompt` (`fixer-start.ts:51`).
- `highArm` (`slice-pr-next.ts:221`) reads no desk state, so a fixer starts beside a live desk and beside the master agent's own fix agents, which push to the same branch.
- `roleCommand` passes the role's settings but not `.plot/agent-settings.json`. A debug run of the role command on 2.1.231 logged `Registered 34 hooks from 13 plugins`, among them oh-my-claudecode, whose `UserPromptSubmit` hook reads prompt text for mode keywords. The fixer prompt carries review findings word for word.

## Design

### Approach

**Slice 1: the fixer is bounded (no wait).** The fixers must not switch on before this merges.

- **Run time.** `launchFixer` passes `FIXER_BOUND_SECONDS = 3600` as `boundSeconds`, a domain constant beside `FIXER_ATTEMPTS_BUDGET`, equal to `Main repair bound`. A run past the bound ends, and the next tick clears its mark and logs `fixer-end` with the bound as the cause. A config key is a follow-up.
- **Concurrency.** A fixer start takes a slot from `machine.headroom`, as verify does (`auto-writes.ts:89-90`), and at most one fixer is in flight across all PRs. A second PR with a HIGH holds with the named reason `fixer-busy` while one fixer runs, and starts on a later pass.
- **The role gate.** `roleDeniesCommand` refuses, for the fixer and main-repair roles, a forced push (`--force`, `-f`, `--force-with-lease`, a `+` refspec), a push whose destination is not the role's own branch (the PR's head branch for the fixer, the claimed `bug/main-repair-*` branch for main-repair), and a branch deletion (`--delete`, `-d`, a `:<branch>` refspec). It parses through `gitPushCalls`, which the rule already imports. A Bash write to a protected path (`sed -i`, `cat >`) stays a known gap, named in Notes.
- **Plugins.** The role session gets `.plot/agent-settings.json` beside the role's settings, as desks do (`.plot/worker-prompt.sh:160`). The slice proves which form loads both files on 2.1.231 and on 2.1.316: a second `--settings`, or a role settings file that carries the agent settings' `enabledPlugins`. If `.plot/agent-settings.json` is absent, the role starts with its own settings and the run log says so once.
- **The races.** A HIGH with a live desk still starts the fixer. That is safe because the fixer pushes `HEAD:<branch>` from a detached head: a branch that moved rejects the push as non-fast-forward, and the role gate now refuses the force that would override it. The master agent reads `inFlight` in `.plot/state/fixer-attempts/<pr>.json` before it starts a hand fix, and the CLAUDE.md master-agent section says so (with `AGENTS.md` regenerated by `./scripts/check-agents-md.sh --write`).
- **Main-repair needs no new bound.** A person who repairs main must win the claim on `bug/main-repair-<12 hex of lastGreenSha>` first. `plot-ask.mjs merge` admits only the record's `repairPr` or `revertPr` on a red main, so a repair on any other branch name does not merge while the episode is open. The plan states this and changes nothing in it.

**Slice 2: the role command passes JSON text (waits on slice 1).** It waits because it switches the fixers on, not because it shares a file.

- `roleCommand` emits `--agents "$(cat -- <singleQuote(agentsFile)>)"`. `agentsFile` stays the one carrier, because the SDK adapter reads the same `RoleAgentRef.agentsFile` (`agent-run-sdk.ts:312`). The callers' file writes do not change. Inlining `singleQuote(json)` is the fallback if a reviewer wants a fragment with no file read.
- The doc comments at `role-command.ts:5-7`, `:27` and `:39-49` state the new shape and that the fragment needs a bash runner.
- `role-command.test.ts:21` stops pinning one exact string and asserts the parsed argument vector.
- The red test is a fake `claude` that models 2.1.231: a small node script in a `mkdtempSync` bin directory. It prints `--agent '<role>' not found. Available agents: claude` and exits 1 unless `--agents` parses as a JSON object with a key equal to `--agent`, and otherwise prints a fixed line and exits 0. Each `ROLE_NAMES` fragment runs through the real `agentRunCommand` and the real `boundedRunProcess`, with that bin first on `PATH`, so the adapter's `bash -c '<fragment> "$@"'` expansion and the quoting are under test. The test never runs the fragment through its own `sh -c`. The test over every `ROLE_NAMES` entry holds the rule; only the fixer and main-repair are live callers.
- No real-CLI case is the red test. On 2.1.312 and later the path form passes, so a real-CLI case proves only that the new form starts. A local smoke case, skipped where `claude` is absent and in CI, may run it with the `claude` that fleetd's `PATH` resolves.

**Slice 3: a failed start spends no attempt (waits on slice 1).** It shares `auto-fixer.ts` with slice 1 and no file with slice 2, so it can merge before or after slice 2.

- **Harness data.** The CLI's startup refusal, `--agent '<role>' not found`, is held as data beside `HARNESS_LIMIT_LINES.claude` in `packages/domain/src/adapters/harness/limit-lines.ts` (or a sibling data file under `adapters/harness/`). The real line from `.plot/state/fixer/3023.log` is its fixture.
- **One domain rule.** A pure rule answers "failed start" for a non-zero exit whose output this run appended carries the refusal line. A non-zero exit without it is not a failed start, because `promptExit` answers `unstarted` for every non-zero exit with no limit line (`prompt-exit.ts:393`), a fixer that ran 60 turns included. The rule runs under the domain's 100% branch gate. No controller, `.tsx` or `.then` makes the decision.
- **The fixer records it at reap time.** Where the tick settles a dead pid (`auto-fixer.ts:243`, `:300`), it reads the output this attempt appended to `.plot/state/fixer/<pr>.log` and writes `start: 'failed'` on the attempt with the refusal line, and logs `fixer-end failed-start: <line>` instead of `moved`. The `.then` in `launchFixer` may write the same record, and the record is the same whichever runs first. A fleetd restart between the exit and the reap loses nothing, because the log is on disk.
- **The attempts record.** `FixerAttemptSchema` gains an optional `start: 'failed'`. Old records decode with it absent, so `FIXER_ATTEMPTS_VERSION` stays `1`. The contract "never mutated after the fixer ends" is amended: the tick that settles the attempt writes `start` once, as part of that settlement.
- **The budget.** `fixerAttemptsSpent` and `fixerAttemptsExhausted` skip an attempt with `start: 'failed'`. `auto-ticket.ts` reads the same functions, so a record that holds only failed starts leads to neither `putOnTicket` nor `writeAccepted`.
- **The bound on failed starts.** A failed start holds its PR head: the next pass starts no fixer on that head and logs the hold once, with the reason `fixer-start-failed`. A new head starts again. A lasting failure (a missing CLI, expired auth) therefore starts at most one process per head, never one per tick.
- **Main-repair.** `agentRunOf` reads `end` and the same rule, not only `result.ok`. A failed start writes `outcome: 'start-failed'` with the refusal line, logs a warning that names it, and does not spend the episode's one attempt. A second failed start in the same episode holds the episode and logs the hold once.
- **Existing records.** No code rewrites the 19 existing records, because their attempts carry no `start` field and the slice cannot tell them apart. After slice 3 merges, a person moves `.plot/state/fixer-attempts/<pr>.json` for each still-open PR with a spent budget to the Trash by name (on 2026-11-01: #3012, #3021, #3022). A closed PR's record stays.

### Constraints

- New and changed functions are arrows. TSDoc states behaviour, not history.
- Every test removes its temp directory by the exact name `mkdtempSync` returned, and waits for each process it started by its own pid.
- The race test in slice 3 uses no clock: a stub `agentRun` calls `onStarted`, then resolves on a promise the test controls, and the test runs the reap tick before and after the run resolves.
- Each slice changes shipped code and carries a changeset for package `plot`.

### Open Questions

- [x] Does the runner run the fragment through a shell? Yes, through bash: `agentRunCommand` runs `env -u PLOT_REPO_ROOT bash -c '<fragment> "$@"' _ <prompt>` (`agent-run-command.ts:65`, asserted at `agent-run-command.test.ts:58`). Both callers build that adapter (`auto-fixer.ts:615`, `repair-start-world.ts:53`). The JSON is 1257 bytes (fixer) and 1191 bytes (main-repair), far below `ARG_MAX`.
- [x] How is a failed start detected? By a non-zero exit plus the CLI's refusal line in the output this run appended, matched by a domain rule over harness data. Not by elapsed time, not by the exit status alone, and not by a first agent event, which the command runner does not emit.
- [x] Does a failed start spend an attempt? No. It records `start: 'failed'`, holds its head, and spends neither the fixer budget nor the main-repair episode's attempt. Existing records are not re-opened by code.
- [x] Is a real-CLI case run in CI? No. CI has no `claude`, and a current CLI accepts both forms. The fake that models 2.1.231 is the gate.
- [ ] Which form loads both the role settings and `.plot/agent-settings.json` on both CLI versions? Slice 1 measures it and records the answer in its PR.

## Done when

Slice 1 rows run in `pnpm --filter @plot-pm/domain exec vitest run` and `pnpm --filter @plot-pm/fleet exec vitest run`. Slice 2 and slice 3 rows run in the same suites.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| A fixer run ends at its bound | stub run that never ends; `boundSeconds` read from the request | the request carries `FIXER_BOUND_SECONDS`; a run past it ends and the next tick clears the mark | `auto-fixer.test.ts`, `bounded-run-process` test | 1 |
| One fixer runs at a time | two PRs with a HIGH; one fixer in flight | the second holds with `fixer-busy`; it starts after the first ends | `auto-fixer.test.ts` | 1 |
| A fixer takes a machine slot | headroom answers no slot | no fixer starts; the reason is logged | `auto-writes` test | 1 |
| The role gate refuses a force push | `git push --force`, `-f`, `--force-with-lease`, `+HEAD:b` for fixer and main-repair | refused | `role-gate.test.ts` | 1 |
| The role gate refuses another branch | `git push origin HEAD:other`, a push from a checkout of another branch | refused | `role-gate.test.ts` | 1 |
| The role gate refuses a deletion | `git push --delete origin b`, `git push origin :b` | refused | `role-gate.test.ts` | 1 |
| The role's own push passes | `git push origin HEAD:<pr head branch>` (fixer), `HEAD:bug/main-repair-<hex>` (main-repair) | allowed | `role-gate.test.ts` | 1 |
| The role session loads the agent settings | `.plot/agent-settings.json` present; absent | both settings reach the command; absent → one log line | `role-command.test.ts` or the callers' tests | 1 |
| The 2.1.231 fake refuses a path and accepts JSON | the fake alone | path → exit 1 with the refusal line; JSON naming the role → exit 0 | `role-command-cli.test.ts` | 2 |
| Each role starts through the real runner | every `ROLE_NAMES` fragment, fake first on `PATH`, real `agentRunCommand` and `boundedRunProcess` | exit 0, the fake's fixed line | `role-command-cli.test.ts` | 2 |
| Quoting survives | `agentsFile` path with a quote and a space; JSON with a `'` (the live fixer and main-repair JSON hold one) | exit 0 | `role-command-cli.test.ts` | 2 |
| A missing agents file fails | `agentsFile` absent | exit 1 with the refusal line | `role-command-cli.test.ts` | 2 |
| The argument vector, not a string | `roleCommand` output | the parsed vector holds `--agents` followed by the JSON command substitution | `role-command.test.ts` | 2 |
| The refusal line is a failed start | the 19 live log tails; one non-zero tail without the line | failed start for each of the 19; not a failed start for the other | `role-start` rule test | 3 |
| The reap records the same failed start in either order | stub run: `onStarted`, then resolve on a test-held promise with the refusal line; reap before and after resolve | the same attempt record (`start: 'failed'`) and one `fixer-end failed-start` line in both orders | `auto-fixer.test.ts` | 3 |
| A failed start spends no attempt | a record with two failed starts | `fixerAttemptsSpent` 0; not exhausted | `fixer-attempts.test.ts` | 3 |
| The ticket arm does not accept on failed starts | a PR with a HIGH and a record of two failed starts | no `putOnTicket`, no `writeAccepted` | `auto-ticket.test.ts` | 3 |
| A failed start holds its head | a failed start on head A; next pass on A; then head B | no start on A, one hold line; a start on B | `auto-fixer.test.ts` | 3 |
| Main-repair names a failed start | stub run that resolves with the refusal line | `outcome: 'start-failed'`, a warning that names the line, the episode's attempt unspent; a second failed start holds | `repair-role.test.ts` | 3 |
| Old records decode | the 19 live records as fixtures | decode with `start` absent; version 1 | `fixer-attempts.test.ts` | 3 |

**Mutation checks.** Slice 1: pass `boundSeconds: 0` again, and the bound row fails; drop the `+` check, and the force row fails. Slice 2: revert `roleCommand` to `singleQuote(role.agentsFile)`, and the real-runner row fails. Slice 3: count failed starts in `fixerAttemptsSpent`, and the budget and ticket rows fail; write the record only from the `.then`, and the reap-order row fails.

**Live acceptance (local, after slice 2 merges, before the fleet runs with it).** A person starts the fixer command with fleetd's `claude` (2.1.231) against a scratch repository and confirms that the role gate refuses `gh pr merge` and `git push --force`, and that the session log shows the agent settings' plugin set. The result is recorded on the plan PR.

## Slices

### Fixer bounds

- `bug/fleetd-s-fixer-runs-bounded` — `auto-fixer.ts`: `FIXER_BOUND_SECONDS` as `boundSeconds`, one fixer in flight, a machine headroom slot (with `auto-writes.ts`); `rules/role-gate.ts`: refuse forced pushes, pushes to another branch and branch deletions for the fixer and main-repair roles; the agent settings on the role session; the master-agent sentence in CLAUDE.md and the regenerated `AGENTS.md`; the slice 1 rows; a changeset for `plot`. <!-- builds: a run-time bound, a concurrency cap and a push gate for fleetd's role agents -->

### Role command

- `bug/the-role-command-passes-agents-json` — `rules/role-command.ts`: `--agents "$(cat -- '<file>')"`, the doc comments; `role-command.test.ts` on the argument vector; the 2.1.231 fake and the real-runner rows; a changeset for `plot`. <!-- waits: bug/fleetd-s-fixer-runs-bounded --> <!-- builds: roleCommand JSON agents argument -->

### Failed start

- `bug/a-failed-role-start-spends-no-attempt` — the refusal line as harness data; the domain rule; `start: 'failed'` on the fixer attempt, written at reap time; `fixerAttemptsSpent` and the ticket arm skip it; the head hold; main-repair's `start-failed` outcome; the slice 3 rows; a changeset for `plot`. <!-- waits: bug/fleetd-s-fixer-runs-bounded --> <!-- builds: a failed-start outcome for role starts -->

## Notes

- Source: tracker issue #3028. Nothing was written to the tracker. Amended from panel round 1 (`.plot/panels/2026-11-01-fleetd-s-fixer-and-main-repair/panel.md`, unanimous amend).
- Definition of Done: docs/definition-of-done.md.

**Left out, each a follow-up rather than a slice here:**

- Two Claude Code CLIs are installed: fleetd resolves `/opt/homebrew/bin/claude` 2.1.231, the interactive shell `~/.local/bin/claude` 2.1.316. fleetd's desks resolve the same 2.1.231 binary, and the limit lines in `limit-lines.ts` were measured on 2.1.286 and 2.1.291. fleetd should log the `claude --version` it resolves at start and on each role start.
- The reviewer (`reviewerCommand`) and the unblocker (no production start) are unaffected. The issue's claim that they share `roleCommand` is wrong.
- `launchFixer` passes no `roleAgent`, while main-repair does (`repair-role.ts:175`). The SDK adapter reads it (`agent-run-sdk.ts:312`, `:426`), so the fixer cannot move to the SDK runner without it.
- Both role starts could move to the SDK runner, whose `loadRole` already answers `unstarted` with a named reason (`agent-run-sdk.ts:309-330`). That changes the runner for two roles.
- A Bash write to a path the role gate protects (`sed -i`, `cat >`) is not refused. Only Write, Edit and NotebookEdit are path-checked.
- `FIXER_BOUND_SECONDS` could become a `## Plot Config` key.
- `roleAgentsJson` could refuse a JSON text over 100 KB, below Linux's 128 KiB per-argument limit. The live files are about 1.2 KB.
- `plot-fleet --stop` skips new fixer starts (`auto-writes.ts:77`). Whether it ends a running fixer is not stated.
- `BoardAgentModelReading.roleCommand` (`board-agent-models.ts:22`) shares the name `roleCommand` and holds a config command string.
