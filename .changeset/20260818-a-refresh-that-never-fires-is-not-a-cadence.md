---
"plot": patch
---

The PR refresh stops losing a whole period to its own gate, so a 60 s cadence is actually 60 s.

Measured on a running board on 2026-08-18:

```
74 branches across 37 plans · scanned 19s ago · PR data 111s ago
```

`PR_REFRESH_MS` is 60 000, so 111 s is a **missed refresh, not a stale one** —
and the cause was local. A host call was measured at 1.4 s with 4986/5000 core
quota remaining, so nothing was slow and nothing was throttled.

The timer and the gate were two clocks set to the same period that could not
both be met. `setInterval` fires at rigid multiples of 60 s, while `prNextAt`
was stamped from the fetch's **finish** and so landed at 60 s + the call's
duration — a hair past the tick meant to satisfy it. That tick was refused, the
next came a full period later, and the board ran a 120 s cadence from a 60 s
setting. Any non-zero fetch duration cost a whole period; the defect was
bistable rather than gradual, because the refusal repeated forever.

**`prNextAt` is now measured from the fetch's START.** The plan named two
possible shapes and left the choice open. The other — running the timer at a
fraction of the gate — was rejected on measurement rather than taste: because
its gate still anchors to the finish, `prNextAt` keeps drifting forward by the
call's duration every cycle, and a quarter-period timer can only round that
drift up to the next quarter tick. Simulated at a 1.4 s call it lands the
observed age at 73.6 s, still over the 60 s the Definition of Done requires,
and it pays four wakeups per period for the privilege. Anchoring to the start
removes the drift at its source instead of sampling around it, and keeps one
tick per period.

`prAt` still stamps at the finish, because it answers a different question:
*how old is this data*, and data is not fetched until it has landed. The two
stamps were the same number in one place, and that was the bug.

**The gate still refuses, and a rate-limit backoff still holds for its full
delay.** `maybeRefreshPrs` refusing early is load-bearing — it is what turns a
rate limit into a wait rather than a tighter loop — so nothing here bypasses it.

Anchoring to the start does, however, put the gate and the tick on the *same
instant*, which is correct and knife-edge: `setInterval` does not promise to
fire late, and one millisecond of early drift reopened the entire defect, since
a single refusal still costs a full period. A fix that merely makes the bug rare
is worse than none, because it stops reproducing in tests while still failing in
production. So an ordinary cadence tick is now honoured if it arrives within a
small tolerance (`PR_REFRESH_MS / 50`, 1.2 s at the 60 s cadence).

That tolerance is applied to the ordinary cadence **only**. `prNextAt` had been
carrying two different promises in one number: a soft target the timer is trying
to hit, and a hard floor the host named. A single tolerance wide enough to
absorb timer jitter is also wide enough to fire a second before a 61 s reset —
spending quota to be refused again, the precise thing the backoff exists to
prevent. The distinction is now carried in the data (`prNextIsBackoff`), and a
backoff is compared exactly, with no slack whatsoever.

The scheduling decision lives in one exported function, `prNextDueAt`, so the
anchor is testable as arithmetic rather than only observable through a live 60 s
timer. The tests drive it and `prGateOpen` against a fake clock, and the anchor
they replaced is kept in the test file as an explicit control: it is asserted to
**fail** the bar the shipped one clears, reproducing the measured 111 s. A first
attempt modelled both anchors inside the test helper and so passed no matter
what the source said — it was rewritten to bind to the real functions, and
verified by reverting the anchor and watching six tests fail.

`PR_REFRESH_MS` itself is unchanged. 60 s is a deliberate figure because the
host is metered; the bug was that 60 s was not achieved, not that it was wrong.

<!--
bumps:
  skills:
    plot: patch
-->
