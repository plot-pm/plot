## Implementation brief — an-assignment-is-read-where-it-is-recorded (slice 1: The queue reads the assignment)

- **Plan (canonical):** `docs/plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md` on `main`, as amended 2026-10-03 (`d26cb8929`)
- **Issues:** #1039, #1152 (this slice answers #1039)
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-queue-reads-the-assignment` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This is wave 1 of 2.** Slice 2, `bug/a-release-and-a-rejected-push-name-the-agent`, waits on `bug/a-hand-over-is-checked-before-it-is-made` (#1252, merged) and builds `claimAnswer` on the `claimTip` you write here. Both prerequisites of this slice, `bug/the-queue-reads-the-scans-order` (#1247) and `#1252`, are on `main`. Do not touch `plot-worker-loop.sh`, the `--release` code or `claimAnswer`: they are slice 2.

### What to build

On 2026-10-01 the supervisor handed agent `8111e3ec` a second slice while its manifest still named the first, because the queue reads claim refs and never manifests. `readQueue` (`packages/board/src/server/queue-reading.ts:209` onwards) receives the registry's manifests as `entries` and uses them only to build the agent list. A branch leaves the queue only through `claimed.has(branch) || merged.has(branch)` in `queueOfPlan`. `claimed` is `claimedBranches` (`registryd-main.ts:710`), the checkout's remote-tracking refs, as fresh as its last fetch or push. Between a hand-over and the agent's claim push, nothing the next tick reads records the assignment. `isAgentFree` (`rules/free.ts:64`) closes the agent side; nothing closes the slice side.

Build, in this order:

1. **`assignedTo` and the `assigned` hold.** In `readQueue`, build `assigned: ReadonlyMap<string, string>` (branch to agent id) from every entry whose manifest names a non-empty branch and whose `stateOf` (`queue-reading.ts:447`) is `running` or `waiting`. `QueuedSlice` (`rules/queue.ts:21`) gains `assignedTo: string` (`''` where no live manifest names the branch). `QueueHold` gains `'assigned'`. `whyNotReady` (`rules/queue.ts:389`) answers `'assigned'` for a non-empty `assignedTo`, tested **after the two landing holds and before `waits`**, therefore before every other hold. `QUEUE_HOLDS` (`:289`) and `HOLD_SCOPE` (`registryd-main.ts:1427`, scope `queue`) gain the key, in `QUEUE_HOLDS` at the position `whyNotReady` tests it. The tick line's `held on assigned (N):` block (`registryd-main.ts:1532` onwards) and `tickLine`'s counts come from `QUEUE_HOLDS`, so the key reaches both. The block prints `<branch>` per slice today; make it print `<branch>: assigned to <agent>` for this hold, the way the `waits` hold prints its own form.
2. **`packages/domain/src/rules/claim.ts`** holding `claimTip` and `orphanedClaims`, built on `isEmptyClaim` and `realCommits` from `rules/empty-claim.ts` (#1244). It never compares a subject itself.
3. **`commitSubjects(range)` on the refs port** (`ports/refs.ts`), implemented in `adapters/refs/refs-git.ts` with `git log --boundary` and a format carrying each commit's time, subject, tree and parents. It answers `{ at, subject, tree, parentTree }` values, newest first, with `parentTree` taken from the boundary lines and `null` where the first parent's tree cannot be read. It answers an error on a failed call and decides nothing about the commits. Add it to `refs-fixture.ts` too.
4. **The tick reads orphaned claims.** For each branch a plan names that has a remote-tracking ref and no merged PR, the tick reads `claimTip`, the newest claim commit's time and `assignedTo`, and asks `orphanedClaims`. It writes `orphaned-claims=N` and, per branch, `<branch>: claim with no agent — plot-dispatch.sh --release <branch>`. It reports and never releases.

Close by reading the plan: it is canonical, this is orientation.

### Decisions the plan settles — do not re-derive them

**A dead agent's manifest is not an assignment.** Only `running` and `waiting` count. #1039's negative control (`test/reconcile/release.test.mjs`) shows a dead agent pushes nothing, so counting it would hold its slice forever. Do not widen the filter to "any manifest naming a branch" to make a test easier.

**The claim vocabulary has one home: `rules/empty-claim.ts`.** A claim marker is a commit whose subject starts `plot: claim ` AND whose tree equals its first parent's tree. A subject-only predicate was the plan's first draft and was replaced: a commit titled `plot: claim handling refactor` that changes a file is real work, so a subject-only test deletes a ref that carries work. `claimTip` calls `realCommits`; it does not re-test the prefix. The prefix comparison exists in `empty-claim.ts` and nowhere else.

**`commitSubjects` is not `commitsSync`.** `commitsSync` (`ports/refs.ts:404`, `refs-git.ts:472`) already answers `{ sha, subject }` and is synchronous, `--no-merges`, `%h %s`. It carries no time, tree or parent tree, and `--no-merges` would drop the boundary lines `parentTree` needs. Add the new method beside it; do not widen `CommitLine`, which other callers read.

**`parentTree` is `null`, not `''`, where it cannot be read, and `isEmptyClaim` then counts the commit as real work.** Absent is not false: a missing reading must never turn a commit into a deletable claim.

**`claimTip` answers `unknown` on a failed read, and `unknown` never names a branch.** Read the call's result, not the emptiness of its output: an empty list from a failed call reads as `claim-only` and names a ref with work on it. A ref with no commit ahead of the default branch is `claim-only` (it locks a slice and carries nothing); that is a different answer from `absent` (no ref).

**`orphanedClaims` names a branch only when the newest claim commit is older than one tick interval** (`TICK_INTERVAL_MS`, 60 s, `entry/registryd.ts:52`). The bound excludes an agent that pushed its claim after the tick read its manifest: that claim reads orphaned for one tick and is not. Take the tick time as a reading, not `Date.now()`, so the rule stays pure.

**`commitSubjects` is asked only for refs that a plan names and that are not merged.** The estate holds hundreds of remote refs; a `git log` per ref across all of them is the 14x cost that `readQueue`'s comment at `:230` records for the per-branch host call. Measure the tick before and after on this checkout and put both numbers in the commit message.

**The tick reports; it never releases.** Deleting a ref is the one write here that cannot be undone. `--release` stays a person's command.

**The reading is a git call and spends no host budget.** No `host` port call, no `plot-host.sh`.

**Rules carried over unchanged:** absent is not false (a missing row is not a `none`); read the exit code, not the emptiness; a held slice is a hold rather than an offer; `claimedBranches` still answers `new Set(['*'])` on an unreadable ref list and that direction stays.

### Done when

The plan's `## Done when` list is the specification, slice 1 lines. The assertions that exist because a naive implementation would pass without them:

- **The `readQueue` test with a live and a dead agent** (live naming `bug/x`, dead naming `bug/y`, both refless and briefed) asserts `bug/x` is held `assigned` and `bug/y` is **offered**. A naive filter on "manifest names a branch" passes the first half and holds `bug/y` forever.
- **The tick replay** of the 2026-10-01 sequence (agent handed `bug/x`, its push not made, next tick with a second free agent) asserts the second agent is not handed `bug/x`. It must fail on `main` today; run it there first.
- **`whyNotReady` ordering:** a slice with `assignedTo` set AND `waitHeld` set answers `assigned`, and one with `landed: 'landed'` answers `already-merged`. Without the second case the hold could move above the landing holds unnoticed.
- **`claimTip` has one case per answer** (`absent`, `claim-only`, `work`, `unknown`, no commit ahead) at 100% branch coverage, plus a `plot: claim …` commit that changes a file, which answers `work`, and one whose `parentTree` is `null`, which also answers `work`.
- **`orphanedClaims`:** claim-only, unassigned and older than one tick is named; assigned, carrying work, `unknown`, or younger than one tick is not. The exactly-one-tick boundary needs its own case: say which side it falls on and assert it.
- **`commitSubjects`:** a case each for a ref with commits, an empty range and a failed call, asserting the adapter returns times, subjects, trees and parent trees and **no classification**.
- **The one-home check:** a check fails on any `plot: claim ` prefix comparison outside `packages/domain/src/rules/empty-claim.ts`. The loop's `git commit -m "plot: claim …"` writes the subject and is not a comparison, so grep for comparisons (`startsWith`, `case`, `==`, `=~`, `grep -q`), not for the string. Add it as `scripts/check-*.sh` and name it in the `## Plot Config` `Local checks` line and in CI beside its siblings, the way `check-ancestry-decisions.sh` is. A grep a test can pass without running is a rule; prove the check fails on a planted violation.
- **The tick line:** the held-list test at `registryd-main.test.ts` iterates `QUEUE_HOLDS` and picks up the new key; assert the full `<branch>: assigned to <agent>` line and the `orphaned-claims=N` line with its release command.

Plus: `nvm use` (Node 24; `pnpm` crashes on 26). Before each push run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e`. Domain coverage gate at 100% branches. A changeset for `@plot-pm/board` (package frontmatter, description first; no `bumps:` block). Do not commit the rebuilt board artifact: `scripts/check-no-bundle-diff.sh` refuses it and `main` builds its own. Run `pnpm build:board` only to test.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's heading line in the plan's `## Slices` section, from a detached scratch worktree on `origin/main`. Push the first real commit as soon as it exists.

### Rules that bite this slice

- New functions are arrow functions; TSDoc says what a function returns and how it fails. The reasoning goes in the commit message and the plan.
- The domain imports `zod` and nothing else outside `adapters/`. `claimTip` and `orphanedClaims` read nothing and take readings as values.
- A new `QueueHold` key fails the build in `HOLD_SCOPE` until it is added there; that is intended.
- Use `trash`, never `rm`. Never `git stash` in a shared worktree.

### Rollout note

The supervisor loads `plot-registryd.mjs` once. The fix takes effect after the artifact is rebuilt and the supervisor restarts. Do not restart it yourself.

### Scope guard

This branch owns `packages/domain/src/rules/queue.ts`, the new `packages/domain/src/rules/claim.ts`, `packages/domain/src/ports/refs.ts`, `packages/domain/src/adapters/refs/refs-git.ts` and `refs-fixture.ts`, `packages/board/src/server/queue-reading.ts`, the `HOLD_SCOPE`, held-list and tick-line code in `packages/board/src/server/entry/registryd-main.ts` and `registryd.ts`, the new one-home check script with its CI and Local checks lines, their tests, and the `Local checks` row for any new bundle (none is built here).

In flight, verified 2026-10-03 against `git ls-remote --heads origin` and `git diff origin/main...origin/<branch> --stat`:

- `bug/the-artifact-repair-is-retired` changes only the generated `skills/plot/scripts/board/plot-registryd.mjs` among the files above. Never take either side of that file; see `CLAUDE.md` › Testing for the conflict procedure.
- `bug/the-desk-has-a-lifecycle` adds `rules/desk-lifecycle.ts` and edits `rules/reapable.ts`. No overlap.
- `bug/the-parser-reads-every-wait` touches none of these files.
- Not yet branched and named by the plan: `a-handed-slice-reads-as-taken` (#1150) owns the board's reading of a hand-over; the `assigned` hold and `orphaned-claims` appear only in the tick line, so do not touch board rendering.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
