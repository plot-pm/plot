---
'plot': patch
---

A continuation on a blocked desk resumes the agent that asked, never the unblocker. A blocked ending (a `PLOT-BLOCKED` marker, a `blocked` hand-back, `turn-limit` and `spend-limit`) now records the asking session's `resumeId`. The unblocker records the transcripts it starts in the desk's own gitdir (`plot-role-sessions`), and the transcript fallback skips them; where no other transcript remains, the continuation starts a new conversation.

<!--
plan: docs/plans/2026-11-21-a-continuation-resumes-the-asking-agent.md
bumps:
  skills:
    plot: patch
-->
