---
"@plot-pm/board": patch
---

Opening a Discovery plan no longer answers `Failed to load plan: HTTP 404`.

Cards gained a second source when the board learned to read plans from prefixed branches, so a plan under PR review renders in the Discovery column. `/plan/<file>` kept resolving against the working tree alone — one consumer, two sources, and it saw half of them. The card sat on screen while clicking it failed.

The plan viewer now reads either source. Branch plans come from git rather than a staged copy, since `collectBranchPlans` already carries the content and a request path has no business creating temp files. Traversal and unknown names stay 404, which the widened lookup makes worth re-asserting.

<!--
bumps:
  skills: {}
-->
