---
'plot': patch
---

The domain gains an `agentRun` port and the pure rules a fleet agent's turn protocol needs — `pollRefusal`, `agentRunEnv`, `backgroundSwitchRefusal`, `sdkRunExit`, `runLimitRefusal`, `runnerChoice` and `fragmentModel` — plus three new worker endings, `turn-limit`, `run-limit` and `spend-limit`, and the hand-back rows in `agentLoop` that let a worker end its turn with `next: checks` or `next: pushed` instead of polling. No SDK dependency lands yet; a fixture adapter stands in for the connector wave 2 builds.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: patch
-->
