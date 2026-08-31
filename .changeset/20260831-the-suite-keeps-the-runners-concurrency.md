---
'plot': patch
---

The reconcile suite lets the runner choose its own concurrency again.

`--test-concurrency=4` was added in #552 to bound a suite that had no bound at
all. It is withdrawn because **nothing measured ever supported it**, not because
it was shown to be harmful.

The bound was added on the strength of a sibling: `@plot-pm/board` carries
`--test-concurrency=4` after its own suite starved. That is a different suite
with a different workload, and this one had shown no such symptom — the number
was borrowed, never derived.

**What was measured, and what it does not say.** `validate` pass rates either
side of #552's merge at 22:33 UTC were 13/25 before and 3/13 after, which looks
like a regression. But the branch removing the flag then **hung on its first
solo run and passed on its second**, so the split is as consistent with an
unrelated intermittent failure as with the flag. Two samples of 25 and 13 across
a boundary nobody controlled is not a measurement.

A mechanism was proposed — that `node --test` defaults to `cpus - 1`, so a
2-core runner defaults to 1 and the flag quadruples it — and that is **also
unsupported**: the reconcile step takes **~2 minutes** on a healthy CI run,
against 12:56 locally at concurrency 1. The runners are not starved.

`--test-timeout=300000` **stays.** That half of #552 works and is what turns an
anonymous 25-minute cancellation into a named failing test — it reported
`a timed-out worker exits without hopping` at exactly `300002ms`.

The underlying intermittent hang in `test:reconcile` is **unexplained** and this
changes nothing about it.

<!--
bumps:
  skills:
    plot: patch
-->
