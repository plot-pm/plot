## Implementation brief — fleet-control-finds-its-own-artifact (wave 1: Fleet control resolves beside itself)

- **Plan (canonical):** `docs/plans/2026-09-24-fleet-control-finds-its-own-artifact.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/fleet-control-resolves-beside-itself` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)
- **Issue:** #969

The plan's only slice. Nothing waits on it, and it waits on nothing.

### What to build

In a repository that consumes Plot as a plugin, `/plot-fleet --once` refuses with *"no supervisor artifact at <consumer>/skills/plot/scripts/board/plot-registryd.mjs — Build it: pnpm build:board"*. Both lines are false: the bundle ships, tracked, beside the script in the plugin, and `build:board` is this repository's script and not the consumer's. The cause is `plot-fleetctl.sh:89`, which builds the path from `$repo_root` (`git rev-parse --show-toplevel`, `:88`), and that is the consumer's checkout.

Four changes in `skills/plot/scripts/plot-fleetctl.sh`, plus one new gate:

1. `:89` → `registryd="$script_dir/board/plot-registryd.mjs"`. `$script_dir` is already defined at `:64`.
2. `pinned_major()` (`:108-112`) reads **Plot's** `.nvmrc`, resolved from `$script_dir` (the repo root is `$script_dir/../../..`; the plugin cache at `~/.claude/plugins/cache/plot-marketplace/plot/<ver>/` carries `.nvmrc` = `24`, verified 2026-09-24). Also fix the refusal text at `:531`/`:534`: *"this repository pins"* and *"nvm use"* are wrong in a consumer that has no `.nvmrc`. Name Plot's pin, and a repair a consumer can perform.
3. The unit fill (`:593`, `-e "s|__REGISTRYD__|$registryd|g"`) needs no edit of its own because it reads `$registryd`. The done-when still requires a test that proves the filled unit names the plugin's path.
4. Both missing-artifact messages (`:505-506` for `--once`, `:518-519` for `--start`) follow `plot-dispatch.sh:1951-1954`. That model says the bundle is tracked, so an absent bundle means a broken or partial installation, and it limits `pnpm build:board` to *"In a development checkout"*. (The plan cites `:1955-1960`. The block has shifted up by 4 lines since then, and the content is unchanged.)
5. A gate: `scripts/check-<name>.sh` + a `ci.yml` step + `test/reconcile/<name>-gate.test.mjs`. It counts shipped-bundle paths (`…/board/*.mjs`) resolved against `$repo_root`/`git rev-parse --show-toplevel`, and it holds at zero.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**`$script_dir`, not `plot-board-probe.sh`.** The issue suggests following `plot-boardctl.sh` through the probe. That is rejected. The probe exists to report *provenance* (`artifact_source`), and fleet control needs only the path. A probe call would also make the board's script a dependency of fleet control, and `DESIGN-process.md` §1 keeps the two independent. The count that settles it: 26 sites already use `$script_dir/board/` (or `$here`/`HERE`), and exactly one site used `$repo_root`.

**Leave every other `$repo_root` alone.** `:176` (start marker), `:260`/`:266` (worktree root), `:378`/`:567`/`:568`/`:641` (logs, state), `:562` (status print) and `:591` (`__REPO_ROOT__`) all belong to the *consumer's* estate, and they are correct. Only a shipped artifact and Plot's own pin move.

**The node pin is Plot's, not the consumer's.** Today a consumer with no `.nvmrc` makes `pinned_major` print nothing, and `[ -n "$want" ]` at `:530` then **skips refusal 2 silently**. That refusal is the one that stops a wrong interpreter from being baked permanently into the unit. The fix makes it fire. Decide what an *absent Plot `.nvmrc`* means, for example in an npm install whose `files` may not ship it. It must not silently read as "no pin" again. If the only honest answer is a refusal or a named warning, report it rather than guess.

**Do not fix installed units.** A unit filled before this lands still names the wrong path. `--stop` then `--start` is the documented upgrade path, and it stays the only one.

**The gate's two known blind spots belong to the slice:**
- `plot-pr-merged.sh:105` inlines `$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/board/plot-landed.mjs`. It is correct, and the gate must not flag it. (The plan's wording, *"catching the inlined `BASH_SOURCE` form"*, means: recognise it as script-relative rather than miss or misfire on it.)
- `plot-board-probe.sh:266-268` legitimately builds `$git_root/skills/plot/scripts/board/board-server.mjs` as its documented last fallback (`artifact_source="checkout"`). **Exempt it by name**, with the reason in the exception list, the way `check-host-cli-callers.sh` names its four exceptions.

**Carried-over invariants:** absent is not false (the `.nvmrc` bug is exactly that). A gate described and not built is a rule, so the gate is built on this branch or the plan's done-when is amended. It is not dropped silently.

### Done when

The plan's `### Done when` list is the specification. The assertions that exist because a naive fix would pass without them:

- **The test runs from a consumer-shaped checkout**, a sandbox git repo with *no* `skills/` directory and *no* `.nvmrc`, that invokes the real `plot-fleetctl.sh` by absolute path. A test run from inside this repo passes before and after the fix, because here the two roots coincide.
- **The filled unit is asserted**, not only `--once`. Fixing `:89` without testing the fill leaves the permanent half unproven.
- **Refusal 2 fires in that consumer sandbox** with a mismatched node (stub `node` on PATH reporting another major). Today it cannot fire there, and that is the regression the panel found.
- **A missing artifact still refuses**, and the message names no `pnpm build:board` outside the *"development checkout"* clause.
- **The gate test proves both directions:** a planted `$repo_root/…/board/x.mjs` line fails it, `plot-pr-merged.sh`'s inline form passes, and `plot-board-probe.sh` passes only because of its named exemption.

Look at `test/reconcile/fleetctl.test.mjs` first. It already sandboxes this script (`PLOT_FLEET_LABEL` exists for tests).

Plus the repo's gates: `nvm use` (Node 24; use `corepack pnpm` if homebrew pnpm crashes), `pnpm test`, `pnpm run test:contracts`, the new check script run locally, and a changeset (`'plot': patch`, description first, `plan:` line and `bumps:` block last, where `bumps:` names `plot-fleet` if its SKILL.md text changes). **Do not run `pnpm run test:e2e` locally.** CI runs it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). **Do not use `gh pr create`.**
- When the PR exists, write `PR: #<n>` inside the wave heading in the plan's `## Slices` (the `(Branch: …, PR: #N)` form; a trailing `→ #N` does not parse there).

### Scope guard

This branch owns: `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs`, the new `scripts/check-*.sh` + its `test/reconcile/*-gate.test.mjs` + one `ci.yml` step, the changeset, and at most a wording touch in `skills/plot-fleet/SKILL.md` if its refusal text is quoted there. Also the CLAUDE.md helper table row for the new gate, if one is added.

Out of scope: `plot-board-probe.sh`, `plot-boardctl.sh`, `plot-pr-merged.sh` (read them, do not change them), and every other `$repo_root` in `plot-fleetctl.sh`.

Verified at dispatch (2026-09-24): no other remote branch touches `plot-fleetctl.sh`, its test, `scripts/check-*.sh` or `.github/workflows/ci.yml`. `ci.yml` is a shared hotspot, so rebase before opening the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
