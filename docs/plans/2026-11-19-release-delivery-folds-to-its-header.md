# Release delivery folds to its header

> The Release delivery section header becomes a toggle: open by default, and folded to its one header line of release and counts, with the fold stored per reader.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Changelog

- The Delivery tab's Release delivery section folds to its header line. The header shows the release, the plan count, the delivered and total slice counts, the at-a-gate count and the blocked count, and a click on it opens or folds the plan table. The section is open by default, and each reader's fold is kept in the browser.

<!-- Board impact: the Delivery tab only. No plan format, template, helper script or docs/plans layout changes. -->

## Motivation

The Release delivery section cannot be folded. #3525 (`delivery-release-progress-per-plan`) removed its fold on purpose: *"the design keeps sections open and collapses only the plan row"* (`docs/plans/2026-11-16-delivery-release-progress-per-plan.md:47`). The section now takes the full height of its plan table on every visit, also when every slice is delivered and the reader only wants to see that.

The first Delivery tab spec folded the section to one progress line, *"2.32.0: 12 of 18 slices delivered · 3 held at gates · 1 blocked"*, each number a link (`docs/superpowers/specs/2026-11-08-delivery-tab-design.md:114`). Jan Wloka asked on 2026-11-19 for the section to fold again.

## Design

### Approach

The mockup is `docs/superpowers/specs/2026-11-19-release-delivery-fold.html`. It shows four states: open, folded, folded with a release in progress, and folded under the My sprint toggle.

- **The header row is the toggle.** It carries `▾` open and `▸` folded, the section name, the release (or the sprint slug under My sprint), and the counts. The separate counts row under the heading moves into the header row. The whole row takes a click and carries `aria-expanded`.
- **Open by default.** The 2026-11-16 mockups show the section open, and this plan keeps that as the first view.
- **Folded, the section is its header line.** No plan rows and no column headers show. The counts stay, so the line answers "where does delivery stand".
- **A count links to the rows it counts.** A non-zero count is a link that opens the section and scrolls to those rows. A count of 0 shows and is not a link.
- **One stored key, `release-delivery`.** `collapse.ts` adds it back to `KNOWN_KEYS` (`packages/board/src/app/lib/agent-rows/collapse.ts:6-8`) and leaves it out of `COLLAPSED_BY_DEFAULT` (`:19`). The key is the same under the My sprint toggle, where the section reads Sprint delivery. A fold stored before #3525 therefore comes back. That is the reader's own earlier choice.
- **Plan rows keep their own fold.** Folding the section hides them; opening it shows each plan row in the state it had.
- **The view state is a domain property.** The header line's parts (name, scope label, counts and the link target of each count) come from one domain function beside `release-plan-rows.ts`, with unit tests. The component maps them and decides nothing. The fold itself is per-reader browser state in `collapse.ts`, like the Free agents line.

This reverses one point of #3525. The tests that pin the always-open section change with it: the `KNOWN_KEYS` test that reads a stored `["release-delivery"]` as open, and the `expandSection` tests in `AgentList.tsx`.

### Open Questions

- [x] Open by default (the mockups) or folded by default (the 2026-11-08 spec)? Resolved: open by default (Jan Wloka, 2026-11-19).

## Slices

### Fold

- `feature/release-delivery-folds-to-its-header` — the header line from one domain function, the header as the toggle, `release-delivery` back in `KNOWN_KEYS`, count links that open the section, and the tests #3525 pinned changed with it <!-- builds: releaseDeliveryHeader, the section's header line -->

## Notes

- Mockup: `docs/superpowers/specs/2026-11-19-release-delivery-fold.html`, in the style of `docs/superpowers/specs/2026-11-16-delivery-tab-mockups/section-header.html`.
- The plan links in the mockup carry their ticket prefixes from #3564, which merged on 2026-11-19.
