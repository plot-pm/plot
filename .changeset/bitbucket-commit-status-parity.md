---
'plot': patch
---

`plot-host.sh commit-status` on Bitbucket now maps `pending` to `INPROGRESS`, times out after 10s instead of hanging the caller, URL-encodes the workspace/repo/sha path segments, and tolerates a trailing slash on the `origin` remote when resolving the workspace/repo slug — fixing #1713. `error` has no Bitbucket state and stays refused by name rather than guessed, since Bitbucket's nearest words (`FAILED`, `STOPPED`) both mean something else and no caller here ever writes it. A corpus test holds the GitHub and Bitbucket arms to the same answer on GitHub's four native states, naming `error` as the one declared divergence.

<!--
plan: docs/plans/2026-10-16-bitbucket-parity-and-app-identities.md
bumps:
  skills:
    plot: patch
-->
