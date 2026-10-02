---
'plot': patch
---

A worker whose harness stops on the account's usage limit now waits for the limit to lift and resumes the same slice, instead of spending its retry budget in under a second and asking a person to fix a prompt file that worked. The loop captures the prompt's output, asks `plot-prompt-exit.mjs` what the exit was, and records the reset in `.plot-worker.limited`; the monitor measures silence from that reset rather than from the transcript, and `/plot-fleet --status` names a waiting agent as waiting. A limit naming no reset, one resetting past `Worker bound`, or one returning with no commit since the wait ends the worker with reason `limited` and a marker that asks for time rather than a repair. Every message on both paths now counts what the desk actually holds instead of calling it untouched.

<!--
plan: docs/plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md
bumps:
  skills:
    plot: patch
-->
