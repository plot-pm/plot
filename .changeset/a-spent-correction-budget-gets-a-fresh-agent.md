---
'plot': patch
'@plot-pm/board': patch
---

A slice that spends its correction budget gets one fresh agent session before a person is asked. The worker loop ends the spent-budget desk with the reason `corrections-spent` (it was `unstarted`), and `agentLoop` row 15 emits the same reason. With `--start-agents`, the registry tick reads each plan-named desk that has no manifest and ended `corrections-spent`. The first time for a slice, it registers a new agent for the desk (`Agents.register`, a manifest in the shape the dispatcher writes, with a new session id), then starts a fresh session through the continue workflow, with every correction from `PLOT-CORRECTION.md` and the failing run in the answer. The session gets a new resume id, so it does not resume the spent conversation. The tick appends a row to `.plot/state/fresh-agents.tsv`, keyed on plan and branch, after continue accepts the desk and before the session starts. A manifest whose start did not happen is removed. A second spent budget for the same slice writes a `blocked` declaration once. If the registration fails or continue refuses the desk, the tick records nothing and logs the reason. `/api/continue` still refuses a desk no manifest names.

<!--
plan: docs/plans/2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md
-->
