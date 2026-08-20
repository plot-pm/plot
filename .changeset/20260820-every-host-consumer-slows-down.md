---
"plot": minor
---

plot: the issue poll slows down for a rate limit, as the PR refresh already does

Measured on this repo 2026-08-20 while the board was live: GraphQL **0/5000**.
The board's PR refresh recognised the rate limit and backed off — `fleet.ts:1295`
routes its failure through `rateLimitBackoffMs`, which reads the host's own
message and waits. The issue poll did not: it recorded the error at `:1136` and
re-fired on the ordinary 60 s cadence, spending the exhausted budget to be
refused again. One host consumer slowed down and its neighbour kept knocking.

`refreshIssues` runs on the **same gate** as the PR fetch (`prNextAt`), so the
fix is to route its rate-limit failure through the same throttle and push that
gate out — never pull it in. The backoff comes from the host's message exactly
as the PR refresh derives it, and it is applied **extend-only**: a longer backoff
the PR fetch set a tick earlier is a floor the host named, and the issue poll's
own 120 s ceiling has no business shortening it — the "more conservative only"
rule `prNextDueAt` already follows.

Behaviour unchanged in every other case: a non-rate-limit failure (a VPN blip)
keeps the ordinary rhythm, Bitbucket's exit-4 *this host cannot be asked* still
clears the error and empties the list without touching the gate, and the PR
refresh's own backoff is untouched.

This is the first of the plan's *Slows* branches; the wait still comes from the
constant ceiling where the message carries no reset — `feature/the-wait-comes-from-the-host`
supplies the free `rate_limit` read that replaces it.

<!--
bumps:
  skills:
    plot: minor
-->
