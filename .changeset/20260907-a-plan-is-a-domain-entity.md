---
'@plot-pm/board': patch
---

A plan and a slice are domain entities. `entities/plan.ts` names both and states the argument that keeps them apart: a plan writes the Slice, git writes the Branch. They are 1:1, so the distinction needed an argument rather than an assertion — and the estate supplies one. Measured 2026-09-07 through `plot-plan-meta.sh` over 225 plan files, 21 branch lines carry a `deferred:` or `moved:` annotation, each stating something about a branch that no ref can tell you.

The entity is a home for judging that was scattered, not a wrapper. `planIdOf` replaces FOUR derivations of one plan identity, and they disagreed: `rules/pulse.ts` stripped only a leading date while the board's three copies take a basename first, so `docs/plans/2026-09-04-x.md` answered `docs/plans/2026-09-04-x` in the domain and `x` in the board. The parser reports `file` as a repository-relative path, so the domain read the wrong one in production — and every test of it passed a bare filename, which is why nothing caught it. Both spellings were user-visible: the slug reaches a rendered row through `deriveSlices` and a collision report that names plans through `doubleClaimedBranches`.

`planStateOf` replaces a cast in `server/entry/transition.ts` that let `UNKNOWN` become the string `'unknown'` — a value `PlanState` does not admit, typechecking only because the cast silenced it. Measured over every phase word the parser emits: one input changes and it is that one. `UNKNOWN` refused before and refuses now, so no plan moves that did not move before; only the reason sharpens from `state-wrong` to `state-unreadable`, and no shell branches on a reason.

`SliceIntent` models what a plan states about a branch as against what git measures, with `moved:` reading as `deferred` — the answer `plot-plan-meta.sh` already gives for either annotation. Nothing new spells `Wave` where it means `Slice`.

Measured: 225 plan files parse byte-identically before and after, 2001 domain tests and 1372 reconcile tests pass, the domain holds its 100% floor for the pure side, and `plot-transition.mjs` stays 4.9 KB — the entity's imports are type-only, so no bundle gains `zod`.

<!--
plan: docs/plans/2026-09-04-every-element-is-a-domain-concept.md
-->
