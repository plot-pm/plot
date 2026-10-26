---
"@plot-pm/domain": patch
"@plot-pm/fleet": patch
---

A slice's draft PR now leaves draft on its own once the agent finishes and checks pass, instead of staying draft forever once CI goes green with no agent left to flip it. `markReadyDecision` (`@plot-pm/domain`'s `rules/mark-ready.ts`) answers `true` only for a `finished` worker on an open, draft PR whose head still matches the agent's last push; every other worker state, a closed or already-ready PR, a moved head, or an unreadable draft flag answers `false`. `agentLoop`'s row 13 reads the PR's draft flag and head sha from the same `WaitClock` reading already taken on entry to the checks wait — never a fresh host call for the decision — and emits the existing `pr-ready` write, which `performLoopWrites` applies through a new `Host.prReady` port method (`host-shell.ts` calling `plot-host.sh pr-ready`, never `gh` directly). A refused `pr-ready` call is recorded and logged; it does not join the take-up sequence, so it cannot stop a later write or change the pass's exit code.

<!--
plan: docs/plans/2026-10-24-a-slice-pr-left-as-a.md
bumps:
  skills:
    plot: patch
-->
