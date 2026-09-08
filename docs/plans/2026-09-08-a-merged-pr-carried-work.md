# A merged PR carried work

> Two slices of one sprint merged carrying no implementation — one a `PLOT-BLOCKED.md`, one zero files — and both plans read Delivered. `/plot-deliver` asks whether a branch's PR merged, never whether it carried the work.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches

## Changelog

- Delivery reports a slice whose PR merged carrying no implementation, so a plan cannot read Delivered on work that was never done.

<!-- Board impact: a plan the board shows as done may hold an empty slice.
     This is about the gate, not the rendering. -->

## Motivation

**Measured 2026-09-08 on `the-build-pipeline-is-its-own-connector` and `adoption-asks-about-the-stack`:**

| slice | PR | files | of those, implementation |
|---|---|---|---|
| `a-pipeline-address-is-not-the-host` | #809 | 1 | 1 |
| `the-build-port-exists` | #820 | 21 | 21 |
| `the-adapter-stops-judging-vendors` | #810 | 6 | 6 |
| **`the-ci-connector-is-jenkins`** | **#821** | **1** | **0** — a `PLOT-BLOCKED.md` |
| **`the-probe-reads-the-ci-system`** | **#811** | **0** | **0** — the claim commit alone |

**BOTH PLANS DELIVERED.** `plot-deliver.sh` verifies that every non-deferred branch's PR merged, and both had. A blocked agent commits its marker, the marker is a commit, the PR merges, and the slice is indistinguishable from a finished one to every counter on the estate.

**THE COST IS NOT THE UNFINISHED WORK — IT IS THAT NOBODY LEARNED.** 2.15.0 shipped and was announced for a team on Bitbucket, Jenkins and Jira. The Jenkins connector does not exist. That was found on 2026-09-08 by a person reading `build-resolve.ts`'s comment, four days after delivery and after the release note had gone out.

**AND THE ESTATE HAD THE EVIDENCE ALL ALONG.** `gh pr diff 811 --name-only` returns nothing. No rule asked.

## What this is not

**Not a rule about PR size.** A one-line fix is a legitimate slice, and `a-pipeline-address-is-not-the-host` shipped exactly that. The question is whether a PR carried *any* implementation, not how much.

**Not a block on delivering with a blocked slice.** A plan may legitimately deliver with a slice deferred — `deferred:`/`moved:` annotations exist for that, and they are read. What must not happen is a slice reading *merged* while carrying a marker.

**Not a new definition of done.** `/plot-deliver` already distinguishes deferred from merged. This teaches it that merged has two kinds.

## Slices

### Delivery reports a slice whose PR carried no work (Branch: bug/a-merged-pr-carried-work)

`plot-deliver.sh` reports a branch whose merged PR changed no file outside `PLOT-BLOCKED*` and the claim.

**IT REPORTS AND DOES NOT REFUSE**, which is the harder call and the right one. A plan may have a good reason to deliver with an empty slice — the work landed elsewhere, or the slice was withdrawn after its branch was cut — and a refusal would make that unrepresentable while the annotation for it already exists. What is missing is the *decision*, not the outcome: today nobody is told there is one to make.

**THE READING IS THE DIFF, NOT THE COMMIT COUNT.** Both failing slices had commits; one had a file. `git diff --name-only main...branch`, excluding `PLOT-BLOCKED*` and the claim, is the same reading `plot-reconcile-scan.sh`'s section 17 already makes for unclaimed work.

**AND IT NAMES THE ANNOTATION THAT SETTLES IT.** A reader told *"this slice merged carrying no implementation"* needs the next move in the same sentence: mark it `deferred:`, or re-open it.

**Done when** `/plot-deliver` names a slice whose merged PR carried no implementation, the check reads the diff rather than the commit count, a `deferred:` slice is silent, delivery still completes, and both #811 and #821 are reproduced as fixtures.

## Notes

### Why this is a gate and not a rule — 2026-09-08

CLAUDE.md's test: *can you answer "did I complete this?" without doing the work?* For a slice, the honest answer today is yes — a marker commit satisfies every mechanical check.

**The gate is cheap because the fact is already in git.** No host call, no judgement: one diff per branch, at a moment `/plot-deliver` is already reading each branch's state.
