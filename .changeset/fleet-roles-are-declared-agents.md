---
'plot': patch
---

Adds the four fleet role definitions under `.claude/agents/` — `reviewer`, `fixer`, `unblocker`, `main-repair` — each with a matching `.claude/settings/<role>.json` registering a `PreToolUse` hook that denies writing a PR's commit status, running the reviewer, merging a PR, pushing to the default branch, editing a protected path, or closing an issue by commit message. The reviewer denies every write-capable tool through its own `tools` list instead. A new `role-deny` gate in `board/plot-gate.mjs` answers these hooks; it is reachable only by explicit name, never through `--all`, so it cannot reach the master agent's or a desk worker's own project-wide hooks.

<!--
plan: docs/plans/2026-10-29-fleet-roles-are-declared-agents.md
bumps:
  skills:
    plot: patch
-->
