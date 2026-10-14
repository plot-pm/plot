---
'plot': patch
---

`plot-host.sh commit-status` writes a Bitbucket build status on a Bitbucket repository, through `POST /2.0/repositories/{workspace}/{repo_slug}/commit/{revision}/statuses/build` under a dedicated account's App password (`BITBUCKET_REVIEW_USER` / `BITBUCKET_REVIEW_APP_PASSWORD`), never through the operator's signed-in `bb` identity. A missing credential exits 4 naming both variables and where to create one; an unresolvable workspace/repo or a `state` outside success/failure exits 4 naming `unsupported` rather than guessing a mapping.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
