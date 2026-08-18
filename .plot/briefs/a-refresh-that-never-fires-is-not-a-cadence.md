# Brief: bug/a-refresh-that-never-fires-is-not-a-cadence

Implement the **cadence** branch of
`docs/plans/2026-08-18-not-yet-asked-is-not-nothing.md`.

Read it first. The diagnosis was measured, not reasoned: **do not
re-derive it, do not widen the scope.**

## The bug

Observed on a running board:

```
74 branches across 37 plans · scanned 19s ago · PR data 111s ago
```

`PR_REFRESH_MS` is 60 000. 111 s is a **missed refresh**, not a stale one,
and the cause is local: a host call was measured at 1.4 s with 4986/5000
core quota remaining. Nothing is slow or throttled.

Three lines in `packages/board/src/server/fleet.ts`:

```
840  entry.prTimer = setInterval(() => void maybeRefreshPrs(...), PR_REFRESH_MS)
625  entry.prAt = Date.now()                        // stamped AFTER the fetch
626  entry.prNextAt = entry.prAt + PR_REFRESH_MS
648  if (entry.prRunning || Date.now() < entry.prNextAt) return
```

The timer and the gate share one period. `prAt` is stamped when the fetch
*finishes*, so `prNextAt` lands at 60 s + the call's duration — just past
the tick meant to satisfy it. That tick is refused, and the next one is a
full period later. **Any non-zero fetch duration costs a whole period**,
which is why the observed age sits near twice the configured one.

## What to build

The plan names two shapes and does not choose:

- measure `prNextAt` from the fetch's **start** rather than its finish
- run the timer at a **fraction** of the gate, so a refused tick is retried
  within the period rather than a period later

Weigh them and say which you chose and why. They differ in more than
style: the first keeps one tick per period and makes it land, the second
tolerates jitter at the cost of more no-op wakeups.

## Do not

**Do not bypass the gate.** `maybeRefreshPrs` refusing early is correct and
load-bearing — the comment at 643-647 explains it: the gate is what turns a
rate limit into a wait rather than a tighter loop. A rate-limit backoff
(`rateLimitBackoffMs`, line 492) must still hold the tick off for its full
delay. That case is the reason the gate exists and must keep working.

**Do not touch the display.** A sibling branch —
`bug/the-board-says-when-it-has-not-asked` — is changing how freshness is
*shown*, in this same file and in the app. Your change is the timing at
lines 625-626, 639-640 and 840. Keep your diff there so the two do not
collide, and expect a rebase.

**Do not change `PR_REFRESH_MS` itself.** 60 s is a deliberate figure — the
host is metered. The bug is that 60 s is not achieved, not that it is wrong.

## Definition of Done

- With a fetch that takes any non-zero time, the observed PR-data age stays
  **under** `PR_REFRESH_MS` across several cycles. The measured failure is
  111 s against a 60 s setting — a test that does not reproduce that
  against the unchanged code is not testing this bug (verify by stashing).
- A rate-limit backoff still holds for its full delay
- `pnpm run test:board` and `pnpm run typecheck` pass
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — run the
  suites **one at a time**; concurrent runs were measured producing false
  timeout failures
- `pnpm build:board` run in THIS worktree and the artifact committed
- A changeset with a `bumps:` block

## Platform note

CI runs Linux; you are probably on macOS. Faults caught this way today:
`stat -f` does not fail cleanly on GNU, and `/usr/bin:/bin` is not an
isolated PATH because CI ships a real `gh` there.

If you find something the plan did not anticipate, implement what you can
and **report the discovery** rather than improvising.
