## Implementation brief — every-file-plot-writes-declares-its-bound (wave 1: The sandbox reaches the browsers and CI)

- **Plan (canonical):** `docs/plans/2026-10-01-every-file-plot-writes-declares-its-bound.md` on `main`. Read it first. Its predecessor's design is `docs/plans/2026-09-30-every-temp-directory-has-an-owner.md`.
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-sandbox-reaches-the-browsers-and-ci` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Issue:** #1118
- **Review of the code:** per repo convention; CI is the authority

This is wave 1 of 3. `bug/no-entry-is-left-behind` (wave 2) waits on it: once this lands, CI's board job runs under the leak gate, and wave 2 removes that gate's ceiling. So wave 2 must also clear what the board package leaves. That is wave 2's work, not this branch's.

### What to build

`scripts/owned-run.sh` moves `HOME` into a private root (`:206`). On macOS Playwright looks for its browsers under `$HOME/Library/Caches/ms-playwright`. Inside the root that directory is empty, so every browser test in `pnpm run test:board` fails at `chromium.launch()` with a missing executable. The operator's cache is full (measured 2026-10-01: `chromium-1178` to `chromium_headless_shell-1234` under `~/Library/Caches/ms-playwright`).

Also, CI's board job does not run through the wrapper. `ci.yml:909` (`pnpm --filter @plot-pm/board test`) and `ci.yml:948` (`pnpm --filter @plot-pm/board exec vitest run`) call the suites directly. The #1114 changeset says both suites run in the root, and in CI that is false.

Two changes:

1. **`owned-run.sh` exports `PLAYWRIGHT_BROWSERS_PATH`** to the child, unless the caller set it. The value is the platform's default cache under the ORIGINAL `HOME`, which the script already keeps as `ORIG_HOME` (`:87`): `$ORIG_HOME/Library/Caches/ms-playwright` on Darwin, `${XDG_CACHE_HOME:-$ORIG_HOME/.cache}/ms-playwright` elsewhere. Put it in the env prefix at `:205-209` beside the other four variables, and update the header comment, which names four variables.
2. **CI's two board steps run through the wrapper**: `./scripts/owned-run.sh pnpm --filter @plot-pm/board test` and `./scripts/owned-run.sh pnpm --filter @plot-pm/board exec vitest run`. Keep each step's `timeout-minutes`.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

**Point at the operator's cache, do not install into the root.** Browsers are read by the suite and never written, so the read reopens no leak. A `playwright install` inside the root downloads about 150 MB on every run, and in CI the cache step (`ci.yml:925-931`) would no longer serve it.

**The caller's value wins, and "set" means set, not non-empty.** Test with `${PLAYWRIGHT_BROWSERS_PATH+set}`, the same idiom as `ORIG_TMPDIR_SET` at `:86`. `PLAYWRIGHT_BROWSERS_PATH=0` is a valid caller value: it tells Playwright to use browsers inside `node_modules`. A `-n` test would pass `0` through by luck and replace an empty value. Pass every caller value unchanged.

**Do not check that the directory exists.** If the cache is missing, Playwright's error then names the operator's cache path. That error tells the reader what to install. A wrapper that silently skips the export falls back to the empty root path and hides the cause.

**Do not move `XDG_CACHE_HOME`.** The wrapper does not set it today, so the caller's value is still in the environment when the default is computed. On the Linux runner it is unset, and the derived path is `~/.cache/ms-playwright`. That path is exactly the one `ci.yml:928` caches and `:941` installs into. The install step stays OUTSIDE the wrapper: it writes into the real cache by design.

**The CI scope is the two board steps at `:909` and `:948`, and the domain step at `:883` is not in scope.** The plan says "two `vitest` steps". `:909` is `node --test` (`packages/board/package.json:55`), not vitest. The two steps the plan means are the two that local `test:board` runs (`package.json:18`). The domain suite is not part of `test:board`.

**Do not add `bounded.sh` in CI.** `timeout-minutes` bounds each step there. Locally `bounded.sh` exists because nothing else bounds the run.

**Carried over from #1083, unchanged:**
- The registry check runs with the caller's `TMPDIR` and `HOME` (`:238-244`). Each wrapped CI step now also runs it. Leave that as it is.
- The suite's exit code survives both checks. A wrapped CI step that fails its tests must still fail.
- Delete only by the exact name `mkdtempSync` returned, never by a glob over a shared temp directory.

### Done when

The plan's `## Done when`, slice 1, is the specification:

- `pnpm run test:board` on macOS runs its browser tests, and none is skipped or failed at `chromium.launch()`. **Read the vitest summary, not the exit code alone.** Record the summary counts before and after the change in the PR body. A run whose browser files report "Executable doesn't exist" has not proved the fix. Run `pnpm build:board` first: browser tests load the built artifact.
- A caller-set `PLAYWRIGHT_BROWSERS_PATH` wins. Add contract cases to `test/reconcile/owned-run.test.mjs` over a fixture command (`sh -c 'printf %s "$PLAYWRIGHT_BROWSERS_PATH"'`), never over the real suite:
  - With no caller value and a fake `HOME`, the child sees the platform default under THAT `HOME`, not under `$root/home`. This case catches an implementation that computes the path after `HOME` moves.
  - A caller value `/x/y` reaches the child unchanged.
  - A caller value `0` reaches the child unchanged. This case catches a `-n` test or a value rewrite.
  - Set the expected path from `process.platform` so the test passes on the macOS laptop and on the Linux runner.
- CI's board job runs both steps through `owned-run.sh`, and the PR's CI run shows the board job green with the wrapper's output. A green job whose log does not show the wrapper ran is not evidence.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. Do not run `test:e2e` locally. Add a changeset: `"plot": patch`, description first, then the `plan:` line in the comment block (copy the shape of `.changeset/the-suites-own-their-temp-root.md` from commit `720a5015`).

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` inside this slice's heading in the plan's `## Slices` section: `(Branch: bug/the-sandbox-reaches-the-browsers-and-ci, PR: #N)`. Make that edit on `main` from a detached scratch worktree, not in the shared main checkout.

### Scope guard

This branch owns:

- `scripts/owned-run.sh`: the export and its header comment only. The leak gate and `PLOT_LEAK_CEILING` (`:273-313`) belong to wave 2. Do not touch them.
- `.github/workflows/ci.yml`: the `run:` lines at `:909` and `:948`, plus a comment if needed.
- `test/reconcile/owned-run.test.mjs`: new cases only. The ceiling cases at `:111-137` belong to wave 2.
- One new `.changeset/*.md`.

In flight, verified 2026-10-01: `bug/no-entry-is-left-behind` and `bug/every-state-path-is-declared` both exist at `74bb1b0c` (the approval commit) with no work yet. Both will edit `owned-run.sh` and `owned-run.test.mjs`, so keep this diff small and local to the env prefix. Open PR #1121 (`changeset-release/main`) touches `package.json` only. This branch has no reason to edit `package.json`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
