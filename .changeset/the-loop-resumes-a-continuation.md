---
'@plot-pm/board': minor
---

The worker loop now reads `.plot-worker.continue.md` itself: a desk carrying an answer resumes its blocked session with the file's text as the prompt and the manifest's `resumeId`, ahead of any other take-up reading for that pass. The file is removed only once the resumed turn is dispatched, so a crash between reading it and running leaves it for the next pass to retry. Separately, take-up no longer reads a desk's own uncommitted or unpushed work as foreign: `agentLoop` now compares the desk's actual checked-out branch against its assigned one, and only a genuinely different (or unreadable/detached) branch ends the slice `holding-work`. `continueTarget` also routes an answer to a desk whose ending already reads `holding-work` with an unanswered marker, not only `blocked`.

<!--
plan: docs/plans/2026-10-08-a-blocked-agent-s-question-has.md
bumps:
  skills:
    plot: patch
-->
