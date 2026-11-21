# Fleet agents start only the MCP servers they use

> Every agent that fleetd or the board starts passes `--strict-mcp-config`, so it starts no MCP server and loads no connector list unless its command names one. Today only the reviewer does.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3178
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3616 merged

## Changelog

- The fixer, main-repair and unblocker agents start no MCP server. Their command passes `--strict-mcp-config`, as the reviewer's command already does.
- An agent started through a configured command loads no MCP server once that command carries `--strict-mcp-config`. To get this for your own agents, add `--strict-mcp-config` to the `claude -p` command in your `.plot/worker-prompt.sh` and to each `claude -p` agent command key in your `## Plot Config` (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`, `Verify`, `Design command`). The SDK runner (`Agent runner: sdk`) follows the same command: it loads no MCP server only where the run's command carries the flag.

<!-- Board impact: none for the plan format, the template, the helper scripts' interface or the docs/plans layout. Slice 1 changes a domain rule and the SDK adapter's role options. Slice 2 changes this repository's `## Plot Config` commands and `.plot/worker-prompt.sh`, and makes the shipped SDK adapter follow the run's command fragment. A builder runs `pnpm build:board` only to test and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one. -->

## Motivation

An agent that fleetd or the board starts inherits every MCP server the operator's user settings and enabled plugins declare. Each server is one or more processes per agent run, and each new process costs a macOS `syspolicyd` check (story `nothing-changed-nothing-runs`, #3170).

- **The role command has no flag.** `roleCommand` (`packages/domain/src/rules/role-command.ts:66-88`, command array at `:73-85`) builds `claude -p --setting-sources user --agent <role> --agents … [--allowedTools …] --settings … [--max-turns n]` and no `--strict-mcp-config`. Its three callers are the fixer (`packages/fleet/src/shared/auto-fixer.ts:550`), main-repair (`packages/fleet/src/shared/repair-role.ts:116`) and the unblocker (`packages/fleet/src/server/entry/registryd-main.ts:1591`). The SDK runner's role options (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts:333-338`) set `settingSources: ['user']` and no strict MCP option either.
- **Only the reviewer has it.** `reviewerCommand` passes `--strict-mcp-config` (`packages/domain/src/rules/review-verdict.ts:245`), held by `packages/domain/test/review-verdict.test.ts:146` and `packages/board/test/unit/review.test.ts:420`. In code, `git log -S 'strict-mcp-config'` on `origin/main` finds only the reviewer commits `1ccfeeb02`, `7296d9069` and `975af3970`; the other hits are plans, panel notes, a release and bundle builds.
- **The worker and board agent commands have none.** `.plot/worker-prompt.sh:158-191` assembles `settings_args`, `head_args` and `tail_args` with no MCP flag. The seven `claude -p` keys in `CLAUDE.md` `## Plot Config` (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`, `Verify`, `Design command`) carry `--settings` and `--permission-mode bypassPermissions` and no MCP flag. Every non-role SDK run uses `settingSources: ['user', 'project', 'local']` (`agent-run-sdk.ts:468`) and no strict MCP option. That options object (`agent-run-sdk.ts:442-475`) serves board agents (`packages/board/src/server/sdk-runner.ts:57`) and fleet workers on `Agent runner: sdk` (`packages/fleet/src/server/entry/worker-loop.ts:2329`).
- **Measured 2026-11-21 07:06, read-only, with `ps -eo pid,ppid,command` over this machine's process tree.** Two `claude -p` processes ran. The reviewer (pid 43790, `--strict-mcp-config`) had 0 descendant processes. A board interrogate agent (pid 70320, `claude -p --model sonnet --settings …/.plot/agent-settings.json --permission-mode bypassPermissions`) had 3 descendants and 2 MCP servers: oh-my-claudecode's `bridge/mcp-server.cjs`, and `npm exec @modelcontextprotocol/server-pdf --stdio` with its child `mcp-pdf-server`. No fixer ran at the time of the reading.
- **The issue's Playwright server is not in today's reading.** The issue measured `npm exec @playwright/mcp@latest --cdp-endpoint http://127.0.0.1:9393` under a fixer on 2026-11-05. On 2026-11-21 `~/.claude.json` declares no user-level `mcpServers`, so today's servers come from enabled plugins. The defect is the same: whatever the operator's configuration declares, every fleet agent starts it.
- **No fleet agent called an MCP tool.** A structural parse of the `tool_use` blocks in the 841 transcripts under `~/.claude/projects/*plot*worktrees*` modified in the last 14 days (to 2026-11-21) found 0 calls to any `mcp__*` tool. The 2026-10-03 parse of 384 worker transcripts found 0 as well (`docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md`, Notes, slice 2).
- **The role files cannot use an MCP tool.** The `tools:` list of every role in `.claude/agents/` names only built-in tools: `fixer.md` and `main-repair.md` list `Read, Grep, Glob, Write, Edit, Bash`; `reviewer.md` and `unblocker.md` list `Read, Grep, Glob`. The role parser also drops an `mcpServers:` key (`role-command.ts:118`, `JSON_KEYS` at `:94-96`). So a role agent starts its MCP servers and cannot call one of their tools.
- **The flag was tried for workers once and not adopted.** On 2026-10-03, `--strict-mcp-config` with no `--mcp-config` cut one worker's first request from 87,676 to 20,365 tokens and removed every MCP tool, connector and plugin. The slice kept the flag out because its brief (`.plot/briefs/a-worker-starts-without-unused-context.md:27`) forbade removing tools workers called, and the plan then stated that workers called oh-my-claudecode's MCP tools. The same Notes entry corrects that statement: no worker called any MCP tool. The reason for the earlier non-adoption therefore does not hold.

## Design

### Approach

**Which MCP servers each kind of agent needs.** None, for every kind this plan touches, on this repository's evidence above:

| Agent | Started by | MCP servers it needs | Evidence |
|---|---|---|---|
| reviewer | `reviewerCommand` | none | already strict (`review-verdict.ts:245`) |
| fixer, main-repair | `roleCommand` | none | `tools:` names no MCP tool; 0 MCP calls |
| unblocker | `roleCommand` | none | `tools:` names no MCP tool |
| worker | `Worker command` → `.plot/worker-prompt.sh` | none | 0 MCP calls in 841 worktree transcripts |
| idea, story, brief, implement, interrogate, verify, design | `## Plot Config` command keys | none | Plot's skills name no `mcp__` tool (`git grep mcp__ -- skills` hits only generated bundles); Plot reaches hosts and trackers through `plot-host.sh` |

**How an agent that needs a server gets one.** It names only that server with `--mcp-config <file>` beside `--strict-mcp-config`, in its own command. No role or command in this plan does so. The 2026-10-03 trial shows the two costs of this route for a plugin server: the file pins the plugin's installed version path, and the tool prefix changes from `mcp__plugin_<plugin>_<server>__*` to `mcp__<server>__*`. A future role that needs a server is a plan of its own.

**Slice 1, the role commands:**

- `roleCommand` adds `--strict-mcp-config` after `--setting-sources user`, the position the reviewer uses relative to its own setting source. The TSDoc block of `roleCommand` states that the fragment loads no MCP server.
- The SDK adapter's role options (`agent-run-sdk.ts:333-338`) add `strictMcpConfig: true`, so `Agent runner: sdk` role runs behave as the command runner's. This follows the rule of slice 2, the flag follows the run's command fragment: a role's fragment is `roleCommand`'s, and after this slice it always carries `--strict-mcp-config`. `strictMcpConfig?: boolean` is at `sdk.d.ts:2301` in `@anthropic-ai/claude-agent-sdk` 0.3.288, the version `packages/domain/package.json:33` pins; the SDK documents it as the CLI's `--strict-mcp-config`.
- **Tests:**
  - `packages/domain/test/role-command.test.ts:39-48`: the exact word list gains `--strict-mcp-config`; this case fails without the flag.
  - `packages/domain/test/role-command.test.ts`: a new case asserts that the flag is present with and without `--allowedTools` and with and without `--max-turns`.
  - `packages/domain/test/agent-run-sdk.test.ts:487-495` (*maps the role to agent, agents, settings and user settings only*): the case also asserts `options.strictMcpConfig` is `true`; it fails today.
  - No caller test changes. No caller test compares a whole role command: `packages/fleet/test/unit/repair-role.test.ts:90` uses `toContain('--agent main-repair')`, and the fixer and unblocker tests have no whole-string assertion. The three callers pass `roleCommand`'s fragment through and append only a second `--settings` (`auto-fixer.ts:550-557`, `registryd-main.ts:1591-1596`, `repair-role.ts:116`), so `role-command.test.ts` is the proof.

**Slice 2, the worker and board agent commands:**

- `.plot/worker-prompt.sh` adds an `mcp_args=(--strict-mcp-config)` array guarded on `harness = claude`, expanded with the `${a[@]+"${a[@]}"}` form for bash 3.2, and puts it into `head_args`, so the `PLOT_PRINT_INVOCATION=1` print and the launch read the same argv and fleetd's write probe (`write-probe-shell.ts`) tests the command that runs.
- The seven `claude -p` keys in `CLAUDE.md` `## Plot Config` add `--strict-mcp-config` before `--permission-mode bypassPermissions`. `Worker command` does not change: it runs `plot-worker-loop.sh`, which runs `.plot/worker-prompt.sh`. Then run `./scripts/check-agents-md.sh --write`, because `AGENTS.md` is generated from `CLAUDE.md` and CI refuses a mirror that differs.
- **The SDK runner follows the command fragment.** The SDK options object (`agent-run-sdk.ts:442-475`) serves board agents and fleet workers on `Agent runner: sdk` (`worker-loop.ts:2329`), and it is shipped code. It sets `strictMcpConfig: true` only where the run's command fragment carries `--strict-mcp-config`, so an adopter on `Agent runner: sdk` keeps its MCP tools unless its own command opts in. A domain rule `fragmentStrictMcp(fragment): boolean` in `packages/domain/src/rules/fragment-strict-mcp.ts` answers whether a fragment names the flag as a whole word, beside `fragmentModel` (`rules/fragment-model.ts`). `AgentRunRequest` (`packages/domain/src/ports/agent-run.ts`) gains `strictMcp: boolean`. The board's caller sets it from the role's fragment (`packages/fleet/src/shared/agent-run-for.ts:76`, the `## Plot Config` key), and the worker loop sets it from `Worker command` (`worker-loop.ts:2289`), the fragment `runnerChoice` already reads there.
- **The worker on the SDK runner, in this repository.** `Worker command` runs `plot-worker-loop.sh` and does not carry the flag, so a worker on `Agent runner: sdk` here would still load its MCP servers. This repository sets no `Agent runner` key, so its workers run on the command runner and get the flag from `.plot/worker-prompt.sh`.
- **Tests:**
  - `test/reconcile/agent-commands-strict-mcp.test.mjs` (new): for each of the seven keys, `skills/plot/scripts/plot-config.sh get "<key>"` in this repository answers a command that contains `--strict-mcp-config`; a case runs `.plot/worker-prompt.sh` under `PLOT_PRINT_INVOCATION=1` with `PLOT_HARNESS=claude` and asserts the printed argv contains the flag once; a case with `PLOT_HARNESS=codex` asserts the flag is absent. The model for running the prompt is the `argv` helper in `test/reconcile/charter-reaches-launch.test.mjs:61-94`, with its "never reached the launch" guard.
  - `test/reconcile/charter-reaches-launch.test.mjs:196` (*the print carries every flag the launch line passes (#2778)*): the charter-less expectation for this repository's file becomes `['--strict-mcp-config', '--permission-mode', 'bypassPermissions']`. The template's expectation does not change, because the template does not change. The same case's print-equals-launch assertion (`:191`) keeps passing, because the print and the launch read one `head_args`; that assertion is the proof that fleetd's write probe tests the launched argv.
  - `packages/domain/test/fragment-strict-mcp.test.ts` (new): a fragment with the flag answers `true`; a fragment without it, an empty fragment, and a fragment naming `--strict-mcp-config-x` answer `false`.
  - `packages/domain/test/agent-run-sdk.test.ts:144`: a non-role request with `strictMcp: true` sets `options.strictMcpConfig` to `true`, and one with `strictMcp: false` leaves it unset.
- **One measurement, read-only:** after both slices merge, `ps -eo pid,ppid,command` during one worker run, one fixer run and one board agent run shows no MCP server process under any of the three `claude -p` processes. Notes records the date, the three pids and each descendant count.

**Layering.** `roleCommand` is a domain rule and stays the one place that builds a role command; the SDK adapter is the one place that builds SDK options. No controller adds a flag. The worker prompt and the config keys are this repository's configuration, so slice 2 changes no shipped template. The one shipped behaviour change in slice 2 is that the SDK runner reads the flag from the run's command fragment, which changes nothing for an adopter whose commands do not carry it.

### Open Questions

- [x] The shipped `skills/plot/templates/worker-prompt.sh` and `skills/plot/templates/claude-md-snippet.md` stay as they are (operator decision, 2026-11-21). This plan changes this repository's configuration only; an adopter's agents may call an MCP tool, and the Changelog tells adopters how to opt in.
- [x] The flag goes on all seven board-agent keys in this repository (operator decision, 2026-11-21).
- [x] The SDK runner sets `strictMcpConfig` only where the run's command fragment carries `--strict-mcp-config` (operator decision, 2026-11-21).

## Slices

### Role commands

- `bug/role-agents-start-no-mcp-server` — `roleCommand` passes `--strict-mcp-config`, the SDK role options set the strict MCP option, and the role-command, SDK and caller tests pin it <!-- builds: --strict-mcp-config in roleCommand and the SDK role options -->

### Worker and board agents

- `bug/workers-and-board-agents-start-no-mcp-server` — `.plot/worker-prompt.sh` adds `--strict-mcp-config` through `head_args`, the seven `## Plot Config` agent commands carry it, `AGENTS.md` is regenerated, the SDK runner sets `strictMcpConfig` where the run's fragment carries the flag (`fragmentStrictMcp`), and `agent-commands-strict-mcp.test.mjs` and `charter-reaches-launch.test.mjs:196` pin it <!-- builds: --strict-mcp-config in the worker prompt and the Plot Config agent commands, and fragmentStrictMcp -->

## Notes

- 2026-11-21: drafted from the triage of #3178. Re-verified on `origin/main` at `b21961602`, and the panel re-verified at `e20c92220`. The issue's line numbers moved: `role-command.ts:72` is now `:73-85`, `review-verdict.ts:183` is now `:245`, and `review-verdict.test.ts:151` is now `:146`. `f985ad14a` moved the fixer's `roleCommand` call from `auto-fixer.ts:496` to `:550`.
- `plot-deliverable-search.sh` for `strict-mcp-config`, `mcp-config`, `strictMcpConfig` and `roleCommand` found only the reviewer's flag (`review-verdict.ts:211,245`), the reviewer's comment in `packages/board/src/server/entry/review.ts:50`, the reviewer floor's `mcpServers` refusal (`review-verdict.ts:155-186`) and the existing `roleCommand` and its callers. Nothing builds the flag for a role, a worker or a board agent.
- The two slices are two waves, so slice 2 starts after slice 1 merges. Both change `agent-run-sdk.ts` and `agent-run-sdk.test.ts`, and the order keeps them from conflicting. The 2026-11-21 process reading and the transcript parse are this machine's and this operator's configuration only.
- Left out: `.plot/agent-settings.json` already switches off 17 plugins for commands that pass `--settings` (slice 2 of `2026-10-02-an-agent-starts-with-what-it-reads`, #1241). It does not switch off MCP servers from user settings, and the role command does not pass it, so it is not a substitute for the flag.
- 2026-11-21, panel round 1 (estate `proceed`, testability `amend`, user `amend`, none `reject`; verdict files in `.plot/panels/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use/`, not committed). Resolved in the plan text: the SDK options serve fleet workers too, and the SDK runner follows the run's command fragment (estate 1, testability 4, user 1); no caller test changes (estate 2, testability 2); the SDK option name is confirmed at `sdk.d.ts:2301` (estate 3, testability 4, user 3); line references `auto-fixer.ts:550`, `role-command.ts:66-88`, `:94-96` and `:118` (estate 4, testability 3); `charter-reaches-launch.test.mjs:196` and its `argv` helper (testability 1, 5); the Changelog line for adopters (user 2); a worker run in the measurement (user 4). No change, with the reason: no conflict with the Approved plan `2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr`, because slice 1 does not edit `auto-fixer.ts` (estate 5); estate 6, 7 and 8 and testability 6 confirm the design; user 3 re-ran the transcript parse, 847 files, 0 MCP calls; user 5 (a lost tool is silent) needs no change, because no Plot role or command here needs a server and a future one is its own plan; user 6 confirms the write probe and the codex guard.
