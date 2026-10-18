## Implementation brief — a-fresh-agent-after-a-wait (wave 3: Wait-bound fleet)

- **Plan (canonical):** docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1954 merged
- **Branch:** `bug/fleetd-at-agents-zero-after-a-wait` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (plan `## Status` → Review: pr)

Both prior waves are merged: wave 1 `bug/the-registry-reads-branch-line-waits`
(PR #1987) and wave 2 `bug/a-free-desk-ending-acts-on-no-slice` (PR #2012).
This is the last wave of the plan — nothing waits on it.

### What to build

#1903's observed failure: on 2026-10-15 fleetd ran at `agents=0` and nothing
would have started the next approved plan's work, even though the start rule
`assign` → `scaleUp` (`packages/domain/src/workflows/assign.ts:191-249`)
already exists and already starts free agents for a slice held
`no-free-agent`.

Reading the code confirms where the rule and the reading disagree. `scaleUp`
computes `running = readings.agents.length + verifying + specRunning`
(`assign.ts:230`) — **every entry in `readings.agents`, unconditionally**.
But `readQueue` (`packages/fleet/src/shared/queue-reading.ts:371-379`) builds
that array from every registry manifest regardless of state: a desk whose
worker process is gone gets `stateOf` → `'none'`
(`queue-reading.ts:586-589`, `if (!(await world.workerAlive(...))) return 'none'`)
and still gets pushed into `agents`. `isAgentFree` already excludes it
correctly (`state !== 'running'` → not free, `packages/domain/src/rules/free.ts:64-67`),
so the slice reads `no-free-agent` as it should — but `scaleUp`'s `running`
count does not make the same exclusion, so a desk that ended its free wait
and left a stale manifest entry still occupies a "running" slot in
`fleetSize`'s request, suppressing the start that `no-free-agent` should
trigger. That is a plausible, code-grounded cause for #1743's `agents=0`
estate — confirm it against the actual `.plot/logs/fleetd.log.1` lines the
plan cites (`:41489`, `:77733`) before committing to it as *the* cause; the
plan names three candidates and leaves the choice to this slice's test.

### The decisions the plan settles — do not re-derive them

**Decided 2026-10-17 by Jan Wloka: start a fresh agent.** When a free desk
ends at the wait bound and the fleet is at `agents=0`, fleetd starts one new
free agent — not zero (leave it to the next approved plan's dispatch), not
a special "wait bound recovery" path separate from the ordinary start rule.

**Decided 2026-10-17 by Jan Wloka: no new per-tick limit.** The existing
bound stands — at `agents=0`, `scaleUp` starts towards `Parallel agents`, at
most `DESKS_PER_TICK = 3` per tick. Do not add a "one start per tick after a
wait-bound end" rule. `queue.test.ts:540` ("bounds a pass, and reports what
the bound held rather than dropping it") already pins the 3-per-tick ceiling
and must keep passing unchanged.

**No second starter.** The start lives in `scaleUp` alone. Do not add a
second code path in board auto-dispatch (`rules/auto-dispatch.ts:451-500`)
or anywhere else that also starts agents for this case — one starter, one
place, per the plan's Design.

**Measure first, then fix where the measurement fails.** Write the failing
test that reproduces the #1743 estate — a desk that ended at the wait bound,
`agents` as fleetd actually reads it (including the stale `'none'`-state
manifest entry, if that's what the logs show), and the next approved plan's
first slice — and assert a `worker-start` write from `assign`. Two candidate
locations, per the plan:

- If the cause is `scaleUp`'s `running` count failing to exclude a
  `state: 'none'` (or otherwise-dead) agent, the test and fix go in
  `packages/domain/test/queue.test.ts` / `assign.ts`'s `scaleUp`. This is the
  cause the code read above supports.
- If instead fleetd's own reading (not `scaleUp`) is what kept the queue
  looking empty — e.g. the next plan's slices actually held `no-brief` or
  `not-claimable`, not `no-free-agent`, or a daemon running without
  `--start-agents` / on a stale bundle — the test and fix go in
  `packages/fleet/test/unit/registryd-tick.test.ts`, and `scaleUp` is left
  alone.

Only one of these should need a code change. If both tests already pass on
`origin/main` before any fix, the cause is a daemon operational issue (stale
bundle, missing flag), not a domain rule — say so in the PR rather than
forcing a code change to justify the branch.

**A slice held on any other reason starts nothing.** `no-brief`,
`not-claimable`, and `waits` must not trigger a start — only `no-free-agent`
does, per `scaleUp`'s existing filter (`held.filter((slice) => slice.hold === 'no-free-agent')`,
`assign.ts:228`). Pin this with a test case alongside the fix, not just by
inspection.

**Domain rules follow the layering rule in CLAUDE.md:** new code here is
arrow functions (`packages/domain/src/**` is the arrow-function package),
readings as values, no spawn outside an adapter.

### Done when

The plan's own Done when (Slices › Wait-bound fleet) is the specification:

- A test reproduces the #1743 estate and asserts a `worker-start` write from
  `assign` — in `packages/domain/test/queue.test.ts` if the cause is
  `scaleUp`, or `packages/fleet/test/unit/registryd-tick.test.ts` if the
  cause is a reading that counted the ended desk as running or kept the
  queue looking empty.
- A slice held `no-brief`, `not-claimable`, or `waits` starts none — pinned
  in a test, not just inspected.
- The start count per tick is pinned in a test to the operator's decision
  above: towards `Parallel agents`, bounded by `DESKS_PER_TICK = 3` per
  tick — no new "one start" limit.
- `queue.test.ts:540` keeps passing with its existing expectation of 3.
- No starter is added beside `scaleUp` — grep for new calls into
  `rules/auto-dispatch.ts` or elsewhere that also write `worker-start` for
  this case; there should be none.

Plus: any changeset this slice needs, and `scripts/check-shell-lines.sh` if
any `.sh` file changes (unlikely — this is a domain/fleet TypeScript fix).
For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before
each push and run what it prints. The suites in `CI suites` (plot's
`## Plot Config`) run in CI on every PR; do not run the full e2e suite
locally.

### Bookkeeping

Open the PR through the controller once there's a real commit:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while still moving). When it
exists, append `→ #<number>` to this branch's line under the plan's
`## Slices` → `### Wait-bound fleet` heading. Push the first real commit as
soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/workflows/assign.ts` (`scaleUp`),
`packages/domain/test/queue.test.ts`, and — only if the cause is on the
reading side rather than `scaleUp` — `packages/fleet/src/shared/queue-reading.ts`
and `packages/fleet/test/unit/registryd-tick.test.ts`.

Both sibling branches of this plan are merged (`bug/the-registry-reads-branch-line-waits`
#1987, `bug/a-free-desk-ending-acts-on-no-slice` #2012) — no concurrent
sibling work on this plan to collide with. Check `/plot-pulse` for other
plans' branches live in sibling worktrees before touching any file outside
the scope named above.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
