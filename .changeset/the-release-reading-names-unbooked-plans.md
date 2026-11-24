---
'@plot-pm/board': patch
---

The release finish now reads every sprint file, active or closed, and books the plans of a sprint closed before it ran. `release-scope-mismatch` refuses only where no sprint names the version and an active sprint names another one, and `sprint-ambiguous` only where two active sprints name the version. fleetd's release tick asks the new `releaseUnbooked` rule each pass, from the newest release tag and the changesets its merge removed, and publishes `release unbooked` on the channel while a Delivered plan of that release has no `Released:` record or a sprint of it is still open. It books nothing.

<!--
plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md
-->
