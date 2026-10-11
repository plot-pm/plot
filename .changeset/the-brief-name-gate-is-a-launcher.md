---
'plot': minor
'@plot-pm/board': patch
---

`plot-brief-name-gate.sh` is now a launcher: it resolves `board/plot-gate.mjs` and execs it with the gate name `brief-name`, and `hooks/hooks.json` drops its own entry, since `plot-gates.sh` answers it. The refusal — a commit that adds or renames a hand-off brief to `.plot/briefs/<prefix>-<slug>.md` — now lives in `briefNameRefusal` (`packages/domain/src/rules/brief-name.ts`), the second row in `plot-gate.mjs`'s `GATES` table. `Refs` gains `untrackedPaths` and `showPrefix` for the chained `git add` and `git mv` case, and the chained command now splits on newlines too. The rule agrees with `briefPath`, which moves into the domain (`packages/domain/src/rules/brief-path.ts`) with the fleet's copy re-exporting it: a name such as `.plot/briefs/feature-y.md` passes when a known branch or the brief's own text names a branch, such as `idea/feature-y`, whose `briefPath` it is.

<!--
plan: docs/plans/2026-10-10-the-gates-are-launchers.md
bumps:
  skills:
    plot: minor
-->
