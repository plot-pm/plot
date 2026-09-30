# A fleet agent starts without the operator's plugins

> Every dispatched agent is a `claude -p` session and runs every `SessionStart` hook the operator's plugins declare. One such hook, run once per agent start with no lock, pinned this machine at load 195 and stopped the supervisor ticking for 12 minutes.

## Status

- **State:** Approved
- **Approved:** 2026-09-30, jwloka, in-session
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1099
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Started:** 2026-09-30, jwloka, `bug/a-fleet-agent-starts-without-the-operators-plugins`

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

`Agent settings` in `## Plot Config` names a JSON file. The key is read from the `CLAUDE.md` of the tree that asks, so a desk cut from an older main that does not carry the key starts as today. Absent or empty means no change: an adopting project that sets nothing behaves as today.

**One script resolves it: `plot-agent-settings.sh`.** It prints the absolute path on stdout and exits 0, or prints nothing, names the reason on stderr and exits 3. Every caller acts on its answer and none re-derives it.

- **A relative value resolves against the main checkout**, the parent of `git rev-parse --git-common-dir`, the rule `Board artifact` already follows (`plot-config.sh:60`). `--show-toplevel` names the desk, and a desk cut from an older main may not hold the file.
- **A missing or unparseable file answers 3** with the path it looked for. The caller starts the agent without the flag, so a typo cannot stop the fleet, and writes the reason where the agent's start is recorded (below). Plot never passes `claude` a path that does not exist.
- **A file that switches Plot's gates off answers 3**, naming the key: `enabledPlugins` setting any `plot@…` key `false`, `disableAllHooks: true`, or any `env` key. `env` is refused whole because a settings `PATH` that hides the gates' tools makes them fail open: measured 2026-09-30, origin/main's `plot-state-gate.sh` run with a `PATH` lacking its tools allowed a `State:` change (exit 0).

**The refusal is a domain rule**, `agentSettingsRefusal`, in `packages/domain/src/rules/`. It takes the parsed file and answers the refused key or none. The script asks it through a bundle, `board/plot-agent-settings.mjs`, per *A Shell Script Asks The Domain*: the script runs once per agent start, not once per pass, so the bundle's start-up cost is the cost rule's permitted case.

**It is a check against a switch-off by accident, not a boundary.** The file is project-owned and reviewed like `CLAUDE.md`, and a project that wants its gates off can edit `CLAUDE.md` as easily. `hooks` and `permissions` are out of scope for that reason: a settings `hooks` block adds hooks and `permissions.deny` restricts tools, and neither was measured to unregister a plugin's hooks.

### Where it reaches

**The path travels as `PLOT_AGENT_SETTINGS`, an absolute path in the environment.** Nothing rewrites a configured command. The command keys are project-owned text, and a project interpolates the variable where its harness takes the flag. This removes the question of recognising a `claude` invocation in `PLOT_UNATTENDED=1 claude -p …` run through `sh -c`. Measured 2026-09-30 with a stub harness, `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}` delivers `--settings` and a path containing a space as two arguments under `sh`, `dash`, `bash` and `ksh`, and nothing when the variable is unset or empty.

- **The worker loop** calls the resolver once per agent start and exports the answer before it sources the prompt file (`plot-worker-loop.sh:1631`). This covers every prompt file the loop resolves, a charter-declared one included (`resolve_prompt_file`, `plot-worker-loop.sh:1099-1138`), and every launch path that reaches the loop: a dispatch, a `--restart`, `/api/continue` and the supervisor's `--start-agents`. A refusal is one line in `.plot-worker.log`.
- **The shipped template** (`skills/plot/templates/worker-prompt.sh`) adds `--settings "$PLOT_AGENT_SETTINGS"` when the variable is set **and** `harness` is `claude` (`:136` reads `PLOT_HARNESS`). This repository's `.plot/worker-prompt.sh` gets the same lines.
- **The board sets the variable once, in its own environment, at startup.** `index.ts` asks the resolver through the `Scripts` port's `awaited` call and assigns `process.env.PLOT_AGENT_SETTINGS`. Its ten agent-runner spawns all start from `process.env`, so none is edited: `idea.ts:713`, `implement.ts:225`, `interrogate.ts:323`, `story.ts:506`, `auto-deliver.ts:424`, `commission.ts:409`, `deliver.ts:531` and `reslice.ts:466` spread `process.env` into their `env`, and `brief-ask.ts:104` and `approve.ts:297` pass no `env` and inherit it. The synchronous sites (`askForBrief`, `startImplement`) therefore need no new port operation. A refusal is written to the server log at startup. Changing the key takes effect at the next board start.
- **`plot-dispatch.sh:792`** starts `Brief command` detached from the shell. It calls the resolver and exports the answer on that command line.
- **This repository's five `claude -p` command keys** (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`) interpolate it: `… claude -p ${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"} --permission-mode bypassPermissions`. It sets no `Approve command` or `Deliver command`.

### A prompt that ignores the key

`plot-install-prompt.sh` returns `current` as soon as a prompt interpolates `PLOT_SESSION_FLAG` (`:77`), and has no check for any other flag. It gains one, run after the session-flag check rather than instead of it: while `Agent settings` is set, a prompt that does not mention `PLOT_AGENT_SETTINGS` reports `settings-unread` and exits 3. Like `stale` and `present`, this is a report; the prompt stays the project's.

### Why not `--bare`

`claude -p --bare` skips hooks and plugin sync, and with them Plot's own gates; it also requires API-key authentication and refuses OAuth. A fleet without its gates is the failure those gates exist to prevent.

### Why not rewrite the commands

A board that appends `--settings` to a command it recognises as `claude` needs a recognition rule for `VAR=value` prefixes, `env`, absolute paths, wrapper scripts and `npx`, applied at every spawn site. An exported variable needs none of it, edits no spawn site, and leaves each command readable as written.

### What this does NOT do

- **It does not fix the plugin.** The missing single-instance lock is reported upstream; this removes the multiplier, not the defect.
- **It does not choose plugins for the operator.** The key is empty by default and each project names its own.
- **It does not touch the operator's own sessions.** `--settings` applies to one run.

## Done when

- **The measurement, first:** a `claude -p` run given the settings file is refused by `plot-state-gate.sh` when it commits a hand-written `State:` change. The plugin half is measured above. If the refusal does not fire, the slice stops and reports it.
- `agentSettingsRefusal` answers the key for `plot@…: false`, `disableAllHooks: true` and any `env`, and none for a file that only disables other plugins; its tests live beside the rule.
- `plot-agent-settings.sh`, asked from a desk, answers an absolute path for a relative value resolved against the main checkout; 3 with the path for a missing file; 3 with the refused key through the bundle; and nothing, exit 0, for an absent key or a desk whose `CLAUDE.md` carries none.
- The shipped template, run with `PLOT_PRINT_INVOCATION`, prints `--settings <path>` when `PLOT_AGENT_SETTINGS` is set and `harness` is `claude`; it prints the unchanged argv when the variable is unset or `PLOT_HARNESS` names another harness.
- The worker loop exports the variable before sourcing a charter-declared prompt file, and writes the resolver's reason to `.plot-worker.log` on a refusal.
- A board started with the key set has `PLOT_AGENT_SETTINGS` in its environment, and a stub command run through each of the ten spawn sites receives it; a refusal reaches the server log. `plot-dispatch.sh`'s detached `Brief command` receives it too.
- `plot-install-prompt.sh` reports `settings-unread` (exit 3) for a prompt that interpolates `PLOT_SESSION_FLAG` but not `PLOT_AGENT_SETTINGS` while the key is set, and `current` once it does.
- `Agent settings` is documented in `plot-config.sh`'s key list and in `CLAUDE.md`'s helper-script table; this repository sets it, tracks the settings file, and its five `claude -p` command keys interpolate the variable.

## Slices

### A fleet agent starts without the operator's plugins (Branch: bug/a-fleet-agent-starts-without-the-operators-plugins, PR: #1107) <!-- builds: plot-agent-settings.sh, the Agent settings resolver -->

The refusal measurement first, then the refusal rule and the resolver, the worker loop and template, the board's startup export, the dispatch brief spawn, the install-prompt report, and this repository's settings file and keys.

## Notes

**Implementation notes from round 3.** `plot-ask.mjs fleet` runs `maybeAutoDispatch` and `maybeAutoDeliver` in its own node process, which the board's `process.env` does not reach; set the variable in `entry/main.ts` too, or name that path out of scope in the PR. Refusing all of `env` removes settings-level environment variables for fleet agents; a project that needs one, such as `ANTHROPIC_MODEL`, sets it in its command key.

**Found while recovering the fleet on 2026-09-30.** The supervisor was alive and idle, waiting on a child that could not finish a `kill -0` for over a minute; the cause was three indexers, not Plot. Three sessions starting within a minute of each other was enough.
