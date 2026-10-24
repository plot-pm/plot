---
"@plot-pm/board": patch
"plot": patch
---

A dispatched agent whose harness refused every Edit, Write and Bash call, and which committed nothing beyond its claim, now ends `permission-denied` rather than `nothing-done`, so `endingAction` sends it straight to a person instead of releasing the claim. The board names the cause — "agent was refused every write — check the worker command's permissions" — instead of the generic "worker finished — review it". The signal comes from the Claude Agent SDK's `result` message (`permission_denials`), a structured field on every run including bare `-p` invocations; the `command` adapter, which only sees free-text stdout, reads it as `unanswerable` and never guesses.

<!--
plan: docs/plans/2026-10-24-an-agent-refused-every-write-ends.md
bumps:
  skills:
    plot: patch
-->
