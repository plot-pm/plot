Position: amend
# The cost lens — a fresh agent after a wait

Paths are relative to the worktree `/Users/jwloka/Quatico/Agentic-Tools/plot/.worktrees/jury-1954`.

## 1. Is each slice's problem real on current code?

**Slice 3 (#1903): the settled behaviour already exists in the domain.** `assign` → `scaleUp` (`packages/domain/src/workflows/assign.ts:168-176, 213-251`) emits `worker-start` writes with `branch: ''` when a slice is held on `no-free-agent`. With `agents: []`, every startable slice is held that way (`packages/domain/src/rules/queue.ts:670-679`). `packages/domain/test/queue.test.ts:540-557` ("starts agents for slices nothing could take, up to the cap", `agents: []`) proves it. fleetd performs the writes under `--start-agents` (`packages/fleet/src/server/entry/registryd-main.ts:1239-1258, 2309`), and both unit templates pass that flag (`skills/plot/units/com.plot-pm.fleetd.plist:40`). So at `agents=0` with an approved, briefed, claimable slice, fleetd already starts agents. The 2026-10-15 case in #1743 ("fleetd ran `agents=0`, so nothing would have built the next approved plan") therefore has a different cause. The candidates are:
- slices held on `no-brief` or `not-claimable`, which `scaleUp` deliberately does not count (`queue.test.ts:574-580`); or
- a daemon run without `--start-agents`; or
- a daemon on a stale bundle.

The plan does not name the cause. Two numbers also differ from the decision. The decision says "one fresh free agent". The existing path starts up to `DESKS_PER_TICK = 3` per tick (`registryd-main.ts:983`) towards `fleet.size`.

**Slice 1 (#1273), first defect: probably already fixed on main.** I ran `plot-plan-meta.sh` on a scratch plan with the issue's exact branch-line shape (`<!-- builds: x --> <!-- waits: infra/the-shell-loop-holds-unlanded-work -->` on the bullet). It printed `"waits_on":["infra/the-shell-loop-holds-unlanded-work"]` on that branch and `unread_waits: []`. The registry reads plans through the same script (`plan-store-shell.ts:148-159`). `branchOf` maps `waits_on` per branch into `waitsOn` (`plan-store-shell.ts:69-80`), and `planQueue` holds on it (`queue.ts:849-876`). #1265 ("The parser reads every wait", 2026-10-04 00:15) and #1253 landed before or around the measurement. fleetd does not reload its bundle, so the 10-04 23:04 and 10-05 08:19 hand-overs may come from a pre-#1265 daemon. I did not run `planQueue` itself, so this is strong evidence from code and not proof. The second defect (slice 2 held only on `no-brief`) cannot happen with the current `whyNotReady` while slice 1 is unmerged. In that state `claimable` is false, so the answer is `not-claimable` (`queue.ts:499`). This points the same way.

**Slice 2 (#1917): real as a path, and it has a real runtime cost.** `killedWorkerEnding` writes `unreadable` for any non-zero exit with a branch checked out (`packages/domain/src/rules/ending-action.ts:553-564`). `isBoundEnding` then reaches `start-fresh` when the branch holds work and `priorFreshSessions === 0`. It reaches `release-claim` otherwise (`ending-action.ts:302-307`). `start-fresh` launches a full `claude` session (`Implement command`, Sonnet), the most expensive action fleetd takes. The `fresh-agents.tsv` record (`registryd.ts:841`, `priorFreshSessions > 0 → needs-a-person`) bounds it to one spurious session per (plan, branch).

## 2. Is each proposed change right, and in the right layer?

- **Slice 1:** reading waits in the domain through the plan-store port is the right layer. Waits cost no extra host call: `prerequisiteAnswer` uses the one bundled merged listing plus the PR index (`packages/fleet/src/shared/queue-reading.ts:301-303`). A waits-held slice that is claimable and has its brief still pays one `prMerged` per tick. `queuedHasLanded` is asked under `entry.claimable && briefPresent` and not under `waitHeld === ''` (`queue-reading.ts:349-352`). The memo clears every tick (`registryd-main.ts:435-448`), and the tick runs every 60 s, so this is about 60 host calls an hour per held slice. Every slice this fix newly holds adds that cost.
- **Slice 2:** deciding from the claim in the domain is the right layer. The plan does not name the reading. A claim's owner is a remote fact, a ref on origin. Reading it per candidate desk per tick is either a network `ls-remote`/fetch, which is git-host traffic, or a local ref that can be stale. The plan must say which, and bound it to desks where `killedWorkerEnding` returned non-null. It must not cover every candidate.
- **Slice 3:** "code follows only if the answer is start" now forks. Under the binding decision the answer is "start", and `scaleUp` already starts. New code beside `scaleUp` would be a second starter beside two that exist: board auto-dispatch (`packages/domain/src/rules/auto-dispatch.ts:451-500`) and `scaleUp`. Each starter that counts slots differently risks crossing `Parallel agents`. The change belongs in `scaleUp`, or in whatever upstream reading kept the queue empty, and never in a new path.

## 3. What is missing, wrong or contradicted

- The plan says the slices "have no ordering between them". From the cost side, slice 3 depends on slice 2. Each new free agent at `agents=0` creates one more free desk that later ends at the wait bound with exit 124. If the old branch is still checked out, `killedWorkerEnding` turns that end into an `unreadable` ending and possibly a `start-fresh` Sonnet session. Starting more free agents before slice 2 lands multiplies the defect.
- There is no runtime bound in any done-when. Nothing states: agents started per tick (1 under the decision; 3 today), the ceiling (`fleet.size` via `fleetSize`), restarts per wait-bound cycle (at most one per `Worker bound` = 28800 s per desk), or host calls added per tick.
- There is no restart-loop analysis. A free agent counts as running (`assign.ts:224-226`), so `scaleUp` does not stack starts beside an idle agent. A start that dies immediately is a different case: `startAgents` treats a failed start as "the next tick tries again" (`registryd-main.ts:1251-1253`), which is one start per 60 s with no back-off. The plan should state that a fresh start after a wait-bound end inherits this, or bound it.
- The open question for #1903 still reads "the reader decides". It must record the operator's 2026-10-17 decision and its "one" and "bounded by fleet size" terms.

## 4. Amendments

See the numbered list below.

## 5. Position

**amend.** All three slices are cheap in host calls. None adds a per-branch host call beyond the one per tick that waits-held slices already pay. But slice 3 as framed would build a starter that already exists. Slice 1 may spend an agent on a defect main already fixed. The ordering claim ignores that slice 3 feeds slice 2's expensive `start-fresh` path. Each of these is fixable by amendment, so none justifies rejecting the plan.

## Amendments

1. Open Questions, #1903: replace with "Decided 2026-10-17 (Jan Wloka): after a free desk ends at the wait bound and the fleet is at agents=0, fleetd starts one fresh free agent when approved, startable slices are waiting, bounded by the configured fleet size."
2. Slice 3: first write a failing test through `assign`/`readQueue` that reproduces the 2026-10-15 `agents=0` estate. If `queue.test.ts:540` already passes for it, find the upstream reading that kept the queue empty (`no-brief`, `not-claimable`, a missing `--start-agents`, or a stale bundle) and fix that, not the start rule.
3. Slice 3: implement the start inside `scaleUp` (`assign.ts:213`) and add no new starter beside `scaleUp` and auto-dispatch. Done-when: one test asserts that a single start path counts against `Parallel agents`.
4. Slice 3: state the start count. Either "one per tick at `agents=0`", which differs from `DESKS_PER_TICK = 3`, or "the existing up to 3 per tick towards `fleet.size`". Pin the chosen number in a test.
5. Slices: add `<!-- waits: bug/a-free-desk-ending-acts-on-no-slice -->` to `bug/fleetd-at-agents-zero-after-a-wait`. Each extra free agent becomes a later exit-124 desk that #1917 can turn into a `start-fresh` Sonnet session.
6. Slice 2: name the claim-owner reading (local ref or remote ref, and which port). Bound it to desks where `killedWorkerEnding` is non-null. Add a done-when: "no host or remote call for a desk with no supervisor ending".
7. Slice 1: first add the failing test with the exact #1273 line through `plot-plan-meta.sh` → `branchOf` → `planQueue`. If it passes on main, the slice ships only the regression test and records that #1265 fixed it. It dispatches no further implementation.
8. Slice 1: gate `queuedHasLanded` on `waitHeld === ''` as well as `claimable && briefPresent` (`queue-reading.ts:349-352`), so that a slice held on `waits` costs no `prMerged` call per tick.
9. Notes: add a cost line naming the per-tick spend each slice adds (host calls, processes, agents started) and the bound on each, so the reviewer can check it against `spendForTick`'s `account=` line.

## What I looked at

I read code and also ran commands. I read the plan, issues #1950, #1903, #1917, #1273 and #1743 with comments (via `gh issue view`), `assign.ts`, `queue.ts`, `queue-reading.ts`, `auto-dispatch.ts`, `brief-budget.ts`, `ending-action.ts`, `agent-loop.ts`, `plan-store-shell.ts`, `registryd-main.ts` (start path, tick loop, merge memo, hand-over world) and `queue.test.ts`'s scale-up tests. I ran `plot-plan-meta.sh` once on a scratch plan in my own `mktemp -d` directory (removed afterwards with `trash`) to check branch-line waits, plus read-only `git log`/`grep`. I ran no vitest suite and no fleet, board or registry command.
