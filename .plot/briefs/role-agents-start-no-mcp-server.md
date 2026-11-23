## Implementation brief — fleet-agents-start-only-the-mcp-servers-they-use (wave 1: Role commands)

- **Plan (canonical):** docs/plans/2026-11-21-fleet-agents-start-only-the-mcp-servers-they-use.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3616 merged
- **Branch:** `bug/role-agents-start-no-mcp-server` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the repository's PR review (`Review: pr`)

Wave 2 (`bug/workers-and-board-agents-start-no-mcp-server`) waits on this branch. Both waves edit `agent-run-sdk.ts` and `agent-run-sdk.test.ts`, and the order keeps them from conflicting. Do not start wave 2's work here.

### What to build

Every fixer, main-repair and unblocker agent starts each MCP server the operator's user settings and enabled plugins declare, and cannot call one of their tools. Measured 2026-11-21 07:06 with `ps -eo pid,ppid,command`: a board agent without the flag had 3 descendant processes and 2 MCP servers (oh-my-claudecode's `bridge/mcp-server.cjs`, and `npm exec @modelcontextprotocol/server-pdf` with its child); the reviewer, which passes `--strict-mcp-config`, had 0. Each new process costs a macOS `syspolicyd` check (#3178, story `nothing-changed-nothing-runs`).

Two changes, both in the domain package:

1. `roleCommand` (`packages/domain/src/rules/role-command.ts`, command array at `:73-85`) adds `--strict-mcp-config` directly after `--setting-sources user`. Its TSDoc block states that the fragment loads no MCP server. Facts only, no history.
2. The SDK adapter's role options (`packages/domain/src/adapters/agent-run/agent-run-sdk.ts:333-338`, the object that sets `settingSources: ['user']`) add `strictMcpConfig: true`, so `Agent runner: sdk` role runs behave like the command runner's. The option is `strictMcpConfig?: boolean` at `sdk.d.ts:2301` in `@anthropic-ai/claude-agent-sdk` 0.3.288, the version `packages/domain/package.json:33` pins.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **No `--mcp-config`, no server for any role.** The `tools:` list of every role in `.claude/agents/` names only built-in tools (`fixer.md` and `main-repair.md`: `Read, Grep, Glob, Write, Edit, Bash`; `reviewer.md` and `unblocker.md`: `Read, Grep, Glob`), and `role-command.ts:118` (`JSON_KEYS` at `:94-96`) drops an `mcpServers:` key. A role cannot call an MCP tool today, so a server it starts is pure cost. A transcript parse of 841 worktree transcripts found 0 `mcp__*` calls. Do not add an opt-in for a role that needs a server; that is a plan of its own.
- **The flag position is fixed:** after `--setting-sources user`, the reviewer's order relative to its own setting source (`review-verdict.ts:245`).
- **`.plot/agent-settings.json` is not a substitute.** It switches off 17 plugins for commands that pass `--settings`, does not switch off user-settings MCP servers, and the role command does not pass it.
- **Do not hardcode the SDK option for non-role runs.** Non-role SDK runs (`agent-run-sdk.ts:442-475`) are slice 2's: they set `strictMcpConfig` only where the run's command fragment carries the flag (`fragmentStrictMcp`, `AgentRunRequest.strictMcp`). Add none of that here. Only the role options change in this wave.
- **No caller changes.** The three callers pass `roleCommand`'s fragment through and append only a second `--settings`: the fixer (`packages/fleet/src/shared/auto-fixer.ts:550`), main-repair (`packages/fleet/src/shared/repair-role.ts:116`) and the unblocker (`packages/fleet/src/server/entry/registryd-main.ts:1591`). No caller test compares a whole role command (`repair-role.test.ts:90` uses `toContain('--agent main-repair')`; checked 2026-11-21: `git grep -e '--setting-sources'` over the test directories finds none), so `role-command.test.ts` is the proof. If a caller test fails, report it; do not edit a caller to make it pass.
- **Rules carried over:** `roleCommand` stays the one place that builds a role command, and the SDK adapter the one place that builds SDK options. In the domain package a function you write is an arrow (`export const f = (…) => …`), and TSDoc states what an export does, not why it was decided.

### Done when

The plan's `## Slices` entry for this branch is the specification: `roleCommand` passes `--strict-mcp-config`, the SDK role options set the strict MCP option, and the role-command, SDK and caller tests pin it. The assertions a naive change passes without:

- `packages/domain/test/role-command.test.ts:39-48`: the exact word list gains `--strict-mcp-config` right after `user`. It fails without the flag, and catches a flag in the wrong position.
- `packages/domain/test/role-command.test.ts`, new case: the flag is present with and without `--allowedTools` and with and without `--max-turns`. It catches a flag added inside one conditional spread only.
- `packages/domain/test/agent-run-sdk.test.ts:487-495` (*maps the role to agent, agents, settings and user settings only*): also asserts `options.strictMcpConfig` is `true`. It fails today, and catches a command-only fix that leaves the SDK runner loading servers.

Plus: add a changeset, description first and the `bumps:` block last (package `plot`; `./scripts/check-changeset-packages.sh` refuses the reverse order and a description under 20 characters). The changeset text is the plan's first Changelog line: the fixer, main-repair and unblocker agents start no MCP server. Commit no generated bundle: `scripts/check-no-bundle-diff.sh` refuses one. Slice 2 owns the adopter-facing Changelog line.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`.

This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. If that changes, growth is paid for in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/role-command.ts`, `packages/domain/src/adapters/agent-run/agent-run-sdk.ts` (role options only), `packages/domain/test/role-command.test.ts`, `packages/domain/test/agent-run-sdk.test.ts` and one changeset file.

In flight: `bug/workers-and-board-agents-start-no-mcp-server` (wave 2, waits on this branch) owns `.plot/worker-prompt.sh`, `CLAUDE.md`/`AGENTS.md` config keys, `fragment-strict-mcp.ts`, `ports/agent-run.ts` and the non-role SDK options. The Approved plan `2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr` edits `auto-fixer.ts`; this slice does not.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
