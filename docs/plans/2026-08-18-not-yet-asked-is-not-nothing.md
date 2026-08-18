# Not yet asked is not nothing

> `WAITING ON A MACHINE — none` is printed before the board has asked the host, and again after it has asked and found nothing. Two opposite situations, one word, and the operator reads the reassuring one.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `bug/the-board-says-when-it-has-not-asked`
- **Delivered:**
- **Released:**
- **Started:** 2026-08-18, Jan Wloka, `bug/a-refresh-that-never-fires-is-not-a-cadence`

## Changelog

- The board distinguishes a section it has checked and found empty from one it has not checked yet, so an unfetched view stops reading as a settled one.

## Motivation

Reported live 2026-08-18 by an operator watching two screenshots of the
same board, 22 seconds apart. The first:

```
WAITING ON A MACHINE  nothing — CI will finish
  none

#57   feature/opus5-longh…            (no status)
#196  idea/the-marker-get…            (no status)
      ...
72 branches across 35 plans · scanned 27s ago · PR data 22s ago
```

The second, after the PR refresh landed:

```
#57   conflicts        the host reports this branch does not merge
#196  checks failing   CI failed · failure at 2026-08-17T18:31:10Z
#203  CI running
73 branches across 36 plans · scanned 1s ago · PR data 4s ago
```

Nothing changed on the host between them. A branch with a **failing CI run
since the previous day** presented as unremarkable, and a branch the host
reports as unmergeable presented the same way. The operator's reading was
that the board had lost its state; it had not yet fetched it.

### The word that carries two meanings

`none` under WAITING ON A MACHINE is printed in both of these situations:

| Situation | What the board should convey |
|---|---|
| PR data fetched, nothing pending | nothing is running — you may proceed |
| PR data not fetched yet | I have not looked |

They want opposite responses, and the reassuring one is the default. This
is the defect `docs/plans/2026-08-17-an-outage-is-not-an-answer.md`
removed three times on 2026-08-17 — **a failure to observe reported as an
observation** — arriving in the one place that plan did not reach: not a
failed call, but a call not yet made.

An outage at least produces an error to carry. A pending first fetch
produces nothing at all, which is why it survived a plan written to catch
exactly this shape.

### The data already exists, one line away

The footer reports it precisely:

```
scanned 1s ago · next in 4s · PR data 4s ago · next in 56s
```

Two independent clocks, and the second is the slow one: the git scan
refreshes every few seconds, the host data every 60. So the window in
which rows are git-fresh and PR-stale is not an edge case — **it is most
of every minute.**

The footer is also the wrong place for it. It qualifies the whole page
with one number while the rows it qualifies carry none, so a reader
checking a single row has to remember that the page's age applies to it.
Nobody does that, which is the entire report.

### The gap is wider than the cadence, and that was measured

Observed a third time, and this one carries the number:

```
74 branches across 37 plans · scanned 19s ago · PR data 111s ago · next in 0s
```

`PR_REFRESH_MS` is 60 000. **111 s is not a stale minute, it is a missed
refresh** — and the cause is in `fleet.ts`, not on the host: a host call
was measured at 1.4 s with 4986/5000 core quota remaining, so nothing is
slow or throttled.

The timer and the gate share one period:

```
fleet.ts:840  setInterval(() => maybeRefreshPrs(...), PR_REFRESH_MS)   // fires at 60s
fleet.ts:626  entry.prNextAt = entry.prAt + PR_REFRESH_MS              // prAt is set AFTER the call
fleet.ts:648  if (entry.prRunning || Date.now() < entry.prNextAt) return
```

`prAt` is stamped when the fetch *finishes*, so `prNextAt` lands at
60 s + the call's duration. The tick at 60 s arrives just before it, is
refused, and the next tick is at 120 s. **Every cycle where the fetch takes
any time at all costs a whole period**, which is why the observed age sits
near twice the configured one.

The refusal is correct — `maybeRefreshPrs` must not bypass its gate, and
the comment at 643-647 says so for the rate-limit case it was written for.
The defect is that an ordinary tick is indistinguishable from a
rate-limited one: both are silently dropped, and the display cannot say a
refresh was skipped.

This is why the section matters beyond first load. A view that is
*supposed* to be at most 60 s old is routinely 120 s old, and prints the
same `none` at both ages.

### Why this is worse for agents than for people

`docs/plans/2026-08-18-the-board-answers-agents.md` exposes these verdicts
over `/api/attention` for consumers that cannot run the scan. A person can
learn to distrust a fresh-looking board; an agent reading `none` will act
on it. A field that means *nothing pending* and *not yet asked* at once
cannot be consumed by anything that does not already know the difference.

## Design

### Approach

**Say which clock a row was read from.** Every fact the board shows comes
from either the git scan or the host, and the two have different ages. A
row whose PR data has never loaded reports that, rather than presenting the
scan's freshness as though it covered both.

Three states where there is one today:

| State | Shown as |
|---|---|
| fetched, something pending | the rows, as today |
| fetched, nothing pending | `none` — nothing is running |
| not fetched yet | `not checked yet` |

The third is the whole plan. It is a **first-load** state, not a general
staleness display: once the host has answered, ordinary ageing is what the
footer already reports, and re-labelling every row every 60 s would trade
one misreading for a flicker.

### Evidence, not verdict

The row says *the host has not answered yet*. It does not estimate, does
not retry-count, and does not say *probably fine* — the same rule the
scan's own outputs follow (Manifesto Principle 3: scripts collect, humans
conclude).

### What must not change

**The scan's own freshness stays separate.** Git facts are cheap and
current; conflating the two clocks into one "page age" is what made this
readable as a settled board. Two sources, two ages, and each fact carries
the one it came from.

### Open Points

- [ ] Does a **failed** host call read as `not checked yet` or as its own
      state? `an-outage-is-not-an-answer` argues an outage must be visible
      as an outage. Likely a fourth state, and the reason this is a
      question rather than a decision.
- [ ] Should the section header carry it (`WAITING ON A MACHINE — not
      checked yet`) or each row? The header is one place to change and one
      place to miss; per-row survives a collapsed section.
- [ ] Does `/api/attention` need the same distinction in its payload? It
      almost certainly does, and that makes this plan a dependency of
      `the-board-answers-agents` rather than a sibling.

## Branches

- `bug/the-board-says-when-it-has-not-asked` — a first-load state distinct from an empty one, on the sections and rows fed by host data; the git scan's freshness stays its own. Tests: a board rendered before the first PR fetch must not print `none` under WAITING ON A MACHINE, and must not present a branch with no PR data as though it had been checked; after a fetch that finds nothing, `none` reads exactly as today; a row's PR-derived fields never borrow the scan's age. PR #221.

- `bug/a-refresh-that-never-fires-is-not-a-cadence` — the PR timer stops losing a whole period to its own gate: `prNextAt` measured from the fetch's START rather than its finish, or the timer run at a fraction of the gate so a refused tick is retried within the period rather than a period later. Tests: with a fetch that takes any non-zero time, the observed age must stay under `PR_REFRESH_MS` across several cycles — the measured failure is 111 s against a 60 s setting; a rate-limit backoff must still hold the tick off for its full delay, which is the one case the gate exists for.

## Notes

Found by an operator reporting the board had "lost its states", then
observing them return unchanged 22 seconds later. The board was correct
both times and said so in the footer; the rows are what could not.

Related: `docs/plans/2026-08-17-an-outage-is-not-an-answer.md` (Delivered)
established the rule this applies — an unobserved thing must not be
reported as an observed one. This is the same rule at the one boundary
that plan did not cross: the call that has not happened yet.
