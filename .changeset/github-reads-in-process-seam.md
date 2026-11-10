---
'@plot-pm/board': patch
---

fleetd reads its pull request listings through a typed `Host.prListing` answer: the rows, one completeness word per asked state, and the refusal with its kind. A credential the host refuses with a `401` is now the refusal kind `auth`: the backoff does not retry it, and the board's PR footer says "sign in" with the connector's fix instead of "host unreachable".

<!--
plan: docs/plans/2026-11-09-github-reads-in-process.md
-->
