---
'plot': patch
---

Jenkins `run-for-sha` and `runs` now answer empty, not exit 4, for a branch the multibranch job does not hold — and a repository can name the job that builds its default branch.

On ewz-kus-portal (Bitbucket + Jenkins), `develop` builds in a separate job (`kus-portal/continuous-deploy`), not the multibranch job (`kus-portal/continuous-build-multi`). `jenkins_sha_runs` asked the branch path (404), then the multibranch root, which under the `tree=builds[…]` filter answers only `{"_class":"…WorkflowMultiBranchProject"}` with no `jobs` key — so neither `has("builds")` nor `has("jobs")` matched, and the function exited 4 even though Jenkins had answered. It now reads that `_class`-only root as "this branch is absent" and answers empty with exit 0; an HTML body or no answer at all on both URLs still exits 4, so an unreachable Jenkins stays distinguishable from a branch the job simply does not index. A new `Default branch job` config key names a job path that `jenkins_sha_runs` reads in place of the multibranch path, for the repository's own default branch only; `PLOT_JENKINS_JOB` still overrides it, same precedence it already had over `Jenkins instance`. `refreshDefaultBranch` now names the reason — no default branch, no remote tip, or CI did not answer — on every path that ends a refresh with `'unreadable'`, so a missing `default-branch.json` is no longer silent.

<!--
plan: docs/plans/2026-10-21-jenkins-run-for-sha-on-the.md
bumps:
  skills:
    plot: patch
-->
