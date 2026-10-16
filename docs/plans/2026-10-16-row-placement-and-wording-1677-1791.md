# Waiting on you: row placement and wording (#1677–#1791)

> Nine open follow-ups on the board's *Waiting on you* rows — where a row lands, what its text says, and the review findings left on the PRs that built it.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #1830
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1859 merged

## Changelog

- *Waiting on you* places a `quiet` row under *Quiet*, words a clean wait-bound end as an ending rather than a blocked agent, and reads an unresolved git host as unresolved instead of GitHub.

<!-- Board impact: changes row placement and wording in the board's Waiting on you view; the board artifact is rebuilt by main. No change to the plan format, template or helper scripts. -->

## Motivation

Issue #1830 tracks nine closed-in-favour issues from a triage against main at `c40ac9e96` (2026-10-16). Each still has open work on main:

- #1546 — the channel and the board word a missing checks commit two ways.
- #1679 — an unresolved git host is read as GitHub (M1 pass `entry.backend ?? ''`, M2 cap test, M3 restart note, L1–L4).
- #1742 — stale comment; confirm the plan head shows the plan PR link.
- #1743 — a desk that ended cleanly at the wait bound reads as a blocked, stopped agent.
- #1758 — a row whose status reads `quiet` lands in *Waiting on you*, not *Quiet*.
- #1760 — plan PR link missing on the plan head, tally counts the plan row, slice groups recomputed.
- #1790 — ticket-lanes `ownerOf` reads the first assignee only; unused `ownedFromStory`; `hiddenByTopic` name; redundant re-export; reshaping in `StoriesTab.tsx`.
- #1792 — slice not delivered (row text, domain placement rule, browser test); `PLOT-BLOCKED` test title; bound fixture changes no result; pid 99999; changeset wording.
- #1793 — Discovery vs Planning disagree on host-login estates; unmemoised reader prop; review-history comments; untested empty-lane messages; stale checkbox comment; owner comment wording.

## Design

### Approach

Group the work by the component that decides it, not by the issue that reported it. Placement and wording are decided in the domain, so each fix is a domain property with a unit test and one browser test proving the row shows it (`CLAUDE.md`, *Every rendered state is a domain property*).

### Open Questions

- [ ] #1743 asks for fleetd to start a fresh agent at `agents=0`. Is that in this plan, or a follow-up issue?
- [ ] #1679 M3 (restart note): is the changeset consumed in 2.27.0, so the note is moot?
- [ ] Which of the LOW findings in #1790, #1792 and #1793 are still present on main? Re-check each before changing code.

## Slices

### Placement and row text

- `bug/row-placement-quiet-and-wait-bound` — `quiet` rows land in *Quiet* (#1758); a clean wait-bound end reads from the ending record, not as blocked (#1743, #1792 MEDIUM) <!-- builds: a domain placement rule for quiet rows -->

### Host and wording

- `bug/row-host-unresolved-and-checks-wording` — unresolved git host passes `entry.backend ?? ''`, with cap test (#1679); one shared wording for a missing checks commit (#1546)

### Review follow-ups

- `bug/row-review-followups` — plan PR link on the plan head, tally and slice-group fixes (#1742, #1760); first-assignee ownership and dead code (#1790); Discovery/Planning host-login agreement, memoisation, comments and empty-lane tests (#1793); test hygiene from #1792

## Notes

Source: issue #1830, https://github.com/plot-pm/plot/issues/1830. Created unattended from the issue body; Type `bug` came from the prompt, the design question defaulted to no.
