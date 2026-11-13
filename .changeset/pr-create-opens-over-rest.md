---
'plot': patch
---

`plot-host.sh pr-create` opens a GitHub pull request over REST (`POST repos/<owner>/<repo>/pulls`) and prints its `html_url`, so opening a PR spends the REST budget and never GraphQL. On 2026-11-13 `gh pr create` failed three times with GraphQL at 0 of 5000 while REST held more than 4600 of 5000, and a fleet worker stopped on a `PLOT-BLOCKED` marker. The owner/repo is the origin remote's; a missing `--head` is the current branch and a missing `--base` is the default branch. Bitbucket is unchanged.

<!--
bumps:
  skills:
    plot: patch
-->
