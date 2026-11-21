## Implementation brief — the-fleet-fixes-every-red-or-conflicting-pr (wave 2: Conflict)

- **Plan (canonical):** docs/plans/2026-11-20-the-fleet-fixes-every-red-or-conflicting-pr.md on main
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3597 merged
- **Branch:** `feature/the-fixer-merges-the-base-into-a-conflicting-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** the review app reviews the PR; `Auto-review` is on

This slice waits on `feature/the-fixer-scope-reads-every-open-pr`, which merged as #3600 (`3698dcaf0`). `fixerPrNext`, `fixerScope` and `fixerOwner` exist on `main`; build on them. `feature/the-fixer-row-names-its-finding` (the Board slice) waits on this one and reads the `conflict` finding kind and `FixerPrNext` answers this slice adds.

### What to build

A conflicting PR that no agent owns stays conflicting. On 2026-11-20 #3594 (`bug/release-approval-blocks-only-when-approvable`) carried `mergeable: "conflicting"` in the PR index and nothing acted on it. Two defects cause that, and this slice fixes both.

1. **No arm answers a conflict.** The fixer knows two finding kinds, `high` and `ci` (`FixerFindingSchema`, `packages/domain/src/entities/fixer-attempts.ts`). Add a third, `{ kind: 'conflict', head, baseTip }`, and a `conflictArm` in `packages/domain/src/rules/slice-pr-next.ts` that `fixerPrNext` walks before `ciRedArm`. Start the fixer with a brief that merges the base into the PR's branch.
2. **The merge arm's `conflicting` hold never fires.** `mergeArm` and the merge identity path compare `row.mergeable === 'CONFLICTING'` (two sites in `slice-pr-next.ts`). The index stores the lowercase word `conflicting` (`mergeableOf`, `packages/domain/src/rules/github-pr-row.ts`; `MergeabilitySchema`, `packages/domain/src/entities/pr.ts`). Export one constant holding the stored word, compare both sites against it, and change the fixtures in `packages/domain/test/slice-pr-next.test.ts` that use `'CONFLICTING'` to it.

Mechanism, in order:

- `FixerFindingSchema` gains the `conflict` arm. `FIXER_ATTEMPTS_VERSION` stays 1. An older build reads a record holding the new arm as `unreadable`, and `fixerInFlight` holds every fixer on an unreadable record, so nothing starts blind. `fixerAttemptsSpent` counts `conflict` apart from `high` and `ci`, under the same `FIXER_ATTEMPTS_BUDGET` of 2 per PR.
- `FixerReading` (`packages/domain/src/rules/slice-pr-next.ts`) gains `conflictExhausted` and `conflictTried`; `fixerReadingOf` (`packages/domain/src/rules/fixer-attempts.ts`) fills them. `conflictTried` is true where an attempt on this head AND this base tip exists. `SlicePrNextReadings` gains an optional `baseTip`; `fixerTick` (`packages/fleet/src/shared/auto-fixer.ts`) reads it through `Refs` after it fetches the base. An unread tip holds `unread`.
- `conflictArm` answers, in order: `none` where `row.mergeable !== 'conflicting'`; `hold('unread')` where the fixer record or the base tip is unread; `hold('conflict-attempted')` where `conflictTried`; `hold('conflict-attempts-spent')` where `conflictExhausted`; `none('desk-alive')` where the desk is not gone, so a desk agent keeps its own conflict ending (`mergeConflictCorrectionEnding`, `packages/domain/src/workflows/agent-loop.ts`); otherwise `{ step: 'fixer', head, evidence: 'conflict' }`. Reuse the `deskGone` expression `ciRedArm` uses; do not write a second one.
- `startFixer` (`auto-fixer.ts`) already re-asks `prState` before it writes the attempt. Add a refusal `not-conflicting` where the host's answer is not `conflicting`, placed before `store.append`, so GitHub's `UNKNOWN` window after a base move spends no attempt. Record the base tip it read in the attempt's finding. The failed-start hold in `fixerTick` keys on head today; it must key on head AND base tip for a conflict attempt.
- `fixerPrompt` (`packages/domain/src/rules/fixer-start.ts`) gains `FixerEvidence` `{ kind: 'conflict', base, baseTip }`. The prompt tells the fixer to: fetch the base; merge `origin/<base>` into the detached head with `git merge`, never rebase and never force-push; resolve every conflict; for a generated bundle (`.gitattributes` marks them `-merge`), restore the path from the merge base, `git merge-base HEAD MERGE_HEAD`, and never commit a rebuild (`docs/definition-of-done.md`, *Resolving a board artifact conflict*); stop and report where a conflict sits in a path the role gate protects (`.github/workflows/`, `.claude/`, `scripts/check-*.sh`); commit the merge and push with `git push origin HEAD:<branch>`. It cites `rolePushViolation` (`role-gate.ts`) and stops when its push is refused. A `State:` conflict stops at `plot-state-gate.sh` and is reported, not retried.
- Bitbucket rows carry `mergeable` from a local merge-tree check (`bitbucket-pr-listing.ts`), so the arm works there with no extra code. They carry no `ciChecks`, so the CI-red arm stays GitHub-only.

### Decisions the plan settles — do not re-derive them

- **`conflictArm` runs BEFORE `ciRedArm`.** GitHub runs no `pull_request` checks for a merge ref that conflicts, so a red or pending CI on a conflicting head is not a finding. Putting it after `ciRedArm` makes a conflicting PR with stale red checks start a CI fixer that cannot succeed.
- **The attempt key is head AND base tip, not head alone.** A conflict is a fact about two commits. A head-only key refuses a second attempt after the base moves, although the second attempt faces a different conflict; a base-tip-only key retries forever on the same head. One attempt per `(head, baseTip)`, at most 2 per PR.
- **`not-conflicting` refuses before the attempt is written.** After a base move GitHub reports `UNKNOWN` for a short window. An attempt written on that reading spends budget on a PR with no conflict. Reuse `MergeabilitySchema`; add no new word list.
- **Merge, never rebase, never force-push.** A rebase rewrites the head a person or a reviewer already saw, and the fixer's push would need `--force`, which the role gate refuses. `git merge` adds one commit and the push is a fast-forward.
- **No bundle rebuild in a conflict resolution.** `main` builds its own bundles after every merge, and `scripts/check-no-bundle-diff.sh` refuses a PR carrying one. The prompt names the restore from the merge base for that reason, not "take ours": *ours* inverts between merge and rebase.
- **`FIXER_ATTEMPTS_VERSION` stays 1.** Bumping it makes every older reader treat every record as unreadable and holds every fixer on every PR. The accepted cost is the opposite one: an older board hides a `conflict` run silently. `fixerReadingOf` gets base-tip cells for it.
- **A desk agent keeps its own conflict ending.** `conflictArm` answers `none('desk-alive')` for a live desk. Starting a fixer beside a live agent is a second writer on one branch.
- **Rules carried over unchanged.** The index never says no: a missing or unread reading means hold, never "no conflict". Read the exit code, not the emptiness, for every `git` call the tick makes for the base tip. A rule is a domain function with a unit test; the tick only calls it.

### Done when

The plan's slice 2 list is the specification:

- the schema round-trips the `conflict` arm, and an old-format reader reads it as unreadable;
- one test per `conflictArm` answer (`none` on a non-conflicting row, `unread`, `conflict-attempted`, `conflict-attempts-spent`, `desk-alive`, `fixer`);
- a second conflict on the same head and base tip holds; a new base tip after one attempt starts a second; a third holds as spent;
- `startFixer` refuses `not-conflicting` and writes no attempt;
- the prompt names the base, the merge-base restore and the protected-path stop;
- the merge arm holds `conflicting` on a row with the stored word `conflicting`.

Assertions that exist because a naive implementation passes without them:

- **A row with `mergeable: 'conflicting'` holds the merge arm.** A fixture still using `'CONFLICTING'` passes the old code and hides the defect. Update `slice-pr-next.test.ts` (both fixtures, plus the two further sites near the merge identity cells) and assert with the lowercase word.
- **A `conflict` finding on a PR with red CI answers `fixer` with `evidence: 'conflict'`, not `'ci-red'`.** Catches the arm order.
- **`not-conflicting` leaves the attempts record unchanged** (read it before and after). Catches an attempt written before the re-ask.
- **The `auto-fixer.test.ts` cells the panel named:** the world's `refs` pick carries what the base-tip read needs; the failed-start hold keys on head and base tip; the cells that pass today's reasons keep passing.
- **A `fixerTick` test for an unread base tip** answers `unread` and starts nothing.

Plus the repo gates: the changeset (`.changeset/*.md`, package `plot`, description FIRST and the `bumps:` block LAST, `plan:` line inside the block), and no committed bundle (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. A fleet agent does not run them locally. Run no `test:e2e`.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice has no reason to touch a `.sh` file; if it does, growth is paid for in the same change by removing shell elsewhere or by writing the rule in the domain and asking it through a bundle. The gate counts commands, not lines, and has no override.

New functions are arrow functions (`export const f = (…) => …`). TSDoc states what an export does, its parameters, its return and how it fails — not the history of the decision.

### Bookkeeping

- Open the PR through `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR is created, append `→ #<number>` to this branch's line under `### Conflict` in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `packages/domain/src/entities/fixer-attempts.ts`
- `packages/domain/src/rules/slice-pr-next.ts` (`conflictArm`, the stored-word constant, `FixerReading`, `SlicePrNextReadings`)
- `packages/domain/src/rules/fixer-attempts.ts`
- `packages/domain/src/rules/fixer-start.ts`
- `packages/fleet/src/shared/auto-fixer.ts`
- their tests under `packages/domain/test/` and `packages/fleet/`, and one changeset.

Not in this branch: `RoleRun.finding`, `agentRowFactsOf`, `delivery-row-form.ts` and the "fixing conflict ✗" wording (the Board slice, `feature/the-fixer-row-names-its-finding`); `reviewPrNext` and `auto-review.ts` (the Review slice, `feature/the-review-reads-the-fixer-scope`, which also edits `slice-pr-next.ts` — keep the `conflictArm` hunk apart from `guardArm` and `slicePrNext`, so the two merge without conflict); `slicePrNext` and `guardArm` must not change behaviour, and `mergeArm` changes only its comparison word.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
