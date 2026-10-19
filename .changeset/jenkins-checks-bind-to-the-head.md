---
'plot': patch
---

Jenkins checks on a Bitbucket repository now bind to the PR's head commit: a bare Jenkins instance slug resolves to `jen`'s own host before the credential lookup and REST call, a build's sha match checks every `lastBuiltRevision` action rather than only the first, and a failed sha lookup reaches stderr instead of being silently discarded.

<!--
plan: docs/plans/2026-10-19-jenkins-checks-never-bind-to-the.md
bumps:
  skills:
    plot: patch
-->
