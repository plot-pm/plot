---
'plot': patch
---

`commit-status` on Bitbucket no longer exits 4 for an scp-style remote with a numeric workspace, such as `git@bitbucket.org:12345/repo.git` (#2055). `plot-host.sh` now reads the `<workspace>/<repo>` slug through the new `plot-bitbucket-slug.mjs` bundle, which separates a port in a scheme'd URL from the path colon of an scp-style remote.

<!--
plan: docs/plans/2026-10-18-an-scp-style-remote-with-a.md
bumps:
  skills:
    plot: patch
-->
