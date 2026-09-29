---
'plot': patch
'@plot-pm/board': patch
---

An agent handed a slice on a different branch starts a new conversation: the worker loop mints a fresh `resumeId` on the hop, so the first prompt carries `--session-id` instead of resuming the previous slice's transcript. A hop to the same branch keeps its conversation. The board reads an agent's model, context and last activity from the `resumeId` transcript, falling back to `session` where a manifest carries no handle.

<!--
plan: docs/plans/2026-09-29-a-slice-starts-its-own-conversation.md
bumps:
  skills:
    plot: patch
-->
