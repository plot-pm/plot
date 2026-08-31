# One account has one budget

> Every board and every script budgets host calls for itself, and the limit
> belongs to the account. Two boards are two budgets against one cap, so the
> arithmetic that keeps one board under the limit says nothing about what the
> machine actually spends.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The board stops running the host out of requests when more than one of them is
  open: host calls are spent against one budget per account, held where every
  board and every helper can see it, so the cadence stretches with the number of
  spenders rather than per process.

Board impact: this IS the board, plus `plot-host.sh` as the one place that talks
to the host. The plan format, template and `docs/plans` layout are untouched.

## Motivation

**The banner is the symptom:**

> PR data paused: the host's rate limit is spent, service returns in ~12 min —
> showing data from 49 min ago — the two groups above that depend on it may be
> incomplete.

Two things are wrong there, and only one is cosmetic. The board is **49 minutes
stale on a 60 s timer**, and it is telling the operator to wait rather than
telling them the fleet is competing with itself.

### The budget arithmetic is correct and per-process

`fleet.ts:93-135` does this properly, and says so:

> the hourly spend stays 60 on both hosts; the higher a host's per-refresh cost,
> the further apart its refreshes
>
>     GitHub      1 request  → refresh every  60 s → 60 requests / hour
>     Bitbucket   4 requests → refresh every 240 s → 60 requests / hour

Every word of that holds **for one board**. Nothing in it is per-account, and
the limit is.

**Measured 2026-09-01: two `board-server` processes running on this machine.**
Two budgets, 120 requests/hour, each process believing it spends 60. Add the
operator's own `gh` calls and a dispatched worker's scans and no component knows
what the total is — including the one that renders the apology.

### The repo has already measured the failure this causes

`plot-host.sh:239` names it, with the date:

> the SECONDARY limit — concurrent-request throttling, which is the outage this
> repo actually had on **2026-08-27 with eight workers against a cap of seven**
> — reports a 403 naming abuse detection, while `gh api rate_limit` reads
> 5000/5000 on both buckets.

So the ceiling that bites first is **concurrency**, not the hourly quota, and it
is reached by adding processes rather than by any one process misbehaving. A
per-process budget cannot see it by construction.

**Confirmed again 2026-08-31**, while verifying a PR: `gh` GraphQL calls failed
with `API rate limit already exceeded` while `gh api rate_limit` reported
**5000/5000 remaining** and REST calls succeeded immediately.

### Twelve scripts share the same cap

`plot-build-monitor.sh`, `plot-board-probe.sh`, `plot-approve.sh`,
`plot-deliver.sh`, `plot-fleet-scan.sh`, `plot-dispatch.sh`,
`plot-impl-status.sh`, `plot-plan-meta.sh`, `plot-release-refs.sh`,
`plot-reconcile-scan.sh`, `plot-reap.sh` all reach the host through
`plot-host.sh`. None of them knows a board is running, and a dispatched worker
runs several of them in a loop.

`plot-host.sh:222` already anticipates the shape of the answer:

> a board on a 5 s cadence, a scan inside a 90 s budget and a person at a
> terminal want three different answers — and a retry inside the adapter would
> impose one

That is the right instinct about *retry*. It leaves *spending* unowned.

### What the existing mitigation does and does not do

`PLOT_TERMINAL_CACHE` removes the host round trip for branches in a terminal
state — 26 of 54 here — and it works. But `fleet.ts:2193` passes it into the
child scan from the board's own memory, so each board has its own. Two boards
ask the host the same questions twice, and a board started a minute ago has an
empty cache and asks everything.

## Design

### One budget, on disk, per account

The spender that matters is the **account**, so the record lives where every
process on the machine can find it — under `.plot/state/`, keyed by host and
account, holding what has been spent and when the window resets.

Every host call goes through `plot-host.sh` already. That is the one place that
must read the budget before spending and record the spend after, which is what
makes this enforceable rather than advisory: a component that forgets to ask
cannot reach the host at all.

### The cadence divides, it does not double

A board's refresh interval already stretches by per-refresh cost. It must also
stretch by **the number of live spenders**: two boards on GitHub refresh every
120 s, not every 60 s, and the pair still spends 60 requests an hour.

This is the property the plan is named for. A second board must not increase
what the account spends — it must halve what each board spends.

### Concurrency is a separate ceiling from quota

The 2026-08-27 outage was **eight workers against a cap of seven** with the
quota untouched. So the budget must bound *simultaneous* requests as well as
requests per hour, and those are different numbers with different recovery
behaviour. A quota exhaustion has a reset time worth printing; a secondary limit
clears in seconds and the board should retry, not apologise for 49 minutes.

### The banner tells the truth about which limit and which clock

Today it prints the primary reset (`~12 min`, `~59 min`) whatever the failure
was. On a secondary limit that number is wrong and the advice it implies —
wait — is the opposite of what helps. When the cause is *this machine's own
spenders*, the banner should say so and name how many, because the fix is
closing a board rather than waiting for GitHub.

### Open Questions

- [ ] Where does the budget file live when boards run from different worktrees?
      `.plot/state/` is per-checkout, and two worktrees of the same repo are two
      directories with one account behind them. A path derived from the account
      rather than the checkout may be required — decide before the first slice
      writes a file, because moving it later is a migration.
- [ ] Is a file lock enough, or does the budget need a daemon? A lock per call
      adds latency to every host request on a 5 s cadence. Measure the lock cost
      against the round trip it protects; if it is small, a file is simpler than
      a process that can itself die.
- [ ] What does a script do when the budget is spent — refuse, or spend anyway
      and say so? `plot-reap.sh` treats an unreachable host as *not merged* and
      keeps, which is safe. `/plot-deliver` blocking on a budget would be new
      behaviour, and a workflow command a person is waiting for is not a poll.

## Branches

### Counting what is spent

- `bug/the-host-adapter-counts-what-it-spends` — `plot-host.sh` records every call against a per-account budget under `.plot/state/`, and reads it before spending. No behaviour change yet beyond the record: the deliverable is a number every component can see, and the answer to the file-location open question.

### Dividing the cadence

- `bug/the-board-refresh-divides-by-its-peers` — `fleet.ts` derives `PR_REFRESH_MS` from the live spender count as well as the per-refresh cost, so N boards spend what one board spends. The measurement is two boards running for an hour against a request count.

### Telling the two limits apart

- `bug/a-secondary-limit-is-not-a-spent-quota` — the banner names which limit was hit, prints a reset time only when there is one, and when the cause is local contention says how many spenders it found. `plot-host.sh` already distinguishes them at `host_failure_kind`; the board discards the distinction.

### Bounding concurrency

- `bug/the-budget-bounds-simultaneous-calls` — a cap on in-flight host requests per account, sized against the measured seven. Last, because it needs the record from slice 1 and the reporting from slice 3 to show it is working rather than merely quiet.

## Done when

- **Two boards running for an hour spend no more host requests than one board
  does** — counted from the budget record, stated in the changeset. This is the
  plan's name and its only real claim.
- A third board changes that number by nothing.
- The banner never prints a reset time it did not receive, and when the limit is
  local it says how many spenders were found.
- The 2026-08-27 shape is covered: more spenders than the concurrency cap
  degrades cadence rather than producing a 403.
- A script whose budget is spent behaves the way its own safety argument
  requires — `plot-reap.sh` keeps, and nothing silently reads *unreachable* as
  permission.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`,
  changeset.

## Notes

**Nothing here is a new diagnosis.** `fleet.ts` did the per-refresh arithmetic
and stated its unit; `plot-host.sh` separated the primary limit from the
secondary one and recorded the outage that motivated it. Both were right about
what they measured. The gap is that a *process* was the unit of both, and the
limit's unit is an account.

**The stale banner is the tell.** A board 49 minutes behind on a 60 s timer is
not slow — it has been refused ~49 times, and the only thing it can say is when
GitHub will forgive it. It cannot say *"the other board on this machine is
asking the same questions"*, because it has no way to know another board exists.
