## Implementation brief — an-agent-starts-with-what-it-reads (slice 2: A worker starts without unused context)

- **Plan (canonical):** `docs/plans/2026-10-02-an-agent-starts-with-what-it-reads.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `infra/a-worker-starts-without-unused-context` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI is the authority)

This is slice 2 of 3. Slice 1 (`infra/the-helper-table-leaves-claude-md`) merged as #1238, so its effect is already in `main` and its controlled pair (125,623 → 95,279 first-request tokens) is the baseline for yours. Slice 3 (`docs/the-master-agent-briefs-rather-than-forks`) touches `CLAUDE.md` only and does not wait on this branch.

### What to build

A fleet worker is a `claude -p` start, and its first request carries two things it never uses: the claude.ai connector list (47,385 chars in 10 of 12 workers checked; the one without it started at 98k tokens, the others at 113.5k–123.3k) and the tool, skill and hook output of plugins no worker called. Both are paid again on every one of the 170–270 requests of a run. This slice removes the connector list first, then the unused plugins. It changes this repository's configuration only: `.plot/worker-prompt.sh` and `.plot/agent-settings.json`.

1. **Measure `--strict-mcp-config` on one worker start, then adopt it in `.plot/worker-prompt.sh`.** The flag is not in the file today. The prompt file assembles its argv from arrays (`settings_args`, `model_args`, `cap_args`, `session_args`) and prints them under `PLOT_PRINT_INVOCATION=1` before launching. Add the flag the way `settings_args` is added: an array guarded on `harness = claude` (it is this harness's flag), expanded with the `${a[@]+"${a[@]}"}` form for bash 3.2, and included in the `PLOT_PRINT_INVOCATION` printf, so the printed argv is the argv that runs. Do not add it to the launch line only.
2. **Then switch off the plugins no worker used**, in `.plot/agent-settings.json`, which today holds one entry (`episodic-memory@superpowers-marketplace: false`). Build the used-set from the worker transcripts since 2026-09-28 (243 on 2026-10-02): any `Skill` call, slash command, `Agent` `subagent_type`, MCP tool call or hook output counts as use. A plugin with no use in that set goes to `false`. The operator's enabled set is in `~/.claude/settings.json` under `enabledPlugins`; a worker inherits it, so that list is the candidate list.
3. **Record the result in the plan's `## Notes`:** the controlled pair for the flag, the used-set method and its count, each kept plugin with its reason and per-start cost, and the `~/claude-usage-report.py` sha256 with its raw output.

### The decisions the plan settles — do not re-derive them

- **The connector list first, because a settings file cannot remove it.** `--settings` and `enabledPlugins` act on plugins; the claude.ai connectors arrive through the MCP configuration, and only the CLI flag reaches them. Doing the plugins first would leave the largest item in place and blur the two effects.
- **The flag is adopted only after one measured start.** Three facts to read from that one start, and a fourth to check without launching:
  - the claude.ai connector tools are gone from its first request (`deferred_tools_delta`);
  - the plugin MCP tools workers used since 2026-09-28 are still there;
  - the first-request token count drops, read from the transcript the way slice 1 read it (input + cache_creation + cache_read of the first assistant row, not the usage script's per-session total — slice 1's Notes shows why they differ);
  - `PLOT_PRINT_INVOCATION=1` prints the flag in the expected position.
- **The open question decides the shape, and it is open on purpose.** `--strict-mcp-config` means "only MCP servers from `--mcp-config`", so with no `--mcp-config` it may remove the plugin MCP servers workers use (oh-my-claudecode's tools were called). Test that first. If plugin MCP tools disappear, there are exactly two outcomes the plan accepts: (a) pass `--mcp-config` naming the plugin servers the used-set shows, then measure again; or (b) keep the connector list and record in Notes why the flag was not adopted. Do not adopt a flag that removes tools workers called, and do not hand-wave "probably fine".
- **Kept plugins, with the reason on record.** superpowers stays: the user-level `CLAUDE.md` names its `executing-plans` and `brainstorming` skills. oh-my-claudecode stays: workers spawned its `code-reviewer` and called its MCP tools. Record the per-start cost of each kept plugin; the plan measured oh-my-claudecode at 13.6k chars of `hook_success` and 10.6k of `hook_additional_context`. State this repository's measurement only; another operator's plugin set is theirs to measure. Re-derive the used-set from the transcripts rather than trusting this list, because the plan's count is four days old.
- **"Used" is any of five signals, not only `Skill`.** The plan's round-1 panel found a skills-only definition would switch off a plugin whose subagents, MCP tools or hooks workers do use. Count all five.
- **The settings file stays inside `agentSettingsRefusal`'s bounds:** no `plot@…: false`, no `disableAllHooks: true`, no `env` key. `plot-agent-settings.sh` refuses such a file and the loop then starts the agent without any settings, so a violation does not fail loudly: it silently removes the whole file's effect. Run `skills/plot/scripts/plot-agent-settings.sh` against the file after every edit and read its exit code (0 with a path is accepted; 3 is refused; empty stdout alone proves nothing).
- **It lowers context, not capability.** The plan states these changes do not lower reasoning effort or the model tier. Do not touch `PLOT_MODEL`, `PLOT_EFFORT` or the charter mapping in the prompt file.
- **Rules carried over unchanged:** read exit codes, not output emptiness; absent is not false; a bash 3.2 empty array expands to one empty argument unless it uses the `+` form; the prompt file is the project's, so the shipped template (`skills/plot/templates/worker-prompt.sh`) and `plot-install-prompt.sh` stay as they are.

### Done when

The plan's `## Done when` list for slice 2 is the specification:

- The controlled pair with `--strict-mcp-config` shows the connector list gone and the used plugin MCP tools present, or Notes records why the flag was not adopted.
- `.plot/agent-settings.json` switches off every plugin with no use by the definition above.
- Notes lists each kept plugin with its reason and per-start cost.

Assertions that exist because a naive implementation would pass without them:

- **Measure BEFORE and AFTER on the same machine with the same prompt, model and `--permission-mode`**, as slice 1 did (`Reply with exactly: ok`, a detached worktree of `origin/main` for BEFORE). Change one thing between the pair, the flag. Run the plugin change as a second pair so the two effects stay separate.
- **Check the plugin MCP tools in the AFTER transcript by name**, not by absence of an error. A start that removed them also exits 0.
- **A settings file that parses is not a settings file that is accepted.** `plot-agent-settings.sh` exits 0 and prints a path only when `agentSettingsRefusal` allows it; assert that, not `jq .`.
- **The printed invocation must match the launched one.** Run with `PLOT_PRINT_INVOCATION=1` and confirm the flag is printed; then confirm the launch line carries the same expansion. The printf and the launch are two lists in this file and nothing keeps them equal.
- **Extend `test/reconcile/agent-settings-prompt.test.mjs`** (it already covers how the prompt file builds `settings_args`) with the new array: flag present for `claude`, absent for another `PLOT_HARNESS`. Run it once with the guard removed and see it fail.

Plus: this branch ships no skill or board change, so it needs no `pnpm build:board`. Add a changeset only if `node skills/plot/scripts/board/plot-local-checks.mjs` or `./scripts/check-changeset-packages.sh` asks for one; the plan's board-impact comment says this slice publishes no changelog entry. Run `plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Use `trash`, not `rm`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line under `## Slices` in the plan, from a scratch worktree on `origin/main`. Append the measurements to the plan's `## Notes` in the same edit, dated, in the form slice 1 used. Push the first real commit as soon as it exists. Do not edit `State:`.

### Scope guard

This branch owns: `.plot/worker-prompt.sh`, `.plot/agent-settings.json`, `test/reconcile/agent-settings-prompt.test.mjs`, and the plan's `## Notes` and slice line.

In flight, verified 2026-10-03: no remote branch changes `.plot/worker-prompt.sh`, `.plot/agent-settings.json` or `plot-worker-loop.sh` against `main`. Slice 3 edits `CLAUDE.md` only. `plot-worker-loop.sh` resolves and exports `PLOT_AGENT_SETTINGS` and is not part of this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope. A worker started with `--strict-mcp-config` that cannot reach a tool it needs is such a finding: write `PLOT-BLOCKED.md` with the tool name rather than widening the allow-list on your own.
