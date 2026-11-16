# Panel: delivery-tab-header-and-my-sprint

Run 2026-11-16, unattended. Reconciliation: `unanimous amend` (estate, contradiction, deliverable, cost).
Siblings: 7 read as plan files, 0 unread (no sprint is active; the unfinished plans are the sibling set). The two non-delivery siblings were read at grep level only.

## What each juror looked at

- Estate: plan, sibling headers and slices, code grep. Opened no full design spec.
- Contradiction: plan and design spec in full, sibling plans by grep, code opened (`sprint-record.ts`, `chip-row.ts`, `DeliveryFilters.tsx`, `ownership.ts`, `person.ts`).
- Deliverable: plan, template, `check-plan-headings.sh`, plan-meta `waits:` syntax, code opened.
- Cost: plan, code opened (`schema.ts`, `mine-filter.ts`, `server-info.ts`); no spec read.
- No juror ran a test.

## No disagreement on position; findings the panel shares

1. The story link and `#3468` point to a file absent from this branch (estate, contradiction, deliverable).
2. Slices 2 to 4 carry no `waits:` marker (contradiction, deliverable).
3. The `This sprint` to `My sprint` rename touches `data-chip="This sprint"` in 4 browser test files and 3 unit tests; its relation to the existing sprint multi-select and `Mine` is unstated (contradiction, cost, deliverable, estate).
4. Marker ownership between this plan and plan 2 has no declared order (contradiction, deliverable).
5. The reader-not-in-`People` question has an existing precedent (`readerIsKnown`, `hostUser`) the plan does not cite (contradiction, cost, estate).
6. No existing sprint has `Owner:`, so My sprint is disabled for everyone until someone backfills (contradiction, cost).

## Findings held by one lens

- Contradiction: the plan disables My sprint when the reader owns no Active sprint; the design and `chip-row.ts` disable it when no sprint is Active. One Approve button per `Release:` value has no rule that maps a value to a release PR.
- Cost: `FleetSprintSchema` has no `end` field; the parser in `packages/domain` cannot read `People`; "rebuild the board artifact with each slice" conflicts with `check-no-bundle-diff.sh`.
- Deliverable: the header-cards slice bundles at least four views.
- Estate: fleet card and Fleet section header both render the fleet switches; the slice-state classification is shared with `delivery-release-progress-per-plan` and has no owner; the scope slice is not sequenced against the siblings that rework You and Work items.

## Shared blind spot

All four lenses read the plan and its neighbours. None ran the board, so no juror checked what the Delivery tab shows today or how the existing chips behave.

## Status

The panel reports and acts on nothing. No phase moved, nothing approved or rejected.
