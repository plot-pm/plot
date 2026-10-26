---
"plot": patch
---

`jenkins_resolve_host` refuses when an `Instance:` line names no host instead of silently exiting 0 with empty output, and `jenkins_sha_runs` refuses by name when Jenkins answers a job with no such branch indexed, distinguishing that from a host that never answered at all. The `.env` credential loader (`plot_env_file`, shared by the Jenkins and Jira fallbacks) now tries each candidate in order and takes the first holding a complete pair, falling through a readable-but-partial `.env` instead of stopping there, and resolves the main checkout's path with `--path-format=absolute`.

<!--
plan: docs/plans/2026-10-24-jenkins-sha-lookups-in-plot-host.md
bumps:
  skills:
    plot: patch
-->
