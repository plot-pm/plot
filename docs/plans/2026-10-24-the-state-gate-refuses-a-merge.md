# The state gate refuses a merge that brings in a receipted State change

> `plot-state-gate.sh` refuses `git commit` on a merge whose `State:` changes come from the other parent, where the owning controller already wrote and receipted them.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2580
- **Review:** pr
- **Impl:** own branches

## Changelog

- The state gate accepts a merge commit whose staged text of a plan or sprint file equals that file in a parent other than `HEAD`. A merge whose staged `State:` text matches neither parent still needs a receipt.

<!-- Board impact: none. The gate's decision lives in `packages/domain/src/rules/state-transition.ts` and its readings in the `state` entry of `skills/plot/scripts/board/plot-gate.mjs`. No plan format, no template, no layout. -->

## Motivation

The gate compares the staged text of a lifecycle file against `HEAD` and requires a receipt in `.plot/state/state-receipts/` for every `State:` change. A controller spends its receipt at commit time on the machine that ran it, so the receipt never travels with history.

A merge of the default branch into a slice branch stages every `State:` change that landed on the default branch since the branch point. Each of those changes already passed the gate on the default branch, but the merge commit has no receipt for them.

Measured 2026-10-24 (issue #2580): the desk for PR #2576 (`bug/sprint-release-gate-ignores-withdrawn-and-partial-reads`) followed `PLOT-CORRECTION.md`'s "conflicts with the default branch" finding and ran `git merge origin/main`. The merge staged two `State: Approved -> Delivered` transitions, `docs/plans/2026-10-24-controller-gate-fires-on-a-script.md` and `docs/plans/2026-10-24-deliver-flips-the-status-block-but.md`, written by `plot-deliver.sh` in `344270211` and `4f8e2e3c8`. The staged text of both files was byte-identical to `origin/main`. `git commit --no-edit` was refused, and the desk stopped with PLOT-BLOCKED. The workaround, `git rebase origin/main`, commits no `State:` change.

Any plan delivered on the default branch after a slice's branch point triggers this, so it affects nearly every long-lived slice in an active sprint.

## Design

### Approach

On a commit with a second parent (`MERGE_HEAD` present), a `State:` change in a lifecycle file passes without a receipt when the staged text of that file equals the file's text in a parent other than `HEAD`. That parent's own commit already passed the gate.

- **Domain rule.** `stateTransitionsOf` and `stateTransitionOf` in `packages/domain/src/rules/state-transition.ts` take the other parents' texts of each path as an additional reading and drop a transition whose staged text equals one of them. The rule stays synchronous and takes the readings as values, as the rest of the domain does.
- **Adapter reading.** The `state` entry in `plot-gate.mjs` reads `MERGE_HEAD` and `git show <parent>:<path>` for each other parent. A missing `MERGE_HEAD` gives no extra readings, so a non-merge commit behaves as today.
- **Comparison on text, not on the `State:` line.** The staged file must equal the parent's file byte for byte. A merge that also hand-edits the `State:` line, or any line that changes the extracted value, matches neither parent and keeps requiring a receipt.
- **Unreadable parent.** A parent whose text cannot be read counts as no match, so the gate refuses as it does today. The gate does not guess.
- **Scope.** Deletions, additions and renames keep their rules. An addition whose text equals the other parent's file passes under the same equality test, because the other parent's commit passed the gate. Confirm this against #1611's cases before approval.

### Open Questions

- [ ] Does an octopus merge (more than two parents) compare against every non-`HEAD` parent, or only the first? Equality with any one of them is the proposed answer.
- [ ] A merge that resolves a conflict inside a lifecycle file stages text equal to neither parent. The proposal keeps the receipt requirement there; confirm that no controller can write a receipt for a merge resolution, and name the escape if none can.
- [ ] Should the same equality test apply to the `Spike approved:` record's receipt key? The proposal says yes, under the same argument.

## Slices

### The gate reads the other parent

- `bug/the-state-gate-refuses-a-merge` — a merge commit's `State:` change passes when the staged text equals the file in another parent; a text matching neither parent still needs a receipt. Tests: a merge staging a receipted delivery from the default branch passes; a merge that edits the `State:` line by hand is refused; a non-merge commit is unchanged; an unreadable parent refuses.

## Notes

- Measured and reported in issue #2580. This plan writes nothing to the tracker.
- The workaround until delivery is `git rebase origin/main` in place of `git merge origin/main`.
