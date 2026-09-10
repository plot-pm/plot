---
'@plot-pm/board': patch
---

The board names the CI system behind an absent check state, so an empty column on a Jenkins team reads as *Jenkins reported nothing* rather than as *no CI*. `ServerInfo` carries the declared `CI` key, read once per process, and `checksUnaskableNote` turns it into the sentence — falling back to the unnamed one where no key was read.

<!--
plan: docs/sprints/2026-W39-the-jenkins-team-sees-its-builds.md
-->
