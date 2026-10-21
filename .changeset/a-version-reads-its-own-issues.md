---
'plot': minor
---

The `Tracker` port gains `versionRead`, a read of one Jira version and the issues whose `fixVersion` names it. `tracker-jira.ts` implements it over Jira's project-versions list and a `fixVersion` JQL search, through a new `plot-host.sh version-read` op; `trackerNone`, `trackerGithub` and `trackerGitHost` answer `unaskable`, since none of those three names a version or a `fixVersion`.

<!--
plan: docs/plans/2026-10-21-a-sprint-cannot-be-read-as.md
-->
