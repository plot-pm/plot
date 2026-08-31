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

So **a second ceiling exists** — concurrency — reached by adding processes
rather than by any one process misbehaving, and a per-process budget cannot see
it by construction.

**But note which evidence that conclusion rested on.** `5000/5000 on both
buckets` was read from `gh api rate_limit`, the endpoint measured below
reporting 5000 while the headers reported 0. That reading cannot distinguish
*"the quota is fine, this is a secondary limit"* from *"the quota is spent and
this endpoint is wrong"*. The 403 naming abuse detection is independent evidence
and stands; the bucket reading beside it does not. Whether 2026-08-27 was purely
concurrency or partly an exhausted GraphQL quota is now unknown — which is
itself a reason to budget by bucket and read the headers, since the same
ambiguity will otherwise recur at every diagnosis.

### The buckets are separate, and the board budgets neither of them by name

GitHub meters **REST (`core`) and GraphQL as independent buckets**, 5000 each,
plus narrower ones (`code_search` is 10). Measured 2026-09-01 from the response
headers:

| bucket | limit | remaining | used |
|---|---|---|---|
| `core` (REST) | 5000 | **4990** | 10 |
| `graphql` | 5000 | **0** | **5000** |

`plot-host.sh` uses both forms and does not distinguish them: `gh pr list`,
`gh pr view` and `gh issue list` are GraphQL; `gh api repos/…` and `gh run list`
are REST. One is exhausted while the other is untouched, so a single "host
requests" budget both under-counts the bucket that is nearly spent and refuses
calls that would have gone to the bucket with 4990 left.

**This is why REST worked all evening while GraphQL refused** — not a secondary
limit, which is what the failure looked like from the aggregate view.

### The endpoint plot asks reports the wrong number

`graphql_budget_spent()` (`plot-host.sh:536`) reads
`.resources.graphql.remaining` from `gh api rate_limit`. Measured 2026-09-01,
three consecutive readings, uncached, against the same account and moment:

    rate_limit says graphql=5000   response header says=0
    rate_limit says graphql=5000   response header says=0
    rate_limit says graphql=5000   response header says=0

The gate that exists to notice a spent GraphQL budget **cannot see it**, because
the endpoint it trusts reports a full bucket while every real call is refused.
The same reading is what licensed the comment beside it — *"the call itself is
FREE, measured 2026-08-27: three consecutive readings, all used=0"* — and
`used=0` from this endpoint is not evidence that a call was free; it is the
symptom.

**So the authority must be the headers on a real response**, which report
`X-RateLimit-Resource` naming the bucket the call actually spent, alongside
`Limit`, `Remaining` and `Used`. A call that has to happen anyway carries its own
accounting; a separate question about the budget is both an extra request and, as
measured, wrong.

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
account, holding what has been spent, against which bucket, and when.

Every host call goes through `plot-host.sh` already, which is the one place that
appends to it.

### GraphQL stays the default, and the asymmetry is why

The obvious inversion — *use REST whenever possible, switch to GraphQL when REST
is spent or lacks a feature* — is rejected, and `plot-host.sh:524` already
argues it in those words:

> "Use REST whenever possible" trades one cheap call for a hundred and eighty.

The cause is structural rather than incidental. **Verified 2026-09-01** against
this repo:

    GET /repos/{o}/{r}/pulls  →  mergeable_state: null,  no statusCheckRollup

REST's list endpoint carries neither the merge state nor the check rollup, so
full data costs **two REST calls per PR** — ~186 for a 93-branch scan — against
**one** GraphQL call that returns the rollup inline. Inverting the default would
multiply the board's main query by ~186 and exhaust `core` faster than GraphQL
is exhausted today, which is the failure this plan exists to remove rather than
relocate.

**So the rule is: the cheap path per question, with the other bucket as the
fallback.** For a PR list that is GraphQL. It is not a global preference for one
API, and the plan should not be read as endorsing GraphQL — a question REST
answers in one call belongs on REST, and `issue-view` fetching one issue is a
candidate.

**Where REST is not a fallback but the only answer**, the routing must say so
too: a feature GraphQL lacks is a routing input exactly like a spent budget.

### The routing decision belongs where every adapter can reuse it

**This is the plan's structural gap, and it is bigger than the budget.** The
choice between paths is made *inside* one op's github branch —
`plot-host.sh:1046`, within `if [ "$be" = "github" ]`, under a comment saying
*"THE ROUTE IS CHOSEN ONCE, HERE"*. Once **for `pr-state`**, and nowhere else.

**Measured 2026-09-01:**

| | count |
|---|---|
| backend branches (`be" = "github"`) in `plot-host.sh` | **14** |
| paths that consult the budget at all | **3** |

So roughly eleven host-touching paths spend with no idea what is left, and any
new op inherits that by default — the routing was written for one question and
never generalised. A second copy would drift from the first, which is the
argument `plot-pr-merged.sh` already makes about a duplicated gate failing in
the permissive direction.

**One router, asked by every op.** Given a question, the budget record and what
each API can answer, it returns which path to take — or that neither can be
taken now. The ops call it; they do not each re-derive it. That is also what
makes the `Host` port (`packages/domain/src/ports/host.ts`) able to express this
for adapters other than `gh`: the decision is a domain rule over readings, not a
property of one CLI.

### There is no registry, and no lock

Two things this plan deliberately does NOT build, because both were considered
and both cost more than they return.

**No spender registry.** Nothing counts boards. Measured 2026-09-01: nothing
registers a running board at all — `.plot/state/` holds `fleet-controls.json`
and `last-pulse.json`, and `index.ts` knows its own `boundPort` and nothing
about peers. A lease file with heartbeats would answer *"how many boards?"* and
bring with it a liveness protocol and stale-entry reaping — the same class of
problem the orphaned-server work has already been through twice, with one
unexplained termination path and 152 orphans measured on this machine.

**Instead the spend rate is the signal.** Each spender appends what it spent,
with a timestamp; a board derives its cadence from the observed rate across the
whole file, not from a headcount. A board that dies stops appending and stops
counting, with nothing to reap and no protocol to get wrong. *"How many
spenders"* becomes a question nobody has to answer correctly.

**No lock.** Reading and writing the budget under a lock on a 5 s cadence
serialises every host call behind a filesystem operation. The budget is
**best-effort**: appended without a lock, tolerant of a lost write, and read as
an estimate. An occasional double-spend costs one request out of 5000; a lock on
the hot path costs latency on every request and adds a failure mode — a stale
lock — whose recovery nobody has written.

**This makes the budget advisory, and that is the honest description.** It is
not a quota enforcer. It is a shared measurement that lets a cadence adapt, and
the property below is what it must deliver.

### The cadence divides, it does not double

A board's refresh interval already stretches by per-refresh cost. It must also
stretch by the **observed spend rate**: when two boards are spending, each
refreshes half as often, and the pair still spends 60 requests an hour.

This is the property the plan is named for. A second board must not increase
what the account spends — it must halve what each board spends. Note what
follows from deriving it from rate rather than headcount: the operator's own
`gh` calls from a terminal, and a dispatched worker's scans, are counted too,
because they also append. A headcount of boards would have missed both.

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
      directories with one account behind them — measured tonight: two boards
      ran from two worktrees. The record is keyed by ACCOUNT, so its path must be
      too; a per-checkout path would give each worktree its own budget and
      reproduce the exact bug this plan exists to fix, one level up. Decide
      before the first slice writes a file, because moving it later is a
      migration.
- [x] Is a file lock enough, or does the budget need a daemon? **Neither — the
      budget is lock-free and best-effort.** An append without a lock can lose a
      write; that costs one request of 5000 and is recoverable by the next
      append. A lock costs latency on every call and introduces stale-lock
      recovery, and a daemon introduces a process that can die holding the
      answer. The remaining question is not the lock but the FORMAT: an
      append-only record tolerates concurrent writers far better than a
      rewritten JSON object, and the first slice should pick accordingly.
- [ ] What does a script do when the budget is spent — refuse, or spend anyway
      and say so? `plot-reap.sh` treats an unreachable host as *not merged* and
      keeps, which is safe. `/plot-deliver` blocking on a budget would be new
      behaviour, and a workflow command a person is waiting for is not a poll.

## Branches

### Counting what is spent

- `bug/the-host-adapter-counts-what-it-spends` — `plot-host.sh` appends every call to a per-account record, lock-free, and can read back the recent spend rate. No behaviour change beyond the record: the deliverables are a number every component can see, the append format (which must tolerate concurrent writers without a lock), and the answer to where the file lives when two worktrees share one account.

### Dividing the cadence

- `bug/the-board-refresh-divides-by-its-peers` — `fleet.ts` derives `PR_REFRESH_MS` from the observed spend rate as well as the per-refresh cost, so N boards spend what one board spends. No peer counting: the rate is read from the record, which also captures the operator's own `gh` calls and a worker's scans. The measurement is two boards running for an hour against a request count.

### Telling the two limits apart

- `bug/a-secondary-limit-is-not-a-spent-quota` — the banner names which limit was hit, prints a reset time only when there is one, and when the cause is local contention says how many spenders it found. `plot-host.sh` already distinguishes them at `host_failure_kind`; the board discards the distinction.

### One router, reused

- `bug/one-router-chooses-the-path` — extract the path choice from `pr-state`'s github branch into one routing rule asked by every op: given the question, the per-bucket record and what each API can answer, which path (or neither). Expressed so the `Host` port can carry it, since 14 backend branches consult 3 budgets today and a second copy of the rule would drift permissive. No new capability — the deliverable is that eleven paths stop spending blind.

### Budgeting each bucket by name

- `bug/the-budget-knows-which-bucket-it-spent` — the record from slice 1 is keyed by bucket (`core`, `graphql`, and whatever `X-RateLimit-Resource` names), read from the response headers of calls that were going to happen rather than from `gh api rate_limit`, which was measured reporting 5000 while the headers reported 0. Fixes `graphql_budget_spent()` in the same slice: a gate that cannot see the condition it gates on is worse than no gate, because it reports safety.

### Bounding concurrency

- `bug/the-budget-bounds-simultaneous-calls` — a cap on in-flight host requests per account, sized against the measured seven. Last, because it needs the record from slice 1 and the reporting from slice 3 to show it is working rather than merely quiet.

## Done when

- **Two boards running for an hour spend no more host requests than one board
  does** — counted from the budget record, stated in the changeset. This is the
  plan's name and its only real claim.
- A third board changes that number by nothing.
- The banner never prints a reset time it did not receive, and when the limit is
  local it says how many spenders were found.
- **Every op consults the router**, and no op re-derives the choice. Asserted by
  there being one implementation, not by review.
- **A spent GraphQL bucket does not stop a REST call, and vice versa** — the two
  are budgeted by name, so the board keeps answering from the bucket that has
  4990 left instead of pausing on the one that has 0.
- `graphql_budget_spent()` returns true when the headers say the bucket is spent,
  asserted against a response whose `X-RateLimit-Remaining` is 0 — not against
  `gh api rate_limit`, which reported 5000 at that moment three times running.
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

**The cheap path is per question, not per API.** An earlier reading of this
plan inverted it — REST first, GraphQL when REST runs out — which is the natural
instinct once you know REST's bucket is the untouched one. The measured
asymmetry refuses it for the board's main query, and the same measurement is why
the router takes the question as an input rather than applying one global
preference.

**The aggregate endpoint is not a source of truth.** Two of this plan's
findings come from comparing it to the headers on a real response, and both
times it was the endpoint that was wrong. Anything that decides whether to spend
should read what the last spend reported.

**The stale banner is the tell.** A board 49 minutes behind on a 60 s timer is
not slow — it has been refused ~49 times, and the only thing it can say is when
GitHub will forgive it. It cannot say *"the other board on this machine is
asking the same questions"*, because it has no way to know another board exists.
