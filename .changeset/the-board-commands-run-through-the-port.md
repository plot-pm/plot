---
'plot': patch
---

Seven of the board's agent-starting routes — idea, commission, reslice, deliver, story, interrogate, and approve — now start their agent through the `agentRun` port instead of a raw `spawn`, so a role configured `Agent runner: sdk` hands back structured output (a written-file path, or a done/refused outcome) instead of a bare exit code. `brief-ask.ts`, `implement.ts` and `auto-deliver.ts` stay on raw `spawn`: each starts its agent `detached`, which the port's contract refuses, and `implement.ts`'s spawn is shared with `dispatch.ts`, outside this slice. The CI spawn ratchet moves from `allowed=28` to `allowed=14`, and `board-server.mjs` joins `plot-worker-loop.mjs` as a bundle carrying the SDK.

<!--
plan: docs/plans/2026-10-05-fleet-agents-run-through-the-agent-sdk.md
bumps:
  skills:
    plot: patch
-->
