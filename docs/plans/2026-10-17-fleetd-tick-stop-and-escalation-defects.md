# fleetd tick, stop and escalation defects

> Eleven open follow-ups against fleetd's tick, its stop path, its output and its escalations are fixed in six slices, each closing the members it names.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1846
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1965 merged
- **Started:** 2026-10-17, Jan Wloka, `bug/fleetd-tick-guard-and-escalations`
- **Started:** 2026-10-17, Jan Wloka, `bug/fleetd-once-and-channel-output`
- **Started:** 2026-10-17, Jan Wloka, `bug/fleetd-stop-starts-no-agent`
- **Started:** 2026-10-18, Jan Wloka, `bug/fleetd-unit-harness-findings`
- **Started:** 2026-10-18, Jan Wloka, `bug/refused-hold-names-its-reason`

## Changelog

- fleetd: `notifyEscalations` runs inside the tick guard, and `EscalationMemory` stays bounded.
- fleetd: a stop that arrives during a scan starts no new agent.
- fleetd: `--once` writes its whole output when stdout is a macOS pipe.
- fleetd: a brief that ended at the usage limit is asked again after the limit resets.
- Board and `/plot-fleet --status`: a refused hold names who refused it, why, and when.

<!-- Board impact: slice 6 changes what the board shows for a refused hold (packages/board and packages/domain). The other slices change fleetd, plot-fleetctl.sh and test files; no plan-format, template or docs/plans change. -->

## Motivation

Issue #1846 tracks eleven issues, each closed in favour of it after a triage of all open issues against `main` at `c40ac9e96` (2026-10-16). Each member's own thread holds its verdict and evidence. The list below records what the issue says stays open on `main`:

- #1306 — `notifyEscalations` runs outside the tick guard; `EscalationMemory` never prunes.
- #1456 — review follow-ups from #1455 (partial): M1 listing rate, L1 Bitbucket short `headSha`, L2 `mergedAt`, L3 drafts, L4 clock reads.
- #1508 — review follow-up from #1505 (partial): L2, read `Checks wait` once per repository.
- #1526 — channel retry and clock warning: newline, stop race, channel bound line, unchecked `over()` tests.
- #1539 — `fleetd --once` can cut its output on a macOS pipe (three bullets).
- #1577 — a fleet stop during a scan can start a new agent: skip the scan's after-step once stopping, shutdown-budget comment at `plot-fleetctl.sh`, a `warn`-throws guard in `fleet-clock.ts`, tests for a scan and PR refresh in flight and for a rejected scan.
- #1580 — an empty fresh `fleetd.log` reads as a fresh tick: decide whether it counts, and derive test bounds from the fixture.
- #1586 — the stop's estate check refuses a desk root through a symlink: resolve `wt_root` with `pwd -P`, pin two mutation cases, fix a test title and assert.
- #1590 — the unit runs its harness, review findings from #1589: M1 test, L1 quoting and `%` escaping, L2–L5.
- #1642 — the refused hold names the branch and not the reason.
- #1716 — fleetd does not retry a brief that stopped at the usage limit.

The members share one component and are mostly small. Fixed one issue per PR they cost eleven reviews and eleven rebases over the same files.

## Design

### Approach

Group the members by the code they touch. Each slice closes its members completely, so no member is left half-done across two slices.

1. **Tick guard and escalations** — #1306, #1580, #1508, #1456. The guard, the memory bound and the tick-freshness reading change together. A fresh empty `fleetd.log` is not a tick, and the board shows starting until the first tick line.
2. **Stop path** — #1577, #1586, #1526 (stop race). Everything that decides what happens after a stop begins.
3. **Output and channel** — #1526 (newline, channel bound line, `over()` tests), #1539.
4. **Unit harness** — #1590.
5. **Usage-limit retry** — #1716.
6. **Refused hold names its reason** — #1642. It crosses domain, fleetd and board, so it takes its own slice. The refusal record (session, reason, ISO time) is persisted next to the refusal in `.plot/state/refused-slices.tsv`, as optional columns after the branch. Decided 2026-10-18 by Jan Wloka.

Each fix follows the layering rule in `CLAUDE.md`: a decision goes in the domain, and fleetd calls it. Each fix lands with a test that fails before it.

### Open Questions

- [x] #1580: does an empty fresh `fleetd.log` count as a tick? The issue asks for a decision; the plan records it before slice 1 starts. Decided 2026-10-17 by Jan Wloka: a fresh empty `fleetd.log` is not a tick, and the board shows starting until the first tick line.
- [ ] #1456 and #1508 are partial: which of their bullets still hold on `main`? Slice 1 re-measures each before changing it, and drops a bullet `main` has already fixed. The slice measures this and records the answer here before changing code.
- [x] #1642: does the refusal record (who, why, when) persist in the index or derive from the tick? The answer decides whether slice 6 touches a stored file. Decided 2026-10-17 by Jan Wloka: the refusal record derives from the tick each time and is never persisted. Reversed 2026-10-18 by Jan Wloka: the code showed that a desk-reset refusal writes no ending record, so the reason is persisted next to the refusal in `refused-slices.tsv` (optional columns session, reason, ISO time; an old one-column line still reads).
- [ ] Do slices 1 and 2 collide on the tick file? If they do, slice 2 waits for slice 1. The slice measures this and records the answer here before changing code.

## Slices

### Implementation

- `bug/fleetd-tick-guard-and-escalations` — guard `notifyEscalations`, bound `EscalationMemory`, read a fresh empty log as no tick (the board shows starting), and the #1456 and #1508 bullets that still hold → #1995
- `bug/fleetd-stop-starts-no-agent` — skip the scan's after-step once stopping, resolve `wt_root` with `pwd -P`, and the stop-race tests
- `bug/fleetd-once-and-channel-output` — `--once` output on a macOS pipe, channel retry newline and bound line, `over()` tests → #1998
- `bug/fleetd-unit-harness-findings` — the #1589 review findings
- `bug/fleetd-retries-usage-limit-brief` — re-ask a brief that ended at the usage limit after its reset time → #1997
- `bug/refused-hold-names-its-reason` — the Tick, `/plot-fleet --status` and the board show who refused, why and when, persisted next to the refusal in `refused-slices.tsv` (decided 2026-10-18 by Jan Wloka)

## Notes

- Created unattended from issue #1846 on 2026-10-17. The Review and Impl answers follow the repo's `Plan PRs: required` setting and the multi-slice shape. No design answer was given, so the plan starts in Draft.
- The member verdicts live in each member's thread. This draft was written from the tracking issue's summary lines and not from the threads, so slice 1 re-checks each bullet against `main` before changing code.
- Nothing was written to the tracker.
- 2026-10-17: open questions decided by Jan Wloka: #1580 a fresh empty `fleetd.log` is not a tick; #1642 the refusal record derives from the tick and is never persisted.
