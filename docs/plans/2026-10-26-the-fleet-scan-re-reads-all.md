# The fleet scan re-reads all PRs every two minutes

> Each fleet scan lists every PR of the repository, merged ones included, about every two minutes. This plan makes an idle scan ask the host only for what can have changed, and read merged PRs from the PR index.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2720
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- An idle fleet scan no longer lists every merged PR of the repository on each pass; it reads merged PRs from the PR index and asks the host for the open ones.

<!-- Board impact: none expected. The plan format and the board payload do not change. If the slice changes the bundle the board runs, rebuild the board artifact (pnpm build:board). -->

## Motivation

`plot-fleet-scan.sh:1063` runs `pr-list --state all --limit 3000` on each scan. On 2026-10-26 the repository held 1,767 PRs (1,711 merged, 3 open), counted with one GraphQL `totalCount` query. At 100 PRs per page one call is about 18 GraphQL pages. With about 25 scans per hour, an idle fleet spends about 450 GraphQL requests per hour on this listing. The spend record shows about 25 lines per hour, because it writes one line per `gh` process (#2717).

The request figures derive from page counts. They are not measured per call. The source is the cost juror's verdict in the #2716 panel (`.plot/panels/2026-10-26-an-idle-board-and-fleetd-spend/cost.md` on `idea/an-idle-board-and-fleetd-spend`).

After #2716 removes the calls of the nothing-done step, this listing is the largest idle GraphQL spender. #2716 does not cover it.

## Design

### Approach

The expected behaviour, from the issue: an idle scan asks the host only for what can have changed since its last read, or reads terminal answers (MERGED rows) from the PR index that fleetd already writes.

Two existing mechanisms bear on the design:

- `board/plot-pr-index-lookup.mjs` reads MERGED rows from the PR index through `decodePrIndex`. `plot-impl-status.sh` (#1020) and `plot-reconcile-scan.sh` (#1022) already use it. `plot-fleet-scan.sh` does not.
- `pr-refresh.ts` is the only writer of the index (`foldPrIndex`). The scan stays a reader.

Constraints from the section *A Decision Reads The Index*:

- Only MERGED rows come from the index. OPEN, CLOSED and draft rows go to the host.
- The index never answers `pr: 'none'`. A missing store, row or bundle means: ask the host.
- The scan lists open PRs with the first call (`--state open --rich`). The second call (`--state all`) is the one this plan shrinks.

### Open Questions

- [ ] Which shape asks the host less: a second call limited to the branches the scan tracks and the index lacks, or a call that lists only PRs updated since the last read? Measure the page count of each against the 1,767-PR repository before choosing.
- [ ] Does the Bitbucket arm of `pr-list` support the chosen shape? The GitHub figures above do not transfer; Bitbucket pages 50 PRs per state.
- [ ] A scan on a machine without a fleetd, or with a store of another `PR_INDEX_VERSION`, falls back to the full listing. Does that fallback need a visible note in the scan output?
- [ ] #2716 changes the idle calls of the same cadence. Does this plan wait for #2716 to merge, or do the two touch separate code?

## Slices

### Index first

- `feature/the-idle-scan-reads-merged-prs-from-the-index` — `plot-fleet-scan.sh` answers merged branches from the PR index and asks the host about the rest; a test shows an idle scan over a fully merged store makes no `--state all` call. <!-- builds: a PR-index read in plot-fleet-scan.sh, through board/plot-pr-index-lookup.mjs -->

## Notes

- Related plans: `2026-10-23-one-pr-reader-per-machine-and` (Approved, #2386) gives the boards one reader of the host. `2026-10-16-fleetd-scan-cost-and-read-cadence` (Released, #1845) cut other scan reads.
- The deliverable search found `plot-pr-index-lookup.mjs` and its two shell callers. It found no existing scan read that answers from the index.
- Created unattended from issue #2720. The plan writes nothing to the tracker.
