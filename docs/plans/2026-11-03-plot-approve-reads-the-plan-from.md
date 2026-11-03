# plot-approve reads the plan from one open PR and merges another

> `plot-approve` and `plot-needs-design` read a plan's gating record from the first open PR that changes the plan file, then act on the `idea/<slug>` PR; where the two differ, the approval judges one copy and merges the other.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3093
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-approve` and `/plot-needs-design` read the plan record from the head of the PR they merge or write to. Where two open PRs hold differing copies of one plan, the command refuses with a named reason and writes nothing.

<!-- Board impact: none to the plan format or layout. The approve and needs-design controllers change behaviour; their bundles are rebuilt by main after the merge. -->

## Motivation

Issue #3093, read on `origin/main` at `0723f9dd5`. Two open PRs can change one plan file, one of them on `idea/<slug>`. Then the gating record and the merged PR come from different PRs.

- `remotePlanOf` (`packages/board/src/server/entry/approve.ts:452-457`) reads the plan record at the head of the first open PR that `planPrsCarrying` returns (`packages/domain/src/rules/plan-pr.ts:174-183`). That function keeps the host's listing order.
- `planPrOf` (`plan-pr.ts:205-219`) asks for the `idea/<slug>` PR first. When the host holds one, it is the plan PR, with `rivals: []`.
- `approve.ts:934-945` sets the PR to merge from that answer. The workflow judges the phase, `Review:` and slices from the record of step 1. The controller merges the `idea/<slug>` PR.
- `needs-design.ts:393-397` reads the record from the first carrying PR. `needs-design.ts:232` writes to the `idea/<slug>` PR when that PR is open. The same split exists there.
- The `pr-ambiguous` refusal (`packages/domain/src/workflows/approve.ts:325-333`) covers only the open route, where `rivals` is filled. The named route never fills it.

With two open PRs whose copies differ in `Review:` or in the slices, the approval judges the copy on PR B and merges PR A. GitHub reaches this path today. Bitbucket reaches it once the fix for #3089 lets plain `pr-list` rows carry `headSha`.

## Design

### Approach

The record that gates an approval comes from the head of the PR that the approval merges.

1. Read the plan record from the head SHA of the PR that `planPrOf` names, not from the first carrying PR. `remotePlanOf` and the `needs-design` read both ask the same rule for the PR first, then read that PR's head.
2. Where the PR that `planPrOf` names and the first carrying PR are different PRs, and their copies of the plan file differ, refuse with a named reason (for example `pr-copies-differ`) and write nothing. Where the copies are equal, the choice is harmless and the command proceeds.
3. The rule lives in the domain (`rules/plan-pr.ts` and `workflows/approve.ts`). The controllers only read the heads the rule asks for, as the layering rule requires.

### Open Questions

- [ ] Does the fix reorder the reads (name the PR, then read its head) or keep both reads and compare? Reordering removes the split; comparing also reports a rival with a differing copy. The first interrogation round decides.
- [ ] Does `pr-ambiguous` also cover the named route, or does a rival beside `idea/<slug>` stay allowed when its copy is equal?
- [ ] Should `plot-needs-design` share the rule through one function, so the two controllers cannot drift again?

## Slices

### Single-source plan read

- `bug/plot-approve-reads-the-plan-from` — read the gating record from the head of the PR the command merges or writes to, in both controllers, and refuse with a named reason where two open PRs hold differing copies. Test: `packages/board/test/unit/approve.test.ts` with two open PRs that change one plan file, one on `idea/<slug>`, whose copies differ in `Review:`; on `main` the approval merges the `idea/<slug>` PR after it judged the other copy.

## Notes

- Found by the safety juror of the panel on `2026-11-03-plot-approve-finds-no-plan-on` (#3089, plan PR #3091). Out of scope for that plan.
- Related: [2026-11-03-plot-approve-finds-no-plan-on](2026-11-03-plot-approve-finds-no-plan-on.md), [2026-10-23-plot-approve-reports-no-pr-found](2026-10-23-plot-approve-reports-no-pr-found.md).
- Deliverable search: the estate holds `planPrOf` and `remotePlanOf`; this plan changes them and builds no new artifact.
- PLOT-UNASKED: Does this plan carry significant design decisions? — default — proceeded; State: Draft
