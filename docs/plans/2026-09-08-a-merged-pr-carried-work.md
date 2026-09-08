# A merged PR carried work

> Two slices of one sprint merged carrying no implementation — one a `PLOT-BLOCKED.md`, one zero files — and both plans read Delivered. `/plot-deliver` asks whether a branch's PR merged, never whether it carried the work.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** plot-gates
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 4
- **Approved:** 2026-09-08, Jan Wloka, plan-PR #834 merged
- **Delivered:** 2026-09-09

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

**MEASURED OVER THE LAST 60 MERGED PRs: SEVEN CARRIED NO WORK — AND ONLY TWO ARE THIS DEFECT.** The other five are the reason this reports rather than refuses:

| PR | what it is | verdict |
|---|---|---|
| #811, #821 | a slice's only merged PR, no work anywhere | **the defect** |
| #797, #801 | `plot: approve …` | lifecycle PRs, not slices — they move a symlink and are supposed to be small |
| #808, #812, #817 | `claim …` on a branch whose work landed **under another PR** | the slice finished; its claim commit merged separately |

**THE THIRD ROW IS WHY A REFUSAL WOULD BE WRONG.** `an-agent-learns-its-pr-failed`'s claim PR carried nothing, and its rule `checks-reading.ts` is on main — arriving through #807, a different branch. A gate that refused would have blocked a delivery whose work was complete, and it would have been right about the PR and wrong about the plan.

**SO THE FINDING IS A QUESTION, NOT A VERDICT**, and its wording has to admit the third row: *this branch's merged PR carried no implementation — check whether its work landed elsewhere, defer it, or re-open it.*

## What this is not

**Not a rule about PR size.** A one-line fix is a legitimate slice, and `a-pipeline-address-is-not-the-host` shipped exactly that. The question is whether a PR carried *any* implementation, not how much.

**Not a check on lifecycle PRs.** `plot: approve …` and `plot: deliver …` move a symlink and a phase line; two of the seven empty PRs measured are exactly that, and they are correct. The reading is per *branch the plan names*, and a lifecycle PR is on no such branch.

**Not a block on delivering with a blocked slice.** A plan may legitimately deliver with a slice deferred — `deferred:`/`moved:` annotations exist for that, and they are read. What must not happen is a slice reading *merged* while carrying a marker.

**Not a new definition of done.** `/plot-deliver` already distinguishes deferred from merged. This teaches it that merged has two kinds.

## Slices

### Delivery reports a slice whose PR carried no work (Branch: bug/a-merged-pr-carried-work)

`plot-deliver.sh` reports a branch whose merged PR changed no file outside `PLOT-BLOCKED*` and the claim.

**IT REPORTS AND DOES NOT REFUSE**, which is the harder call and the right one. A plan may have a good reason to deliver with an empty slice — the work landed elsewhere, or the slice was withdrawn after its branch was cut — and a refusal would make that unrepresentable while the annotation for it already exists. What is missing is the *decision*, not the outcome: today nobody is told there is one to make.

**THE JUDGEMENT GOES IN THE DOMAIN, WHERE THE OTHER TWO ALREADY ARE.** `plot-deliver.sh:160` asks `plot-ask.mjs deliverable`, and `rules/branch-state.ts` decides from a `DeliverBranchReading` carrying `{branch, deferred, merged}` — two facts about each branch and no third. A `git diff` in the shell script would be a second implementation of a rule that already has a home, in the same sprint that removes seven such thresholds from the collectors. So the reading gains a field:

```ts
/** Whether the merged PR changed anything but a marker or a claim. */
carriedWork: boolean | 'unknown';
```

**`unknown` IS A FIRST-CLASS ANSWER AND IT NEVER REPORTS.** A branch whose diff cannot be read is not a branch that carried nothing, and the estate draws that line everywhere — `auth: unknown` reads as *cannot verify*, never as *authenticated*.

**IT COSTS 1.7 ms PER BRANCH.** Measured 2026-09-08: `git show --stat` over 20 merge commits took 33 ms total. Delivery already spends a host call per branch, so this is below the noise of what it does anyway.

**THE READING IS THE MERGE COMMIT, NOT THE BRANCH.** The first draft said `git diff --name-only main...branch`, and that cannot run: **both failing slices' refs are gone**, deleted on merge, measured 2026-09-08. The merge commit survives and answers the same question — `git show --stat 5d7644ec` reports nothing for #811, and `dab631d4` reports `PLOT-BLOCKED.md` alone for #821, matching what the host says about each. **So git suffices and no host call is needed**, which matters because delivery already spends host calls per branch and this must not double them.

**EXCLUDE THE MARKER AND THE CLAIM, AND NOTHING ELSE.** A documentation-only PR carried work — it is a slice that wrote documentation. The two exclusions are `PLOT-BLOCKED*` and the claim commit's file, the same pair `plot-reconcile-scan.sh`'s section 17 already excludes when it asks whether a branch holds work.

**AND IT NAMES THE ANNOTATION THAT SETTLES IT.** A reader told *"this slice merged carrying no implementation"* needs the next move in the same sentence: mark it `deferred:`, or re-open it.

**Done when** `/plot-deliver` names a slice whose merged PR carried no implementation; the judgement is `rules/branch-state.ts`'s and the measurement the adapter's; the reading is the merge commit rather than a branch ref that no longer exists; `unknown` reports nothing; a `deferred:` slice is silent; a documentation-only PR counts as work; delivery still completes; and both #811 (zero files) and #821 (a marker) are fixtures whose expected verdicts differ from a third fixture carrying one real file.

## Notes

### Why this is a gate and not a rule — 2026-09-08

CLAUDE.md's test: *can you answer "did I complete this?" without doing the work?* For a slice, the honest answer today is yes — a marker commit satisfies every mechanical check.

**The gate is cheap because the fact is already in git.** No host call, no judgement: one diff per branch, at a moment `/plot-deliver` is already reading each branch's state.
