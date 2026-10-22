---
'plot': patch
---

`plot reconcile`'s changeset-reconciliation section (§22) no longer reports "(none — every merge … carried a changeset)" on a repository that keeps no `.changeset/` directory at all — it now prints "(not evaluated — this repository keeps no changesets)" and skips the per-merge walk entirely. The shipped-code path pattern that section uses to decide which merges count is now a `Shipped code paths:` `## Plot Config` key, defaulting to Plot's own layout so this repository's output is unchanged; it holds an extended regex, read whole through the new `plot-config.sh get-raw`, and an invalid pattern reports "(not evaluated — the 'Shipped code paths' pattern is invalid: …)". The merge-subject parser also recognizes Bitbucket's `Merged in <branch> (pull request #N)` form, so the `idea/*`/`changeset-release/*` exclusions and the PR number now resolve correctly on Bitbucket merges too.

<!--
plan: docs/plans/2026-10-22-reconcile-22-reports-every-merge-carried.md
bumps:
  skills:
    plot: patch
-->
