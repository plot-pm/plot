# A fleet agent starts without the operator's plugins

> Every dispatched agent is a `claude -p` session and runs every `SessionStart` hook the operator's plugins declare. One such hook, run once per agent start with no lock, pinned this machine at load 195 and stopped the supervisor ticking for 12 minutes.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1099
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A project can name the plugins its fleet agents start without, through one `Agent settings` config key; every `claude -p` the fleet starts receives the file, and a file that would switch Plot's own gates off is refused.

Board impact: none. The key reaches the worker prompt and the agent-runner spawns as an environment variable; no payload changes.

## Motivation

Measured 2026-09-30. The superpowers `episodic-memory` plugin (1.0.15) declares `SessionStart` with matcher `startup|resume`, running `episodic-memory sync --background` asynchronously. Its `dist/sync-cli.js` holds no lock (`grep -ciE 'lock|pidfile|already running'` finds 0), so every session start runs a full sync whether or not one is running.

Three ran at once, orphaned (ppid 1), about 300% CPU each. The 1-minute load average reached 195. A supervisor child, `bash -c kill -0 <pid>`, stayed runnable for over 60 s, and the supervisor did not tick for 12 minutes; the board reported *fleet silent for 11m*. Stopping the duplicates brought the load to 32 and the supervisor ticked within a minute.

**The missing lock is the plugin's defect. The multiplier is Plot's.** An operator starts a session a few times a day; the fleet starts one on every worker start, restart, retry and hop, plus every agent-runner command the board runs. Each inherits every plugin the operator installed.

**A fleet agent needs Plot's hooks and not the operator's.** `hooks/hooks.json` registers four `PreToolUse` gates: `plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh` and `plot-controller-gate.sh`. In this repository they arrive only through the Plot plugin; no `.claude/settings.json` registers them.

## Design

### The rule

**Every `claude -p` the fleet starts receives the project's `Agent settings` file, and a file that would switch Plot's gates off never reaches an agent.**

### The mechanism, measured

Measured 2026-09-30 with Claude Code 2.1.285, in two `claude -p` runs given `--settings <file>` holding `{"enabledPlugins":{"episodic-memory@superpowers-marketplace":false}}`:

- The debug log reads `Read hooks.json for plugin episodic-memory (enabled=false; will NOT register, plugin is disabled)` and `Loading hooks from plugin: plot`.
- The `init` event lists 34 enabled plugins; `plot` is present and `episodic-memory` is absent.
- Six `PreToolUse:Bash` hooks started on the run's one Bash call.
- The `sync-cli` process count was 1 before and after each run; the one process predated both.

So `--settings` overrides the user-level `enabledPlugins` value for the named key and keeps every other user-level entry, `plot@plot-marketplace` included.

### One key, one resolver

`Agent settings` in `## Plot Config` names a JSON file. Absent or empty means no change: an adopting project that sets nothing behaves as today.

**One script resolves it: `plot-agent-settings.sh`.** It prints the absolute path on stdout and exits 0, or prints nothing, names the reason on stderr and exits 3. Every caller acts on its answer and none re-derives it.

- **A relative value resolves against the main checkout** — the parent of `git rev-parse --git-common-dir` — the rule `Board artifact` already follows (`plot-config.sh:60`). `--show-toplevel` names the desk, and a desk cut from an older main may not hold the file.
- **A missing or unparseable file answers 3** with the path it looked for. The caller starts the agent without the flag, so a typo cannot stop the fleet, and writes the reason where the agent's own start is recorded (below). Plot never passes `claude` a path that does not exist.
- **A file that switches Plot's gates off answers 3**: `enabledPlugins` naming any `plot@…` key `false`, or `disableAllHooks: true`. The reason names the key. This is the rule's second half, and it is a refusal rather than advice.

### Where it reaches

**The path travels as `PLOT_AGENT_SETTINGS`, an absolute path in the environment.** Nothing rewrites a configured command. The command keys are project-owned text, and a project interpolates the variable where its harness takes the flag. This removes the question of recognising a `claude` invocation in `PLOT_UNATTENDED=1 claude -p …` run through `sh -c`.

- **The worker loop** calls the resolver once per agent start and exports the answer before it sources the prompt file (`plot-worker-loop.sh:1631`). This covers every prompt file the loop resolves, a charter-declared one included (`resolve_prompt_file`, `plot-worker-loop.sh:1099-1138`). A refusal is one line in `.plot-worker.log`.
- **The shipped template** (`skills/plot/templates/worker-prompt.sh`) adds `--settings "$PLOT_AGENT_SETTINGS"` when the variable is set **and** `harness` is `claude` (`:136` reads `PLOT_HARNESS`). This repository's `.plot/worker-prompt.sh` gets the same lines.
- **The board's seven agent-runner spawns** set the variable through one helper: `Idea` (`idea.ts:713`), `Implement` (`implement.ts:225`), `Interrogate` (`interrogate.ts:323`), `Brief` (`brief-ask.ts:104`), `Story` (`story.ts:506`), `Approve` (`approve.ts:297`) and `Deliver` (`auto-deliver.ts:424`). The helper asks the resolver through an adapter, per the layering rule, and returns the environment each `spawn` receives. A refusal is written to the board's server log once per spawn.
- **This repository's seven command keys** interpolate it: `… claude -p ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions`.

### A prompt that ignores the key

`plot-install-prompt.sh` returns `current` as soon as a prompt interpolates `PLOT_SESSION_FLAG` (`:77`), and has no check for any other flag. It gains one, run after the session-flag check rather than instead of it: while `Agent settings` is set, a prompt that does not mention `PLOT_AGENT_SETTINGS` reports `settings-unread` and exits 3. Like `stale` and `present`, this is a report; the prompt stays the project's.

### Why not `--bare`

`claude -p --bare` skips hooks and plugin sync, and with them Plot's own gates; it also requires API-key authentication and refuses OAuth. A fleet without its gates is the failure those gates exist to prevent.

### Why not rewrite the commands

A board that appends `--settings` to a command it recognises as `claude` needs a recognition rule for `VAR=value` prefixes, `env`, absolute paths, wrapper scripts and `npx`, applied at seven sites. An exported variable needs none of it and leaves each command readable as written.

### What this does NOT do

- **It does not fix the plugin.** The missing single-instance lock is reported upstream; this removes the multiplier, not the defect.
- **It does not choose plugins for the operator.** The key is empty by default and each project names its own.
- **It does not touch the operator's own sessions.** `--settings` applies to one run.

## Done when

- **The measurement, first:** a `claude -p` run given the settings file is refused by `plot-state-gate.sh` when it commits a hand-written `State:` change. The plugin half is measured above. If the refusal does not fire, the slice stops and reports it.
- `plot-agent-settings.sh` answers an absolute path for a relative value asked from a desk, resolved against the main checkout; 3 with the path for a missing file; 3 naming the key for `plot@…: false` and for `disableAllHooks: true`; and nothing, exit 0, for an absent key.
- The shipped template, run with `PLOT_PRINT_INVOCATION`, prints `--settings <path>` when `PLOT_AGENT_SETTINGS` is set and `harness` is `claude`; prints the unchanged argv when the variable is unset or `PLOT_HARNESS` names another harness.
- The worker loop exports the variable before sourcing a charter-declared prompt file, and writes the resolver's reason to `.plot-worker.log` on a refusal.
- Each of the seven board spawns receives `PLOT_AGENT_SETTINGS` through the one helper, asserted by a test over all seven; a refusal reaches the server log.
- `plot-install-prompt.sh` reports `settings-unread` (exit 3) for a prompt that interpolates `PLOT_SESSION_FLAG` but not `PLOT_AGENT_SETTINGS` while the key is set, and `current` once it does.
- `Agent settings` is documented in `plot-config.sh`'s key list and in `CLAUDE.md`'s helper-script table; this repository sets it, tracks the settings file, and its seven command keys interpolate the variable.

## Slices

### A fleet agent starts without the operator's plugins (Branch: bug/a-fleet-agent-starts-without-the-operators-plugins) <!-- builds: plot-agent-settings.sh, the Agent settings resolver -->

The refusal measurement first, then the resolver, the worker loop and template, the board helper and its seven spawns, the install-prompt report, and this repository's settings file and keys.

## Notes

**Found while recovering the fleet on 2026-09-30.** The supervisor was alive and idle, waiting on a child that could not finish a `kill -0` for over a minute; the cause was three indexers, not Plot. Three sessions starting within a minute of each other was enough.
