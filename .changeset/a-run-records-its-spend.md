---
'plot': patch
'@plot-pm/board': patch
---

An SDK run appends its own cost line instead of relying on the seal taken at `seal_declaration`. `SliceSpendSchema` is now a union of the seal line and a per-run line carrying the session's cumulative token, cost and turn figures; `readSpend`/`planSpend` group a record's lines by session and sum each session's increase, so a resumed session's rising cumulative figure is read once rather than re-summed. The seal skips any session that already has a run line, so an SDK-only slice gets no seal line and a slice that changed runner seals only its remaining `command` sessions. Each `rate_limit_event` a run observes appends a `BudgetEntry` through a new `rateLimitEntry` rule. Two config keys gain no default — `Agent max spend` and `Slice max spend` — read through a `dollarsOrUnset` helper that reports `null` rather than `0` where the key is absent; a slice whose recorded cost reaches `Slice max spend` starts no next run and ends `spend-limit` with no fresh session (`sliceSpendRefusal`). A run ending `turn-limit` gets one fresh session from the registry tick if the slice has had none yet (`freshAgentAfterTurnLimit`, reading the same `.plot/state/fresh-agents.tsv` count `freshAgentAfterCorrections` does); `spend-limit` and `run-limit` still go to a person.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
-->
