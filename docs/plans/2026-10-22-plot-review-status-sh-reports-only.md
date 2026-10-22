# plot-review-status.sh reports only the first PR of a multi-PR annotation

> `plot-review-status.sh` reads the first number of a `pr:` annotation and drops the rest; it must report every PR the annotation names.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-1
- **Issue:** #2346
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2349 merged
- **Started:** 2026-10-22, Jan Wloka, `bug/plot-review-status-sh-reports-only`

## Changelog

- `plot-review-status.sh` reports every PR a sprint item's `pr:` annotation names, so an item annotated `<!-- pr: #3645, #3649 -->` no longer reads as PR 3645 alone.

<!-- Board impact: none expected. The board does not call plot-review-status.sh (confirm in Design); the sprint file format is unchanged. The JSON field `pr` may change shape — see Open Questions. -->

## Motivation

On ewz-kus-portal, `plot-review-status.sh kafka-gp-sync` reports `"pr":"3645"` for a sprint item annotated `<!-- pr: #3645, #3649 -->`, and `"pr":"3646"` for `<!-- pr: #3646, #3647 -->`. The second PR of each item gets no entry (ewz field test, round 8, main `04d336440`; issue #2346).

`skills/plot/scripts/plot-review-status.sh:46` extracts the field with `grep -oE 'pr: #[0-9]+' | grep -oE '[0-9]+'`. The pattern matches the literal `pr: #` once per annotation, so the only number it can return is the one directly after `pr:`. Later numbers in a comma list (`, #3649`) lack that prefix and never match.

## Design

### Approach

Read the whole `pr:` field, then extract every `#<number>` in it. The field runs from `pr:` to the next `key:` or the comment end, so `branch:`, `reviewed_at:` and `review_sha:` values cannot leak in. A single-PR annotation keeps its current result.

### Open Questions

- [ ] Output shape: `pr` is a JSON string today (`"3645"`, or `"none"` when absent). Options: a comma-joined string (`"3645,3649"`, no schema change), or a `prs` array added beside `pr` (`pr` keeps the first number). Who reads `pr`? Check callers of the script (skills, board, sprint-release) before choosing.
- [ ] Which annotation spellings count: `pr: #1, #2`, `pr: #1,#2`, `pr: #1 #2`, and a repeated `pr:` key.

## Slices

### Multi-PR extraction

- `bug/plot-review-status-sh-reports-only` — extract every PR number from the `pr:` annotation and report them; add a contract test in `test/reconcile/` with a two-PR and a single-PR item → #2352

## Notes

- Related, both Delivered: `plot-review-status-sh-exits-1` (#2303) and `plot-review-status-sh-reads-the` (#2323) fixed other defects in the same script. This plan touches the annotation parse only.
- Created unattended from issue #2346. Design question not answered in the prompt, so the plan starts in Draft. Nothing is written to the tracker.
