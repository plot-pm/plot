# The scan asks once, not once per branch

> Fourteen branches cost 39 Bitbucket requests and the scan never finished. One request would have answered all of them — the host returns every PR in the repo, and what the scan needs is a local join over that one response.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Sprint:** the-board-tells-the-truth
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-18, jwloka, in-session
- **Started:** 2026-08-18, Jan Wloka, `bug/the-scan-joins-one-pr-list`
- **Delivered:**
- **Released:**

## Changelog

- `plot-fleet-scan.sh` resolves every branch's PR state from one host response instead of one request per branch, and the board's refresh cadence accounts for what a refresh actually costs on the configured host.

## Motivation

Two measurements against `bitbucket.org/quatico/ekzweb` on 2026-08-18, filed as
issues #228 and #226. They are one defect seen from two ends: **nothing in
either layer knows what a host call costs.**

### The scan asks per branch (#228)

14 branches across 2 plans, with a PATH-stubbed `bb` counting invocations:

```
bb calls in 60s: 39
  14  pr list --state open --json
  13  pr list --state merged --json
  12  pr list --state declined --json
```

The scan did not finish inside 110 s. **The host is not slow** — one `pr list`
answers in 0.8 s and `git fetch` takes 1.6 s. It is 39 sequential round trips.

`host_pr_state()` (`plot-fleet-scan.sh:399`, called from 430, 447 and 912)
resolves state **per branch**. Each call is one `plot-host.sh pr-state`, which
on Bitbucket costs up to three requests because `bb` has no `all` state.

14 × 3 = 42; the early exit from PR #225 saved 3, because it only helps
branches that *have* an open PR — and most here have none, so they pay all
three.

### The board pays it every minute (#226)

`PR_REFRESH_MS` is 60 s, and the comment reasons about it as one call: *"a
check turning green is a minutes-scale event, so five-second freshness buys
nothing here."* That reasoning is right, and on GitHub the cost matches it.

| | per refresh | per hour |
|---|---|---|
| GitHub | 1 request | 60 |
| Bitbucket | **3 requests** | **180** |

A board left open all day makes ~1400 Bitbucket requests just watching. The
adapter knows a call costs three; the board knows the cadence; **neither knows
the other.** Measured consequence: `HTTP 429 — Rate limit for this resource has
been exceeded`, account-wide, with every `bb` call from the shell failing too.

### It stopped hiding on GitHub too — measured here, today

The defect was filed against Bitbucket because that is where it became fatal.
Measured on **this repo, on GitHub**, 2026-08-18:

```
branches in the scan:     84
one pr-state lookup:      438 ms
84 x 438 ms:              ~37 s   ← observed: 34 s
one pr-list (all PRs):    1107 ms
```

The board's `run()` helper times out at **30 s** (`fleet.ts:260`). So the scan
now exceeds it on GitHub, and the board has been serving a cached pulse
**644 seconds old** while reporting `Command failed`. The operator's view was
stale for over ten minutes and the reason was invisible.

**One list answers what 84 lookups take, and is 30x faster.** That ratio is the
whole argument: paginating the scan would halve the wait by halving what is
seen, while the join removes the wait and keeps the whole picture.

The repo simply grew past the threshold. Nothing changed in the scan — 84
branches did what 14 did on Bitbucket, one host generation later.

### Why GitHub hid it

`gh pr view` is one request and fast, so N lookups stay under the timeout — the
loop is wasteful there too, just not fatally. On Bitbucket the same loop
triples and hits a rate limit. The defect has been present the whole time; only
the second host made it visible.

## Design

### 1. One response, joined locally

The scan needs `branch → state` for a **known set** of branches. That is a join
over one response, not N lookups: `plot-host.sh pr-list` already returns every
PR the repo has.

Three requests (one per Bitbucket state) answer what currently takes 39, and
one on GitHub. **The ratio worsens with every branch added**, which is what
makes this a shape problem rather than a tuning problem.

**The existing per-branch call stays** for the one case that genuinely needs
it: PR #216's host lookup for a branch with no ref, which asks about a specific
branch that the repo-wide list may not contain if it was never opened as a PR.
That call is bounded by absent branches, not by all branches.

### 5. The cadence knows what a refresh costs

The board asks the adapter what one refresh costs on the configured host, and
spaces its polling accordingly. `plot-host.sh backend` already reports which
host is in use; the cost per refresh is a property the adapter can state.

**This is second, and depends on the first.** Once a refresh is one join
instead of N lookups, the arithmetic changes enough that the cadence question
may answer itself — which is why the waves are ordered rather than parallel.

### 3. The board shows what it has, while the rest arrives

Measured 2026-08-18, splitting the scan by source:

```
--offline (git only):  12.7 s
with host lookups:     34.0 s
```

**Even with the join, the scan stays around 14 s** — under the 30 s timeout,
but nowhere near the 5 s the pulse aims for. The git half alone is 12.7 s on 84
branches, and no host fix touches it.

So the fix and the wait are two problems. The join makes the host phase short;
it does not make the scan instant, and a board that renders nothing for
fourteen seconds is a board that looks broken.

**Three sources with three speeds, each row saying which it has.** Plan facts
are immediate — the file is on disk. Git facts arrive in seconds. Host facts
arrive last. A row can render as soon as its plan facts exist, gain its git
state when the walk reaches it, and gain its PR badge when the list lands.

The schema is already built for this. `claimed` and `eligible` are **optional**
precisely so that `claimed: 0` and "no pulse has landed yet" do not render
identically (`schema.ts`, the comment on `WaveSummary`). Incremental delivery
is that distinction applied continuously rather than only on first load —
which is what `2026-08-18-not-yet-asked-is-not-nothing` established for the
host half and stopped short of generalising.

**A badge that has not arrived is absent, never zero and never a guess.** That
is the rule the whole day has been about, and streaming makes it load-bearing
rather than occasional: for most of the scan, most rows are genuinely partial.

### 4. Not every branch is worth asking about

Measured on this repo 2026-08-18, across the 84 branches the scan walks:

| State | Count | Can it still change? |
|---|---|---|
| `merged` | **56 (67%)** | **no — terminal** |
| `open` | 22 | yes |
| `deferred` | 1 | no |

**Two thirds of the work asks about facts that cannot change.** A merged branch
stays merged; a deferred one stays deferred until a human edits the plan. The
scan re-derives both on every pass, at full cost, forever — and the proportion
worsens as a repo ages, because merged branches accumulate and open ones do not.

So the split is not "important vs unimportant", which would need a judgement
call the scan has no business making. It is **terminal vs live**, which is a
property of the state itself:

| Class | Which branches | Refresh |
|---|---|---|
| **live** | `open`, `claimed`, `wip`, anything with a worker | every pulse |
| **terminal** | `merged`, `deferred`, plans that are `Released` | once, then cached until something local changes |

**A terminal answer is cached until git contradicts it.** The invalidation is
not a timer: if a ref reappears, a plan is edited, or a branch gains commits,
the cached answer is discarded and the branch rejoins the live class. That
keeps the cache a *derivation* rather than a *record*, which is the difference
Principle 1 rests on — nothing is remembered that git cannot re-establish.

**What this must not become.** A cache that survives a contradiction is a lie
with a long half-life, and this repo has removed that shape repeatedly today: a
stale tracking ref outranking the host, a `none` printed before the first
fetch, a timer tick silently dropped. The rule that keeps this one honest is
that **the cache is checked against git every pulse, and only the host call is
skipped** — git is local and cheap, the host is remote and metered, and the
whole saving lives in that asymmetry.

The arithmetic: 22 live branches instead of 84 is a 74% reduction, on top of
the join. Together they turn ~21 s of host work into a single call about a
quarter of the branches.

### What must not change

**A failed lookup must still read as a failure**, never as "no PR". That
distinction was added on 2026-08-17 when GitHub returned 503 all afternoon and
every branch read as having no PR. A join over a response that never arrived is
the same trap in a new shape: an empty join and a failed fetch must not
render identically.

### Open Points

- [ ] Does `pr-list` return closed/declined PRs by default on both hosts? The
      join needs the same three-way vocabulary `pr-state` produces, and if the
      list omits a state the join silently loses branches.
- [ ] Is the repo-wide list bounded? A long-lived repo may have thousands of
      PRs, and paging turns one request back into N. Measure before assuming.
- [ ] Should the cadence be configurable per host, or derived? Derived is
      honest and invisible; configured is predictable and can be wrong.

## Branches

### Shape

- `bug/the-scan-joins-one-pr-list` — `plot-fleet-scan.sh` resolves branch PR state from one `pr-list` response joined locally, instead of `host_pr_state()` per branch. The no-ref lookup from #216 stays, bounded by absent branches. Tests: a scan over N branches makes a constant number of host calls, asserted by counting invocations of a stubbed host — the measured failure is 39 calls for 14 branches, so a test that does not reproduce that against the unchanged script is not testing this; a failed list still reads as failure and never as "no PR"; the three-way state vocabulary is unchanged per branch. PR #232.

### Cadence

- `feature/the-board-renders-what-has-arrived` — the scan emits its results as they resolve rather than as one document at the end, and the board renders each row with the sources it has, marking the rest as not-yet-arrived. Measured: git alone is 12.7 s on 84 branches, so even a perfect host fix leaves a wait worth filling. Tests: a row renders from plan facts before any git fact exists; a badge whose source has not arrived is absent rather than zero or guessed; a completed scan renders identically to today's; a scan that fails midway keeps what arrived and says the rest is unknown, rather than discarding the partial result.

- `feature/a-terminal-branch-is-asked-once` — branches in a terminal state (`merged`, `deferred`, and branches of `Released` plans) are asked about once and cached, while live ones are re-derived every pulse. The cache is validated against git on every pass and discarded the moment git contradicts it — a reappearing ref, an edited plan, a new commit — so it stays a derivation rather than a record. Measured: 56 of 84 branches here are terminal, so 67% of the host work asks about facts that cannot change. Tests: a merged branch costs one host call across many pulses; a merged branch whose ref reappears is re-asked on the next pulse; an edited plan invalidates its branches' cached answers; a live branch is never cached; the cache never outlives the process, so a restart re-derives everything.

- `bug/the-cadence-knows-what-a-refresh-costs` — the board's PR refresh accounts for the configured host's per-refresh cost rather than assuming one request. Tests: a Bitbucket-configured board makes measurably fewer requests per hour than the naive cadence; a GitHub-configured board is unchanged; the rate-limit backoff already in `fleet.ts` still holds for its full delay.

## Notes

Both halves were reported as issues by the operator who hit them (#228, #226)
with counts, timings and line numbers already in place. This plan adds the
ordering and the shared cause; the measurements are theirs.

Related: `docs/plans/2026-08-18-not-yet-asked-is-not-nothing.md` fixed the
board's *display* of stale host data. This fixes how much of it is asked for.
