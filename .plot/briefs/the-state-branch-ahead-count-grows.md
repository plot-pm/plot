## Implementation brief — the-state-branch-ahead-count-grows

- **Plan (canonical):** `docs/plans/2026-11-09-the-state-branch-ahead-count-grows.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3315 merged
- **Branch:** `bug/the-state-branch-ahead-count-grows` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

One slice, one branch. The dependency, #3292 (`feature/state-branch-sync`), merged on 2026-11-09, so `commitsBetween`, `syncPrDecision` and `syncPrAt` are on `main`.

### What to build

After a sync PR squash-merges, the state branch's commits stay unreachable from the default branch, so `git log <defaultRef>..<trackRef>` keeps counting every commit the branch ever carried. The count only grows: the board's lag line and the sync PR body report commits as pending that the default branch already holds. Issue #3314, from the review of #3292 (MEDIUM 1).

Add one pure rule in `packages/domain/src/rules/` (the plan names it `aheadSinceTreeEqual`). It takes the state branch's first-parent commits newest first, each with its tree id, plus the default branch's tree id. It returns the index of the first commit whose tree equals the default tree. A tip whose tree equals the default tree returns 0. With no tree-equal commit it returns the merge-base count, as today. Every reader calls this one rule, and the plan is canonical for the rest.

Today two call sites count, and they count differently:

- `commitsBetween(refs, defaultRef, trackRef)` at `packages/domain/src/workflows/state-sync.ts:51`. `syncPrAt` (line 126) feeds it to `syncPrDecision` and the PR body.
- `recordsAhead` at `packages/domain/src/workflows/record-listing.ts:80`. It counts the range, then returns 0 only when the tip tree equals the default tree (`syncedByTrees`). That is the tip-only version of the same idea, and the new rule replaces it.

### Decisions the plan settles — do not re-derive them

**Count commits since the last tree-equal commit, not changed record files.** Jan Wloka chose this on 2026-11-09. Do not reopen the file-count alternative.

**One count feeds every reader.** The lag line, the sync PR body, the `syncPrDecision` refresh comparison and `recordsAhead` all call the rule. A second count reproduces the defect in whichever reader keeps it, and it lets the Read slice and the Sync slice disagree.

**Do not touch the `behind` direction.** `commitsBetween(refs, trackRef, defaultRef)` in `forwardSyncAt` (`state-sync.ts:174`) feeds `forwardSync` and keeps its meaning. Only the ahead direction changes. If you change `commitsBetween` itself, the `behind` call changes too, so give the ahead path its own function or leave `commitsBetween` alone.

**The state branch carries merge commits — the plan's first premise was wrong.** fleetd's forward sync merges the default branch into the state ref (`ForwardSyncDecision` `merge` in `packages/domain/src/rules/state-sync.ts`). The rule walks first-parent history and stops at the first tree-equal commit. Every commit on the walk counts, except a forward-sync merge: a merge whose second parent is on the default branch. It carries default-branch content and no record. A forward merge right after a squash leaves the trees equal, so the count reads 0.

**A stale refresh costs one refresh.** A refresh recorded before the change carries the old count. The comparison sees a difference, refreshes the open PR once, and records the new count. Write no migration.

**Check the `Refs` port before adding to it.** `CommitSubject` (`ports/refs.ts`) carries `tree` and `parentTree` but no sha and no parent list. `commitSubjectsOf` (`adapters/refs/refs-git.ts:268`) reads only the first parent of `%P`, and the `default..state` range lists every commit, not the first-parent line. So the rule's input needs either a first-parent walk with a merge marker or a new `treeOf`-style method. The plan leaves the choice to you: add the smaller of the two. The rule stays pure over values; the adapter reads and does not decide.

**Rules carried over from related work.** Absent is not false: a failed read answers `null` (`ahead-unread` in `syncPrDecision`), never 0. A failed tree read must not read as "not equal" and fall through to a count that looks authoritative — name it unknown.

**Style.** Arrow functions and factual TSDoc in `packages/domain` (`CLAUDE.md`, *The Domain Package*). No history in comments; put the measurement in the commit message.

### Done when

The plan's `Tests:` line is the specification:

- A state branch squash-merged into the default branch and given two new commits reports 2 ahead.
- A state branch whose tip tree equals the default tree reports 0.
- A state branch with no tree-equal commit reports the merge-base count.

Plus the assertions a naive implementation passes without:

- **A forward-sync merge after a squash.** The state branch carries a merge whose second parent is on the default branch. A rule that counts every first-parent commit reports 1 where the right answer is 0 (trees equal) or the record commits only.
- **A merge in the middle of the walk.** Two record commits, a forward merge, one more record commit. The forward merge does not count; a rule that counts all merges reads 4 instead of 3.
- **`recordsAhead` and `syncPrAt` agree.** One fixture, both readers, the same number. This catches a second count left behind in either.
- **A failed tree read answers `null`, not 0.** This catches the "absent is false" error.
- **The `behind` input is unchanged.** `forwardSyncAt` reads the same count it read before.

Plus: the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Add a changeset (description first, `bumps:` block last) for the package this touches; `./scripts/check-changeset-packages.sh` checks it. The board's lag line reads the count, so a board test asserts the line only if its wording changes — it should not.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new rule and its test), `packages/domain/src/workflows/state-sync.ts`, `packages/domain/src/workflows/record-listing.ts`, the `Refs` port and `refs-git.ts` only if the port needs the widening, and the tests under `packages/domain/test/`. No other slice is in flight on these files: `feature/state-branch-sync` is merged, and `feature/state-branch-setup` waits on it and does not touch the count. Verify with `git log origin/main -5 -- packages/domain/src/workflows/state-sync.ts` at the start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
