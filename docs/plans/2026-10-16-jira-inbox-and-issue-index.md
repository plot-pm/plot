# Tracker connector: Jira inbox and issue index

> Eight open findings from three merged reviews (#1659, #1660, #1688) leave the Jira inbox read unpaged and silently truncated, the kept inbox unmarked as stale, and two decisions untested; this plan closes them in one place.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #1849
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1860 merged

## Changelog

- A Jira inbox with more than one page of open tickets records that it is truncated instead of reading as complete, and a dropped or failed inbox read no longer leaves the previous pass's rows unmarked.

<!-- Board impact: the issue index schema (`packages/domain/src/entities/issue-index.ts`) gains a field if truncation or read time is recorded; board and fleetd then restart together. -->

## Motivation

Issue #1849 folds three closed review follow-ups whose findings did not hold their merges. Each line below is as the issue states it, to be re-checked against main before work starts.

- **#1688 (partial)**
  - M2: `issueListInbox` takes `ISSUE_INDEX_OPEN_LIMIT` (1000), so `plot-host.sh` sends `maxResults=1000`. Jira caps the page near 100, and `complete` (`issues.length < limit`) still reads true. A reader with more than 100 open tickets loses the rest silently.
  - M3: a failed, unsupported or `unaskable` inbox read keeps the previous pass's rows with no marker, also after the config key is removed.
  - L1: `tracker_projects` honours `PLOT_TICKET_PREFIXES` and the adapter gate reads only `plot-config.sh get`, so the two disagree under the override.
  - L2: the gate spawns one extra `plot-config.sh` per Jira pass.
  - L3: `tracker-fixture.ts` is at 47% function coverage.
- **#1659**
  - Decide whether `PLOT_TICKET_PREFIXES` still applies to `issue-open`, and test the decision either way.
  - Review the removal of `ci_instance` and `ci_looks_like_host` (commit 9b918e628), which no slice reviewed.
  - L4 to L6: `plot-host.sh` decides the issue-open arm from `tracker_scheme` instead of `issueSource`; title, body and labels travel as argv (E2BIG over 128 KiB on Linux, no guard for a leading `-`, no label-space rule); no test pins the issue-open budget record or a Jira 4xx on create.
- **#1660**
  - L4: `issue-refresh.ts` writes the closed read's `unsupported` reason into `state.issueError` on every Bitbucket pass. A standing fact reads as an error. The reason belongs on the closed set's answer.

## Design

### Approach

Group the findings by the code they touch, so each slice has one reviewer-sized surface.

1. The inbox read: page or cap it, record truncation, stamp read time, drop the kept inbox on `unaskable` (M2, M3).
2. One gate source for the ticket-prefix scope, read once per pass (L1, L2), plus the `issue-open` override decision (#1659) and `issueSource` in place of `tracker_scheme` (#1659 L4).
3. The closed set's standing reason moves off `issueError` (#1660 L4).
4. Tests: `tracker-fixture.ts` coverage, the issue-open budget record, a Jira 4xx on create (#1688 L3, #1659 L6).

Each fix follows the layering rule: the decision lives in the domain, `plot-host.sh` stays the one host caller, and the index holds answers and not verdicts. A truncation flag is an answer the host gave, so it may be stored; a staleness verdict is derived from the stored read time.

### Open Questions

- [ ] Page the inbox read, or cap it at one page of 50 as the lanes plan says? Paging costs more requests per pass against the Jira rate budget.
- [ ] Does `PLOT_TICKET_PREFIXES` still apply to `issue-open`? It reaches `tracker_projects` today and not `trackerJira`.
- [ ] Is the argv size and leading-`-` guard (#1659 L5) in scope, or a separate plan?
- [ ] Which of these findings still hold on main at `c40ac9e96`? #1701 fixed the two HIGH findings of #1687 after the triage list was written.

## Slices

### Inbox read

- `feature/the-jira-inbox-read-reports-truncation` — page or cap the inbox read, record truncation and read time, drop the kept inbox on `unaskable`

### Scope gate

- `feature/the-ticket-prefix-scope-has-one-source` — one gate source for `PLOT_TICKET_PREFIXES` and the config key, one `plot-config.sh` read per pass, the `issue-open` override decision, `issueSource` for the issue-open arm

### Closed set

- `feature/the-closed-set-answers-for-itself` — move the closed read's `unsupported` reason off `state.issueError`

### Coverage

- `feature/the-tracker-connector-paths-are-tested` — `tracker-fixture.ts` coverage, the issue-open budget record, a Jira 4xx on create

## Notes

- Source: tracking issue #1849, triage of open issues against main at `c40ac9e96`, 2026-10-16.
- Created unattended: the Design question had no explicit answer, so the plan starts in Draft.
