# Supervisor tick's fleet scan reads Bitbucket live every 60 s and saturates the account; mine= hides it

> On a Bitbucket repository the supervisor's scan spends about 2,500 host calls per hour on an idle fleet, and the tick line reports `mine=60/hr`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2815
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The supervisor's Bitbucket scan reads PRs as a delta, the tick line's `mine=` counts the scan's calls, and a tick over the host's limit backs off.

<!-- Board impact: none for the plan format. A change to the scan's read path or the tick line touches no board contract; rebuild the board artifact (pnpm build:board) only if a slice changes a field the board reads from the scan stream. -->

## Motivation

Issue #2815 reports one machine on Plot 2.29.0 whose Bitbucket account ran at about 4,500 requests/hour against Bitbucket Cloud's about 1,000/hour. Every reader on the machine was throttled: the board banner *Fleet scan blind: the git host refused a burst*, `bb` retries and 429s.

- **Spend.** `~/.plot/state/budget.tsv`, bitbucket `quatico/api`, ten-minute buckets over the last hour: 386, 403, 794, 766, 570, 760.
- **Source.** A 90 s process sample attributed 62 `plot-host.sh` invocations to one fleetd (ewz-kus-portal, Bitbucket): `pr-list` 21, `pr-list --state open` 15, `pr-state` 15, `pr-list --state merged` 11. That is about 2,500 per hour. The boards made 0. In that repository 3 agents were free and the queue was empty.
- **The tick line.** The same fleetd printed `account=3664/hr mine=60/hr`.

The issue names four causes. Each needs checking against main before the plan commits to it:

1. **The scan reads live.** The tick runs `plot-fleet-scan.sh --stream` through `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts:547`). CLAUDE.md records that the delta fold of a carried listing (`scan-listing.ts`) serves GitHub only, and that the Bitbucket arm still sweeps for itself because the sweep needs `TRACKED_BRANCHES`, which only the shell computes. The measured Bitbucket spend is consistent with that.
2. **`mine=` undercounts.** `minePerHour` is `boardSharePerHour(intervalMs, calls)` (`registryd-main.ts:461`). It reads the daemon's own calls, not the scan subprocess's.
3. **No reader election.** Issue text says `electReader` has no caller. CLAUDE.md says `fleetPrs` elects under `ReaderLock` since `one-pr-reader-per-machine-and` (Released). The election covers the PR-index beat. It may not cover the scan's own reads, which is the open point.
4. **No per-tick budget.** The tick interval is fixed at 60 s. The tick line shows `account=` but nothing reads it to slow the tick.

## Design

### Approach

Three independent changes, ordered by how much each removes.

1. **Count the scan's spend in `mine=`.** First, because the other two need an honest figure to be judged against. The scan subprocess already goes through `plot-host.sh`, which records to `budget.tsv`. The tick attributes those entries to its own run, so `mine=` and `account=` agree when fleetd is the only reader.
2. **Read Bitbucket as a delta.** Extend the carried-listing fold to Bitbucket, or let the shell take the listing from the PR index. The constraint is `TRACKED_BRANCHES`: the sweep is per tracked branch, so the fold must name how a branch absent from the delta is handled. The existing rule applies: the index never says `pr: 'none'`, and a carried OPEN row absent from both answers refuses the fold and forces a full read.
3. **Back off over budget.** When `account=` exceeds the host's declared limit, the tick skips its host read and carries the last listing. The gate state already exists (`backoffUntil`, `nextAt`, issue and PR passes); the scan joins it instead of keeping its own cadence.

An idle fleet (free agents, empty queue) should make no host read beyond the cheapest delta call.

### Open Questions

- [ ] Does the scan's Bitbucket spend come from the sweep, from `pr-state` per branch, or both? Measure by `plot-host.sh` verb over one idle hour before slice 2.
- [ ] Is cause 3 still true on main? If `fleetPrs` election already covers the scan's reads, drop it from the plan; if not, name the second reader.
- [ ] Which limit does the back-off compare against: a configured value, or Bitbucket's response headers? The domain's connector contract says a connector answers what its limit is and how well it knows it.
- [ ] Does `mine=` count the scan's calls when a board, not fleetd, started the scan?

## Slices

### Implementation

- `bug/the-tick-line-counts-its-scan` — attribute the scan subprocess's host calls to `mine=` so the tick line names its own spend <!-- builds: scan spend attribution in the tick's spend report -->
- `bug/a-bitbucket-scan-reads-a-delta` — fold the carried listing with a watermarked delta on Bitbucket, as GitHub does <!-- builds: a Bitbucket arm of the carried-listing fold -->
- `bug/a-tick-over-the-limit-backs-off` — skip the tick's host read while the account is over the host's limit, and carry the last listing <!-- builds: a scan back-off on the account's spend -->

## Notes

- Created from tracker issue #2815 by `/plot-idea` on 2026-10-28. No approval and no implementation exist.
- Related: #2718, #2730, #2782, #2808. Workaround in use on the reporting machine: the ewz-kus-portal fleet is stopped.
