---
'plot': patch
---

A declared role run has a command builder (`--agent`, `--agents`, `--settings`, `--max-turns`), a translation of its `.claude/agents/<role>.md` into the `--agents` JSON, and a liveness reading that treats an unanswerable pid as alive for the fixer and main-repair and as not alive for the reviewer and unblocker. `agentRunSdk` runs a role request from its definition files and refuses one it cannot load.

<!--
plan: docs/plans/2026-10-29-fleet-roles-are-declared-agents.md
bumps:
  skills:
    plot: patch
-->
