# Discovery story cards read Invalid Date and quote their own text; Tickets heading is empty

> A Discovery story card shows no date line when a date is absent or unparseable, shows its title and summary without stored quote marks, and the Tickets group says why it has no lanes.

## Status

- **State:** Released
- **Type:** bug
- **Issue:** #1752
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1754 merged
- **Started:** 2026-10-15, Jan Wloka, `bug/discovery-tickets-heading-reason`
- **Delivered:** 2026-10-15
- **Released:** 2026-10-16, v2.27.1

## Changelog

- The Discovery tab no longer shows `Invalid Date` on story cards, no longer wraps story titles and summaries in stored quote marks, and shows a reason under the Tickets heading when no ticket lanes were read.

Board impact: changes the board's Discovery tab and the story front-matter read only. No change to the plan format, the template, the helper scripts or the schema.

## Motivation

Seen 2026-10-15 on the `ewz-kus-portal` board (Jira project `EWZKUS`), Discovery tab, `show=both`:

1. Every story card reads `Created: Invalid Date · Updated: Invalid Date`. `formatDate` in `packages/board/src/app/components/StoriesTab.tsx` calls `new Date(iso)` on any non-empty string and renders the result without checking it. A value that is not ISO yields `NaN`, and the card prints `Invalid Date`.
2. Story titles and summaries render inside literal quote marks, for example `"EWZKUS-3547 — Einladungen im Portal und Backoffice löschen"`. The values look like YAML front-matter strings whose quotes the reader keeps. The objective preview also adds its own `"…"` around the text, so a stored quote doubles it.
3. The `Tickets` heading shows with no count and no lanes, while `Stories (7)` shows with lanes. `discoveryGroups` in `packages/domain/src/rules/discovery-groups.ts` answers `shows: true` for a group that was not read (`tickets: null`), so the heading renders with nothing under it and no reason. This is the MEDIUM left open by #1720. The cause may be a failed or unconfigured Jira read, and the tab does not say which.

## Design

### Approach

Each of the three points gets one domain property and one test, and the component renders what the property returns (CLAUDE.md, *Every rendered state is a domain property*).

- **Dates.** A pure helper in `@plot-pm/domain` takes the raw `created` or `updated` value and a `now`. It returns the display text, or null when the value is empty or does not parse to a valid date. The card renders the age line only from non-null parts, and omits the whole line when both are null. A unit test covers an ISO date, a date-only value, a non-ISO value and an absent value.
- **Quotes.** The front-matter read strips one pair of matching surrounding quotes from a scalar `title` and `objective` value, the way a YAML parser does. The fix goes where the value is read, not in the component, so the story modal and any other consumer see the same text. A test covers double-quoted, single-quoted, unquoted and inner-quote values.
- **Tickets heading.** `discoveryGroups` answers `shows: false` for the tickets group when the tickets were not read, and returns a reason string for the tab to render in place of the heading. Where a read failed, the reason names the failure; where no tracker is configured, it says so. A test pins `tickets: null` for each `show` value.

### Open Questions

- [ ] Where the quotes come from. Reproduce against the `EWZKUS` story files first: are the quotes part of the stored value (a double-quoted YAML scalar read by a line parser), or does the component add them? The objective preview adds its own quotes in `StoriesTab.tsx`, and the title may take a different path.
- [ ] What `created` and `updated` hold in the `EWZKUS` stories. The fix hides an unparseable value, and the plan should also say whether the writer of those files (`story-tracking`) should write ISO dates.
- [ ] Whether the Tickets reason distinguishes *not configured* from *read failed*. The board may carry only a null today, in which case the reason needs a field from the fetch.

## Slices

### Story card text and dates

- `bug/discovery-story-card-text` → #1764 — Show no date line for an absent or invalid date, and strip stored quote marks from story titles and summaries <!-- builds: formatStoryDate, a story-card date helper -->

### Tickets group

- `bug/discovery-tickets-heading-reason` → #1774 — Hide the Tickets heading for an unread group and show why <!-- builds: discoveryGroups unread reason -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/1752. Follow-up to #1720.
- Deliverable search found `discoveryGroups` in `packages/domain/src/rules/discovery-groups.ts` and `StoriesTab.tsx`. This plan changes both and builds no duplicate.
- Ceremony answers chosen unattended from the repo's usual shape: `Review: pr`, `Impl: own branches`, `State: Draft` (no `Design: yes` given).
