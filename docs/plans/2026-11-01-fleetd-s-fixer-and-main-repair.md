# fleetd's fixer and main-repair agents never start

> `roleCommand` passes `--agents` a file path where the Claude Code CLI reads JSON text, so every fixer and main-repair start ends with `--agent '<role>' not found`.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3028
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd's fixer and main-repair agents start: the role command hands the CLI the role definition as JSON text, and a start that fails before its agent runs is reported as a failed start.

<!-- Board impact: none. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

`roleCommand` (`packages/domain/src/rules/role-command.ts:55-75`, added in `26100bfb8` on 2026-10-30) builds `claude -p --setting-sources user --agent <role> --agents '<path to agents.json>' --settings '<path>' [--max-turns N]`. The CLI's `--agents` flag takes the JSON text (`claude --help`: `--agents <json>  JSON object defining custom agents`). Given a path, the CLI defines no agent and `--agent <role>` fails.

Measured 2026-11-01:

- `.plot/state/fixer/` holds logs for 20 PRs (#2973 to #3023). 19 of them end with `--agent 'fixer' not found. Available agents: claude, ...`.
- `.plot/state/main-repair/run.log` ends with `--agent 'main-repair' not found`.
- With Claude Code 2.1.231 and the same `.plot/state/fixer/3023.agents.json`, `--agents <path>` printed `--agent 'fixer' not found`, and `--agents "$(cat <path>)"` started the fixer, which answered.
- 8 of 12 slice PRs on 2026-11-01 got at least one HIGH review finding. Each waited until the master agent saw it and started a fix agent by hand. From the HIGH to the merge took 19 to about 100 minutes (#3003 40, #3004 53, #3005 19, #3013 about 100 over two rounds, #3020 29, #3023 29). #3012 stayed open for more than 3 hours.
- The review is not the slow part: it ran 2.5 to 4.5 minutes per head and started while CI still ran.

The callers are `packages/fleet/src/shared/repair-role.ts` and `packages/fleet/src/shared/auto-fixer.ts`. The reviewer and unblocker roles share `roleCommand`. Both callers already write the JSON from `roleAgentsJson` to `agentsFile` before they call `roleCommand`.

## Design

### Approach

1. **Command shape.** `roleCommand` emits the JSON text instead of the path. The candidate is `--agents "$(cat '<agentsFile>')"`, which is the form measured to start the fixer. `agentsFile` stays the carrier, so the quoting rule (`singleQuote`) and the callers' file writes stay as they are. The alternative, inlining the JSON into the fragment, makes the fragment depend on the JSON's own quoting and grows every logged command.
2. **Parser test.** A test runs the fragment `roleCommand` builds against a fake `claude` on `PATH` that rejects a path where JSON is required (`--agents` value must parse as a JSON object) and prints `--agent '<role>' not found` as the CLI does when no agent is defined. The test fails on today's shape. Where the real CLI is installed, a second, skipped-when-absent case runs the real argument parser. The test covers every role `roleCommand` accepts, so the reviewer and unblocker are held too.
3. **Failed start.** A role start whose process ends with an error before its agent runs is reported as a failed start: `auto-fixer.ts` records the attempt as a failed start instead of leaving it in flight, and fleetd logs it. `repair-role.ts` already returns `'failed'` when the run ends without a result; the slice checks that its log line names the cause.

### Open Questions

- [ ] Does the runner that executes the fragment (`agentRunOf`, the `command` runner) run it through `sh -c`, so that `$(cat ...)` expands? If it execs without a shell, the JSON must be inlined or passed through an environment variable.
- [ ] How does a start "end with an error before its agent runs" get detected: by the exit code and a `not found` line in the log, or by the absence of a first agent event? The fixer attempts record has `markInFlight`; the failed-start outcome needs a field or a state there.
- [ ] Does a failed start spend a correction attempt (`Correction budget: 2`)? Today `startFixer` keeps the attempt spent when a launch starts no process. With 19 of 20 logs failing this way, the budget of any PR the fleet tried is already spent; the slice states whether those records are re-opened.
- [ ] Is the real-CLI test case run in CI, where `claude` is not installed, or only locally?

## Slices

### Role command passes JSON

- `feature/fleetd-s-fixer-and-main-repair` — `roleCommand` hands the CLI the role JSON, a test holds the shape against a parser that rejects a path, and a start that fails before its agent runs is reported as a failed start <!-- builds: roleCommand JSON agents argument, a failed-start outcome for role starts -->

## Notes

- Source: tracker issue #3028. Nothing was written to the tracker.
