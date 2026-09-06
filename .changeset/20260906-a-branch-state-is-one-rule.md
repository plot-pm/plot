---
'@plot-pm/board': minor
---

`branchState(readings)` in `packages/domain/src/rules/branch-state.ts` derives a branch's state in the domain. Three rules already consumed `BranchState` and none produced one — `eligible.ts`, `waiting.ts` and `verdict.ts` all take a state and judge it, and `waiting.ts` even groups them, `SETTLED = ['merged','deferred']` and `TAKEN = ['claimed','wip']`. The answer lived in `plot-fleet-scan.sh`, 4,194 lines, split across a git reading at `:3050`, a prerequisite judgement at `:1132` and a plan statement at the caller, `:3454`.

The precedence is stated as order rather than as an `if`, with a test per case: a plan's `deferred:` beats a merged ref, a prerequisite's state beats `open` and `unknown` and nothing else, and `unknown` marks an ABSENT reading rather than an empty one. `HostReach` carries that last distinction by construction — `unasked` yields `open` because the scan was never going to ask, while `throttled`, `secondary` and `failed` yield `unknown` because the question was put and went unanswered.

Verified against the estate, not reviewed: `corpus/branch-state.corpus.test.ts` compares the rule's answer to the scan's for all 55 branches of every plan, exercising merged=35, open=9, wip=9, deferred=1 and waiting=1. Four single-line breaks to the rule were applied to measure what the comparison reaches — the resurrected-ref host override and the `deferred:` precedence each fail it by name; the merge-subject lookup and the claim-marker count each pass, because this estate reaches neither arm, and the test records that so a green run is not read as more than it covers.

`plot-fleet-scan.sh` is unchanged; a second slice rewires it. `eligible.ts`, `waiting.ts` and `verdict.ts` are byte-unchanged, which is the assertion the plan made about the shape being right.

<!--
plan: docs/plans/2026-09-04-a-branch-state-is-derived-once.md
-->
