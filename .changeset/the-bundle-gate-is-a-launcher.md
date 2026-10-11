---
'plot': minor
'@plot-pm/board': patch
---

`plot-bundle-commit-gate.sh` is now a launcher: it resolves `board/plot-gate.mjs` and execs it with the gate name `bundle-commit`, and `hooks/hooks.json` registers `plot-gates.sh` in its place. The refusal — a commit staging a generated board bundle — now lives in `bundleCommitRefusal` (`packages/domain/src/rules/bundle-commit.ts`), the first row in `plot-gate.mjs`'s `GATES` table.

A branch that adds a brand-new generated bundle is beyond this gate's reach: it reads the generated-path set from `BOARD_ARTIFACT_PATHS`, compiled into the installed bundle rather than grepped live from the repository being gated. `scripts/check-no-bundle-diff.sh` remains the CI-time backstop for that case, 16-18 minutes later.

<!--
plan: docs/plans/2026-10-10-the-gates-are-launchers.md
bumps:
  skills:
    plot: minor
-->
