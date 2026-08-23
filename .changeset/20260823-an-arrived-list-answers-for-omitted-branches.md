---
"@plot-pm/plot": patch
---

The fleet scan no longer asks the git host about branches a complete PR list
already accounts for. Measured on this repo: 29 host calls per scan became 1,
because 28 of them were branches an approved plan names that nobody has started
— no ref, no PR — each paying a round trip to re-learn it still had no PR, on
every five-second pulse. One board spent roughly 3,600 calls an hour that way
and emptied a 5,000/hour budget in about 78 minutes.

Absence is only an answer when the list is known whole, so `.list-complete` is
written solely when the parsed row count is both above zero and below the
request limit: a list returned at the limit may be truncated, and an empty list
is a silent failure rather than a repository without pull requests. Where
neither holds, the host is asked exactly as before.

`PLOT_SCAN_ASK_ALWAYS=1` restores the previous behaviour on the next scan
without a rebuild.

<!--
bumps:
  skills:
    plot: patch
-->
