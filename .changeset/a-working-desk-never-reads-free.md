---
'plot': patch
---

The worker loop's idle watch counts a session's subagent transcripts under `<session>/subagents/` as well as the session's own transcript. An agent that delegated its slice to a subagent left its own transcript silent, so the watch read the desk as idle, ended the working agent with exit 124 and left its tree uncommitted.

<!--
plan: docs/plans/2026-10-09-no-controller-resumes-a-claimed-slice.md
bumps:
  skills:
    plot: patch
-->
