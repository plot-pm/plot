# check-helper-table.sh misses a new bundle on its PR and turns main red after the merge

> The helper-table gate counts tracked bundle files, which a PR never commits, so a bundle without a README row passes on the PR and fails on main.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:**
- **Issue:** #2260
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `check-helper-table.sh` counts the bundles that `packages/board/build.mjs` declares, so a PR that adds a bundle without a row in `skills/plot/scripts/README.md` fails on the PR.

Board impact: none. The change touches a CI gate script and its contract test, not the plan format, the template, or the board.

## Motivation

`scripts/check-helper-table.sh` counts shipped scripts with no row in `skills/plot/scripts/README.md`. It reads the population from `git ls-files 'skills/plot/scripts/board/*.mjs'`. A PR that adds a bundle cannot commit the built file, because `check-no-bundle-diff.sh` refuses it. The gate does not see the new bundle on the PR and passes. Main builds the bundle after the merge, the tracked count rises, and `validate` fails on main and on every open PR.

Measured twice on 2026-10-21:

- #2235 added `board/plot-release-chain.mjs`. Main was red from 02a40bad2 until 01d7ac54d added the row.
- #2243 added `board/plot-sprint-release-gate.mjs`. Main was red from 0e973879b until the row was added.

Each time every open PR failed with "19 shipped scripts have no row … baseline of 18".

## Design

### Approach

The gate reads the bundle population from the declarations in `packages/board/build.mjs`, not from tracked files. `scripts/check-decision-count.sh` already parses those declarations in `read_declared` for its evidence rule. The new population is the union of the tracked `*.sh` helpers and the declared `board/<name>.mjs` names. The row-matching rule and the baseline stay as they are.

The parser must exist once. Options: move `read_declared` into a sourced helper that both gates use, or have the helper-table gate call a shared function. A second awk parser would be free to drift from the first when `build.mjs` changes shape.

Edge cases the slice settles:

- A `build.mjs` that is absent or declares no parseable bundle fails the gate, as `check-decision-count.sh` does. A gate that cannot read its input does not pass.
- A declared bundle that is also tracked counts once.
- A tracked bundle that `build.mjs` no longer declares still counts until it is removed from git.

The contract test adds a fixture repo whose `build.mjs` declares a bundle with no row and no tracked file, and asserts the gate fails and names the bundle.

### Open Questions

- [ ] Does the shared parser live in a new sourced file under `scripts/`, or does `check-helper-table.sh` source `check-decision-count.sh`? The README helper-table gate and `check-shell-lines.sh` both count the result.
- [ ] Should the baseline of 18 stay, or drop once the declared population is counted and the existing rows are re-measured?

## Slices

### Declared bundles

- `infra/check-helper-table-declared-bundles` — count `build.mjs`-declared bundles in `check-helper-table.sh` and share the parser with `check-decision-count.sh` <!-- builds: a shared declared-bundle reader used by check-helper-table.sh and check-decision-count.sh -->

## Notes

- Source: tracker issue #2260.
