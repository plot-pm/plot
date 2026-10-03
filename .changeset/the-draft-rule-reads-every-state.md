---
'@plot-pm/board': patch
---

A slice of a Draft plan now renders in WAITING ON YOU with the note `plan not approved yet — still in review` for every branch state, instead of only `open` and `deferred`. Previously a `blocked`, `waiting`, `unknown` or unrecognised state, a fresh `claimed` or `wip` branch, and a branch held, dirty or locked in a local worktree all placed a Draft plan's branch in NOT STARTED under *approved — nobody has taken it* — pairing `verdict: unapproved` with `group: not-started` in the same payload. A new domain rule, `draftPlacement`, answers the placement once for every state that reaches `classifyGroup`'s no-work arms, so a later arm cannot forget the plan's phase again. A stale `claimed` or `wip` branch keeps its existing abandonment note, a deferred branch with a written reason keeps its QUIET placement, and a live worker still puts the row in WORKING.

<!--
plan: docs/plans/2026-10-02-a-draft-slice-waits-on-its-approval.md
-->
