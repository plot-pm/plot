# Reconcile on Bitbucket reads merged branches as orphans past 50 merged PRs

> Bitbucket returns one page of 50 for the merged-PR list, so `plot-reconcile-scan.sh` cannot see a PR merged before the newest 50. §3 then reports a merged branch as an orphan and §20 reports no stale refs, and neither says the list was cut.

## Status

- **State:** Released
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Type:** bug
- **Issue:** #2282
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2292 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/reconcile-on-bitbucket-reads-merged-branches`
- **Delivered:** 2026-10-22
- **Released:** 2026-10-22, v2.28.0

## Changelog

- `plot-reconcile-scan.sh` on a Bitbucket repository with more than 50 merged PRs no longer reports a merged branch as an orphan, and names the merged list as cut when it cannot see every merged PR.

Board impact: none expected. The change is inside a helper script's read of the host; the plan format, the template and the `docs/plans` layout do not change.

## Motivation

On ewz-kus-portal, §3 reports `origin/bug/ewzkus-3678-sd-rechnungen-rechnungsliste — ahead of develop, no open PR → orphan`. `plot-host.sh pr-merged` on the same branch answers `merged` (#3623). §20 prints "(none — no remote ref outlives its merged PR)" with no truncation note. Found by the read-only ewz field test, round 6, on main `b33d3ee22`.

The cause is three facts that agree with each other:

- Bitbucket's merged list returns one page of 50. The newest merged PR is about #3712, so #3623 lies outside it.
- The truncation test (`count -ge MERGED_PR_LIMIT`, `skills/plot/scripts/plot-reconcile-scan.sh:699-706`) compares against `MERGED_PR_LIMIT=500`. A count of 50 never reaches 500, so the scan never marks the list truncated and the existing truncation note never prints.
- `plot-host.sh` warns "possibly truncated" on stderr, and the scan discards that line with `2>/dev/null` (`:399`). The PR index store does not hold the row either.

A merged branch read as an orphan sends a person to inspect finished work. A missing stale ref in §20 hides a branch that should be cleaned up. Both answers look complete.

## Design

### Approach

Two repairs are possible, and the plan decides which one ships. The issue names both.

1. **Page the merged list on Bitbucket** up to the limit. `plot-host.sh` already walks every page in other reads (the PR-list window and the issue reads), so the merged read can follow the same cursor. The cost is one request per page: 886 merged PRs on ewz-kus-portal means about 18 pages, on the host where the account is the scarce resource (see `2026-09-28-a-cold-bitbucket-board-buys-the-whole-list`).
2. **Report the truncation and ask per branch.** The scan treats a list shorter than `MERGED_PR_LIMIT` as truncated when the host is known to cap its page, and calls `plot-host.sh pr-merged <branch>` for each branch it would otherwise call an orphan. That exact per-branch filter (`state="MERGED" AND source.branch.name=…`) already answers a PR merged before a page's newest 50, and an absent PR reads as an exact absence. The cost is one call per candidate orphan, which is a small set.

Recommended direction: option 2 for the §3 orphan verdict, because it spends calls only on branches that would be wrongly named, and a wrong *orphan* verdict is the harm in the report. The truncation note is part of the same slice: the scan must say when the list is cut, whichever repair ships, and §20 needs the note because it cannot ask per branch for refs it never enumerated as merged.

### Open Questions

- [ ] How does the scan know the host capped the page at 50? Options: `plot-host.sh pr-list` exits with a distinct status or a stdout marker for a cut list, or the scan reads the stderr line it discards today. The signal must come from `plot-host.sh`, because the scan does not call `bb` directly (`scripts/check-host-cli-callers.sh`).
- [ ] Should §20 page the merged list (option 1), since it enumerates merged PRs, while §3 asks per branch (option 2)? Or does one repair serve both?
- [ ] Does the same cap affect `review-bypass.ts` (`--limit`, "merged-PR list hit its limit") and the PR index store on Bitbucket? The store lacks the row too, so the index fallback does not rescue a cut list.
- [ ] Does GitHub need any change? `gh pr list --limit 500` returns up to 500, so the existing test holds there.

## Slices

### Truncation and per-branch ask

- `bug/reconcile-on-bitbucket-reads-merged-branches` — the scan detects a cut merged list on Bitbucket, prints the truncation note in §20, and asks the host per branch before §3 calls a branch an orphan <!-- builds: a Bitbucket-aware truncation signal for the merged-PR list, and a per-branch pr-merged ask in reconcile §3 --> → #2310

## Notes

- Test target: a contract test in `test/reconcile/` with a stubbed Bitbucket host that returns 50 merged rows and a per-branch `merged` answer for a branch outside them. The test fails on `main` with an orphan line in §3 and passes with no orphan and a truncation note in §20.
- Source: issue #2282 (https://github.com/plot-pm/plot/issues/2282). The plan writes nothing to the tracker beyond the plan-link reflection.
