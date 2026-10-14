---
'plot': patch
---

`plot-host.sh commit-status <sha> <state> <context> <description> <url>` writes a GitHub commit status, authenticated as a dedicated GitHub App installation (`## Plot Config`'s `Review app: <app id> <key path>`) rather than the signed-in `gh` user. It mints its own JWT and exchanges it for an installation token locally, since the repo's only prior App-token precedent runs inside a GitHub Actions workflow. GitHub only; a repository with no `Review app` configured, or a key file that cannot be read, is refused (exit 4) before any token is minted.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
