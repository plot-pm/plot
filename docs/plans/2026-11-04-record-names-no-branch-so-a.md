# The Spike approved: record names no branch, so a moved marker moves the approval

> A plan edit that moves or renames the spike marker after approval moves the approval to another branch, so the record must bind to the branch it licenses.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3101
- **Review:** pr
- **Impl:** own branches

## Changelog

- A `Spike approved:` record licenses one named branch. Moving or renaming the `<!-- spike -->` marker after approval no longer admits another branch.

<!-- Board impact: none expected. The board reads `spikeApproved` through the plan walk; a changed record format needs the plan parser and `plot-plan-meta.sh` output checked, and the board artifact rebuilt only if the plan contract it consumes changes. -->

## Motivation

The `Spike approved:` record does not name the branch it licenses. `sliceVerdict` admits a Design plan's slice when `phase` is `design`, the slice names one branch, `spike === true` and `spikeApproved === true` (`packages/domain/src/rules/eligible.ts:132-134`). `spike` comes from the `<!-- spike -->` marker (`spikeOf`, `packages/domain/src/rules/spike.ts:37-41`). `spikeApproved` reads only that a record exists (`packages/domain/src/workflows/plan-walk-assembly.ts:334`).

`approveSpike` decides with a branch (`packages/domain/src/transitions/plan.ts:493-494`, `:601`) and writes only `${input.on}, ${who}, ${input.channel}` (`plan.ts:600`). The branch the person approved is not recorded.

The state gate covers the `Spike approved:` line (receipt key `<plan path>#Spike approved`). It does not cover the marker. A plan edit that moves the marker, or renames the spike branch, after approval moves the approval to that branch.

Design plans are edited during Design by people, by `Design command` agents and by `/plot-reslice`. A marker move is a normal edit. This was review finding M2 in #1637, closed and folded into #1836. The wrong admission has so far reached only the scan's `eligible` word, because the registry queue never admitted a spike (#3092). Plan PR #3095 makes the queue read the same two fields, after which fleetd hands a moved or renamed spike branch to a free agent with no person in the loop. The safety juror of the panel on plan PR #3095 found it.

## Design

### Approach

Two options come from the issue. A person chooses; this plan does not.

1. **The record names the branch**, for example `2026-11-03, jwloka, pr, feature/x`. The rule admits only that branch. This changes the record format that `approveSpike`, the state gate receipt and `plot-approve.mjs --spike` write, and it needs a rule for existing records that carry no branch.
2. **The state gate refuses a commit that moves or renames the marker** in a plan that carries `Spike approved:`.

Option 1 puts the decision in the domain, where `sliceVerdict` and the queue read it, so every reader gets it. Option 2 stops one edit path at the commit and leaves a record that still names nothing. Any option must pass the MANIFESTO checklist, and "Gates Over Rules" in `CLAUDE.md` applies.

### Open Questions

- [ ] Option 1, option 2 or both?
- [ ] For option 1: how does a record with no branch read — admits nothing, admits the marked branch as today, or is migrated by `/plot-approve --spike`?
- [ ] For option 1: does a branch rename by `/plot-reslice` re-approve, or does the rename rewrite the record under a receipt?
- [ ] Do plans in flight carry a `Spike approved:` record today? Measure before choosing the legacy rule.

## Slices

### Implementation

- `feature/record-names-no-branch-so-a` — the chosen option, with tests for a moved marker and a renamed branch

## Notes

- Source: tracker issue #3101, evidence read at origin/main `1fa36d2aa`. Line references were not re-verified when the plan was written.
- Related: #1637, #1836, #3092, plan PR #3095.
