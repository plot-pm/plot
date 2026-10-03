# An assignment is read where it is recorded

> The supervisor writes an assignment into a manifest, and the queue reads only claim refs. Between the hand-over and the agent's claim push, nothing the next tick reads records the assignment. A release and a rejected claim push meet in the same gap, and the loop then names a double assignment that did not happen.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1039, #1152
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The supervisor does not hand out a slice that a live agent's manifest already names, and its tick line counts such a slice as `assigned=N`.
- The supervisor tick names every claim ref that holds only `plot: claim` commits, that no live agent's manifest names, and whose newest claim commit is older than one tick interval, with the `--release` command that clears it.
- `plot-dispatch.sh --release` refuses a branch that a live agent's manifest names, even while that agent's desk still holds another branch, and names the agent.
- A rejected claim push names what origin holds: a stale empty claim with its release command, another live agent by id, or work on the ref. It reports `REGISTRY LOCK VIOLATION` only where another live agent's manifest names the branch.
- After a rejected claim push the loop does not run the previous slice's prompt again. It clears its own assignment and waits for a hand-over as a free agent.

## Motivation

Measured on `origin/main` (`76124f61` and later), 2026-10-01.

**The queue reads refs and never manifests.** `readQueue` (`packages/board/src/server/queue-reading.ts:209-262`) receives the registry's manifests as `entries`, but it uses them only to build the agent list. The queue is built from `queueOfPlan(plan, claimed, merged)` (`:245`), and `queueOfPlan` drops a branch only where `claimed.has(line.branch) || merged.has(line.branch)` (`:144-145`). `claimed` is `claimedBranches()`, which reads `git for-each-ref refs/remotes/origin` (`registryd-main.ts:554-562`, `packages/domain/src/adapters/refs/refs-git.ts:149-156`): the checkout's remote-tracking refs, as fresh as its last fetch or push. `isAgentFree` (`packages/domain/src/rules/free.ts:64-67`) closes the agent side, because an agent whose manifest names a branch is not free. Nothing closes the slice side.

**It fired on this sprint's own slices.** `.plot/logs/registryd.log`, 2026-10-01, lines 23794-23833:

1. One tick handed three slices, among them `bug/a-closed-sprint-stops-filtering` to agent `8111e3ec`.
2. That agent's claim push was rejected. Origin still held an empty claim at `142ae697`, left by a start step run outside the supervisor (#1090). The loop logged `REGISTRY LOCK VIOLATION … two agents were given one branch` (`plot-worker-loop.sh:2290-2291`). No second agent held the branch.
3. Two ticks later the supervisor handed `bug/the-tally-names-its-tickets` to the same agent `8111e3ec`, while its desk still held `bug/a-closed-sprint-stops-filtering` and its prompt ran there.
4. `plot-dispatch.sh --release bug/a-closed-sprint-stops-filtering` then deleted the stale ref. The agent worked the slice with no claim on origin until its claim commit `20e1eab3` was pushed by hand.

**What emptied the manifest between steps 2 and 3.** `isAgentFree` (`free.ts:64-67`) answers free only for an empty manifest branch or a merged slice, and `bug/a-closed-sprint-stops-filtering` had no PR, so `sliceHasMerged` answered `false`. So at step 3 the manifest of `8111e3ec` named no branch. The writer is the loop's own `clear_manifest_branch` (`plot-worker-loop.sh:2128-2130`), and the path to it is the rejection's `continue` (`:2292`):

- `continue` re-enters the loop with `$PLOT_BRANCH` unchanged. Only a successful hop sets it (`:2314`). Here it still named the agent's previous slice, `bug/the-loop-waits-out-a-usage-limit`.
- The branch-holding block (`:1905`) therefore ran that previous slice's prompt again, in the desk that `reset_desk` (`:2227`) had just moved onto `bug/a-closed-sprint-stops-filtering`. The agent's own report in `.worktrees/free-311eb148/.plot-worker.log` (lines 52-104) says so: *"This desk is no longer on my branch"*, HEAD `20e1eab3`.
- The prompt exited 0, and the loop sealed a declaration and cleared the manifest branch at `:2129`. The next line in the log is `free on ?`, and 360 s later the supervisor handed `bug/the-tally-names-its-tickets` (claim `00f39b36`, 19:46:55).

`--release` is not the writer for this hand-over. It clears the manifests and then deletes the ref in one command (`plot-dispatch.sh:2103-2117`), and at the tally hand-over tick the queue still counted `bug/a-closed-sprint-stops-filtering` as not-claimable, so its ref stood. It appears under `no-free-agent` only in later ticks (`registryd.log:23863` onwards). The operator's earlier `--release` over seven branches released `bug/the-loop-waits-out-a-usage-limit`, the slice whose prompt the loop ran again.

Slice 2's `--release` refusal does not close this path, because no release runs on it. Slice 2 therefore fixes the rejection path in the loop.

**`--release` checks only the desk that holds the branch.** Its live-worker refusal (`plot-dispatch.sh:2031-2046`) asks `plot_worker_state` of `release_wt`, the worktree whose HEAD is the branch. An agent that was just handed the branch has not checked it out yet, so `release_wt` is empty and the refusal does not run. The release then clears every manifest that names the branch (`:2008-2012`, `:2103-2117`) and deletes the ref, under the agent that was handed it.

**The issues' own record.** #1039's comments measure the other direction twice: claim refs with no manifest behind them held `not-claimable` beside idle agents (`handed=0 idle=3 not-claimable=318`, 2026-09-29), and a release moved the queue on the next tick. Nothing in Plot reports a claim with no agent behind it, and four wrong diagnoses were tried first.

**What is in flight next door.** `docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md` (#1100, #1149) changes `queueOfPlan`'s order rule, adds the `waits` hold, adds `handOverCheck` before each hand-over, and changes the rejection message for an absent ref. It states that telling a stale empty claim from another agent's claim is #1152's. This plan builds on both of its slices and changes none of their decisions.

## Design

### Slice 1: the queue reads the assignment

**The reading.** `readQueue` already holds `entries` and asks `stateOf` for each (`queue-reading.ts:340-370`). It builds `assigned: ReadonlyMap<string, string>`, branch to agent id, from every entry whose manifest names a non-empty branch and whose state is `running` or `waiting`. A manifest whose worker is gone is not an assignment: #1039's negative control (`test/reconcile/release.test.mjs`) shows a dead agent pushes nothing, and holding its slice would hold it forever.

**The rule.** `QueuedSlice` (`packages/domain/src/rules/queue.ts`) gains `assignedTo: string`, `''` where no live manifest names the branch. `QueueHold` (`:102-123`) gains `'assigned'`. `whyNotReady` (`:205-210`) answers `'assigned'` for a slice whose `assignedTo` is not empty, tested after the two landing holds and before every other hold. `QUEUE_HOLDS` (`:138-144`) and `HOLD_SCOPE` (`registryd-main.ts:1203`, scope `queue`) add the key, so the tick line counts `assigned=N` and lists `<branch>: assigned to <agent>`.

**The claim vocabulary has one home.** A new file `packages/domain/src/rules/claim.ts` holds `claimTip`, `orphanedClaims` and slice 2's `claimAnswer`. The `plot: claim ` prefix test exists there and nowhere else: no adapter, script or bundle caller compares a subject with the prefix.

**The reading.** The refs port (`packages/domain/src/ports/refs.ts:79`) gains `commitSubjects(range)`, implemented in `refs-git.ts` as `git log --format=%ct%x09%s <range>`. It answers the commits as `{ at, subject }` values, newest first, or an error on a failed call. It decides nothing about the subjects. It is a git call and spends no host budget.

**`claimTip(commits)`** answers `absent` for no ref, `claim-only` where every commit has a subject that starts `plot: claim `, `work` where any commit does not, and `unknown` where the read failed. A ref with no commit ahead of the default branch is `claim-only`: it locks a slice and carries nothing.

**Orphaned claims.** `orphanedClaims(readings)` takes, for each branch a plan names that has a remote-tracking ref and no merged PR: the `claimTip`, the time of the newest claim commit, `assignedTo`, the time of the tick, and the tick interval. It answers the branches where the tip is `claim-only`, `assignedTo` is empty, and the newest claim commit is older than one tick interval (`TICK_INTERVAL_MS`, 60 s, `packages/board/src/server/entry/registryd.ts:52`). The age bound excludes an agent that pushed its claim after the tick read its manifest: that claim reads orphaned for one tick and is not. `unknown` never names a branch. `commitSubjects` is asked only for refs that a plan names and that are not merged.

The tick writes `orphaned-claims=N` and, for each, `<branch>: claim with no agent — plot-dispatch.sh --release <branch>`. It reports and never releases: deleting a ref is the one write here that cannot be undone.

### Slice 2: a release and a rejected push name the agent

**The rule.** A new rule `claimAnswer(readings)` in `packages/domain/src/rules/claim.ts` takes the commits on the ref, classifies them with `claimTip` into `refTip` (`absent`, `claim-only`, `work`, or `unknown`), and takes `holders` (the agent ids whose live manifests name the branch, the asker excluded), and answers one of:

| Answer | When |
|---|---|
| `held-by-agent` | `holders` is not empty |
| `work-on-ref` | `refTip` is `work` |
| `stale-claim` | `refTip` is `claim-only` |
| `absent` | `refTip` is `absent` |
| `unknown` | `refTip` is `unknown` |

The rows are tested in this order. A live holder is first because it is the only case where two agents hold one slice.

**The bundle.** `skills/plot/scripts/board/plot-claim-answer.mjs` reads the readings as JSON on stdin, the raw commit subjects among them, and prints the answer and the holders. The callers pass subjects and never classify them. The two callers run once per operator command and once per rejected push, which the cost rule in `docs/shell-and-domain.md` permits. The slice adds the bundle's row to the helper-script table in `CLAUDE.md`, as the other bundles have.

**`--release`.** Before it clears any manifest, `--release` collects the live holders: the agents whose manifests name the branch and whose worker is alive in its own desk, whatever branch that desk holds. It asks `plot-claim-answer.mjs`, and on `held-by-agent` it refuses, names each agent id and desk, and writes nothing. The existing refusals (`plot-dispatch.sh:1990-2090`) are unchanged.

**The loop.** When the claim push is rejected (`plot-worker-loop.sh:2290`), the loop runs `git fetch origin <branch>`, reads the subjects with `git log --format=%ct%x09%s origin/<main>..origin/<branch>`, reads the holders from the registry, and passes all of them to the bundle. It prints:

- `held-by-agent`: the existing `REGISTRY LOCK VIOLATION` line, with the other agent's id;
- `stale-claim`: *"origin/<branch> holds only an empty claim at <sha> and no live agent names it; release it with `plot-dispatch.sh --release <branch>`"*;
- `work-on-ref`: *"origin/<branch> carries work that no live agent holds; a person decides"*;
- `absent` and `unknown`: the lines that `bug/a-hand-over-is-checked-before-it-is-made` writes.

**Then the loop gives up the hand-over, and this closes the path that emptied the manifest of `8111e3ec`.** Before `continue`, the loop runs `clear_manifest_branch` on its own manifest and sets `PLOT_BRANCH` to empty. The next pass skips the branch-holding block (`:1905`) and waits in `wait_for_work` as a free agent. It does not run the previous slice's prompt in a desk cut for another branch, and it does not seal a declaration for a slice it did not work. Clearing its own manifest returns no slice to the queue: the ref on origin still holds the branch as not-claimable, and slice 1 reports it as orphaned once it is older than one tick. Without the clear, the manifest still names the rejected branch, and the next pass would read it in `assigned_branch` and push the same rejected claim again. The loop does not release the ref itself.

### What this does NOT do

- It does not change the slice order, `waits:`, or `handOverCheck`. Those are `the-queue-reads-the-order-the-scan-reads`.
- It does not change how the board shows a handed slice or an orphaned claim. `docs/plans/2026-10-01-a-handed-slice-reads-as-taken.md` (#1150) owns the board's reading of a hand-over; the `assigned` hold and `orphaned-claims` appear only in the tick line.
- It does not delete or repair any claim automatically. Slice 1 reports orphaned claims; a person releases them.
- It does not stop a start step from leaving an empty claim. That is `docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md` (#1090, #1151).
- It does not migrate the existing `--release` refusals into the domain. It adds one refusal, asked through the domain.

## Slices

### The queue reads the assignment (Branch: bug/the-queue-reads-the-assignment) <!-- waits: bug/the-queue-reads-the-scans-order -->

`assignedTo`, the `assigned` hold and its tick count, `rules/claim.ts` with `claimTip` and `orphanedClaims`, and `commitSubjects` on the refs port. <!-- builds: assigned queue hold, claimTip, orphanedClaims, commitSubjects -->

### A release and a rejected push name the agent (Branch: bug/a-release-and-a-rejected-push-name-the-agent) <!-- waits: bug/a-hand-over-is-checked-before-it-is-made -->

`claimAnswer`, `plot-claim-answer.mjs`, the `--release` refusal, the rejection messages in the loop, and the loop giving up a rejected hand-over. <!-- builds: claimAnswer, plot-claim-answer.mjs -->

## Done when

- Slice 1: a unit case gives `whyNotReady` a slice with `assignedTo` set and asserts `assigned`; with `assignedTo` empty it falls through to the existing holds.
- Slice 1: a `readQueue` test with two entries, one live and naming `bug/x`, one dead and naming `bug/y`, both refless and briefed, asserts `bug/x` is held `assigned` and `bug/y` is offered.
- Slice 1: a tick test with a fixture estate replays the 2026-10-01 sequence: an agent handed `bug/x`, its push not yet made, the next tick with a second free agent. It asserts the second agent is not handed `bug/x`.
- Slice 1: one unit case per `claimTip` answer (`absent`, `claim-only`, `work`, `unknown`, and no commit ahead), at 100% branch coverage.
- Slice 1: unit cases for `orphanedClaims`: claim-only, unassigned and older than one tick is named; assigned, carrying work, `unknown`, or younger than one tick is not.
- Slice 1: a `commitSubjects` case each for a ref with commits, an empty range and a failed call, asserting the adapter returns subjects and times and no classification.
- Slice 1: a check fails on any `plot: claim` prefix comparison outside `packages/domain/src/rules/claim.ts`. The loop's `git commit -m "plot: claim …"` writes the subject and is not a comparison.
- Slice 2: one unit case per `claimAnswer` row, at 100% branch coverage.
- Slice 2: a contract test runs `--release` against a sandbox where a live agent's manifest names the branch while its desk holds another branch, and asserts the refusal names the agent and that the manifest and the ref are unchanged.
- Slice 2: a contract test rejects a claim push against a ref that holds one `plot: claim` commit and no live holder, and asserts the `stale-claim` line with the release command and no `REGISTRY LOCK VIOLATION`.
- Slice 2: a contract test replays the path of `8111e3ec`: a loop whose `PLOT_BRANCH` names a finished previous slice is handed a branch whose claim push is rejected. It asserts the prompt does not run again, no declaration is sealed for the previous slice, the manifest branch is empty after the rejection, and the next pass waits. The same test fails on `origin/main` today.
- Both: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass, with a changeset per slice.

## Notes

Slice 1 waits on `bug/the-queue-reads-the-scans-order` because both change `queueOfPlan`, `QueueHold` and `HOLD_SCOPE`. Slice 2 waits on `bug/a-hand-over-is-checked-before-it-is-made` because both change the rejection branch at `plot-worker-loop.sh:2290`.
- 2026-10-03, `scripts/check-shell-lines.sh` (`the-shell-shrinks-into-the-domain`, wave 1) refuses a pull request whose shell under `skills/` is longer than at its merge base. Offset the lines in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.
