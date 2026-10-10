---
'@plot-pm/board': minor
---

A failing or pending PR's checks badge now names the short commit SHA its checks ran against, or says checks are not bound to a commit where none is known. The Agents tab also shows a status-panel entry naming the default branch when its settled CI reading is red, reusing the same panel green PRs and green branches stay silent in. The entry names the failing workflows and the reading's age in minutes, hours or days, and says the age is unknown where the reading's timestamp does not parse. A new `## Plot Config` key, `Default branch checks`, names the workflows whose runs decide whether the default branch is red; absent, every workflow counts.

<!--
plan: docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md
bumps:
  skills:
    plot: patch
-->
