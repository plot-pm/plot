---
'plot': patch
---

The Playwright apt cache key in CI now hashes the output of `install-deps --dry-run`, so a changed package set misses and saves anew instead of staying frozen under the Playwright version. The stage step empties the staging directory before copying, a restored cache is copied into apt's archive on an exact hit only, and the Playwright version step fails the job when the version resolves empty.

<!--
plan: docs/plans/2026-10-24-ci-job-caps-and-the-apt.md
bumps:
  skills: {}
-->
