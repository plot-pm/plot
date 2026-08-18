---
"@plot-pm/board": patch
---

plot-host: a running check reports pending, not green

WAITING ON A MACHINE was empty every time it was looked at, and the
reason was a mistranslation pointing the reassuring way.

GitHub sends `conclusion: ""` for a check still running — an EMPTY
STRING, not null — and the reader was `(.conclusion // .state)`. jq's
`//` substitutes only null and false, so `$c` stayed `""`, matched none
of the three tests, and fell through to `green`. **A running CI read as
a passed CI**, permanently rather than occasionally.

Measured on the release PR while its `validate` job was in progress: the
adapter said `green`, GitHub's own rollup said `IN_PROGRESS`.

The field is `status` besides; `state` never existed on a rollup entry,
so the fallback pointed nowhere even when it fired. Both are corrected at
all three sites that read the rollup, and the conclusion still wins
wherever it says anything — a fix that simply preferred `.status` would
report every finished check by its lifecycle word (`COMPLETED`) and turn
failures green.
