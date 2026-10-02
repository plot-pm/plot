---
'@plot-pm/board': patch
---

`plot-issue-source.mjs` ships the `issueSource` rule to shell callers: it takes the git host as an argument and the `Tracker` value on stdin, and answers `tracker <scheme>`, `git-host` or `nobody <reason>` on one line. `TRACKER_LISTERS` moves to `adapters/tracker/tracker-listers.ts`, which imports one type, so the new bundle is 1.2 KB rather than the 330 KB the adapters barrel costs; `tracker-resolve.ts` re-exports it and every existing importer is unchanged.

<!--
plan: docs/plans/2026-10-01-the-issue-ops-ask-who-answers.md
-->
