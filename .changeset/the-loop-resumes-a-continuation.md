---
'@plot-pm/board': minor
---

The worker loop reads `.plot-worker.continue.md` at take-up. On a desk checked out on its assigned branch, the loop resumes the blocked session with the file's text instead of taking the slice up again, and writes no ending before the resumed turn exits. The SDK runner sends the text as the prompt and resumes the manifest's `resumeId` only where a transcript exists for it; the `command` runner appends the text to `PLOT-CORRECTION.md`, which the worker prompt reads first. The loop removes the file once the run has started, so a run that never starts leaves it for the next loop. At take-up, uncommitted changes or unpushed commits on the assigned branch are the slice's own work: the loop runs the prompt without a desk reset or a claim commit. A detached, unreadable or different desk branch still ends `holding-work`. `continueTarget` routes an answer to a desk whose ending reads `holding-work` with an unanswered marker, and `continueOnDesk` writes the asked branch into a stopped free loop's manifest, which names no branch.

<!--
plan: docs/plans/2026-10-08-a-blocked-agent-s-question-has.md
-->
