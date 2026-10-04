---
'plot': patch
'@plot-pm/board': patch
---

`plot-dispatch.sh --release` refuses a branch a live agent holds even when that agent's own desk sits on another branch, and a rejected claim push now names what origin holds — another live agent, a stale empty claim with its release command, or real work no live agent holds — through a new domain rule `claimAnswer`, reached without HTTP via `plot-claim-answer.mjs`. Before this, an agent just handed a branch had not checked it out, so the release refusal that reads the branch's own worktree never ran, and a rejected push's `REGISTRY LOCK VIOLATION` fired on a stale empty claim with nobody behind it. After a rejected push the loop now also clears its own manifest's assignment and empties `PLOT_BRANCH` before asking for another branch, so it does not run the previous slice's prompt again in a desk just reset onto the rejected branch — the path that let one agent be handed a second slice while its desk still held the first.

<!--
plan: docs/plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
