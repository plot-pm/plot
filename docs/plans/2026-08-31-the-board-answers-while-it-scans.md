# The board answers while it scans

> The board stops serving for seconds at a time because it recomposes the whole
> fleet document on every streamed scan line, on the thread that answers HTTP.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- The board keeps answering while a fleet scan is in flight, instead of freezing
  for seconds at a time and showing "No contact with the board server".

Board impact: this IS the board. `packages/board/src/server/fleet.ts` only; the
plan format, the template, the helper scripts and the `docs/plans` layout are
untouched. The artifact needs rebuilding (`pnpm build:board`).

## Motivation

The board periodically shows *"No contact with the board server for N polls"*,
dims its controls, and then recovers on its own. Measured 2026-08-31.

**It is not a leak and not a crash.** RSS is flat at 360–387 MB across 78
samples, 2 plot processes, 37 FDs, and the process never dies.

**The discriminating measurement** — six requests for `/`, a STATIC FILE, back
to back:

```
3630ms   2ms   1.7ms   1.5ms   1.4ms   1.5ms
```

The first waits 3.6 s; the rest answer in ~1.5 ms. **A static file cannot wait
on a fleet scan** — it waits on the event loop. So the board is not slow; it is
periodically *blocked*, and everything arriving in that window queues behind it.

Sampling `/` once a second for 40 s gives the shape:

- blocks of **1.5–5 s**, arriving every **~8 s**
- a two-stage pattern: a long block, then a shorter one ~2 s later
- unblocked roughly 60–70 % of the time

The browser overlay follows mechanically: the client polls on a timer, lands in
blocked windows repeatedly, and after enough consecutive timeouts declares no
contact. It recovers because nothing was ever broken.

**A sampling artifact to avoid repeating.** A 5-second probe reported a "2571 ms
average response". That average is an artifact of landing inside blocks — it
describes the sampler, not the server. Measure with back-to-back requests.

## Design

### What the cause is NOT

**The streamed scan is not the blocker, and this plan first said it was.**
Corrected 2026-08-31 from the probe's own data, 238 samples:

| | slow (>3.5 s) | total | rate |
|---|---|---|---|
| no scan running | 12 | 53 | **23 %** |
| scan running | 15 | 185 | **8 %** |

The board is **three times more likely to stall when no scan is running**. The
first version of this plan named `publishPartial()` — which recomposes the whole
fleet document on every arriving scan line — as the cause. That code is still a
real inefficiency and worth fixing, but it cannot be this, because the stalls
concentrate where it does not run.

**Memory does not predict a slow SAMPLE** — slow samples average 381 MB RSS,
fast ones 380 MB — but **it does grow, and the growth is steep.**

Corrected 2026-08-31: a restart put RSS at **80 MB**, against **419 MB** on the
process it replaced after 1h38m, and the fresh process reached **222 MB within
one minute**. The earlier "RSS is flat" reading was taken over one-minute
windows and measured a plateau, not a trend.

So memory is not what makes any single request slow, and it is still a real
growth to explain. The two questions are separate and both open.

So what is measured and certain is the SYMPTOM: the event loop is blocked in
bursts of 1.5–5 s, roughly every 8 s, and a static file is as slow as an API
route during one. What blocks it is **not yet identified**.

### The growth, measured from a clean start

A restart gave the cleanest reading available: one process, watched from its
first second.

| | RSS |
|---|---|
| at start | **78 MB** |
| 55 samples later (~5 min) | **336 MB** |
| the process it replaced, after 1h38m | **419 MB** |

**4x in five minutes**, then flattening toward ~420 MB. That is why the earlier
one-minute windows read as "flat": they sampled the plateau, not the climb.

13 % of those 55 samples were slow (>3.5 s), so the board is degraded from early
in its life rather than only after hours.

**Two questions, still separate.** Memory does not predict a slow SAMPLE
(381 MB slow vs 380 MB fast, measured over 238 samples of the previous
process). But something retains, and the first outage sample showed
`plot-plan-meta.sh` churning with unreaped zombies — a plausible shared cause
for both, and not yet established as one.

### What the first outage sample says

**Measured 2026-08-31 15:41:42, the first UNREACHABLE sample** (not merely
slow — `http=000` after a 10 s budget, and still dead 15 s later):

```
pid=99533  rss=416752KB  cpu=0.0  children=2  scan=yes
```

**`cpu=0.0` while unreachable.** The board was not computing; it was WAITING.
That rules out a synchronous compute burst — including `publishPartial()`, this
plan's original suspect — and points at process I/O.

`ps` on its descendants during the outage:

```
71884  <defunct>
74127  <defunct>
75143  bash .../plot-plan-meta.sh /var/folders/g0/...
```

**Two zombies and a live `plot-plan-meta.sh`.** Sampled every 2 s, the pattern
holds: a continuous churn of `plot-plan-meta.sh` spawns with unreaped children.

That is one process **per plan file**, which is precisely what
`packages/board/test/plan-read-shape.test.mjs` forbids for the estate read —
*"spawns plot-plan-meta.sh ONCE for the whole estate"*, whose own comment prices
the alternative at **~8 s on this repo's estate**.

So the next question is narrow: **which board path spawns `plot-plan-meta.sh`
per file, and why is the contract test not catching it?** The test covers
`/api/board`; something else on the refresh path evidently does not go through
the batched read.

### Approach — find the blocker before fixing one

The static-file measurement bounds the search: whatever runs is **synchronous on
the main thread**, in bursts, and is not the scan. Candidates, in the order they
can be cheaply ruled out:

1. **The PR refresh** (`PR_REFRESH_MS`, 60 s) and whatever it does with the
   host's answer — a 60 s timer cannot produce an 8 s period, but its
   *processing* may be one of two interleaved sources.
2. **The registry / manifest read** — per-agent file reads on every pulse.
3. **Anything the board derives per request** rather than per refresh.

**The first branch is instrumentation, not a fix.** An event-loop lag probe
inside the server (`monitorEventLoopDelay`, or a `setInterval` measuring its own
drift) records WHAT was running when a stall began. This plan asked for a fix
before it had that, which is how it got the cause wrong.


Publish on a **schedule**, not per line. Accumulate arriving plans and compose
at most once per interval (and once on the terminal line), so the number of
recompositions stops scaling with the number of plans.

Two properties the current code establishes and this must not lose:

- `pulseComplete` stays false for every partial, so a consumer can tell a
  partial from a finished answer
- `summary` is RECOUNTED from the plans actually present, never carried over —
  a summary describing 24 plans beside 3 plan rows is a measurement of one
  document presented as a measurement of another

### Open Questions

- [ ] What publish interval? It must be short enough that the board still reads
      as streaming and long enough that recomposition stops dominating. The scan
      runs ~18 s and the client polls at 5 s, so the answer is bounded by both.
- [ ] Is composition itself worth making incremental (a keyed map rather than
      filter-and-concat), or does batching alone bring the block under the
      threshold? Measure before adding the complexity.

## Branches

### Measuring

- `bug/the-board-times-its-own-loop` — an event-loop lag probe in the server
  that records the stall AND what was running when it began. This is the whole
  first branch, and it comes first because the plan's original cause was wrong
  and only a measurement would have caught that.

### Answering

- <!-- deferred: named once the probe says what blocks. Writing this branch now
     would repeat the mistake this plan already made once. -->

## Done when

- The server records event-loop stalls with what was running at their start, and
  a stall of >1 s is attributable to a named call rather than inferred.
- The 8 s period and the 1.5–5 s duration are explained by that record — or
  shown to be something else, in which case this plan is corrected again.
- Only then: a fix, and `/` answers in tens of milliseconds while the board is
  under its normal load, measured **back to back** rather than on a timer.
- `pnpm build:board`, `pnpm run test:board`, `pnpm run typecheck`, changeset.

## Notes

**This plan named the wrong cause once.** Its first version blamed
`publishPartial()`'s per-line recomposition, which was a reading of the code
rather than of the data. The probe's own samples then showed stalls are three
times MORE likely when no scan is running. The measurements were right and the
inference was wrong — which is why the first branch is now a probe.

Ruled out, with measurements, so they are not re-investigated:

- **memory, process and FD leaks** — RSS flat over 78 samples; 2 plot processes;
  37 FDs
- **`execFileSync('git', ['worktree', 'list'])` and `git branch --show-current`
  in `fleet.ts`** — both measure 0.00 s against 21 worktrees
- **the 5 s scan timer and the 60 s PR timer** — the observed period is ~8 s,
  which is neither
- **the streamed scan itself** — stalls are 23 % of samples with no scan running
  against 8 % with one (238 samples)
- **memory pressure** — slow samples average 381 MB RSS, fast ones 380 MB
