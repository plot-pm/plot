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

### The cause

`refreshFleet` in `packages/board/src/server/fleet.ts` consumes
`plot-fleet-scan.sh --stream` and calls `publishPartial()` **once per arriving
plan line**. Each call:

- builds a `Set` over every plan arrived so far
- filters the previous plan list against it
- concatenates both
- recomputes `partialSummary(plans)` over the whole collection

and `mergePlan` copies the entire array on every line as well. With ~24 plans
that is ~24 full recompositions per scan, each O(n) over a growing list, all
synchronous on the thread that serves requests.

**The intent is right and must be kept.** The composition exists so a streaming
board does not flicker — at line one the tab would otherwise drop 23 of 24 plans
and grow them back, which reads as losing the fleet rather than refreshing it.
The defect is the *cadence*, not the composition.

### Approach

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

- `bug/the-board-answers-while-it-scans` — a test that fails on the current
  cadence: assert the event loop is not blocked beyond a bound while a scan is
  in flight. This is the gate; without it the fix is unfalsifiable.

### Answering

- `bug/the-partial-publishes-on-a-schedule` — batch `publishPartial` behind an
  interval, keeping `pulseComplete: false` and the recounted summary.

## Done when

- A test holds the event loop's stall under a stated bound during a scan, and
  fails against the current per-line cadence.
- Requesting `/` while a scan is in flight answers in tens of milliseconds, not
  seconds — measured back to back, not on a timer.
- The board still streams: plans appear as they arrive and none is dropped and
  regrown.
- `pulseComplete` is false for every partial; `summary` matches the plans in the
  same payload.
- `pnpm build:board`, `pnpm run test:board`, `pnpm run typecheck`, changeset.

## Notes

Ruled out, with measurements, so they are not re-investigated:

- **memory, process and FD leaks** — RSS flat over 78 samples; 2 plot processes;
  37 FDs
- **`execFileSync('git', ['worktree', 'list'])` and `git branch --show-current`
  in `fleet.ts`** — both measure 0.00 s against 21 worktrees
- **the 5 s scan timer and the 60 s PR timer** — the observed period is ~8 s,
  which is neither
