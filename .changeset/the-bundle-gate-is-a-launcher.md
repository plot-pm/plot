---
'plot': minor
'@plot-pm/board': patch
---

`plot-bundle-commit-gate.sh` is now a launcher: it resolves `board/plot-gate.mjs` and execs it with the gate name `bundle-commit`, and `hooks/hooks.json` registers `plot-gates.sh` in its place. The refusal — a commit staging a generated board bundle — now lives in `bundleCommitRefusal` (`packages/domain/src/rules/bundle-commit.ts`), the first row in `plot-gate.mjs`'s `GATES` table.

The gate reads the generated set from the gated repository's own `packages/board/build.mjs` through `shippedPathsOf`, as the shell gate did, so a branch that declares a new bundle is refused with `git rm --cached`. A repository with no `build.mjs` builds no bundle, and the gate allows its commits.

<!--
plan: docs/plans/2026-10-10-the-gates-are-launchers.md
bumps:
  skills:
    plot: minor
-->
