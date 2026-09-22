## Implementation brief — the-board-asks-the-process-not-the-desk (wave 1: The row reads the process)

- **Plan (canonical):** `docs/plans/2026-09-22-the-board-asks-the-process-not-the-desk.md` on `main`
- **Approved:** 2026-09-22, in-session review after panel (amend 3/3, amendments applied)
- **Branch:** `bug/the-row-reads-the-process` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Sole wave — nothing waits on this and it waits on nothing.

### What to build

The board's WORKING section renders no agents while agents are alive. Measured 2026-09-22 and reproduced at dispatch time today: three agents with live pids — 243, 6542, 27820, in `.worktrees/free-fe7ff576`, `free-c810e5bb`, `free-719604d9` — and `plot_worker_state` answers `finished` for all three. `LIVE_STATES` is `{running, waiting}`, so every one is filtered out of WORKING. The supervisor's own tick reported `idle=3 agents=3` for the same day: the queue could see them the entire time.

Make the registry row's liveness read the **process**, the way the queue's already does. Where `plot-worker-state.sh` answers `finished` **and the recorded `.plot-worker.pid` is alive**, the row reads `running`. Nothing else moves.

The site is `refreshStates` in `packages/board/src/server/registry.ts` (~line 806-815) — the assignment `entry.state = KNOWN_STATES.has(answer) ? answer : 'unknown'`. `bashLiveness` (~:865) is the derivation and `KNOWN_STATES` (:55) is a membership filter that decides nothing about which state is right. **A second reader shares the same resolver:** `drop.ts`'s `classifyState` (:151) calls the injected `LivenessResolver` for one entry, so whichever site you choose must account for it.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Do not add a ninth agent state.** Three plans proposed one and all three were panel-rejected: `free` collides with `rules/free.ts`, a pid-alive arm over-fires on every orphaned desk, and `idle` collides with `AgentActivitySchema` ten lines below the enum it would join. `running` already exists and already means this. No enum change means no consumer must decide anything new.

**Do not change `plot-worker-state.sh`.** The shell is sourced by the reaper, by dispatch and by the fleet scan, and `finished` is right for all three — they ask about the DESK. This changes one consumer's reading, not the script. `packages/domain/corpus/agent-state.corpus.test.ts` pins the shell against `agentState` and states the rule: *neither side is authoritative, and adjusting either side to make the comparison pass is the one move forbidden.* A fix inside the derivation would put you against that test; a fix in the consumer sits outside the pair entirely. **That is why this plan survived where three did not.**

**Do not fix the queue — it is not broken.** `entry/registryd.ts` emits `idle=${queue.idle.length}` off the list `isAgentFree` computed with no slice-level gating in front of it. The measured tick reads `agents=3 left=3 handed=0 held=265 idle=3 no-brief=1 not-claimable=264 no-free-agent=0`: all three agents passed the rule, and the fleet is idle because there is nothing to hand out. `queue-reading.ts`'s `stateOf` reads `workerAlive` (the pid), never the shell. Three plans were aimed at a working path.

**`no-free-agent=0` is NOT evidence about the agents.** `rules/queue.ts` increments it inside the slice loop *after* the readiness gate, so all 266 slices took the first `continue` and the test never ran. Measured: forcing the three agents to `finished` and re-running `matchQueue` makes the counter go **up**, to 1. It reads 0 whether the free list holds three agents or none. Do not use it as a regression test.

**The discriminator is `.plot-worker.pid` plus liveness** — the same two facts `workerAlive` uses. Not detachment, which the last panel measured false on two of three desks; not an exit record, which the wrapper writes at teardown and cannot distinguish never-started from waiting.

**The safety guard is an argument literal, NOT the arm order — and it must be commented at the change site.** `taskState`'s *first* arm is `if (readings.hasPr) return 'finished'`, which outranks `blocked` and `dirty` both. Measured against the real shell on five synthetic desks, `finished` + a live pid has five ways in:

| desk | PR fact | shell answers |
|---|---|---|
| clean | `''` | `finished` |
| dirty | `''` | `stalled` |
| **dirty** | **`pr`** | **`finished`** |
| **blocked** | **`pr`** | **`finished`** |
| blocked | `''` | `waiting` |

Rows three and four are unreachable **only because `registry.ts:870` hardcodes an empty PR argument** — `plot_worker_state "$wt" ''`. A later caller passing a real PR fact would silently widen the set to include a dirty or blocked desk, and nothing would say so. Comment this at the change site. The plan's own first draft asserted the arm order instead, which is false: a safety argument that is wrong is dangerous even where the code is right.

**`agentState`'s `orphaned` arm stays.** It routes to `taskState` by documented design and the reaper depends on it: a desk whose wrapper is alive and whose work is unpushed must still read `stalled`.

### This changes what the board STARTS, not only what it SHOWS

**Settled 2026-09-22 by the operator: LET THE BUDGET SEE THEM.** Do not scope the reading to the display path.

The row's `state` feeds two counters that are both halves of auto-dispatch's budget (`auto-dispatch.ts:479`, `:1017`, `:1106`):

```ts
let budget = controls.parallelAgents - (liveCount + inFlight.size);
if (budget <= 0) { budget = freeAgentCount(agents, pulse); if (budget <= 0) return []; }
```

`pruneInFlight` (:889) also reads `LIVE_STATES` to decide which in-flight marks retire. Flipping three rows from `finished` to `running` raises `liveCount` by three, so the fall-through budget narrows — on this machine from *start up to 5* to *start up to 2*. **That is the correct arithmetic**, per the consequence juror: three live agents genuinely occupy machine slots, and `fleet.ts:7642`'s own comment already requires its count to equal what WORKING renders — today 0 while three agents live. Scoping to display would repair the invariant in one place and leave it broken in the other.

**So `liveAgentCount`, `freeAgentCount` and `pruneInFlight` each need a test pinning their behaviour for a between-slices agent**, and the PR body must state that the fall-through budget narrows on a machine with live agents. A change to what the board starts must not arrive as a side effect of a change to what it shows.

### Done when

The plan's `## Done when` list is the specification. Lifting the assertions that exist because a naive implementation would pass without them:

- **An agent alive in `sleep 60` between slices renders in WORKING.** The positive case. Three do not today.
- **A worker that exited with a clear desk still reads `finished` and stays out of WORKING.** Catches a fix that keys on the desk being clear rather than on the pid — it would wrongly resurrect every finished desk.
- **A live worker with a `PLOT-BLOCKED` marker still reads `waiting`; one with unpushed work still reads `stalled`.** Catches an over-broad arm that maps every live pid to `running` and destroys two states the reaper depends on.
- **`plot-worker-state.sh` is unchanged and `corpus/agent-state.corpus.test.ts` still passes.** Catches the forbidden move.
- **The queue is untouched: `idle=3 agents=3` before and after, proved by a tick.** Note the plan's own caveat — `no-free-agent=0` is not a regression test, since it reads 0 today, after the change, and also if the change broke `isAgentFree` outright.
- **A browser test asserts a live between-slices agent appears in WORKING.** That section had no such fixture, which is why a whole day of `none` looked plausible. Existing homes: `packages/board/test/unit/working-agents.test.ts` for the filter, `packages/board/test/integration/agents-tab.browser.test.ts` for the render.
- **`liveAgentCount`, `freeAgentCount` and `pruneInFlight` each have a test pinning their between-slices behaviour** (`packages/board/test/unit/auto-dispatch.test.ts`).

Plus the repo's gates:

```bash
nvm use                    # Node 24 — pnpm crashes on 26
pnpm test
pnpm run test:contracts
pnpm run test:board        # rebuilds the artifact, then runs its tests
pnpm run typecheck
```

Do **not** run `pnpm run test:e2e` — it is CI's gate, not a local one. Commit the rebuilt `skills/plot/scripts/board/board-server.mjs` artifact. Add a changeset: `'@plot-pm/board': patch`, description first, and the `plan:` / `bumps:` comment block last.

### Bookkeeping

Open the PR through the controller — **not `gh pr create`**, which takes its title from the last commit subject:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work is moving
```

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/registry.ts`, `packages/board/src/server/drop.ts` and `packages/board/src/server/auto-dispatch.ts` where the reading changes, plus their tests under `packages/board/test/unit/` and one browser test under `packages/board/test/integration/`, plus the rebuilt board artifact and a changeset.

Verified at dispatch: the only other live sibling is `origin/bug/the-index-is-read-once` (3 files: the reconcile scan, its test, its changeset) — no overlap. `origin/changeset-release/main` is the release PR and touches only `.changeset/`.

Out of scope: `skills/plot/scripts/plot-worker-state.sh`, `packages/domain/src/rules/agent-state.ts`, `packages/domain/src/rules/queue.ts`, the `AgentState` enum, and the wire schema. If you find something the plan did not anticipate, report it rather than improvising outside scope.
