---
'plot': patch
---

The Bitbucket test stub for `plot-pr-merged.sh` now emits valid bash when no merged branch is given and encodes branch names as `url_encode` does, and a test covers the Bitbucket open lookup returning `found`.

<!--
plan: docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md
bumps:
  skills: {}
-->
