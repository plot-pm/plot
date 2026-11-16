# Panel: delivery-tab-header-and-my-sprint, round 2

Run 2026-11-16, unattended, after the round-1 amendment (`c8075ac6a`). Reconciliation: `unanimous amend` (estate, contradiction, deliverable, cost). Files carry the prefix `r2-`; round 1's files stay.
Siblings: 5 delivery plans read in full, 0 unread (no sprint is active; the unfinished delivery plans are the sibling set).

## What each juror looked at

- Estate: plan, sibling slices, code by `git grep`, `sed`. Opened no test.
- Contradiction: plan, design spec, all six plans' `waits:` markers mapped for cycles, cited code.
- Deliverable: plan, siblings, template, `check-plan-headings.sh`; ran `plot-plan-meta.sh` (8 waves, no unread waits) and `git cat-file` on the story file.
- Cost: plan, cited code, grep counts of the chip test files.
- No juror ran a test or started the board. The moderator spot-checked three claims by grep: `SprintOwner` at `issue-source.ts:116`, `data-release-line` at `AgentList.tsx:1390`, `data-sprint-report` at `DeliveryFilters.tsx:183`, `readerIsKnown` at `ownership.ts:316`, `parsePersonDirectory` call at `server-info.ts:179`. All hold.

## No disagreement on position

Round 1's findings are resolved: no wait cycle, every `waits:` target exists, the story link resolves on `main`, the rename lists its test files. Round 2 finds a second layer, shared in part.

## Findings held by two or more lenses

1. Stale citations (estate, contradiction, deliverable, cost): `readerIsKnown` is defined at `ownership.ts:316` and does not call `resolvePerson`; `Reader` is at `ownership.ts:19-29`; the `parsePersonDirectory` call is `server-info.ts:179`; the "This sprint" label also lives in `chip-row.ts:117,120` and `DeliveryFilters.tsx:120`.
2. Serial cost (deliverable, cost, contradiction): a wave starts after every earlier wave completes, so plan 1 is eight serial merges and the longest cross-plan chain is nine. The sprint-owner slice waits on nothing and the sprint card waits on slices it does not need. The plan does not count this.
3. Slice-state "blocked" (contradiction, cost, estate): it is read from `placeDelivery`, which runs only in client code and takes the reader's filters, so "on the payload" has two readings and a team-wide bar can differ per reader. Plan 3's Queued group is not one of the five states.

## Findings held by one lens

- Estate: the tab already has `data-sprint-report` and `data-release-line`; neither is removed by a slice, so the sprint and the release would show twice, with two meanings of "blocked". `SprintOwner` already names the `Sprint owner` config key type (`issue-source.ts:116`). `SectionView` (`delivery-view.ts:159`) already holds a section's icon, label and counts.
- Contradiction: removing the release row removes the only Approve button, and with no Active sprint no card carries one. The to-do list assigns a marker itself for "Approve release". Plans 1 and 5 both claim the delivery section's scope. The rename reverses a decision at `DeliveryFilters.tsx:63-65`.
- Deliverable: the sprint card needs the Owner-to-reader rule that the scope slice builds later. Changelog, Board impact and Done When omit the release row's removal, the slice-state payload counts, and the template and `/plot-sprint` write.
- Cost: no host call found (the plan's zero claim holds). `end` touches `mock-fleet.ts`, `fleet.ts` and fixtures; the template change needs a `plot-sprint` changeset bump.

## Shared blind spot

All four lenses read code and plans. None ran the board, so nobody saw the Delivery tab render the existing sprint and release lines beside the proposed cards.

## Status

The panel reports and acts on nothing. No phase moved, nothing approved or rejected.
