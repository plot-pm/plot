## Implementation brief — a-plugin-install-finds-its-own-scripts (wave 1: The installer writes a path that runs)

- **Plan (canonical):** `docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md` on `main`
- **Approved:** 2026-09-25, Jan Wloka, in-session after two panel rounds
- **Branch:** `bug/the-installer-writes-a-path-that-runs` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review)
- **Issue:** #980

Wave 2 (`bug/a-refusal-names-a-command-that-exists`) waits on this branch's merge. It touches `plot-controller-gate.sh` only, so the two do not collide.

### What to build

`plot-install-hooks.sh --verify` reports `verified` for gates registered at a path that does not exist. Reproduced in a scratch consumer repository with no `skills/` directory: settings written by `gate_command()` (`:145`, `"$CLAUDE_PROJECT_DIR"/skills/plot/scripts/<gate>`), `--verify` run from a plugin copy, result `verified … exit=0`. The cause is `gate_path()` (`:191-195`), which resolves every gate beside the installer, so the existence check at `:289` tests the plugin's copy and never the path the registered command names. A `PreToolUse` hook whose script is missing exits ~127, and Claude Code blocks only on exit 2, so every such gate permits.

Change `--verify` so the existence check reads the path the REGISTERED command names. Where that path does not exist, report the gate `unverified` and name both readings (text below). The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The plan's Design and Notes (round 2) supersede three stale lines in the same file.** The `## Done when` bullets 1 and 2, the slice line's "tests the path the installer WROTE rather than the script beside itself", and the open question about plugin detection are round-1 residue. The Design section refutes each by name. Build the Design. Report the stale lines in the PR body so a person can amend the plan; do not edit the plan's Done-when yourself.

**No plugin detection.** An earlier draft proposed "detect a plugin install, write nothing". Refuted: `existing_bash_hooks` (`:149-155`) reads only `$root/.claude/settings.json`, and the harness never writes a plugin's hooks there, so the signal is absent. A wrong guess toward "plugin" leaves a vendored repository with no gates at all. `gate_command()` and the write path stay as they are.

**"Written path alone" is refuted too — the check reads the entry's SPELLING.** `${CLAUDE_PLUGIN_ROOT}` is unset when the installer runs by hand, so a plugin-rooted entry resolves to nothing and all three gates would flip to `unverified` on a correct install. `install-hooks.test.mjs:104`, `:144` and `:160` construct exactly that configuration, and `:135` documents it as correct. The plan's phrase "accept EITHER the written path or the sibling" must be read per entry, or it does not catch the measured defect (the sibling always exists when `--verify` runs from the plugin copy). The reading that satisfies both Done-when tests:

| registered command | resolve to | missing → |
|---|---|---|
| `"$CLAUDE_PROJECT_DIR"/…/<gate>` (or any path not rooted at the plugin variable) | expand `$CLAUDE_PROJECT_DIR` to the repo root, test that file | `unverified`, with the two-readings sentence |
| `"${CLAUDE_PLUGIN_ROOT}"/…/<gate>` | the script beside the installer (today's `gate_path`) — the plugin variable names this Plot copy | `unverified` (as today) |

If you find a spelling this table does not cover, report it rather than extending the rule.

**The two-readings sentence, for a written path that does not exist:**

> registered at `$CLAUDE_PROJECT_DIR/skills/plot/scripts/`, which does not exist here — if Plot is installed as a plugin these entries are inert and the plugin's own gates apply; if it is vendored, the vendoring is incomplete.

It is correct under both installs and guesses nothing.

**Carried-over rules:** the gate set is read from `hooks/hooks.json`, never hardcoded. The no-duplicate rule (basename match, `:365-370`) is unchanged. A check that goes red on a good install is one operators learn to ignore (`:254-263`).

### Done when

The plan's `## Done when` list, read through the Design as above. Assertions that exist because a naive implementation passes without them:

- **A `$CLAUDE_PROJECT_DIR`-rooted entry whose script is missing reports `unverified`, and `--verify` exits non-zero.** All five existing `--verify` tests use `repoWithGates()` (`install-hooks.test.mjs:280-290`), which copies the gates into `<dir>/skills/plot/scripts/`, so none of them sees the missing-path case. Build the fixture without that copy.
- **A `${CLAUDE_PLUGIN_ROOT}`-rooted entry with the gates in place still reports `verified`.** No existing `--verify` test spells the entry the plugin's way. Without this test, the "written path alone" false negative ships.
- **The vendored arm is unchanged:** the existing five tests pass untouched.
- **The missing-path report carries the two-readings sentence**, asserted on the text, not only the status word.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`. Not `test:e2e` — that is CI's gate. A changeset (`'plot': patch`, description first, `bumps:` block last) with `plan: docs/plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md`.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`).
- Append `→ #<number>` to this branch's line in the plan's `## Slices` section when the PR exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-install-hooks.sh`, `test/reconcile/install-hooks.test.mjs`, and its changeset. It does not touch `plot-controller-gate.sh` (wave 2), `plot-state-gate.sh:138,143,144` (deferred to a separate sweep), `plot-fleetctl.sh` (fixed by #986), or `hooks/hooks.json` (already correct).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
