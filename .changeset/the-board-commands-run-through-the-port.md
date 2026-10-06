---
'plot': patch
---

The board's ten agent-starting routes — idea, commission, reslice, deliver, story, brief, implement, interrogate, approve and auto-deliver — start their agent through the `agentRun` port instead of a raw `spawn`. A role on `Agent runner: sdk` runs on its `Agent models` entry or its fragment's `--model`, starts with the `Agent settings` file, and hands back a written path or a done/refused outcome; a missing or outside path and a `refused` outcome record a failed run. The agent now runs in the board's process group, so a board stop or restart ends a running board role: the board writes its exit code into the run's state file, and a `running <pid>` marker whose board is gone reads as failed instead of locking the slug. `board-server.mjs` carries the SDK; `plot-ask.mjs` waits for the agents its scan started before it exits. The CI spawn ratchet moves from `allowed=28` to `allowed=11`.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: patch
-->
