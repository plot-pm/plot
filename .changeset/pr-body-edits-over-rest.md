---
'plot': patch
---

`plot-host.sh pr-body` replaces a GitHub pull request's body over REST (`PATCH repos/<owner>/<repo>/pulls/<n>`) and prints its `html_url`, so editing a PR body spends the REST budget and never GraphQL. On 2026-11-14 `gh pr edit` failed twice with "GraphQL: API rate limit already exceeded" while REST held budget. `pr-create` and `pr-body` both take `--body-file <path>` in place of `--body`, so a caller passes a long body without a long command line. Bitbucket still runs `bb pr edit`.

<!--
bumps:
  skills:
    plot: patch
-->
