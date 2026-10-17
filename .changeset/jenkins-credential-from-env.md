---
'plot': patch
---

`jenkins_rest_credential` now reads `JENKINS_USER` and `JENKINS_API_TOKEN` from the environment, then the repository's `.env`, before falling back to the macOS keychain — so a Linux agent or CI machine with neither `security` nor a keychain entry can still authenticate against Jenkins' REST API instead of `jenkins_sha_runs` exiting 4 (*cannot be asked*) on every such machine.

<!--
plan: docs/plans/2026-10-16-the-agent-s-ci-wait-never.md
bumps:
  skills:
    plot: patch
-->
