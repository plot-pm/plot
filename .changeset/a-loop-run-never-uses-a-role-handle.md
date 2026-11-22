---
'plot': patch
---

The worker loop no longer resumes a role session's handle. Where the manifest's `resumeId` names a role run's session or another branch's session, the loop mints a new handle, writes it to the manifest and runs `--session-id`; a failed write ends the run unstarted. A pass that ends before any run records no such handle, and an ending carries no empty `resumeId` key.

<!--
plan: docs/plans/2026-11-21-a-continuation-never-resumes-a-role-session.md
bumps:
  skills:
    plot: patch
-->
