## Implementation brief — fleet-roles-are-declared-agents (wave 1: Role-agent probe)

- **Plan (canonical):** docs/plans/2026-10-29-fleet-roles-are-declared-agents.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2908 merged
- **Branch:** `feature/role-agents-are-probed` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`; one full review per PR)

This is the first wave. `feature/role-agent-definitions` waits on it (`<!-- waits: feature/role-agents-are-probed -->`). `feature/unattended-callers-are-refused` is the next wave and shares no file with this slice.

### What to build

A probe, and the recorded result of it. No product code ships in this slice. Run `claude -p` (Claude Code 2.1.312 or later) under the flags fleetd will use for a role: `--setting-sources user`, `--agents <file read from origin/<default>>`, `--settings <role settings file>`. Both files live outside the run's tree. Then write what each run showed into the plan, under `## Design` (a `### Probe result` subsection), so slice 3 reads a measurement rather than a guess.

The failure this answers: a reviewer started with `--setting-sources user` cannot find `--agent <name>`, and adding `project` loads the reviewed tree's hooks and settings, which lets a PR rewrite its own reviewer. The panel found a workable route (`--agents <file>`) with n=1 per fact. This slice turns n=1 into a recorded answer, because four definitions will depend on it.

Record four results, each with the exact command, the exit code, and the observed output line:

1. The agent loads under `--setting-sources user` with `--agents <file outside the tree> --agent <name>`.
2. A `PreToolUse` hook in the `--settings` file blocks a forbidden call (use `plot-host.sh commit-status` or `gh pr merge` as the call, and a permitted call as the control in the same run).
3. `maxTurns` in the definition bounds the run: set it to 1 or 2, give a task that needs more, and record whether the run stops.
4. `memory: local` writes outside the run's tree: record the path it writes to.

If a result is negative, record it as negative and state which design line fails. Do not adjust the probe until it passes.

### Decisions the plan settles — do not re-derive them

- **The gates live in a settings file, not in the definition's frontmatter.** Measured on 2.1.312, one run each: a `PreToolUse` hook in the frontmatter did not fire under `--agent`; the same hook in `.claude/settings.json` blocked the call. Do not test the frontmatter route again as a way to "make it work". You may repeat it once as a control.
- **The definition cannot come from the run's cwd.** `--setting-sources user --agent <name>` answered "`--agent '<name>'` not found"; adding `project` loads the agent and also the reviewed tree's hooks. `project` is the rejected alternative.
- **`isolation: worktree` in frontmatter is ignored under `--agent`** (one run). fleetd creates every worktree itself. Do not probe it again.
- **`--agent` does not go into `agentRunCommand`.** The port names no harness option. This slice touches no adapter.
- **n=1 is the reason for this slice.** Run each of the four checks at least twice, and name the model used. A single passing run is not a result.
- Rules carried over: absent is not false (a missing hook output is not proof the hook blocked; read the exit code and the tool-result text); read the exit code, not the emptiness.

### Done when

The plan's slice line is the specification: the probe proves `--agents <file from main>` plus `--settings <role settings>` gates a tool call and loads under `--setting-sources user`, and the plan records the result, `maxTurns` and the `memory: local` path. Assertions a naive probe would pass without:

- The forbidden call and a permitted control run in the same session. This catches a hook that blocks everything, or a run that never reached the tool.
- The agent file is read from `origin/main` (`git show origin/main:<path>`) into a path outside the worktree. This catches a probe that loads from cwd and passes by accident of `project` scope.
- A run with `--setting-sources user` and a tree that holds a hostile `.claude/settings.json` and `.claude/agents/<name>.md`. The run must use neither. This catches the exact attack the design exists to stop.

The probe leaves no file in the repository except the plan edit. Create scratch files under `mktemp -d` and remove them by the exact name `mkdtempSync`/`mktemp` returned, never by glob.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run `scripts/check-plan-headings.sh`: the new `### Probe result` heading must pass it. This slice edits no `.sh` file, so `scripts/check-shell-lines.sh` needs no payment. Add a changeset only if the plan edit needs one; a plan-only change usually does not.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `docs/plans/2026-10-29-fleet-roles-are-declared-agents.md` (the `### Probe result` subsection and, if a result changes it, the matching `Design` line). It owns no file under `packages/` or `skills/`.

Other branches in flight on this plan: none started. `feature/unattended-callers-are-refused` edits `packages/domain/src/workflows/{merge,dispatch-verbs,release}.ts` and the entrances; this slice must not. Do not write `.claude/agents/*.md` or any settings file into the repository; `feature/role-agent-definitions` owns them.

The plan's one Open Question (which source names the reviewer's model and effort: `.plot/charters/reviewer.json` or `reviewer.md`) is not this slice's to answer. If a probe run shows how `--model` and a definition's `model:` interact, record that as an observation and leave the decision to `feature/role-agent-definitions`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
