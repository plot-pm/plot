# A waits: chain under one heading reads as a cut slice sequence

> A heading whose branches form one `waits:` chain reads as `slice not cut`, and its waiting branch reads `eligible` while its `waits:` target is an unmerged draft.

## Status

- **State:** Delivered
- **Type:** bug
- **Issue:** #2094
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2095 merged
- **Started:** 2026-10-19, Jan Wloka, `bug/a-waits-chain-is-a-cut-slice-sequence`
- **Started:** 2026-10-20, Jan Wloka, `bug/an-unmerged-waits-target-blocks-eligibility`
- **Delivered:** 2026-10-20

## Changelog

- A heading whose branches each wait for the one before reads as a slice sequence, not as `slice not cut`. A heading with several branches and no `waits:` between them still reads as uncut.
- A branch whose `waits:` target has not merged reads as blocked, names the target in the board row, and is not eligible for dispatch.

Board impact: changes the `unsliced-wave` state and the eligibility verdict the board rows show; the board artifact needs a rebuild after the change.

## Motivation

On 2026-10-19 the board flagged `manifest-retry-and-race-findings` with `slice not cut` on two rows. Under `### Continuation`, `bug/an-unstarted-continue-resumes-no-stranger` carries `<!-- waits: bug/a-continuation-obeys-the-limits -->`, so the two branches already run in sequence. The plan's `### Start and stop` heading has the same shape, and both its branches delivered (#2034, #2052).

On the same row the waiting branch read `eligible` and `approved — nobody has taken it`, while its `waits:` target (#2078) was an open draft. The `one-chip-row-and-a-sprint` row reads `blocked — an earlier slice has to land first` for the equivalent case across headings. The same prerequisite gives a different verdict depending on whether the chain sits under one heading or several.

## Design

### Approach

Two defects, one place to fix each.

1. **Uncut-slice detection.** `unsliced-wave` fires on branch-line count per heading: `skills/plot/scripts/plot-reconcile-scan.sh` section 7 and the board's `packages/board/src/app/lib/agent-rows/stuck.ts:145` (`slice not cut`). Add a domain rule that takes a heading's branches with their `waits:` targets and answers whether they form one chain, each branch waiting for the one before. A chain is a cut sequence. Two branches with no `waits:` between them stay uncut.
2. **Eligibility of a waiting branch.** A `waits:` target that has not merged blocks its branch. The fleet scan (`skills/plot/scripts/plot-fleet-scan.sh`, `waits_on` / `prereq_missing`) and the domain (`packages/domain/src/workflows/`) both decide eligibility. The slice's first task is to name the single place where each decides, and to add a corpus test (`packages/domain/corpus/`) that fails when the two disagree, as `docs/shell-and-domain.md` requires for a declared duplicate.

Both rules are domain properties with unit tests. The board row reads the verdict from the domain and names the blocking target; `.tsx` decides nothing.

### Open Questions

- [ ] Why does the waiting branch read `eligible` when its target is an open draft? Reproduce against the `manifest-retry-and-race-findings` plan before cutting the fix. The prior fix (`a-slice-waits-on-every-branch-it-names`) covered several `waits:` values; this case may be a heading-level versus branch-line placement gap, or a draft PR read as merged.
- [ ] Does a chain of three or more branches count as one chain, or only pairs? The issue says "each branch waiting for the one before".
- [ ] Does a branch that waits on a branch under another heading count as chained for the uncut-slice rule?

## Slices

### Chain detection

- `bug/a-waits-chain-is-a-cut-slice-sequence` — domain rule for a chained heading; reconcile section 7 and the board `unsliced-wave` state use it → #2108

### Eligibility

- `bug/an-unmerged-waits-target-blocks-eligibility` — a branch whose `waits:` target has not merged reads blocked with the target named, in the row and in dispatch; corpus test pairs the scan with the domain <!-- waits: bug/a-waits-chain-is-a-cut-slice-sequence --> → #2142

## Notes

Source: https://github.com/plot-pm/plot/issues/2094. Reference: `docs/stories/the-master-agent-holds-the-fleet/DESIGN-slice.md` (a slice holds one branch).
