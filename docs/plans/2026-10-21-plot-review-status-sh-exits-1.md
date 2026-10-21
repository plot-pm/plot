# plot-review-status.sh skips a sprint line with no plan slug

> `plot-review-status.sh` exits 1 with empty stdout on any sprint file that holds a line without a `[slug]`; the script must skip such a line and print its JSON.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2280
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2297 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/plot-review-status-sh-exits-1`

## Changelog

- `plot-review-status.sh` skips sprint lines that name no plan and prints the review-freshness JSON, so `/plot-sprint` status receives review data.

<!-- Board impact: none. The script's output format does not change. -->

## Motivation

`plot-review-status.sh <sprint-slug>` exits 1 with empty stdout on every sprint file tested: `kafka-gp-sync` on ewz-kus-portal and `the-board-tells-the-truth` in this repository (found by the read-only ewz field test, round 6, on main `b33d3ee22`).

The script runs under `set -euo pipefail`. On the first line without a `[slug]`, the command substitution at `skills/plot/scripts/plot-review-status.sh:32` (`ITEM_SLUG=$(echo "$line" | grep -oE … | head -1 | tr -d '[]')`) fails, because `grep` finds nothing and `pipefail` carries that status out. `set -e` ends the script before the `[ -z "$ITEM_SLUG" ] && continue` line runs. No test under `test/` calls the script. `/plot-sprint` status therefore gets no review freshness data.

## Design

### Approach

Make the slug extraction tolerate a non-match, so the existing `[ -z "$ITEM_SLUG" ] && continue` line runs. For example, end the pipeline with `|| true`, as the lines below it already do for `ANNOTATION`.

Check the other `grep` pipelines in the script for the same failure on a line that matches the slug but lacks a field.

Add a contract test under `test/reconcile/` that runs the script on a sprint file mixing plan items, plain items and annotated items, and asserts exit 0 and the expected JSON.

### Open Questions

- [ ] Does any other helper script that reads sprint lines use the same unguarded `grep` pipeline?

## Slices

### Fix

- `bug/plot-review-status-sh-exits-1` — guard the slug extraction and add the mixed-sprint contract test → #2303

## Notes

Board impact: none.
