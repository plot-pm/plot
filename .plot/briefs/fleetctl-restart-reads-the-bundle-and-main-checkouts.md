## Implementation brief — shell-scripts-refuse-a-second-mode-and-name-the-fetch (wave 2: Restart Roots)

- **Plan (canonical):** `docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3612 merged
- **Branch:** `bug/fleetctl-restart-reads-the-bundle-and-main-checkouts` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 1 (`bug/boardctl-and-dispatch-refuse-a-second-mode`) merged as #3628 and touches other files. Wave 3 (`bug/check-scripts-name-the-default-branch-fetch`) touches `scripts/` only. This slice waits on neither.

### What to build

`plot-fleetctl.sh --restart` reads two wrong checkouts (#3367, found in the review of #3340). Anchors re-read on `origin/main` at dispatch: all line numbers below hold.

- **M1, the reported commit.** `:1120` (`restartPlan`) and `:1141` (`restarted`) pass `git -C "$repo_root" rev-parse --short HEAD`. `$repo_root` is the repository the command runs in, but the reload at `:1131-1136` re-runs the program `--start` recorded (`$script_dir/board/plot-fleetd.mjs`, `:136`). In a consumer repository the report names the consumer's HEAD, and in a linked worktree it names the worktree's HEAD. The domain labels the value "the bundle checkout's short commit" and prints `unknown` for an empty one (`packages/domain/src/rules/fleetctl-start.ts:73,115,205`).
- **M2, the owner root.** `:1102` calls `old_label_refuses "${mode/restart/stop}"` with no root, so `old_label_action` compares the loaded job against `$repo_root` (`:592`). The supervisor serves the main checkout, so from a desk or scratch worktree the rule answers `another` and `--restart` refuses with "serves ANOTHER checkout". `--stop` already passes `stop_root=$(plot_repo_root)` (`:1280-1281`) for this reason.

The fix:

- **M1.** Before `:1120`: `unit_root=$(supervisor_bundle_path); unit_root=${unit_root%/skills/plot/scripts/board/*}`. `supervisor_bundle_path` (`:230-237`) already reads the `.mjs` path from the loaded job's argv (launchd `arguments = {…}`, systemd `ExecStart`). Both calls then pass `"$(GIT_CEILING_DIRECTORIES="${unit_root%/*}" git -C "$unit_root" rev-parse --short HEAD 2>/dev/null)"`. An unreadable bundle path leaves `unit_root` empty or a non-directory, and the commit is empty too. No domain change.
- **M2.** `:1102` becomes `old_label_refuses "${mode/restart/stop}" "$(plot_repo_root)"`. The line also serves `--start` (verb `start`), and the change applies to both modes with no fallback. On an unloaded unit `old_label_action` returns before it asks (`:593`); on a loaded unit `start` refuses whatever checkout it serves, so for `--start` from a linked worktree only the refusal text changes: `serving THIS repository` in place of `serving ANOTHER checkout` (`packages/board/src/server/entry/old-label.ts:121,123`).

The plan's `Design › Slice 2` is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Read the unit's bundle path, not `$plot_root` or `$repo_root`.** `$plot_root` is the invoked script's checkout, which need not be the unit's. The unit's argv is the only reading of what the supervisor runs, and `restarted` reads it after a reload that re-runs the same recorded program.

**The ceiling is not optional.** Without `GIT_CEILING_DIRECTORIES`, `git -C <plugin dir>` walks up to a git-tracked parent (a `~/.claude` kept in git, or a plugin vendored in the consumer) and reports the parent's HEAD. That is the same defect with a different wrong answer. With the ceiling set to the checkout's parent, a plugin directory with no `.git` answers empty and the domain prints `unknown`. A linked worktree's `.git` file still resolves.

**No fallback for M2.** The plan dropped a `$repo_root` fallback in panel round 1: it would keep the refusal for the case the fix targets.

**Out of scope, named by the plan — do not fix them here:**

- A supervisor started from a linked worktree. `--start` fills the unit with `$repo_root` (`:1124`), so such a unit serves the worktree, and after M2 a `--restart` from that worktree reads `another` and refuses. #3367 does not cover it.
- `:1103` (`start-default`) still compares against `$repo_root`. It asks about the default label's unit, a different unit from `$LABEL`.
- The six LOW points from the review of #3340.

**Rules carried over unchanged:** read the exit code, not the emptiness; absent is not false. An empty commit is `unknown`, never the parent's or the consumer's HEAD.

### Done when

The plan's `Changelog` items 3 and 4 plus the `Tests` bullets of Slice 2 are the specification. Lifted, with what each catches. Tests go in `test/reconcile/fleetctl.test.mjs`, beside the `--restart` block at `:3846-3998`. The `restartEnv` stub (`:3878`) prints a `working directory` and no `arguments = {…}` block; extend it to print the bundle path the way the stub at `:2211-2237` does.

- **A plugin checkout.** In `consumerSandbox` (`:2612-2644`), `git init` the plugin directory `box/plugin-cache/plot/9.9.9` and commit once. `--restart` reports `bundle commit: <plugin short HEAD>` (one space, `restarted`, `fleetctl-start.ts:205`) and not the consumer's HEAD. `--restart --dry-run` reports `bundle commit:  <plugin short HEAD>` (two spaces, `restartPlan`, `:115`). Catches M1 reading `$repo_root`. The tests missed this defect because `sandbox()` puts the scripts inside the sandbox root, so every candidate root is the same directory; this fixture is what separates them.
- **No `.git`.** An unmodified `consumerSandbox` (plugin with no `.git`) reports `bundle commit: unknown` for `--restart` and `bundle commit:  unknown` for `--restart --dry-run`. A second case places the plugin directory, still with no `.git`, inside a `git init`-ed parent and asserts the same `unknown`. Catches a missing ceiling.
- **A worktree ahead of main.** A linked worktree of the sandbox repository carries one commit that main does not. The main checkout's `ctl` runs with `cwd` set to the worktree (the worktree holds no `skills/`, `fleetctl.test.mjs:155-161`). The unit's bundle path names the main checkout. `--restart` restarts the supervisor (the pid changes), does not print `serves ANOTHER checkout`, and reports `bundle commit:` equal to the main checkout's short HEAD, not the worktree's. Catches M1 and M2 together. Run it against the unfixed script first and see it fail.
- **`--start` from a worktree.** With a loaded unit that serves the main checkout, `--start` run from the same linked worktree exits 1 and prints `is already loaded, serving THIS repository`. Catches M2 applied to `--start`.
- Style of the tests: `test/reconcile/fleetctl.test.mjs:782-857`. Any helper you write is an arrow function.

Plus the repo's gates:

- **Changeset.** Add `.changeset/<slug>.md` for `'plot': patch` — description first (at least 20 characters), the `bumps:` block last with `skills: plot: patch`. Run `./scripts/check-changeset-packages.sh`.
- **Local checks.** Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.
- **Shell line budget.** `scripts/check-shell-lines.sh pr` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice nets **+2** in `plot-fleetctl.sh` (the `unit_root` line counts 2; the two call lines keep their count; the `:1102` argument counts 0), so it pays 2 in the same change. Options: read the commit once into one value used by both calls, or remove two commands elsewhere in the file. Measure with the gate before the push. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The PR body names issue #3367.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs` and one `.changeset/*.md`. Do not touch `plot-boardctl.sh` or `plot-dispatch.sh` (wave 1, merged), `scripts/` (wave 3 owns it), `packages/` (no domain change) or the generated bundles under `skills/plot/scripts/board/`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
