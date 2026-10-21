# Reconcile §23 ignores a plan's ticket: frontmatter key

> Reconcile §23 resolves a finished plan's Jira key from the `Issue:` line only, so a plan carrying its key in `ticket:` frontmatter reads "not checked".

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2269
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2270 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/reconcile-23-ignores-a-plan-s`

## Changelog

- Reconcile §23 reads a plan's `ticket:` frontmatter key when the plan has no `Issue:` line, so fewer finished plans read "not checked" under a Jira tracker.

<!-- Board impact: none. The plan format is unchanged; only a reconcile section reads one more field. -->

## Motivation

Under a Jira tracker, `plot-reconcile-scan.sh` §23 takes a finished plan's key only from `plot-plan-meta.sh`'s `issues` (the `- **Issue:**` line). PR #2265 (#2248) makes `plot-plan-meta.sh` also report a plan's `ticket:` frontmatter key, and PR #2266 (#2249) adds the §23 Jira comparison without reading that field.

Measured 2026-10-21 on ewz-kus-portal: 33 of 40 EWZKUS plans carry their key only in `ticket:` frontmatter. After #2266 those 33 plans read "not checked" in §23.

## Design

### Approach

§23 resolves a plan's key in the same order as the sprint/Release comparison after #2265: the `Issue:` line, then the `ticket:` field. Only a plan with neither is listed as "not checked". One key resolver serves both readers, so the two cannot drift.

Depends on #2265 and #2266 being merged. The resolver's home is decided against what #2265 ships.

### Open Questions

- [ ] Does #2265 already expose the resolver in a form §23 can call, or does this plan extract it?

## Slices

### Key resolver

- `bug/reconcile-23-ignores-a-plan-s` — §23 resolves a plan's key through the shared resolver (`Issue:` line, then `ticket:`) and lists only plans with neither as "not checked" → #2273

## Notes

Created from tracker issue #2269. Waits for #2265 and #2266.
