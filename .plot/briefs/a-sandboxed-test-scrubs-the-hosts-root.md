## Implementation brief — a-sandbox-does-not-inherit-its-host (A sandboxed test scrubs the host's root)

- **Plan (canonical):** `docs/plans/2026-09-26-a-sandbox-does-not-inherit-its-host.md` on `main`. Read it in full first, then the slice-1 panel verdict at `.plot/panels/a-sandbox-does-not-inherit-its-host/slice1.md`.
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel
- **Branch:** `bug/a-sandboxed-test-scrubs-the-hosts-root` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #1000
- **Review of the code:** per repo convention; CI is the authority

The plan has one slice. Nothing waits on it and it waits on nothing.

### What to build

Contract tests in `test/reconcile/` build a temp repository and run `plot-dispatch.sh` in it. When the suite runs inside a dispatched worker, `PLOT_REPO_ROOT` is already set to the host checkout, and `plot-config.sh:167` prefers it over `git rev-parse`. The sandbox then reads the host's `## Plot Config`, gets this estate's absolute `Agent registry`, and writes its agent manifest into the host's `.plot/agents/`. Measured 2026-09-25: 19 of 20 manifests there were test fixtures, and the board rendered each one as an agent row.

The variable arrives by plain inheritance, not from any Plot script: the launchd plist (`skills/plot/units/com.plot-pm.registryd.plist:44-45`) sets it, and it travels supervisor → dispatcher → wrapper → worker loop → any suite that worker runs. The panel measured this on live pids 1506 and 2949.

Three deliverables:

1. `delete env.PLOT_REPO_ROOT` at the three env choke points.
2. A regression test that reproduces the leak against a decoy root and asserts it does not happen.
3. A gate that catches the next test that forgets.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**`plot-config.sh` stays untouched.** Its precedence (`:158-170`) removed 21 of 42 git spawns in one board build. A narrower rule, *"honour the variable only when it agrees with git"*, must spawn `git rev-parse` to compare, which restores every spawn it saved. The board also sets the variable for a repository that is not the cwd's on purpose. The variable is correct. Inheriting it into a sandbox is the defect.

**The scrub sits at the env choke points, not at the `mkdtemp` calls.** The first draft named four `mkdtempSync` lines, and a `delete` there does nothing. The three sites that build an env are:

| site | what is there | note |
|---|---|---|
| `test/reconcile/dispatch.test.mjs:299` | shared `dispatch:` helper, `env: { ...process.env, PLOT_PLUGIN_ROOT: …, ...(opts.env ?? {}) }` | the `delete` must come **after** the `opts.env` spread, or a caller passing the variable puts it back. This means building the object first and deleting from it, not an inline literal |
| `test/reconcile/dispatch.test.mjs:3336` | `runDetached`, `env: { ...process.env, ...env }` | same ordering rule |
| `test/reconcile/restart.test.mjs:122` | `run()`, `const env = { ...process.env }` | delete beside the existing `env.PLOT_AGENT_PROCESS` line |

Every test in those two files routes through these helpers, so each scrub covers the file's future tests too. The worked example is `test/reconcile/approve-record-outside-comments.test.mjs:117-126`. Copy its comment's reasoning, not its wording.

**The gate's discriminator is "no host manifest names a worktree under the system temp directory".** The obvious alternative, *"the host registry is unchanged across the suite"*, is unimplementable. `plot-registryd.mjs --start-agents` runs under launchd with `KeepAlive: true` and writes manifests on its own schedule. The panel caught two honest manifests written mid-session. A snapshot-and-compare gate flags those, fails, and gets turned off. The discriminator reads a property of each manifest: a fixture's `worktree` lies under `os.tmpdir()` (`/private/var/folders/…`, `/tmp/…`), and a real desk lies under the configured `Worktree root`. Resolve both sides with `fs.realpathSync`, because on macOS `os.tmpdir()` is `/var/folders/…` while recorded paths read `/private/var/folders/…`.

**Reaping the leaked manifests is out of scope.** `plot-reap.sh:690-718` already sweeps a manifest whose desk is gone (#474, 2026-08-27). Slice 2 was rejected for proposing that sweep again. Do not add one.

### Two traps the plan's wording does not show

**A decoy with no absolute `Agent registry` reproduces nothing, and the test passes on unfixed code.** `plot-dispatch.sh` resolves a relative registry against its own `repo_root`, which is `git rev-parse --show-toplevel` of the sandbox (`:1560`, `:1801`, `:1829`), not `PLOT_REPO_ROOT`. A decoy that declares no key, or a relative one, therefore produces a manifest inside the sandbox. The decoy must:

- exist as a directory, because `plot-config.sh:167` falls back to git on a missing path, and a non-existent decoy is silently ignored;
- carry a `CLAUDE.md` whose `## Plot Config` declares an **absolute** `Agent registry` inside the decoy, as this estate's does.

Run the regression test against unfixed helpers first and watch it fail. A regression test you have not seen go red proves nothing here.

The plan says a repository with a relative key "leaks one hop later, via `plot-dispatch.sh:1125`". For the manifest that does not hold, because `$repo_root` at `:1125` is git's answer. Other config keys read from the host are still wrong under a relative key. Record the correction in the plan's Notes. Do not build anything for it.

**CI never sets `PLOT_REPO_ROOT`, so a gate that only runs in CI is always green.** The leak appears only where a worker runs the suite. The gate must run where `pnpm run test:contracts` runs, including inside a worker's desk. Also note that `node --test` runs files concurrently, so a gate written as one more `*.test.mjs` file is not guaranteed to run after the tests that leak. Two shapes survive that constraint:

- an assertion inside the shared helpers after each spawn;
- a post-suite check chained onto `test:contracts` in `package.json`.

The plan leaves the choice to this slice. Name the choice and the reason in the PR body.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation passes without them:

- **The regression test sets `PLOT_REPO_ROOT` deliberately.** Without it, the test passes on unfixed code in CI and on any shell that did not inherit it.
- **It points at a decoy temp root, never the real repository.** A failing test that names the host writes into the host registry, which causes the defect it defends against.
- **The decoy declares an absolute `Agent registry`.** Without it, see the trap above.
- **The gate tolerates live agents.** Test it with a manifest whose worktree is outside the temp directory present in the registry, and assert that the gate passes.
- `skills/plot/scripts/plot-config.sh` has no diff.
- `approve-record-outside-comments.test.mjs` and `started-record-outside-comments.test.mjs` pass unchanged.

Repo gates:

- `nvm use` (Node 24; pnpm crashes on 26)
- `pnpm test`
- `pnpm run test:contracts`. Run it with `PLOT_REPO_ROOT` both exported and unset. Under load, re-run any `ETIMEDOUT` file alone before believing it.
- A changeset: `'plot': patch`, description first. The change touches no skill, so it needs no `bumps:` block. Add `plan: docs/plans/2026-09-26-a-sandbox-does-not-inherit-its-host.md` in the trailing comment block.
- Do not run `test:e2e` locally. CI runs it.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the branch's line in the plan's `## Slices` section on `main`.
- Answer the plan's open question *"How many of the other 91 tests are exposed?"* in the plan's Notes, with the number the gate reports. 24 files in `test/reconcile/` invoke `plot-dispatch.sh`, and `fleet.test.mjs` alone builds at least ten envs over `...process.env`. Report the exposed count. Do not scrub those files in this slice unless the gate fails on them.

### Scope guard

This branch owns:

- `test/reconcile/dispatch.test.mjs` (the two helpers only)
- `test/reconcile/restart.test.mjs` (`run()` only)
- one new regression test file under `test/reconcile/`
- the gate (a helper assertion, or a script under `scripts/` plus its `package.json` hook)
- `.changeset/`
- the plan's `## Slices` line and `## Notes`

It does not touch `skills/plot/scripts/`, `packages/`, the launchd/systemd units, or the host's `.plot/agents/`.

Other branches touching these files at brief time (2026-09-26): exactly one. `feature/one-monitor-watches-the-slice` changes `dispatch.test.mjs` at `:2557` and `:2691`, the manifest tests, and not the two helpers. Its last commit is 2026-09-06 and records a blocking question, so it is not moving. No branch touches `restart.test.mjs`. If the gate reports leakers outside the two named files, or you find something else the plan did not anticipate, report it in the PR and the plan's Notes rather than improvising outside scope.
