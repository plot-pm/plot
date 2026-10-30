---
'plot': patch
---

The corpus tier runs with no host token, locally and in CI: a setup file removes the `gh` token variables and the handed-in host answers and points `GH_CONFIG_DIR` at an empty directory before each corpus file, so a local corpus run reads the host as `unasked`, as CI's job does. `host-environment.corpus.test.ts` fails when the setup does not reach a spawned `plot-host.sh`.

<!--
plan: docs/plans/2026-10-30-ci-runs-what-the-change-touches.md
-->
