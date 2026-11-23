---
'@plot-pm/board': patch
---

The open Fleet section starts with a switch row that holds auto-dispatch, auto-review, auto-verify, auto-design and the parallel-agents stepper, above the empty frame of a stopped fleet; the heading holds no switch, and a folded Fleet section shows none. Each Fleet agent row shows one state pill (`agentPills`) after its spinner slot in Doing now, and its ⋯ lists a fixed item set from `rowMenuOf`'s `fleet-agent` kind: Restart and Drop agent on a broken agent, and Show the agent, Open, Continue, Restart, Open plan and Reveal branch on any other agent with a branch, each disabled item with its reason.

<!--
plan: docs/plans/2026-11-20-delivery-rows-act-from-one-place.md
-->
