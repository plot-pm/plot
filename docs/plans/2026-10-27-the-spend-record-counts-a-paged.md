# The spend record counts a paged listing as one request

> `budget_record_call` writes `spent=1` for every `gh` process, so a paged `pr-list` that makes 5 to 18 GraphQL requests records one. This plan makes the record carry the page count, so `localSpenders`, the cadence stretch and `mine=` read the real spend.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2717
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-host.sh` records the number of requests a paged `pr-list` makes in the `spent` field of its `budget.tsv` line, instead of `1`, so every reader of the record sees the real GitHub spend of a listing.

<!-- Board impact: none expected. The line format (`b1`, ten fields, `spent` already a number) does not change, and the board reads `budget.tsv` through the same decoder. The plan format, the template, the docs/plans layout and the helper-script table are untouched. To confirm in the slice: no board test pins `spent` to 1 for a `pr-list` line. -->

## Motivation

`budget_record_call` (`skills/plot/scripts/plot-host.sh:3651`) calls `budget_append … 1 …` on both of its paths, so every line records `spent` 1 per `gh` process. The format already allows more: `packages/domain/src/entities/budget.ts` defines `spent` as "how many calls this line accounts for" and defaults it to one in its constructor. Only the shell writer never writes anything else.

A paged listing is one process and several requests. Issue #2717, measured 2026-10-26 from `ps` samples against `budget.tsv` during the #2715 investigation:

| Caller | Operation | Requests | Lines recorded |
|---|---|---|---|
| fleetd tick `mergedBranches` (`registryd-main.ts:791`) | `pr-list --state merged --limit 500` | about 5 GraphQL pages | 1 |
| fleet scan (`plot-fleet-scan.sh:1063`) | `pr-list --state all --limit 3000` | 10 or more GraphQL pages | 1 |

[`an-idle-board-and-fleetd-spend`](2026-10-26-an-idle-board-and-fleetd-spend.md) states its rates in lines and, where they differ, in requests, and names this plan's issue as the reason. Its figure of about 610 GraphQL lines per hour is therefore a lower bound on the requests.

Every reader of the record reads the GitHub GraphQL spend low by the page count of each paged listing: `localSpenders`, the cadence stretch that subtracts a gate's spend from the PR pass's rate, and `mine=` on the fleetd tick line.

## Design

### Approach

The record counts requests, and each line carries the number it covers. The line format stays as it is: `spent` is the field, and the decoder and every reader already sum it.

1. **Name the page count where the listing is made.** `gh pr list --limit N` pages at `min(N, 100)` rows per request, so a listing that returns R rows made `max(1, ceil(R / pagesize))` requests. This is a derived count, not a harvested one: `gh` prints no page count, and the rate-limit headers it harvests describe the last response only. The slice states the derivation in the code comment and tests it against a fake `gh` that returns 0, 99, 100, 101 and 500 rows.
2. **Write it through the existing path.** `budget_record_call` takes an optional fourth argument, the request count, and passes it to `budget_append` in place of the literal `1` on both paths. Every other caller passes nothing and still records `1`.
3. **Count the paged `pr-list` forms only.** `pr-list` is the one listing the issue measures. `issue-list` pages through its own `--page-token`, one request per call, and stays at `1`. Other `gh` calls stay at `1`.
4. **Keep Bitbucket and Jenkins at one.** Their calls are single requests, and the page count of a paged Bitbucket listing is a separate question (see Open Questions).

### Readers

No reader changes its code. Their values change, and two thresholds read them:

- `mine=` on the fleetd tick line (`mine=60/hr` measured 2026-10-26) rises by about 4 per tick for the merged listing and 17 for the all-PR listing at the repository's 1,767 PRs. The slice records the before and after in its commit message.
- The PR pass's cadence stretch subtracts the gate's spend from its own rate. With the real count it stretches earlier. The slice names the new steady-state rate from a sample, so that the stretch is a measured consequence and not a surprise.

### Open Questions

- [ ] Is the derived count (`ceil(rows / pagesize)`) acceptable, or does the slice need `gh api graphql --paginate` with a per-page counter? Derivation is exact when the listing is full and over-reports nothing when it is short, but it assumes `gh`'s page size stays 100.
- [ ] Does a paged Bitbucket listing (`pr-list`, `issue-list`) make more than one request per call, and does it need the same count?
- [ ] Do existing records stay as they are? Lines before the change keep `spent` 1 and the window sums mix both for one hour. This plan assumes yes, because the record is append-only and windowed.
- [ ] Does any test or gate pin the `spent` of a `pr-list` line to 1 (`test/reconcile/*budget*`, `packages/domain/corpus/`)? The slice finds them before it changes the writer.

## Slices

### Page count

- `feature/the-spend-record-counts-a-paged` — `plot-host.sh` computes the request count of a paged `pr-list` and passes it to `budget_record_call`; contract tests cover the row-count boundaries and the unchanged `1` of every other caller <!-- builds: a request count on the spend record's paged lines -->

## Notes

- Created from issue #2717 by `/plot-idea`, unattended. The issue's request is the record counting each request or each line stating how many it covers; this plan takes the second form, because the line already has the field.
- Unattended defaults: `Review: pr` (the repository declares `Plan PRs: required`), `Impl: own branches`, `State: Draft` (no `Design: yes` line in the prompt).
- Deliverable search for "spend record page count" found only the existing `plot-budget.sh` spend-record comments and `slice-spend-record.ts`; nothing builds a request count. `slice-spend-record.ts` records agent turns, not host requests.
