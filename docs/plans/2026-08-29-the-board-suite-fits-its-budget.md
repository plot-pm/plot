# The board suite fits its budget

## Status

- **Phase:** Rejected
- **Type:** infra
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

> **REJECTED 2026-08-29, hours after being written — the diagnosis was wrong.**
>
> This plan read "the suite has outgrown its 15-minute budget" from the last
> line of a failed CI log. The failing lines said something else: **21 tests
> dying at exactly 30001ms**, every passing one at 200–9000ms. That uniformity
> is not a size problem — an assertion failure takes as long as the assertion,
> so identical durations mean Playwright waiting for a locator that never
> resolves.
>
> **The cause was three stale selectors.** #516 renamed the Board tab to Plans
> and changed no test file; `getByRole('button', { name: 'Board' })` then waited
> out its 30 s timeout, 21 times, which is 10.5 of the 15 minutes. **The job
> timeout was the consequence.** Fixed in #519: `agents-tab` went 12 failed →
> 111/111, `unreachable-overlay` 9 failed → 25/25.
>
> **Kept rather than deleted, because the mistake is the lesson.** I read a
> summary line instead of the failure lines and wrote a plan proposing to
> measure, shard or re-budget a suite that was not slow. The operator's question
> — *"es ist vermutlich kein Timeout, wir müssen die Selektoren fixen"* — is
> what turned it around.
>
> **What may still be true**, and needs its own measurement rather than this
> plan's assumptions: whether a healthy suite has comfortable margin inside 15
> minutes. Measure that on a green main first; do not inherit the numbers below,
> which were taken while a fifth of the suite was timing out.

## Changelog

CI's board-integration step finishes inside its budget, so a red build means a
failing test again rather than a slow one.

## Motivation

### Measured 2026-08-29: a quarter of main's builds fail, and no test does

```
last 18 completed runs on main:   12 success, 5 failure, 1 cancelled
the failure, every time:          "The action 'Board integration tests
                                   (vitest + Playwright)' has timed out
                                   after 15 minutes."
tests that failed in those runs:  none
```

**Every visible line in a failed log is a ✓.** The job is killed mid-suite,
after reporting hundreds of passes, because `timeout-minutes: 15`
(`.github/workflows/ci.yml:209`) expires — not because anything is wrong.

### Why this is worse than a slow build

**It makes CI unreadable, and it does so silently.** A branch whose CI goes red
looks like a branch with a defect. Measured today on
`feature/the-entities-carry-their-states`: the merge was refused, the branch
rebased and re-verified locally — 166 tests, 100% coverage, three gates green —
and the second run timed out in exactly the same place. **Half an hour spent on
a branch that was never broken.**

**And it is indistinguishable from the real thing at a glance.** The remedy for
a genuine failure is to read the log; here the log's last line is the only line
that matters, and everything above it says the code is fine.

**It also defeats the merge discipline this repo relies on.** A merge waiter
that pins CI's sha and refuses on non-success is correct — and against a
1-in-4 flake it refuses correct work a quarter of the time, which trains an
operator to merge past it.

### The suite has grown, and the budget has not

43 browser-test files under `packages/board/test/integration/`. The step's
budget has been 15 minutes throughout, while the file count and the work per
file both rose — `story-overlay.browser.test.ts` alone is 12 tests and 4.9 s.

**This repo already knows the shape.** `board-suite-starves-when-files-are-added`
records the same failure and its own remedy: *"bound `--test-concurrency`, don't
raise timeouts."* The lesson was learned for the unit suite and not applied here.

## Design

### Measure before choosing, because the obvious fix is the wrong one

**Raising `timeout-minutes` is the tempting move and the one to refuse first.**
A budget raised to fit an overrun hides the next regression rather than
reporting it — the same argument `fleet.ts` records for its own 90 s scan
budget, which was refused twice while the scan was 279 s.

So the first slice **measures**: which files dominate, whether the cost is
startup or assertions, and whether the runner is starving itself by launching
more browsers than the CI box has cores. The measurement decides between:

- **bounding concurrency** — the remedy the estate already found for the unit
  suite, and free if the box is oversubscribed
- **sharding the step** — two jobs of ~7 min, if the cost is genuinely the
  volume of work rather than contention
- **raising the budget** — only if the work is irreducible AND the measurement
  says so, and then by a stated margin over the measured cost rather than to
  whatever number makes it pass

### Not chosen: mark the step `continue-on-error`

It would turn the red build green and destroy the signal entirely. The suite
catches real regressions — that is why it exists.

## Waves

### Measuring (Branch: infra/the-board-suite-reports-its-cost)

Instrument the step so a run states where its time goes: per-file durations in
the log, the total, and the runner's concurrency against the box's core count.

Tests: a CI run prints a per-file cost table; the numbers are reproducible
locally within the same order of magnitude.

### Fitting (Branch: infra/the-board-suite-lands-inside-fifteen)

Apply whichever remedy the measurement selects, and state in the workflow file
which one it was and why.

Tests: ten consecutive runs on main complete inside the budget; the step's
duration is recorded in the file's comment so the next reader can see the margin
it was chosen with.

## Done when

1. **Ten consecutive main runs finish inside the budget** — one green run proves
   nothing against a 1-in-4 flake.
2. **The workflow file states the measured cost and the margin.** A budget with
   no recorded basis is the one that gets raised again next time.
3. **No test is skipped, sharded away or marked `continue-on-error`.** The suite
   must still fail on a real regression — asserted by making one fail
   deliberately.
4. **If the remedy is a raised budget, the plan says why the other two were
   rejected**, with the numbers.
5. `pnpm test`, `pnpm run test:board` green.

## Notes

Found by a merge that CI refused twice on a branch that was never broken. The
waiter behaved correctly both times; the signal it was reading did not.
