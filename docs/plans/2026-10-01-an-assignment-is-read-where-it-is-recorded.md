# An assignment is read where it is recorded

> The supervisor writes an assignment into a manifest, and the queue reads only claim refs. Between the hand-over and the agent's claim push, nothing the next tick reads records the assignment. A release and a rejected claim push meet in the same gap, and the loop then names a double assignment that did not happen.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1039, #1152
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The supervisor does not hand out a slice that a live agent's manifest already names, and its tick line counts such a slice as `assigned=N`.
- The supervisor tick names every claim ref that holds only `plot: claim` commits and that no live agent's manifest names, with the `--release` command that clears it.
- `plot-dispatch.sh --release` refuses a branch that a live agent's manifest names, even while that agent's desk still holds another branch, and names the agent.
- A rejected claim push names what origin holds: a stale empty claim with its release command, another live agent by id, or work on the ref. It reports `REGISTRY LOCK VIOLATION` only where another live agent's manifest names the branch.

## Motivation

Measured on `origin/main` (`76124f61` and later), 2026-10-01.

**The queue reads refs and never manifests.** `readQueue` (`packages/board/src/server/queue-reading.ts:209-262`) receives the registry's manifests as `entries`, but it uses them only to build the agent list. The queue is built from `queueOfPlan(plan, claimed, merged)` (`:245`), and `queueOfPlan` drops a branch only where `claimed.has(line.branch) || merged.has(line.branch)` (`:144-145`). `claimed` is `claimedBranches()`, which reads `git for-each-ref refs/remotes/origin` (`registryd-main.ts:554-562`, `packages/domain/src/adapters/refs/refs-git.ts:149-156`): the checkout's remote-tracking refs, as fresh as its last fetch or push. `isAgentFree` (`packages/domain/src/rules/free.ts:64-67`) closes the agent side, because an agent whose manifest names a branch is not free. Nothing closes the slice side.

**It fired on this sprint's own slices.** `.plot/logs/registryd.log`, 2026-10-01, lines 23794-23833:

1. One tick handed three slices, among them `bug/a-closed-sprint-stops-filtering` to agent `8111e3ec`.
2. That agent's claim push was rejected. Origin still held an empty claim at `142ae697`, left by a start step run outside the supervisor (#1090). The loop logged `REGISTRY LOCK VIOLATION … two agents were given one branch` (`plot-worker-loop.sh:2290-2291`). No second agent held the branch.
3. Two ticks later the supervisor handed `bug/the-tally-names-its-tickets` to the same agent `8111e3ec`, while its desk still held `bug/a-closed-sprint-stops-filtering` and its prompt ran there.
4. `plot-dispatch.sh --release bug/a-closed-sprint-stops-filtering` then deleted the stale ref. The agent worked the slice with no claim on origin until its claim commit `20e1eab3` was pushed by hand.

**`--release` checks only the desk that holds the branch.** Its live-worker refusal (`plot-dispatch.sh:2031-2046`) asks `plot_worker_state` of `release_wt`, the worktree whose HEAD is the branch. An agent that was just handed the branch has not checked it out yet, so `release_wt` is empty and the refusal does not run. The release then clears every manifest that names the branch (`:2008-2012`, `:2103-2117`) and deletes the ref, under the agent that was handed it.

**The issues' own record.** #1039's comments measure the other direction twice: claim refs with no manifest behind them held `not-claimable` beside idle agents (`handed=0 idle=3 not-claimable=318`, 2026-09-29), and a release moved the queue on the next tick. Nothing in Plot reports a claim with no agent behind it, and four wrong diagnoses were tried first.

**What is in flight next door.** `docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md` (#1100, #1149) changes `queueOfPlan`'s order rule, adds the `waits` hold, adds `handOverCheck` before each hand-over, and changes the rejection message for an absent ref. It states that telling a stale empty claim from another agent's claim is #1152's. This plan builds on both of its slices and changes none of their decisions.

## Design

### Slice 1: the queue reads the assignment

**The reading.** `readQueue` already holds `entries` and asks `stateOf` for each (`queue-reading.ts:340-370`). It builds `assigned: ReadonlyMap<string, string>`, branch to agent id, from every entry whose manifest names a non-empty branch and whose state is `running` or `waiting`. A manifest whose worker is gone is not an assignment: #1039's negative control (`test/reconcile/release.test.mjs`) shows a dead agent pushes nothing, and holding its slice would hold it forever.

**The rule.** `QueuedSlice` (`packages/domain/src/rules/queue.ts`) gains `assignedTo: string`, `''` where no live manifest names the branch. `QueueHold` (`:102-123`) gains `'assigned'`. `whyNotReady` (`:205-210`) answers `'assigned'` for a slice whose `assignedTo` is not empty, tested after the two landing holds and before every other hold. `QUEUE_HOLDS` (`:138-144`) and `HOLD_SCOPE` (`registryd-main.ts:1203`, scope `queue`) add the key, so the tick line counts `assigned=N` and lists `<branch>: assigned to <agent>`.

**Orphaned claims.** A new rule `orphanedClaims(readings)` in `packages/domain/src/rules/queue.ts` takes, for each branch a plan names that has a remote-tracking ref and no merged PR: `claimOnly` (every commit on the ref that the default branch lacks has a subject that starts `plot: claim `) and `assignedTo`. It answers the branches where `claimOnly` is true and `assignedTo` is empty. The refs port gains `claimOnly(branch)` in `refs-git.ts`: `git log --format=%s origin/<main>..origin/<branch>`, answering `true`, `false`, or `unknown` on a failed call, which never names a branch. It is a git call and spends no host budget. It is asked only for refs that a plan names and that are not merged.

The tick writes `orphaned-claims=N` and, for each, `<branch>: claim with no agent — plot-dispatch.sh --release <branch>`. It reports and never releases: deleting a ref is the one write here that cannot be undone, and an agent that dies seconds after its push looks the same for one tick.

### Slice 2: a release and a rejected push name the agent

**The rule.** A new rule `claimAnswer(readings)` in `packages/domain/src/rules/claim.ts` takes `refTip` (`absent`, `claim-only`, `work`, or `unknown`) and `holders` (the agent ids whose live manifests name the branch, the asker excluded), and answers one of:

| Answer | When |
|---|---|
| `held-by-agent` | `holders` is not empty |
| `work-on-ref` | `refTip` is `work` |
| `stale-claim` | `refTip` is `claim-only` |
| `absent` | `refTip` is `absent` |
| `unknown` | `refTip` is `unknown` |

The rows are tested in this order. A live holder is first because it is the only case where two agents hold one slice.

**The bundle.** `skills/plot/scripts/board/plot-claim-answer.mjs` reads the readings as JSON on stdin and prints the answer and the holders. The two callers run once per operator command and once per rejected push, which the cost rule in `docs/shell-and-domain.md` permits.

**`--release`.** Before it clears any manifest, `--release` collects the live holders: the agents whose manifests name the branch and whose worker is alive in its own desk, whatever branch that desk holds. It asks `plot-claim-answer.mjs`, and on `held-by-agent` it refuses, names each agent id and desk, and writes nothing. The existing refusals (`plot-dispatch.sh:1990-2090`) are unchanged.

**The loop.** When the claim push is rejected (`plot-worker-loop.sh:2290`), the loop reads `refTip` through `git log --format=%s origin/<main>..origin/<branch>` after a `git fetch origin <branch>`, reads the holders from the registry, and asks the bundle. It prints:

- `held-by-agent`: the existing `REGISTRY LOCK VIOLATION` line, with the other agent's id;
- `stale-claim`: *"origin/<branch> holds only an empty claim at <sha> and no live agent names it; release it with `plot-dispatch.sh --release <branch>`"*;
- `work-on-ref`: *"origin/<branch> carries work that no live agent holds; a person decides"*;
- `absent` and `unknown`: the lines that `bug/a-hand-over-is-checked-before-it-is-made` writes.

In every case the loop then asks for another branch, as today. It does not release the ref itself.

### What this does NOT do

- It does not change the slice order, `waits:`, or `handOverCheck`. Those are `the-queue-reads-the-order-the-scan-reads`.
- It does not delete or repair any claim automatically. Slice 1 reports orphaned claims; a person releases them.
- It does not stop a start step from leaving an empty claim. That is `docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md` (#1090, #1151).
- It does not migrate the existing `--release` refusals into the domain. It adds one refusal, asked through the domain.

## Slices

### The queue reads the assignment (Branch: bug/the-queue-reads-the-assignment) <!-- waits: bug/the-queue-reads-the-scans-order -->

`assignedTo`, the `assigned` hold and its tick count, `orphanedClaims`, and `claimOnly` on the refs port. <!-- builds: assigned queue hold, orphanedClaims, claimOnly -->

### A release and a rejected push name the agent (Branch: bug/a-release-and-a-rejected-push-name-the-agent) <!-- waits: bug/a-hand-over-is-checked-before-it-is-made -->

`claimAnswer`, `plot-claim-answer.mjs`, the `--release` refusal, and the rejection messages in the loop. <!-- builds: claimAnswer, plot-claim-answer.mjs -->

## Done when

- Slice 1: a unit case gives `whyNotReady` a slice with `assignedTo` set and asserts `assigned`; with `assignedTo` empty it falls through to the existing holds.
- Slice 1: a `readQueue` test with two entries, one live and naming `bug/x`, one dead and naming `bug/y`, both refless and briefed, asserts `bug/x` is held `assigned` and `bug/y` is offered.
- Slice 1: a tick test with a fixture estate replays the 2026-10-01 sequence: an agent handed `bug/x`, its push not yet made, the next tick with a second free agent. It asserts the second agent is not handed `bug/x`.
- Slice 1: unit cases for `orphanedClaims` (claim-only and unassigned is named; assigned, carrying work, or `unknown` is not), and a `claimOnly` case each for `true`, `false` and a failed call, at 100% branch coverage.
- Slice 2: one unit case per `claimAnswer` row, at 100% branch coverage.
- Slice 2: a contract test runs `--release` against a sandbox where a live agent's manifest names the branch while its desk holds another branch, and asserts the refusal names the agent and that the manifest and the ref are unchanged.
- Slice 2: a contract test rejects a claim push against a ref that holds one `plot: claim` commit and no live holder, and asserts the `stale-claim` line with the release command and no `REGISTRY LOCK VIOLATION`.
- Both: `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board` and `pnpm run typecheck` pass, with a changeset per slice.

## Notes

Slice 1 waits on `bug/the-queue-reads-the-scans-order` because both change `queueOfPlan`, `QueueHold` and `HOLD_SCOPE`. Slice 2 waits on `bug/a-hand-over-is-checked-before-it-is-made` because both change the rejection branch at `plot-worker-loop.sh:2290`.
