---
"plot": patch
---

The board's PR refresh cadence accounts for what a refresh costs on the
configured host

`PR_REFRESH_MS` is 60 s, and the reasoning behind it treats a refresh as one
request: *"a check turning green is a minutes-scale event, so five-second
freshness buys nothing here."* That reasoning is right, and on GitHub the cost
matches it. On Bitbucket a refresh is **three** requests — `plot-host.sh`
expands `--state all` into `open`, `merged` and `declined` because `bb` has no
`all` state — so the same cadence spent 180 requests an hour there against 60
on GitHub. Measured against `bitbucket.org/quatico/ekzweb` (issue #226): a
board left open a working day made ~1400 requests just watching, and reached
`HTTP 429 — Rate limit for this resource has been exceeded` account-wide, with
every `bb` call from the operator's own shell failing too.

The adapter knew a call cost three and the board knew the cadence; neither knew
the other. The cadence now asks: `prRefreshMsFor(backend)` is
`PR_REFRESH_MS × PR_REQUESTS_PER_REFRESH[backend]`, so refreshes are spaced by
what they cost and **every host spends the same requests per hour** — 60,
whether that is 60 refreshes of one request or 20 of three.

**A GitHub board is unchanged**, and this is asserted rather than assumed: the
multiplier is 1 there, so `prNextDueAt` returns the number it always returned.
The uncommon case must not slow the common one down.

Derived, not configured — the plan left that open and this answers it that way
deliberately. A configured cadence is a second number someone must keep true;
this one follows from a fact the adapter already states. The multiplier is read
once from `plot-host.sh backend`, which reads `PLOT_HOST` or the `Git host` key
and touches no network. It is never inferred by counting responses, which would
make the cadence depend on the very calls it is rationing.

Only `pr-list` is counted, and that is not an omission. A refresh also runs
`issue-list` and `runs`, and on Bitbucket both cost zero requests — `bb`
exposes neither, so `plot-host.sh` exits before touching the network. Counting
calls that cannot be made would overstate the bill and slow the board down for
requests nobody sends.

**The rate-limit backoff is untouched.** The multiplier is applied after the
backoff arm returns, so a floor the host named is never edited — a cost-aware
cadence may only ever be more conservative than a backoff, never less. That
includes the case where the backoff is *shorter* than the stretched cadence
(120 s against 180 s on Bitbucket): a backoff is a floor on when the host may
be called, not a ceiling on how long the board may wait.

`PR_TICK_SLACK_MS` stays absolute rather than scaling with the multiplier. It
answers "how far can `setInterval` miss its mark", which is a property of the
timer — still firing every 60 s on every host — not of the period the gate aims
at. Scaling it would widen the licence to fetch early on exactly the host that
can least afford it.

The trade is stated rather than hidden: a Bitbucket board's PR badges are up to
three minutes old instead of one. That is the right side to err on for data
whose events are minutes-scale anyway, and the alternative is not a fresher
board but a rate-limited one, which is how this was measured.

Tested as arithmetic against a fake clock, driving the real `prNextDueAt` /
`prGateOpen` pair: requests per hour are asserted as a **count**, since the
count is what the host meters and an interval assertion would pass for a
change that lengthened the period and left the multiplier wrong. The naive
cadence is kept in the test as a control, asserted to fail the bar the shipped
one clears.

<!--
bumps:
  skills:
    plot: patch
-->
