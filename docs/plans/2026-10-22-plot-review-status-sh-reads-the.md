# plot-review-status.sh reads only sprint checklist items

> `plot-review-status.sh` reads the scope-change comment of `sprint.md` as an item named `slug`, and skips plan-less items that carry a `pr:` annotation; it must read checklist lines only and report plan-less items by key or text.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:**
- **Issue:** #2323
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2328 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/plot-review-status-sh-reads-the`
- **Delivered:** 2026-10-22

## Changelog

- `plot-review-status.sh` reads only checklist lines (`- [ ]` / `- [x]`) of a sprint file, so a sprint built from the template no longer yields a phantom item named `slug`, and a plan-less item with a `pr:` annotation appears in the review-freshness JSON under its key or text.

<!-- Board impact: none expected. The board does not call plot-review-status.sh; the sprint file format is unchanged. Confirm in Design. -->

## Motivation

`plot-review-status.sh kafka-gp-sync` on ewz-kus-portal prints one item, `{"slug":"slug","pr":"none",…,"needs_review":true}` (ewz field test, round 7, main `da789acff`).

The loop at `skills/plot/scripts/plot-review-status.sh:29-36` reads every line of the sprint file. The scope-change comment in `skills/plot/templates/sprint.md:50` (`<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->`) matches both the `[slug]` test and the annotation test. Every sprint built from the template therefore reports this item, and it always has `needs_review: true`.

The reverse gap: a plan-less item such as `EWZKUS-3869 <!-- pr: #3663, branch: … -->` carries no `[slug]`, so the script skips it and its PR gets no review-freshness reading.

#2303 added a skip for lines without a `[slug]`. That fix addresses the exit code and leaves both defects above.

## Design

### Approach

Filter on line shape before any extraction: process a line only when it matches `^[[:space:]]*- \[[ xX]\]`. HTML comment lines and prose then never reach the slug or annotation tests.

Item identifier: take `[slug]` when present; otherwise take the item's leading key or text (the text after the checkbox, before the first `<!--`, trimmed). The output keeps the field name `slug` for consumers, unless Design finds a consumer that needs to tell a plan item from a plan-less one.

Test: extend `test/reconcile/review-status-slug-match.test.mjs` with a template-built sprint (expects `items: []`) and a plan-less annotated item (expects one item named by its key).

### Open Questions

- [ ] Does a plan-less item appear under `slug`, or under a new field such as `key`? Check `/plot-sprint` status and the board for readers of this JSON.
- [ ] Does the checklist filter need to accept indented sub-items, or only top-level items?

## Slices

### Fix

- `bug/plot-review-status-sh-reads-the` — filter to checklist lines, report plan-less annotated items by key or text, and add the contract tests → #2338

## Notes

Issue: https://github.com/plot-pm/plot/issues/2323. Review channel and implementation home follow the repo's `Plan PRs: required` setting, so the plan reviews on a draft PR and the fix lands on its own branch. No design answer was given, so the plan starts in Draft.
