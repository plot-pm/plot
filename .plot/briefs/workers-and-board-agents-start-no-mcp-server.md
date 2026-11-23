## Implementation brief — fleet-agents-start-only-the-mcp-servers-they-use (wave 2: Worker and board agents)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3616 merged
- **Branch:** `bug/workers-and-board-agents-start-no-mcp-server` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the repository's PR review (`Review: pr`)

Wave 1 (`bug/role-agents-start-no-mcp-server`, #3621) merged 2026-11-21 14:22Z: `roleCommand` passes `--strict-mcp-config` (`role-command.ts:79`) and the SDK role options set `strictMcpConfig: true` (`agent-run-sdk.ts:339`). Nothing waits on this branch.

### What to build

A worker, an idea, story, brief, implement, interrogate, verify or design agent starts every MCP server the operator's user settings and enabled plugins declare, and no Plot agent calls one of their tools. Measured 2026-11-21 07:06 with `ps -eo pid,ppid,command`: a board interrogate agent (pid 70320) had 3 descendant processes and 2 MCP servers (oh-my-claudecode's `bridge/mcp-server.cjs`, and `npm exec @modelcontextprotocol/server-pdf` with its child); the reviewer, which passes `--strict-mcp-config`, had 0. A structural parse of 841 worktree transcripts found 0 `mcp__*` calls. Each new process costs a macOS `syspolicyd` check (#3178, story `nothing-changed-nothing-runs`).

Four changes:

1. **`.plot/worker-prompt.sh`** adds `mcp_args=(--strict-mcp-config)`, guarded on `[ "$harness" = "claude" ]` as `settings_args` is, and puts it into `head_args` (`:158-191` today, before `cap_args`' neighbours). Expand it with the `${mcp_args[@]+"${mcp_args[@]}"}` form (bash 3.2: an empty array under `set -u` fails otherwise). The print (`PLOT_PRINT_INVOCATION=1`) and the launch read one `head_args`, so fleetd's write probe (`write-probe-shell.ts`) tests the argv that runs. Do not add the flag to `tail_args` or to the launch line alone.
2. **The seven `claude -p` keys in `CLAUDE.md` `## Plot Config`** (`Idea command`, `Story command`, `Brief command`, `Implement command`, `Interrogate command`, `Verify command`, `Design command`) add `--strict-mcp-config` directly before `--permission-mode bypassPermissions`. `Worker command` does not change: it runs `plot-worker-loop.sh`, which runs `.plot/worker-prompt.sh`. Then run `./scripts/check-agents-md.sh --write`; `AGENTS.md` is generated from `CLAUDE.md` and CI refuses a mirror that differs.
3. **`fragmentStrictMcp(fragment): boolean`** in `packages/domain/src/rules/fragment-strict-mcp.ts`, beside `fragment-model.ts`. It answers `true` where the fragment names `--strict-mcp-config` as a whole word, and `false` for an empty fragment, a fragment without it and `--strict-mcp-config-x`. An arrow, with a TSDoc block that states what it answers.
4. **The SDK runner follows the command fragment.** `AgentRunRequest` (`packages/domain/src/ports/agent-run.ts`, `model` is at `:59`) gains `strictMcp: boolean`. The non-role options object in `agent-run-sdk.ts` (the one with `settingSources: ['user', 'project', 'local']`, `:470`) sets `strictMcpConfig: true` where `request.strictMcp` is true and leaves the key unset otherwise. Two producers set the field: board agents from the role's fragment in `packages/fleet/src/shared/agent-run-for.ts` (`fragment` is read at `:76`; the SDK return is at `:112`), and fleet workers from `Worker command` in `packages/fleet/src/server/entry/worker-loop.ts` (`cfg('Worker command')` at `:2313`, the request fields at `:2343`). Run `git grep -n "contextWindow:" packages` to find every construction of `AgentRunRequest`, tests included, and give each the new field; the compiler names any that is left.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **No `--mcp-config`, no server for any agent in this plan.** Plot's skills name no `mcp__` tool (`git grep mcp__ -- skills` hits only generated bundles), and Plot reaches hosts and trackers through `plot-host.sh`. An agent that needs a server names it with `--mcp-config <file>` beside `--strict-mcp-config` in its own command; no command here does, and a future one is its own plan.
- **The flag was tried for workers on 2026-10-03 and not adopted, and the reason no longer holds.** It cut one worker's first request from 87,676 to 20,365 tokens. The slice then kept it out because its brief forbade removing tools workers called, on a claim that workers called oh-my-claudecode's MCP tools. The same plan's Notes correct that: 0 calls in 384 worker transcripts, 0 in 841 now. Do not reopen it.
- **The SDK option follows the run's command fragment and is never hardcoded for non-role runs.** An adopter on `Agent runner: sdk` keeps its MCP tools unless its own command carries the flag. Hardcoding `strictMcpConfig: true` there removes tools from adopters' agents, which the operator ruled out on 2026-11-21. Role runs are already hardcoded by wave 1 because `roleCommand`'s fragment always carries the flag.
- **The shipped templates do not change.** `skills/plot/templates/worker-prompt.sh` and `skills/plot/templates/claude-md-snippet.md` stay as they are (operator decision, 2026-11-21). This branch changes this repository's configuration and the shipped SDK adapter's reading of the fragment. The flag goes on all seven board-agent keys (operator decision).
- **A worker on `Agent runner: sdk` in this repository would still load its servers**, because `Worker command` does not carry the flag. This repository sets no `Agent runner` key, so its workers run on the command runner and get the flag from `.plot/worker-prompt.sh`. Do not add the flag to `Worker command` to cover it.
- **`.plot/agent-settings.json` is not a substitute.** It switches off 17 plugins for commands that pass `--settings`; it does not switch off user-settings MCP servers.
- **Rules carried over:** absent is not false, so `fragmentStrictMcp('')` answers `false`, never throws. Read the exit code, not the emptiness. In the domain package a function you write is an arrow, and TSDoc states what an export does, not why it was decided. A new `.sh` expansion must run under bash 3.2.

### Done when

The plan's `## Slices` entry for this branch is the specification. The assertions a naive change passes without:

- `test/reconcile/agent-commands-strict-mcp.test.mjs` (new): for each of the seven keys, `skills/plot/scripts/plot-config.sh get "<key>"` in this repository answers a command that contains `--strict-mcp-config`. It catches a key left out. A case runs `.plot/worker-prompt.sh` under `PLOT_PRINT_INVOCATION=1` with `PLOT_HARNESS=claude` and asserts the printed argv contains the flag exactly once, and a case with `PLOT_HARNESS=codex` asserts it is absent; the second catches an unguarded flag that a non-claude harness would reject. Model the run on the `argv` helper in `test/reconcile/charter-reaches-launch.test.mjs:61-94`, with its "never reached the launch" guard, so a test that never reached the launch does not pass.
- `test/reconcile/charter-reaches-launch.test.mjs:196` (*the print carries every flag the launch line passes (#2778)*): the charter-less expectation for this repository's file becomes `['--strict-mcp-config', '--permission-mode', 'bypassPermissions']`. The template's expectation does not change. The same case's print-equals-launch assertion (`:191`) keeps passing and is the proof that the write probe tests the launched argv; if it fails, the flag reached only one of print and launch.
- `packages/domain/test/fragment-strict-mcp.test.ts` (new): the four cases above (flag, no flag, empty, `--strict-mcp-config-x`). The last catches a substring match.
- `packages/domain/test/agent-run-sdk.test.ts:144` (*merges the env, names five disallowed tools…*): a non-role request with `strictMcp: true` sets `options.strictMcpConfig` to `true`, and one with `strictMcp: false` leaves it unset. The second catches a hardcoded `true`.
- A test beside each producer: `agentRunFor` sets `strictMcp` from the role's fragment, and the worker loop sets it from `Worker command`. Use the existing tests of those two files as the model.

Plus: add a changeset (package `plot`), description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh` refuses the reverse order and a description under 20 characters). Its text is the plan's second Changelog line, so an adopter learns how to opt in: an agent started through a configured command loads no MCP server once that command carries `--strict-mcp-config`; add it to the `claude -p` command in `.plot/worker-prompt.sh` and to each `claude -p` agent command key; the SDK runner follows the same command. Declare `plot` as a bumped skill only if a skill's SKILL.md changes, which it should not. Commit no generated bundle: `scripts/check-no-bundle-diff.sh` refuses one. Run `pnpm build:board` only to test, and restore the generated paths before you push.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`.

This slice touches `.plot/worker-prompt.sh`, which is a `.sh` file outside `skills/`; `scripts/check-shell-lines.sh` counts shell under `skills/` against the merge base, so confirm with `./scripts/check-shell-lines.sh pr` that the count did not grow. If it did, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); do not run `gh pr create`. When the PR exists, run `skills/plot/scripts/plot-record-pr.sh bug/workers-and-board-agents-start-no-mcp-server <pr-number>`, which appends `→ #<number>` to this branch's line in the plan; do not edit the plan or commit on main by hand.

**One measurement, read-only, after the branch merges or on a local build of it:** run `ps -eo pid,ppid,command` during one worker run, one fixer run and one board agent run, and confirm no MCP server process runs under any of the three `claude -p` processes. The PR body records the date, the three pids and each descendant count. If a run is not available, say so in the PR body; do not invent a reading.

### Scope guard

This branch owns `.plot/worker-prompt.sh`, `CLAUDE.md` and the generated `AGENTS.md` (the seven config keys only), `packages/domain/src/rules/fragment-strict-mcp.ts`, `packages/domain/src/ports/agent-run.ts`, `packages/domain/src/adapters/agent-run/agent-run-sdk.ts` (the non-role options only), `packages/fleet/src/shared/agent-run-for.ts`, `packages/fleet/src/server/entry/worker-loop.ts` (the `strictMcp` field only), their tests, `test/reconcile/agent-commands-strict-mcp.test.mjs`, `test/reconcile/charter-reaches-launch.test.mjs` and one changeset file.

Do not touch `roleCommand`, the role options of `agent-run-sdk.ts` (wave 1 owns them and is merged), `skills/plot/templates/`, or `auto-fixer.ts` (the Approved plan `2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr` edits it).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
