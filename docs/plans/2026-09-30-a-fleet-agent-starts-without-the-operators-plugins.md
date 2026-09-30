# A fleet agent starts without the operator's plugins

> Every dispatched agent is a `claude -p` session and runs every `SessionStart` hook the operator's plugins declare. One such hook, run once per agent start with no lock, pinned this machine at load 195 and stopped the supervisor ticking for 12 minutes.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1099
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A project can name the plugins its fleet agents start without, through one `Agent settings` config key that every agent's `claude -p` receives; Plot's own gates keep running.

Board impact: none. The key reaches the worker prompt and the agent-runner commands; no payload changes.

## Motivation

Measured 2026-09-30. The superpowers `episodic-memory` plugin (1.0.15) declares `SessionStart` with matcher `startup|resume`, running `episodic-memory sync --background` asynchronously. Its `dist/sync-cli.js` holds no lock (`grep -ciE 'lock|pidfile|already running'` finds 0), so every session start runs a full sync whether or not one is running.

Three ran at once, orphaned (ppid 1), about 300% CPU each. The 1-minute load average reached 195. A supervisor child, `bash -c kill -0 <pid>`, stayed runnable for over 60 s, and the supervisor did not tick for 12 minutes; the board reported *fleet silent for 11m*. Stopping the duplicates brought the load to 32 and the supervisor ticked within a minute.

**The missing lock is the plugin's defect. The multiplier is Plot's.** An operator starts a session a few times a day; the fleet starts one on every worker start, restart, retry and hop, plus every `Implement`, `Idea` and `Interrogate` command the board runs. Each inherits every plugin the operator installed.

**A fleet agent needs Plot's hooks and not the operator's.** `plot-phase-gate.sh`, `plot-state-gate.sh` and `plot-brief-name-gate.sh` are `PreToolUse` hooks, registered through the plugin's `hooks/hooks.json` or the repository's `.claude/settings.json` by `plot-install-hooks.sh`. They are the reason a fleet agent cannot write a `State:` line or a misnamed brief.

## Design

### The rule

**Every `claude -p` a fleet agent runs receives the project's `Agent settings`, and those settings can switch plugins off without switching Plot's gates off.**

### One config key

`Agent settings` in `## Plot Config` names a JSON file, relative to the repository root. Absent or empty means no change, so an adopting project that sets nothing behaves as today.

This repository's file disables the one plugin measured above:

```json
{ "enabledPlugins": { "episodic-memory@superpowers-marketplace": false } }
```

### Where it reaches

- `.plot/worker-prompt.sh` and its shipped template (`skills/plot/templates/`, installed by `plot-install-prompt.sh`) pass `--settings <file>` to the harness when the key is set. The template is the path every adopting project gets; this repository's own copy is updated too.
- The four agent-runner keys (`Idea command`, `Implement command`, `Interrogate command`, `Brief command`) are commands the board spawns. The board appends `--settings <file>` when the key is set and the command is a `claude` invocation; a command naming another harness is left untouched and reported, never rewritten.

### Why not `--bare`

`claude -p --bare` skips hooks and plugin sync, and with them Plot's own gates; it also requires API-key authentication and refuses OAuth. A fleet without its gates is the failure those gates exist to prevent.

### What this does NOT do

- **It does not fix the plugin.** The missing single-instance lock is reported upstream; this removes the multiplier, not the defect.
- **It does not choose plugins for the operator.** The key is empty by default and each project names its own.
- **It does not touch the operator's own sessions.** `--settings` applies to one run.

## Done when

- **The measurement that decides the design:** with `--settings` naming a file that sets the episodic-memory plugin to `false`, a `claude -p` run starts no `sync-cli.js` process, **and** `plot-state-gate.sh` still refuses a hand-written `State:` change in that run. If `enabledPlugins` cannot disable a plugin's `SessionStart` hook while leaving Plot's hooks registered, the slice stops and reports which mechanism can.
- A worker prompt with `Agent settings` set passes `--settings <file>`, asserted against a stubbed harness that records its argv; with the key absent, the argv is unchanged.
- A board-spawned `Implement command` receives the flag when it runs `claude`, and a command naming another harness is left unchanged and reported.
- The installed `.plot/worker-prompt.sh` template carries the flag, and `plot-install-prompt.sh` classifies an existing prompt that lacks it the way it classifies other missing flags.
- `Agent settings` is added to `plot-config.sh`'s documented keys and to this repository's `## Plot Config`.

## Slices

### A fleet agent starts without the operator's plugins (Branch: bug/a-fleet-agent-starts-without-the-operators-plugins)

The measurement first, then the key, the worker prompt template, the board's agent-runner spawns, and this repository's settings file.

## Notes

**Found while recovering the fleet on 2026-09-30.** The supervisor was alive and idle, waiting on a child that could not finish a `kill -0` for over a minute; the cause was three indexers, not Plot. Three sessions starting within a minute of each other was enough.
