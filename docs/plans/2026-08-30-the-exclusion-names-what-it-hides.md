# The exclusion names what it hides

> The adapter coverage exclusion shrinks to what a mock cannot simulate, and what stays excluded is named.

## Status

- **Phase:** Released
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-31
- **Released:** 2026-09-05, 2.13.0
- **Started:** 2026-08-31, Jan Wloka, `infra/the-adapters-are-measured`

## Approval

- **Assignee:** Jan Wloka

## Changelog

`src/adapters/**` leaves the coverage exclusion. What genuinely cannot be
simulated is excluded by name, with the reason beside it, and everything else is
measured.

## Motivation

### The sprint goal asks for this and no plan carried it

> *Mock coverage is what makes the second condition reachable at all. The domain
> package holds 100% thresholds today, but `src/adapters/**` is excluded, on the
> argument that its uncovered branches need a host to fail or a disk to be full.
> **A mocked host can fail on demand**, so that exclusion shrinks to whatever
> genuinely cannot be simulated — and what remains excluded has to be named
> rather than assumed.*

Twelve plans are in this sprint. `the-domain-runs-the-workflows-in-a-sandbox`
builds the mock adapters; **none of the twelve touches the exclusion**, so the
condition the goal calls *"what makes the second reachable at all"* had no owner.

### Measured 2026-08-30: the adapters are already tested, and nobody knows it

Lifting the exclusion and running the existing suites — no new tests, thresholds
set to zero, purely to read the number:

```
All files                94.00 lines  82.80 branches

src/adapters/run-script  100.00       85.00
src/adapters/machine      93.33       85.71
src/adapters/plan-store   90.90       50.00
src/adapters/trees        87.50       72.22
src/adapters/processes    70.00       58.33
src/adapters/refs         65.51       40.00
src/adapters/host         57.50       12.24
src/adapters/clock        50.00        0.00
```

**Four test files already exercise adapters** — `ports-real-state.test.ts`,
`run-script.test.ts`, and both corpus suites. Their work does not appear in any
report, because the directory is excluded.

**So the first act is a measurement, not a campaign.** 1056 lines across nine
files were assumed uncovered and are 94% covered by lines.

### Where the real gaps are, and they are not evenly spread

`host-shell.ts` at **12.24% branches** and `clock-system.ts` at **0%** are the
outliers. Both are exactly the case the goal names: a host that refuses, a clock
that jumps. **A mocked host can fail on demand** — which is the argument the
exclusion was resting on, inverted.

## Design

### The exclusion becomes a list with reasons

`src/adapters/**` is one line hiding nine files of varying testability.
Replacing it with named entries makes each one a claim someone can dispute:

```ts
exclude: [
  'src/index.ts',
  // <path> — <what cannot be simulated, in one line>
]
```

**An entry with no reason is a defect.** The goal's wording is *"named rather
than assumed"*, and a path list without reasons is the same assumption in a
longer form.

### Thresholds follow the measurement, not the other way round

The package holds 100% today because it measures only what is easy to cover.
**Set the adapter threshold to what the suite actually reaches once the gaps
below are closed**, and let it ratchet. A threshold nobody can meet gets
excluded again in six weeks.

### Not chosen: cover everything to 100%

Some branches need a disk to be full or a signal to arrive mid-write. The goal
does not ask for 100% — it asks that what remains be **named**.

### Not chosen: leave it and add a comment

The exclusion's argument is already written in the config. What is missing is
the measurement that tests it, and a comment does not produce one.

## Slices

### Measuring (Branch: infra/the-adapters-are-measured)

Lift the exclusion, replace it with a named list, set thresholds to what the
suite reaches today.

**Done when** `src/adapters/**` no longer appears as a blanket exclusion; every
remaining entry names one path **and its reason**; `pnpm --filter @plot-pm/domain
test` is green with thresholds that hold; and the PR states the numbers before
and after so the ratchet has a starting point.

**No new tests in this slice.** It reports what exists. Mixing measurement with
new coverage means a reviewer cannot tell which number came from which.

### Covering (Branch: infra/a-mocked-host-fails-on-demand)

Close the two outliers with mocked failures: `host-shell.ts` (12.24% branches)
and `clock-system.ts` (0%).

**Done when** a mocked host that refuses, times out and returns malformed JSON
each drives its own branch; the clock's paths are exercised without waiting for
real time; and **the exclusion list shrinks by whatever these cover**, with the
threshold raised to match.

**The assertion that matters is the shrink.** New tests that leave the exclusion
list unchanged have improved a number without changing what the package claims
about itself.

## Done when

1. No blanket `src/adapters/**` exclusion.
2. Every excluded path names its reason.
3. The threshold is met by the real suite and stated in the PR.
4. `host-shell.ts` and `clock-system.ts` are no longer the outliers.
5. `pnpm test`, `pnpm run typecheck`, `pnpm --filter @plot-pm/domain test` green.

## Notes

Cut 2026-08-30 after reviewing the sprint goal against its twelve plans. The
first two conditions had owners; this one did not.

**The measurement that motivates it was taken by lifting the exclusion in place
and restoring it** — the config is unchanged on main, and the numbers above are
reproducible in one command.
