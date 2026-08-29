# A throttled host says so

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, branch -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Approval

- **Assignee:** Jan Wloka

## Changelog

A fleet scan that could not reach the git host says so, instead of reporting
every branch as unmerged and looking like a quiet estate.

## Motivation

### Measured 2026-08-29, on a merged PR

`#513` was merged. Minutes later the scan reported:

```
  Reading — eligible
      infra/the-domain-names-a-slice — open      ← merged, and the ref is deleted
summary: … eligible=1 blocked=2 … merge_detect=pr-merge
```

**Nothing in that output is a warning.** `merge_detect=pr-merge` reads as *the
host was asked and answered*; the branch reads `open`; the summary counts it
among the unfinished. The truth was that `plot-host.sh pr-list` had returned

```
GraphQL: API rate limit already exceeded for user ID 870334.
```

and the scan swallowed it.

### The degradation is right; the silence is not

**The scan's direction is correct and must not change.** `plot-pr-merged.sh`
states the rule: *"An unreachable host answers not merged, so silence is never
permission."* A scan that guessed `merged` from a failed call would settle waves
on work that never landed.

**What is missing is the report.** The estate has a name for this shape — a
signal computed and consumed by nobody — and W36 was written about it. Here the
signal is not even computed: the failure is discarded at the call site.

### Why it bites harder than a one-off wrong row

`pr-list` is **one GraphQL call in place of ~186 REST calls**
(`plot-host.sh:363`), a deliberate and good trade. Its consequence is that
GraphQL throttling takes out **every** PR answer at once rather than degrading
row by row. So the whole fleet reads unmerged, every wave stays blocked, and the
board shows a busy estate with nothing eligible — indistinguishable from work
genuinely in flight.

**And REST is a separate bucket.** Measured the same afternoon: `gh api
repos/…/pulls/513` answered `merged=true` while GraphQL was refusing. The data
was reachable; only the path being used was not.

## Design

### The scan reports what it could not ask

`plot-host.sh` already has the vocabulary — exit 4 for *cannot be asked* — and
`PortResult<T>`'s third outcome (`unaskable`) is the domain's name for it. This
plan does not invent a mechanism; it connects one that exists to an output that
does not carry it.

Three surfaces, in order of how much they mislead today:

1. **The scan's summary line** gains `host=ok|throttled|failed`. A reader who
   sees `host=throttled` knows the merge answers are unreliable without reading
   further.
2. **Each affected row** says the answer is unknown rather than `open`. `open`
   is a claim about a PR; when no PR could be read, the honest word is different.
3. **The board** renders the degradation. It already renders `prError`; this is
   the same shape one level up.

### Not chosen: fall back to REST automatically

Tempting — the data *was* reachable. Rejected as this plan's content because it
turns a reporting fix into a second host path with its own pagination,
truncation and cost profile, and `pr-list`'s whole design is the batched call.
**A fallback is a plan of its own**, and it needs the reporting first: without
it, a silent fallback is just a slower silence.

### Not chosen: retry with backoff

Same objection, plus it hides duration. A scan that takes four minutes because
it is waiting out a limit looks like a slow scan, and the board's 90 s budget
would kill it mid-answer.

## Waves

### Reporting (Branch: bug/the-scan-says-it-could-not-ask)

`plot-host.sh` distinguishes *asked and answered* from *could not ask* on the
`pr-list` path, and `plot-fleet-scan.sh` carries that into its summary line and
its rows.

Tests: a stubbed host that exits with a rate-limit error produces
`host=throttled` in the summary and leaves no row claiming `open`; a healthy
host still produces `host=ok` and byte-identical rows to today.

### Rendering (Branch: bug/the-board-shows-a-throttled-host)

The board renders the degraded state, beside the existing `prError` treatment.

Tests: a pulse carrying `host=throttled` renders the notice; a pulse without it
renders exactly as today.

## Done when

1. **A scan that could not reach the host says so in its summary**, and the word
   distinguishes *throttled* from *failed* — they need different responses.
2. **No row reads `open` when its PR could not be read.** `open` is a claim
   about a PR that was seen.
3. **A healthy scan is byte-identical to today.** This is a reporting change;
   any moved verdict is a regression, and `--next` picks branches to claim from
   this output.
4. **The degradation direction is unchanged** — an unreachable host still
   answers *not merged*. Asserted, not assumed: the existing test that pins it
   must still pass unedited.
5. `pnpm test`, `pnpm run test:board`, `pnpm run test:reconcile` green.

## Notes

Found while waiting for a merged PR to clear the fleet. The scan was correct
about everything it could observe and silent about the one thing it could not —
which is the failure mode that costs the most, because it looks like data.
