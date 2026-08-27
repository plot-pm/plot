---
'plot': minor
---

<!--
bumps:
  skills:
    plot: minor
-->

`plot-host.sh` reports the remaining API budget per API, so a rate-limited
caller can tell which budget is gone.

GitHub meters GraphQL and REST/core separately — measured at 4503/5000 and
4997/5000 in the same instant — so exhausting one says nothing about the other.
The new `rate-limit` op reports both, with `limit` and `reset` alongside each
`remaining`.

It reports and does not decide: a caller that wants to fall back reads this,
compares against zero, and acts.

A host that cannot be asked reports `unknown`, never `zero`. Zero means *spent*,
and a caller reading "cannot ask" as "exhausted" would take the expensive path
forever. Bitbucket has a single budget and no way to query it, so it reports
`unknown` throughout and is not asked at all.

The query itself is free — `gh api rate_limit` consumes neither bucket.
