---
'plot': patch
---

`DESIGN-pulse.md` gives the fleet's clock a specification. A Pulse is a thing
that beats on a Machine, not a constant: it beats once, and every subscriber
names how many beats it waits.

The three cadences were already one clock. Measured 2026-08-30 and re-verified
2026-09-01 — 5 s at `fleet.ts:65`, 30 s at `plot-worker-monitor.sh:165`, 60 s at
`fleet.ts:81`. Every remainder is zero, across three numbers chosen
independently in two languages by three authors, which is what says the entity
already exists implicitly.

Divisors rather than one shared frequency, because each number carries its own
argument and a divisor keeps it attached. The monitor holds 30 s because a CPU
delta over two samples 0.4 s apart is noise; the PR reader holds 60 s because
firing it on the 5 s timer meant 720 host calls an hour and exhausted a
5000/hour budget on 2026-08-16. One frequency destroys both arguments.

One pulse per Machine, where a Machine is a Plot instance — three measured here,
all reporting `ani`. `fleet.ts:646` keys its cache by `repoRoot + scriptsDir`,
which is that identity, so the timer pair per repository is one clock per
machine and not a defect. The document also says which measurements belong to
which: the divisors and `beatCount` are the instance's, `spawnCostMs` is the
computer's, and the parallel test suite is the standing proof that several
machines on one computer are legitimate.

A subscriber's failure is contained, and that is a requirement rather than a
quality. `fleet.ts:2449` records that the two timers were split because they
failed independently; a shared clock that re-couples them would be a regression
wearing an improvement's clothes.

What the pulse does not tick, each reason stated in the document rather than
cross-referenced, because the exclusions are what a later reader will try to
undo. Watchdogs: `exitWithParent` watches the process the pulse lives in, so
ticking it would stop it in the one case it exists for, and its 1 s is
deliberately not a multiple of 5 s. The browser client: another process, often
another machine, and `FLEET_POLL_MS = 4_000` polls faster than the server on
purpose — ticking it makes the pulse an API. Monitors: tickable now that #584
shipped the channel, and held back on sequencing, because
`plot-dispatch.sh:558` enforces that every worker is born monitored from the
wrapper and that guarantee has to become a gate before it can move.

Recorded so the mechanism is not assumed present: `PurposeSchema` subscribes to
findings, which is a subscription to things that happen; a divisor subscribes to
nothing happening on a schedule. Both are subscriptions and neither is the
other.

No code, no cadence change, no subscriber. The numbers get one owner; they do
not get retuned.
