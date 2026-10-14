---
'plot': patch
---

`plot-host.sh commit-status <sha> <state> <context> <description> <url>` writes a GitHub commit status, authenticated as a dedicated GitHub App installation (`## Plot Config`'s `Review app: <app id> <key path>`) rather than the signed-in `gh` user. `skills/plot/scripts/plot-commit-status.mjs` signs the App JWT, exchanges it for an installation token and writes the status through `fetch`, so neither credential appears in a child process's argv. `GITHUB_API_URL` sets the API base. GitHub only; a repository with no `Review app` configured, or a key file that cannot be read, is refused (exit 4) before any token is minted.

<!--
plan: docs/plans/2026-10-14-a-pr-cannot-merge-until-its.md
bumps:
  skills:
    plot: patch
-->
