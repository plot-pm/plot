## Implementation brief — a-unit-can-find-the-harness

- **Plan (canonical):** `docs/plans/2026-09-29-a-unit-can-find-the-harness.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-unit-can-find-the-harness` (base: `main`, claimed at `4063cca7`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review + CI)
- **Issue:** #1068

Single-slice plan: nothing waits on this branch and it waits on nothing. #1067 (a desk resumes the previous slice's session) is `bug/a-slice-starts-its-own-conversation` and stays out of this branch.

### What to build

Both supervisor units set a fixed `PATH` whose comment names *git, gh and node* and not the harness. The two platforms fail differently. On macOS, `com.plot-pm.registryd.plist:53` carries `/opt/homebrew/bin`, so a supervisor-started worker silently runs `/opt/homebrew/bin/claude` 2.1.231 while the operator's shell runs `~/.local/bin/claude` 2.1.282. On Linux, `plot-registryd.service:39` has no directory where `claude` installs, so the worker exits 127.

Build: `plot-fleetctl.sh --start` resolves the harness (`${PLOT_HARNESS:-claude}`) with `command -v` at install time, refuses when it cannot, and fills the result into both units beside `__NODE__` (`plot-fleetctl.sh:744`). Update both unit comments to name the harness. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**TRAP — the resolved value cannot travel as `PLOT_HARNESS` in the unit's environment.** The plan says *"bake it into the unit"* and does not say through which variable. The obvious choice fails. `plot-dispatch.sh:1447` exports `PLOT_HARNESS="$launch_harness"` on every launch, and `resolve_launch` (`:897-964`) sets `launch_harness=""` on every path except a charter that declares a harness. Zero charters exist, so every worker receives `PLOT_HARNESS=""`, and the template's `${PLOT_HARNESS:-claude}` (`templates/worker-prompt.sh:136`) falls back to a bare `claude` lookup on `PATH`. A `PLOT_HARNESS` set in the unit is overwritten before the prompt reads it. A test that fills the unit and asserts the variable passes and proves nothing.

**`PATH` is the channel that reaches the worker, and it is the only one that reaches existing adopters.** `run-script.ts:70` inherits the environment, and nothing between launchd and the prompt rewrites `PATH` (the round-1 juror checked all five hops). A `__HARNESS_DIR__` (or similar) placeholder that PREPENDS `dirname` of the resolved harness to the unit's `PATH` makes `command -v claude` inside the worker answer the binary `--start` resolved. It needs no change to the template. A template change reaches only a fresh `/plot-init`, because `plot-install-prompt.sh` never overwrites a prompt file (`:8-10`, `:67`). This is the brief's reading, not the plan's text. If you choose another channel, state in the PR why it survives `:1447`. Changing dispatch so an empty charter harness inherits the caller's value is a second option, but the plan says *"It does not change `PLOT_HARNESS`"*. Report it rather than choose it silently.

**Prepending puts every binary in that directory first**, not only the harness. On this machine that directory is `~/.local/bin`. State that in the unit comment. Do not narrow it by symlinking one binary into a private directory: that is a new installed artifact with its own upgrade story.

**Resolve with `command -v`, not a list.** `plot-fleetctl.sh:638` resolves node the same way. The plan's round 1 rejected a PATH list: this machine holds two installs at two versions, and a list records no reason for its order.

**The plan contradicts itself once; the Design and `Done when` win.** *"What this does NOT do"* still opens with *"It does not probe for the harness at install time"*. Round 1 reversed that bullet and left it standing. Resolve at install time.

**The refusal at worker run time already exists — do not build it.** `plot-worker-loop.sh:2008-2021` (commit `85eaa80c`, 2026-09-06) writes `PLOT-BLOCKED`, an ending record `unstarted`/`agent`, and exit 1 after `START_ATTEMPT_BUDGET` (`:359`, 3) attempts. `test/reconcile/second-slice.test.mjs:353-391` asserts it. This slice adds the refusal at `--start` only.

**The `--start` refusal follows REFUSAL 2's shape** (`plot-fleetctl.sh:637-661`): name what it looked for (the harness name, and `PLOT_HARNESS` if set), say that the unit bakes the value in permanently, and name the fix. Exit 1 before the unit is written.

**Rules carried over:** absent is not false; read the exit code, not the emptiness (`command -v` exits non-zero and prints nothing); `grep -c` prints a count AND exits 1 on no match (`:750-756` records the measured failure). Do not add a `|| echo 0` near the fill check.

### Done when

The plan's `## Done when` list is the specification. Assertions that a naive implementation would pass without:

- **Assert what the WORKER resolves, not only what the unit file says.** Read the filled unit's `PATH`, run `env -i PATH=<that> sh -c 'command -v claude'` against a stub harness in a temporary directory, and assert the stub's path. A test that greps the unit for the path passes even if the value lands in a variable that `:1447` overwrites.
- **`PLOT_HARNESS` is honoured:** with `PLOT_HARNESS=my-harness` and a stub of that name on `PATH`, `--start` resolves the stub. With `PLOT_HARNESS` naming nothing on `PATH`, `--start` refuses, names `my-harness`, and writes no unit file.
- **The fill check still catches a surviving placeholder.** Add the new placeholder to the expected lists at `test/reconcile/fleetctl.test.mjs:454-455` and to the `.replaceAll` fixtures at `:472`, `:482`, `:508`.
- **A machine whose harness is already on the default unit `PATH` is unchanged** in behaviour. Prepending a directory that is already on it is harmless; assert that the resolved binary is the same.
- **Both unit comments name the harness**, and `skills/plot/units/README.md` names the new placeholder in its count sentence (`:5`, "four" and "three") and in both manual `sed` blocks (`:44-47`, `:99-101`).
- **The changeset says an installed unit needs `--stop` then `--start`.** Also record that the template half is undeliverable to existing adopters.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts` (includes `fleetctl.test.mjs`). `test:e2e` is CI's gate; do not run it locally. The changeset uses `'plot': patch` with a `bumps:` block last (`plot-fleet: patch`), and the description goes first.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (or `--draft`). Do not use `gh pr create`.
- When the PR exists, append `, PR: #<number>` inside this branch's heading in the plan's `## Slices` (`### A unit can find the harness (Branch: …, PR: #N)`). The trailing-arrow form parses as `prs=[]` for a heading-style plan.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot/units/` (both units and `README.md`), `test/reconcile/fleetctl.test.mjs`, and one changeset. It does not touch `plot-dispatch.sh`, `plot-worker-loop.sh`, `templates/worker-prompt.sh`, or `plot-install-prompt.sh`.

In flight at dispatch (2026-09-29): no remote branch changes any of those paths. `bug/a-slice-starts-its-own-conversation` owns `plot-worker-loop.sh` and `packages/board/src/server/registry.ts`. The only open PR is #1047 (release).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
