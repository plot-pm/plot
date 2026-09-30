## Implementation brief — a-fleet-agent-starts-without-the-operators-plugins

- **Plan (canonical):** `docs/plans/2026-09-30-a-fleet-agent-starts-without-the-operators-plugins.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `bug/a-fleet-agent-starts-without-the-operators-plugins` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention; issue #1099

One slice, one wave. Nothing waits on it and it waits on nothing, but PR #1102 edits four of the same files (see Scope guard).

### What to build

Every fleet agent is a `claude -p` session that inherits every `SessionStart` hook the operator's plugins declare. On 2026-09-30 the `episodic-memory` plugin's lockless sync ran three times at once at ~300% CPU each, the 1-minute load reached 195, and the supervisor did not tick for 12 minutes. The plugin's missing lock is upstream's defect; the multiplier (one session per worker start, restart, retry, hop and board agent-runner command) is Plot's.

The fix is a settings file, not a code path around `claude`:

1. `Agent settings` — a new `## Plot Config` key naming a JSON file (for example `{"enabledPlugins":{"episodic-memory@superpowers-marketplace":false}}`).
2. `plot-agent-settings.sh` — the one resolver. It prints an absolute path and exits 0, or prints nothing, names the reason on stderr and exits 3. Absent or empty key: nothing, exit 0.
3. `agentSettingsRefusal` — a domain rule in `packages/domain/src/rules/`, reached from the resolver through a new bundle `skills/plot/scripts/board/plot-agent-settings.mjs`.
4. `PLOT_AGENT_SETTINGS` — the exported absolute path. Each consumer interpolates `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}` itself.

Consumers: the worker loop, the shipped worker-prompt template and this repo's `.plot/worker-prompt.sh`, the board's startup environment, `entry/main.ts` (see below), `plot-dispatch.sh`'s detached `Brief command`, `plot-install-prompt.sh`'s new `settings-unread` report, and this repository's own config plus settings file. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**`--settings` is the mechanism, and it was measured.** With Claude Code 2.1.285, a `--settings` file setting one plugin to `false` overrode only that key: the debug log reads `will NOT register, plugin is disabled` for `episodic-memory` and `Loading hooks from plugin: plot`; `init` lists 34 plugins with `plot` present; six `PreToolUse:Bash` hooks fired. Do not look for another way to disable plugins.

**Not `--bare`.** It skips Plot's own four gates (`plot-phase-gate.sh`, `plot-state-gate.sh`, `plot-brief-name-gate.sh`, `plot-controller-gate.sh`) along with the plugins, and refuses OAuth. A fleet without its gates is the failure the gates exist for.

**Not rewriting commands.** Recognising `claude` inside `PLOT_UNATTENDED=1 claude -p …`, `env …`, absolute paths, wrappers and `npx` at ten spawn sites is a parser nobody can finish. An environment variable needs no recognition. `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}` was measured under `sh`, `dash`, `bash` and `ksh`: two arguments with a path containing a space, nothing when unset or empty.

**The board edits no spawn site.** `index.ts` resolves once at startup through the `Scripts` port's `awaited` call (`packages/domain/src/ports/scripts.ts:197`) and assigns `process.env.PLOT_AGENT_SETTINGS`. All ten sites inherit it. The paths are under `packages/board/src/server/`, not `actions/`: `idea.ts:713`, `implement.ts:225`, `interrogate.ts:323`, `story.ts:506`, `auto-deliver.ts:424`, `commission.ts:409`, `deliver.ts:531` and `reslice.ts:466` spread `process.env`; `brief-ask.ts:104` and `approve.ts:297` pass no `env`. The synchronous sites need no new port operation. A key change takes effect at the next board start.

**`plot-ask.mjs fleet` is a second process.** `entry/main.ts` runs `maybeAutoDispatch` and `maybeAutoDeliver` in its own node process, which the board's `process.env` does not reach. Set the variable there too, or name that path out of scope in the PR (round 3 note).

**The worker loop exports before it sources the prompt.** The sourcing is at `plot-worker-loop.sh:1631` (`bash -c '. "$1"' _ "$prompt_file"`), next to the `PLOT_CORRECTION_FILE` export. Export there, once per agent start. That covers every prompt `resolve_prompt_file` (`:1099`) returns, charter-declared ones included, and every launch path: dispatch, `--restart`, `/api/continue` and `--start-agents`. A refusal is one line in `.plot-worker.log`.

**The template guards on two things.** It adds `--settings` only when the variable is set and `harness` (`PLOT_HARNESS`, template `:136`) is `claude`. Another harness gets its argv unchanged.

**Relative values resolve against the main checkout,** the parent of `git rev-parse --git-common-dir`, as `Board artifact` does (`plot-config.sh:55-62`). `--show-toplevel` names the desk, and a desk cut from an older main may not hold the file. The key itself is read from the asking tree's `CLAUDE.md`, so an old desk without the key starts as today.

**What the refusal refuses, and why `env` goes whole.** `enabledPlugins` with any `plot@…` key set to `false`, `disableAllHooks: true`, or any `env` key. A settings `PATH` that hides the gates' tools makes them fail open: origin/main's `plot-state-gate.sh`, run with such a `PATH`, allowed a `State:` change (exit 0). `hooks` and `permissions` are out of scope: they add hooks or restrict tools and were not measured to unregister a plugin's hooks. This is a check against an accidental switch-off, not a security boundary.

**Missing or unparseable file: exit 3, never a hard stop.** The caller starts the agent without the flag and records the reason. Plot never passes `claude` a path that does not exist.

**`plot-install-prompt.sh`: add, do not replace.** The `PLOT_SESSION_FLAG` check at `:77` stays. After it, while `Agent settings` is set, a prompt that does not mention `PLOT_AGENT_SETTINGS` reports `settings-unread` and exits 3. That is a report like `stale` and `present`; the prompt stays the project's.

**Rules carried over unchanged:**
- The domain package uses arrow functions and factual TSDoc (CLAUDE.md, *The Domain Package*).
- The bundle is its own `build.mjs` entry, following the `plot-panel.mjs` block at `packages/board/build.mjs:308-329`, with its source in `packages/board/src/server/entry/`. Do not add a verb to `plot-ask.mjs`: that bundle runs the fleet scan.
- Exit 3 means *answered no*. Keep it apart from 1 (a broken pipe) and 2 (unreadable input), and read the exit code, not stdout's emptiness.

### Done when

The plan's `## Done when` list is the specification. The assertions that catch a naive implementation:

- **The gate measurement first.** Show that a `claude -p` run given the settings file is refused by `plot-state-gate.sh` when it commits a hand-written `State:` change. If it is not refused, stop and write `PLOT-BLOCKED.md`. A green run of everything else proves nothing if the gates are gone.
- **The rule's negative case:** a file that only disables other plugins answers none. Without it, a rule that refuses every `enabledPlugins` passes the positive tests.
- **The resolver asked from a desk,** not the main checkout. Only that test separates `--git-common-dir` from `--show-toplevel`.
- **The resolver with a desk whose `CLAUDE.md` has no key:** nothing, exit 0.
- **The template under `PLOT_PRINT_INVOCATION`** with `PLOT_HARNESS` set to a non-`claude` value: unchanged argv.
- **The loop with a charter-declared prompt file,** not only the default one.
- **Each of the ten board spawn sites** receives the variable through a stub command. The two sites without `env` are the ones a refactor would break silently.
- **`plot-install-prompt.sh`** with a prompt that has `PLOT_SESSION_FLAG` but not `PLOT_AGENT_SETTINGS`: `settings-unread`, exit 3. Without this, the existing early `exit 0` at `:77` hides the new check.

Plus the repo gates: `nvm use` (Node 24; `corepack pnpm` if homebrew pnpm crashes), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` (which rebuilds the artifacts, so commit the rebuilt `board-server.mjs` and the new bundle), `pnpm run typecheck`, and a changeset with the description first and the `bumps:` block last (`plot`: patch). Do not run `test:e2e` locally. Document `Agent settings` in `plot-config.sh`'s key list, in `CLAUDE.md`'s helper-script table (a `plot-agent-settings.sh` row plus the `plot-config.sh` row), and in the `## Plot Config` section: the key, a tracked settings file (for example `.plot/agent-settings.json`), and `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}` in the five `claude -p` command keys (`Idea`, `Story`, `Brief`, `Implement`, `Interrogate`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to the slice heading in the plan's `## Slices` section, inside the heading's parentheses: `(Branch: …, PR: #N)`.

### Scope guard

This branch owns the new `plot-agent-settings.sh`, the new domain rule and its tests, the new bundle entry and artifact, and the listed edits to `plot-worker-loop.sh`, `plot-dispatch.sh`, `plot-install-prompt.sh`, `plot-config.sh`, `skills/plot/templates/worker-prompt.sh`, `.plot/worker-prompt.sh`, `packages/board/src/server/index.ts`, `packages/board/src/server/entry/main.ts`, `packages/board/build.mjs`, `CLAUDE.md` and the new settings file.

**In flight, verified 2026-09-30:** PR #1102 (`bug/scripts-share-one-temp-helper`) edits `plot-worker-loop.sh` (5 lines), `plot-dispatch.sh` (17), `plot-config.sh` (6) and `CLAUDE.md`. It also adds `plot-tmp.sh` and a `temp-paths-gate` test. If #1102 merges first, rebase onto it and create any temp directory in new tests and scripts through its helper, or its gate will fail this branch. PR #1047 (release 2.21.1) touches no file here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
