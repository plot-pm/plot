---
'plot': patch
---

Bitbucket's predicted hourly limit is 10000 instead of 1000, and a new `## Plot Config` key, `Host rate limit`, sets it per project (for example `Host rate limit: 2000` on a smaller plan). The in-process Bitbucket client, the shell's budget record and `plot-host.sh limit` read it; a value that is not a positive whole number reads as 10000. A reply that states `X-RateLimit-Limit` outranks the key: the client records that number with basis `actual`, with `X-RateLimit-Remaining` and `X-RateLimit-Reset` where the reply carries them and null where it does not, so a stated limit with no remaining count gives no headroom. The concurrency bound at 10000 requests an hour is 11 instead of 1, and a `429` still halves a predicted limit.

<!--
bumps:
  skills:
    plot: patch
-->
