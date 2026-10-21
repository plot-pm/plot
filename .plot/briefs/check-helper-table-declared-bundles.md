## Implementation brief — check-helper-table-sh-misses-a (wave 1: Declared bundles)

- **Plan (canonical):** docs/plans/2026-10-21-check-helper-table-sh-misses-a.md on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2261 merged
- **Branch:** `infra/check-helper-table-declared-bundles` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review through the `plot-review` app

The plan has one wave and one branch. Nothing waits on it.

### What to build

`scripts/check-helper-table.sh` reads its bundle population from `git ls-files 'skills/plot/scripts/board/*.mjs'`. A PR cannot commit a built bundle (`check-no-bundle-diff.sh`), so a PR that adds a bundle without a README row passes. Main builds the bundle after the merge, the count rises from 18 to 19, and `validate` fails on main. Measured 2026-10-21 twice: #2235 (`board/plot-release-chain.mjs`) and #2243 (`board/plot-sprint-release-gate.mjs`).

Change the gate so its population is the tracked `*.sh` helpers plus the `board/<name>.mjs` names that `packages/board/build.mjs` declares. The row-matching rule and the baseline stay as they are. The plan is canonical; this brief orients.

### Settled decisions — do not re-derive them

- **One parser.** `read_declared` in `scripts/check-decision-count.sh:122` already parses `build.mjs`. A second awk parser drifts when `build.mjs` changes shape. Move it into a sourced file under `scripts/` that both gates use. The plan's open question (new sourced file or sourcing `check-decision-count.sh`) resolves to the new file: sourcing `check-decision-count.sh` would run its main body, which is a gate.
- **`read_declared` reads `HEAD:` through `git show`, and `fail` is that script's function.** The shared file must take the root and the failure callback as inputs, or define its own failure. Check how `check-helper-table.sh [repo-root]` passes its root before copying the call — the helper-table gate runs against a fixture root in tests, and `git show HEAD:` runs in the current directory.
- **Union, counted once.** A bundle both declared and tracked counts once (`sort -u` on the existing `files_tmp`). A tracked bundle that `build.mjs` no longer declares still counts.
- **An unreadable `build.mjs` fails.** Absent file or zero parseable bundles exits 1 with an `::error::` line. A gate that cannot read its input does not pass; the existing "no tracked scripts" check shows the style.
- **Baseline.** Leave 18 unless re-measuring with the declared population gives a lower number. Never raise it. Report the measured count in the PR.

### Done when

The plan has no `## Done when` list; the Changelog line is the specification: a PR that adds a bundle without a README row fails on the PR. Assertions a naive implementation passes without:

- A fixture repo whose `build.mjs` declares a bundle with no README row and **no tracked file** fails the gate and names `board/<name>.mjs`. This catches an implementation that still reads only `git ls-files`.
- The same fixture with the row added passes. This catches a gate that fails on every declared bundle.
- A fixture with an absent `build.mjs` fails. This catches a silent pass on unreadable input.
- `test/reconcile/decision-count.test.mjs` still passes unchanged. This catches a regression in the extracted parser.

There is no contract test for `check-helper-table.sh` today (`grep` over `test/` finds none). Add `test/reconcile/helper-table.test.mjs`, modelled on `decision-count.test.mjs` (throwaway git repo, `spawnSync`). Write helpers as arrow functions.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI. Add a changeset (description first, `bumps:` block last, package `plot`). Do not commit `board-server.mjs` or any built bundle.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. Both scripts here live under `scripts/`, not `skills/`, so the gate should not count them — confirm with `scripts/check-shell-lines.sh` rather than assuming. Add a README row if the new sourced file lands under `skills/plot/scripts/` (`scripts/check-helper-table.sh` is the gate).

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

Owns: `scripts/check-helper-table.sh`, `scripts/check-decision-count.sh`, the new sourced file under `scripts/`, `test/reconcile/helper-table.test.mjs`, one changeset. Nothing else in flight touches these files as of 2026-10-21. If you find something the plan did not anticipate, report it rather than improvising outside scope.
