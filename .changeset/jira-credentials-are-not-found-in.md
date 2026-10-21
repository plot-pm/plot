---
'plot': patch
---

jira_load_env_file, jenkins_rest_credential and the Bitbucket review commit-status script now read the main checkout's `.env` when a worktree holds none of its own, through one shared resolver per language. The worktree's own `.env` still wins when present, and the refusal where neither file has both variables is unchanged.

<!--
plan: docs/plans/2026-10-21-jira-credentials-are-not-found-in.md
-->
