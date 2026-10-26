# An idle board and fleetd spend about 610 GitHub GraphQL requests per hour

> With no desk, worker loop or Claude session running, one board and one fleetd on the plot repository spent 4,966 GitHub requests in 8 hours. This plan finds which operations and which process spend them, then brings the idle rate to the cadence the code declares.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2715
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- An idle board and fleetd spend a measured, bounded number of GitHub GraphQL requests per hour.

<!-- Board impact: none known. A spend record that names its caller may add a column to `~/.plot/state/budget.tsv`; the board's budget reader is the consumer to check. -->

## Motivation

`~/.plot/state/budget.tsv` on 2026-10-26, measured over 24 hours:

| Connector | Account | Bucket | Requests in 24 h |
|---|---|---|---|
| github | jwloka | graphql | 16,456 |
| github | jwloka | core | 2,235 |

From 00:00 to 07:59 no desk, worker loop or Claude session ran. The record holds 4,966 GitHub lines for those 8 hours, about 610 per hour. Nearly all are `graphql`; `core` ran at 2 per hour. The running processes were one board (`board-server.mjs`, port 7777) and one fleetd, both on the plot repository.

The peak hour is 2,017 requests (2026-10-25 20:00). A 9-minute burst at 20:42–20:50 ran 96–236 requests per minute.

`PR_REFRESH_MS` is 60 s. A PR read on that cadence explains one request per minute; the record shows about 10. The operations, the caller, and whether the board still reads the host while fleetd owns the index are unknown.

### The record cannot split the baseline

Each line is `b1 <connector> <account> <bucket> <at-ms> <spent> ...`. No field names the caller or the operation. [2026-09-29-a-spend-line-names-its-caller](2026-09-29-a-spend-line-names-its-caller.md) proposed a caller field and is Rejected, so the baseline cannot be divided between the board and fleetd from the record alone.

### Related plans

- [2026-10-23-one-pr-reader-per-machine-and](2026-10-23-one-pr-reader-per-machine-and.md) (#2386, Approved) gives several boards one PR reader. It carries no measurement of the idle rate of one board, and #2715 is its baseline.
- [2026-10-16-fleetd-scan-cost-and-read-cadence](2026-10-16-fleetd-scan-cost-and-read-cadence.md) (Released) bounded the fleet scan's reads.
- [2026-10-01-a-shared-account-names-what-spends-it](2026-10-01-a-shared-account-names-what-spends-it.md) (Released) measured callers by instrumenting a process.

## Design

### Approach

1. **Measure first, without changing the record's format.** Attribute the idle 610 per hour to a process and an operation by running the board and fleetd one at a time on an otherwise idle checkout and counting `budget.tsv` lines per process. The rejected plan's lesson holds: the earlier diagnoses of #1059 and #1065 named the wrong caller, so the cause comes from a measurement and not from reading the code.
2. **Fix the largest caller.** The remedy is chosen after the measurement: a read the board repeats while fleetd owns the index, a per-PR GraphQL call inside the refresh, an issue or check read outside its cadence, or a 60 s read with no delta.
3. **Hold the idle rate with a test.** A test fixes the number of host calls one idle pass makes, so the rate cannot grow back unseen.

### Open Questions

- [ ] Which process and which operation spend the 610 per hour: board, fleetd, or both?
- [ ] Does the board read the host while fleetd owns the PR index?
- [ ] What caused the 2026-10-25 20:42–20:50 burst of 96–236 requests per minute?
- [ ] Does a caller field in the record answer the question for good, and is that worth reopening the rejected plan, or does a one-off measurement suffice?
- [ ] What idle rate does the plan accept as done?

## Slices

### Measurement

- `feature/an-idle-rate-is-attributed-to-its-caller` — attribute the idle GitHub request rate to the board and to fleetd by operation, from a run of each alone on an idle checkout; the result is a table in this plan's Notes <!-- spike -->

### Fix

- `feature/the-largest-idle-caller-follows-its-cadence` — bring the largest caller the measurement names under its declared cadence, with a test that fixes the host calls of one idle pass <!-- waits: feature/an-idle-rate-is-attributed-to-its-caller -->

## Notes

- Source: issue #2715, https://github.com/plot-pm/plot/issues/2715.
