# Panel moderation: a-red-default-branch-is-repaired

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: all four ran probes against `merge()`, `defaultBranchRed()` and `advanceSettled` on red, pending-after-red and stale readings; testability ran 239 domain and 110 fleet tests (`default-branch`, `workflows-merge`, `queue`, `default-branch-refresh`, `queue-reading`); safety classified the first-parent commits on main since 2026-10-20.

## Agreed by all four

1. **Neither repair PR can merge.** Executed by all four: a green, ready revert PR on a fresh red main returns `refused / default-branch-red` (`workflows/merge.ts:127-129`), and #2902's rule also holds on red. "Jumps the queue" has no mechanism. A new slice adds a narrow exception in `merge()` and in `slicePrNext`: only the PR the repair record names, pinned to the red SHA, keeping the stale, head-moved and checks refusals. Three tests pin today's refusal (`workflows-merge.test.ts:128,165`, `merge-entry.test.ts:135`).
2. **The rule's inputs are not recorded.** Executed: `advanceSettled(green G → red R)` returns `{sha:'R',state:'red'}` and G is lost (`rules/default-branch.ts:110`); `headSince` resets on every new head; the PR index row has no merge-commit SHA. A repair record, written by `default-branch-refresh.ts` at the green→red change while `previous.settled` still holds G, carries last-green SHA, first-red time and the candidate merge. Not in `default-branch.json`: its schema is `.strict()` and a parse failure decodes to null, so an added field makes older readers lift the hold (executed by layering). The record is a lifecycle, so `check-state-declarations.sh` needs a `transitions/` rule.
3. **Missing prerequisites.** #2898 (the `main-repair` definition — the plan must not add it — and the role runner), #2900 (the reviewer; `plot/review` is required on repair PRs, and #2900's scope reader excludes them), #2899 (run log), #2903 (ticket writer). Each as a `waits:`, since an issue link does not hold a dispatch.
4. **The reverted work does not come back as planned.** A new slice heading on a Delivered plan is never dispatched (`rules/auto-dispatch.ts:220`), and no controller appends a heading to a plan on main. For a Delivered plan the ticket is the only way back; for an Approved plan the heading needs an owner.

## Safety findings that narrow the revert

- **The commit that turned main red is usually not a PR merge**: 970 of 1273 first-parent commits on main since 2026-10-20 are direct pushes, mostly lifecycle records. Reverting one runs a lifecycle step backwards, and `plot-state-gate.sh` refuses a `State:` change with no receipt. Revert only a merge the host reads `MERGED`; otherwise notify.
- When the pick is ambiguous (`ancestorsToAsk` gives several candidates; `merge-subject.ts` does not parse squash subjects `Title (#N)`), the pure domain picker answers `unknown` and nothing is reverted (layering, testability).
- Before a revert opens: main is still red on the same commit and no newer head is pending. Close the revert PR if main turns green by other means, or `merge()` later reverts good work on green.
- Write the repair record before starting an agent or pushing a branch, so a crash or a second machine does not start a second repair.

## Testability findings

- No port can make a revert: `refs.ts` and `host.ts` have no revert, commit or push operation. Slice 3 needs one, tested on a temp git repo for squash and merge-commit landings.
- No terminal outcome for a red revert PR, a conflicting revert, or a red with nothing to blame; each loops silently. Name them.
- `defaultBranchRed` is false at 61 minutes against a 3600 s `Checks wait` (executed): the revert arm requires a fresh reading. `Main repair bound` takes seconds, like `Checks wait`.
- The anti-goal ("reverted within bound plus one merge round") is provable only by a multi-tick fleet unit test with a fake clock; name it.

## Shared blind spot

All four assumed a red main is caused by a merge. None considered a red from outside the repo — a flaky runner, an expired secret, a dependency yanked upstream — where fix-forward has nothing to fix and a revert removes good work. The `unknown` answer covers it only if the picker also refuses when the red reproduces on the last green SHA.

## For the person

- None of its own beyond the cross-plan merge exemption, which this plan owns.
