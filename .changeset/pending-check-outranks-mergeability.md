---
'@plot-pm/board': patch
---

fix(@plot-pm/board): a pending check outranks an unreadable mergeable

A PR whose CI is running now lands in WAITING ON A MACHINE even while GitHub
answers `mergeable: unknown` — the state GitHub reports while it recomputes
mergeability, which is exactly when CI starts (#1164). Previously such a row
read "cannot say whether it merges" in WAITING ON YOU, hiding a check that was
already in flight.

`packages/domain/src/rules/pr-row.ts` adds `prRowPlacement`, a pure rule
answering an open PR's group and clause from its `mergeable` and `checks`
fields. `classifyGroup`, `prEvidence`, `draftNote` and `prStates` in
`packages/board/src/server/fleet.ts` now all read this one rule, so a row's
group and its sentence cannot disagree. Every other precedence — conflicting
mergeability, every other checks value behind unreadable mergeability — is
unchanged.

<!--
plan: docs/plans/2026-10-07-the-board-reads-a-pr-while-its-ci-runs.md
-->
