# A plugin install finds its own scripts

> Several scripts assume Plot is vendored at `<repo>/skills/plot/`. With Plot installed as a Claude Code plugin — the documented install — that directory does not exist. Measured 2026-09-25 on Plot 2.20.0 as a plugin: the installed gates point at a path that is not there, and every refusal text prescribes a command the operator cannot run.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #980
- **Sprint:** a-refusal-names-what-it-cannot-see

## Changelog

- Scripts that reach another Plot script resolve it beside themselves rather than against the adopting repository's root, so a plugin install works where a vendored checkout did. Refusal texts name a command that exists on the reader's machine.

Board impact: none directly. The gates are `PreToolUse` hooks and the refusal texts are prose; neither reaches the board's payload.

## Motivation

**The documented install is the one that does not work.** `<repo>/skills/plot/` exists only where the repository vendors Plot. A plugin install puts the scripts under `${CLAUDE_PLUGIN_ROOT}`, and three sites still name the vendored path.

**One third of this is already fixed, and that is the evidence the rest is real.** `#969` reported item 1 — `plot-fleetctl.sh` resolving the supervisor artifact against `$repo_root` — and it shipped 2026-09-25 as PR #986. Measured now, `plot-fleetctl.sh:97` reads `$script_dir/board/plot-registryd.mjs` and the supervisor starts. The same defect at two more sites was reported in the same issue and is untouched:

| site | measured 2026-09-25 | state |
|---|---|---|
| `plot-fleetctl.sh:97` | `$script_dir/board/…` | **fixed** (#986) |
| `plot-install-hooks.sh:145` | `"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/%s` | live |
| `plot-controller-gate.sh:232` | `bash skills/plot/scripts/plot-state-receipt.sh …` | live |

**The two live ones fail differently, and the first fails silently.**

### The installed gates permit everything

`plot-install-hooks.sh:145` writes `.claude/settings.json` entries rooted at `$CLAUDE_PROJECT_DIR`. In a plugin install that path holds no script, so every gate invocation runs a missing file. A `PreToolUse` hook that cannot execute is **non-blocking** — it permits. So the phase gate, the state gate and the controller gate are all installed, all reported as installed, and none of them refuses anything.

**`--verify` says `verified` anyway**, because it runs the scripts next to itself rather than the paths it wrote. That is the part that makes this worse than a plain absence: the installer confirms a protection that is not in place.

**The plugin already registers the same gates** through `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}`, so on a plugin install the project-level entries are not merely broken — they are redundant. `plot-install-hooks.sh`'s own rule already refuses to add a gate a plugin install has registered, *"because the state gate spends its receipt when it clears, so a second reader finds it spent and refuses a write that was properly owned."* A broken duplicate cannot spend a receipt, so today the redundancy is harmless and the silence is not — but the rule says the right answer is to write no entry at all.

### The refusal texts prescribe a command that is not there

`plot-controller-gate.sh:232` prints:

```
bash skills/plot/scripts/plot-state-receipt.sh --unowned-action <action> <slug> "<reason>"
```

On a plugin install that file does not exist, so **the named escape from a gate is unreachable**. CLAUDE.md's argument for the escape is that *"a gate with no exit is one people route around"* — and an exit whose command errors is a gate with no exit.

## Design

### The rule, stated once

**A script that reaches another Plot script resolves it beside itself.** `$script_dir` is what every correct site already uses, and `plot-fleetctl.sh:97` is the worked example from #986. `$repo_root` answers *which repository am I acting on*, which is a different question and stays where it is asked.

### What each site needs

**`plot-install-hooks.sh`** — the written path must point at the scripts that will actually run. Two cases, and they are not the same:

- **vendored**: `$CLAUDE_PROJECT_DIR/skills/plot/scripts/…` is correct and stays.
- **plugin**: the plugin's own `hooks/hooks.json` already registers the gates. The installer should detect this and **write nothing**, reporting that the gates are registered rather than adding entries that cannot fire.

`--verify` must test **the path it wrote**, not a sibling. That is the defect that turned a broken install into a confirmed one.

**`plot-controller-gate.sh`** — the refusal text names `$script_dir/plot-state-receipt.sh`, which it can compute. A reader copying the line gets a command that runs.

### What this does NOT do

- It does not change what any gate decides, only whether it can be reached.
- It does not touch `plot-fleetctl.sh` — #986 fixed it, and re-fixing it would be the duplication this plan exists to name.
- It does not change `hooks/hooks.json`, which is already correct.
- It does not audit every script for the pattern. The three sites #980 names are the measured ones; a sweep is a separate plan with its own gate.

### Open questions

- [ ] **How does a script tell a plugin install from a vendored one?** `${CLAUDE_PLUGIN_ROOT}` is set in a hook's environment but not necessarily when a script runs by hand. The detection must not guess wrong in the direction that skips a gate a vendored repo needs.

## Done when

- `plot-install-hooks.sh` on a plugin install writes no project-level gate entry and says why; on a vendored install it writes what it writes today.
- `--verify` tests the path it wrote. A test asserts that a settings entry pointing at a missing script reports **not** verified.
- `plot-controller-gate.sh`'s refusal names a path that exists on the machine printing it.
- **A test per site**, and one asserting `plot-fleetctl.sh` is untouched.
- The gate set is still read from `hooks/hooks.json` rather than hardcoded — the existing rule, unchanged.

## Slices

### The installer writes a path that runs (Branch: bug/the-installer-writes-a-path-that-runs)

- `bug/the-installer-writes-a-path-that-runs` — `plot-install-hooks.sh` detects a plugin install and writes no project-level entry, reporting the plugin's own registration instead; `--verify` tests the written path rather than a sibling, so a broken entry reports unverified; tests for the vendored arm unchanged, the plugin arm writing nothing, and `--verify` refusing a missing target

### A refusal names a command that exists (Branch: bug/a-refusal-names-a-command-that-exists)

- `bug/a-refusal-names-a-command-that-exists` — `plot-controller-gate.sh:232` builds the escape command from `$script_dir`; a test asserts the printed path resolves to a real file from a checkout whose layout differs from the caller's

## Notes

- Reported as one issue naming three sites. The first shipped separately as `fleet-control-finds-its-own-artifact` (#969 → PR #986) before this plan was written, which is why this plan covers two slices rather than three and says so in a table rather than quietly dropping it.
- **The silent failure is the serious half.** A missing gate script permits, and the installer reports `verified`, so a repository can believe it has three gates and have none. The refusal-text defect is real and merely inconvenient by comparison.
