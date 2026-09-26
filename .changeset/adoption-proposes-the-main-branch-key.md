---
'plot': patch
'@plot-pm/board': patch
---

Adoption proposes `Main branch` where the git host and this clone disagree about the default branch. `proposeDefaultBranch` compares the two readings wave 1 added to the probe and answers one of three states: they agree, which is every healthy repository and proposes nothing; they differ, which proposes the host's answer and names both values plus `git remote set-head origin -a` as the clone's repair; or the host was not asked, which proposes nothing and says the reading went unverified rather than passing silence off as confirmation. The status word decides and never the emptiness of the value beside it, so an unasked host cannot propose a key with no value, and a probe report predating the field reads as unverified rather than as a match. The key is written only from a confirmed answer — `AdoptionAnswers.mainBranch`, where empty is a decline — because adoption is the one command that writes into a repository Plot does not own. Reported 2026-09-24: a clone whose GitHub default had moved to `develop` kept `origin/HEAD → main`, no key was written, and the board read plans from `origin/main` and showed one untitled group with two of three plans missing.

<!--
plan: docs/plans/2026-09-24-adoption-notices-a-stale-default-branch.md
bumps:
  skills:
    plot-init: minor
    plot-board-setup: minor
-->
