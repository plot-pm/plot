## Implementation brief — delivery-reads-the-delivered-plan-and (wave 1: Ref path)

- **Plan (canonical):** `docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1971 merged
- **Branch:** `bug/deliver-ref-read-canonical-path` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waves 2 (`bug/scan-reads-plans-at-the-fetched-ref`) and 3 (`bug/default-branch-writes-take-turns`) are independent of this one. The plan's open question 3 asks whether wave 2 reuses this path fix; it can only do so after this wave merges.

### What to build

`POST /api/deliver` reads a plan's phase at the pulse's `read_ref`. `phaseAtRef` (`packages/board/src/server/deliver.ts:217`) builds the ref path with `path.relative(opts.repoRoot, file)`. `file` comes from `resolvePlanBySlug`, which returns a `fs.realpathSync` result. When `repoRoot` is not canonical (macOS `os.tmpdir()` is `/var/...`, which resolves to `/private/var/...`), the relative path starts `../../private/var/...`. `git show origin/main:<that path>` fails, `phaseAtRef` returns `null`, and the route falls back to the working tree — the stale read #1350 was written to remove. Issue #1355.

Fix the path, not the symptom. Either build it as `path.join(planDir, path.basename(file))` (`planDir` from `readConfig(opts, 'Plan directory', 'docs/plans/')`), or take `path.relative` against `fs.realpathSync(opts.repoRoot)` — the way `packages/board/src/server/board.ts:355-362` resolves its root. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The failure is silent, and that is why no test caught it.** A failed `showFile` returns `null` by design (*cannot read, never not delivered*, `deliver-route.test.ts` "falls back to the working tree when the ref read fails"). Do not change that fallback to throw: absent is not false. The fix makes the ref read succeed; it does not make a failed read loud.

**The combined test is the deliverable.** No existing test sends an `active/` symlink together with a `read_ref` under a symlinked root. Write it first and watch it fail: repo under a symlinked temp root (create the directory, `fs.symlinkSync` a second path to it, pass the symlink as `repoRoot`), `active/<slug>.md` symlink to the dated file, working-tree phase `Approved`, the injected `refsFixture` holding `origin/main:docs/plans/<DATED>` at `delivered`, expected verdict `already-delivered`. The fixture's `files` key is the exact path string `showFile` receives, so a wrong path misses the key — that is the assertion.

**Mutation-test it.** Revert your `phaseAtRef` change in place and confirm the new test fails; a test that passes on both sides proves nothing.

### Done when

The plan's slice line for this branch is the specification: canonical path for the ref read, the combined test, arrow helpers. Two more assertions exist because a naive fix would pass without them:

- A non-symlinked root still reads the ref (the three existing `read_ref` tests stay green unchanged). It catches a fix that hardcodes the symlinked case.
- The path handed to `showFile` is repo-relative with forward slashes and no `..` segment. It catches a fix that canonicalises `file` but not the root, or the reverse.

Also in this slice: convert `pulseNaming` (`deliver-route.test.ts:341`) and `planBody` (`:370`) from `function` declarations to arrows. The plan names exactly these two; leave `repo`, `mergedPlan`, `request`, `response`, `post` alone (CLAUDE.md: the unit is the function).

The plan's third item, unwrapping the changeset description, is moot: `.changeset/deliver-reads-the-plan-at-the-pulse-ref.md` no longer exists (released with #1350). Write your own changeset with the description first, one line, and the `bumps:` block last; package `@plot-pm/board`, patch.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. `scripts/check-shell-lines.sh` refuses shell growth under `skills/`; this slice touches no `.sh` file. A PR must carry no generated bundle (`scripts/check-no-bundle-diff.sh`); do not commit `board-server.mjs`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (never `gh pr create`). When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `packages/board/src/server/deliver.ts`, `packages/board/test/unit/deliver-route.test.ts`, one new `.changeset/*.md`. Do not touch `plot-reconcile-scan.sh` or `skills/plot-deliver/SKILL.md` (wave 2), nor `plot-push-main.sh` or the approve/release routes (wave 3).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
