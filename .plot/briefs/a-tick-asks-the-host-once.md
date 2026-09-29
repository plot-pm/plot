## Implementation brief — a-tick-asks-the-host-once

- **Plan (canonical):** `docs/plans/2026-09-29-a-tick-asks-the-host-once.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-tick-asks-the-host-once` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention
- **Issue:** #1059. **Not this slice:** #1065 (the supervisor has no spend discipline)

The plan has one slice. No other slice waits on it, and it waits on none.

### What to build

A supervisor tick (`plot-registryd.mjs`, `--once`) asks the host more than once about the same branch. An instrumented tick on this estate made **4 host calls on 321 slices and 2 agents, and 2 of the 4 were the same branch asked twice**. On a Bitbucket estate the tick hit `HTTP 429` twice in two hours and printed `merge-unknown=4 handed=0` for about 20 minutes.

Three independent `host.prMerged(branch)` call sites exist in one world, `worldForRepo` in `packages/board/src/server/entry/registryd-main.ts`:

| call site | reached from | per |
|---|---|---|
| `prMerged` (`registryd-main.ts:290`) | `supervisor.ts:332` `merge:` ← `readAgent` `:186` | registered agent, including free agents with `branch === ''` |
| `sliceHasMerged` (`:453`) | `queue-reading.ts:226` | registered agent with a branch |
| `queuedHasLanded` (`:459`) | `queue-reading.ts:212` | claimable slice with a brief (at most one per plan) |

The first two ask about the same branch for every busy agent in each tick. That is the measured duplicate.

The fix: **one per-tick memo over `host.prMerged`, keyed by branch, inside `worldForRepo`**. The three call sites read through it, and `beginTick` clears it, the same way the existing `planLines` memo works (`registryd-main.ts:272-281`). Then do not ask about `''` at all.

### Decisions the plan settles — do not re-derive them

**A memo, not a new bundled call.** An earlier draft of the plan ruled out a memo, and round 1 withdrew that exclusion. The estate already solves this shape with the memo at `:272`, and that memo is the model: `let memo = null` in the world closure, `??=` on first use, `null` in `beginTick`. Memoize the **Promise** and not the resolved value, so that two concurrent readers (`readAgent` uses `Promise.all`) share one call.

**Do not fold these readings into `mergedBranches()`.** "Does `mergedBranches` carry the fact that `landed` needs?" answers yes, and an implementer who acts on that answer ships promote-on-silence. `mergedBranches` (`:432-450`) returns a bare `Set` on `!answer.ok`. That set cannot tell *the host failed* from *nothing merged*, so a host outage reads as *not landed*. `queuedHasLanded` must still be able to answer `unknown`. The memo must therefore store the **raw port answer** (`ok`/`!ok` plus the value) and not a boolean, and each of the three consumers derives its own word from that answer as it does today:

- `prMerged` → `'merged' | 'not-merged' | 'unreachable'`
- `sliceHasMerged` → `boolean` (silence is `false`, because the agent keeps its branch)
- `queuedHasLanded` → `LandedAnswer`, where silence is `'unknown'` (read the existing body at `:459` and keep its mapping)

Three words from one answer is intentional. Each consumer's silence direction is a separate decision and already documented in place. Do not merge the three.

**Leave the queue's bound alone.** `queuedHasLanded` fires only for `claimable && briefPresent` (`queue-reading.ts:156-165`, the 454-slice measurement). The cost premise of the first draft was wrong: the instrumented tick fired `queuedHasLanded` **zero** times. This slice removes the duplicate and does not reduce fan-out that is already bounded.

**Guard the empty branch at the supervisor call site.** `sliceHasMerged` skips `''` (`queue-reading.ts:226`). `supervisor.merge` (`supervisor.ts:332`, via `readAgent` `:186`) does not skip it. `plot-host.sh` refuses `''` locally, so the call spends no quota, but `:291` maps the refusal to `'unreachable'`, and each tick feeds a spurious merge reading for every free agent into the rule. Find out which `MergeReading` a free agent must carry: read how `rules/` consumes `merge` for an agent with no branch. Pick the word that the rule already treats as *no branch to ask about*, and assert it. **If no word expresses "not asked", report that and stop. Do not invent a value.**

**Carried-over invariants:**
- **Silence holds.** An unreadable merge state still holds the slice. The plan changes how often the host is asked, not what silence means.
- **Absent is not false.** `unaskable`/`unreachable`/`unknown` stay distinct from *not merged* along the whole path.
- **No `PrIndexStore` read, no tick-interval change, no change to the board's PR timer.** Each of these is excluded in *What this does NOT do*.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **Count calls with a stub host, and assert that no branch is asked twice in one tick.** A test that checks only the tick's decision passes unchanged with the duplicate still present. The duplicate has no visible effect except its cost.
- **Assert the count over two ticks.** The memo must be cleared by `beginTick`, so a second tick asks again. A memo that never clears passes a one-tick test and freezes merge state for the life of the daemon.
- **A stub whose `prMerged` fails must yield `unknown` from `queuedHasLanded` and `unreachable` from `merge`, and never *not merged*.** This catches a memo that stores a boolean.
- **Assert that a free agent (`branch === ''`) causes zero host calls**, and that the rule receives the word the plan settles for it.
- **An unreadable merge state still holds the slice** (`merge-unknown` in the tick's counters).
- **The tick's reported counters are unchanged in shape.**

The existing tests to extend are in `packages/board/test/unit/`: `registryd-main.test.ts`, `registryd-tick.test.ts`, `queue-reading.test.ts`, `supervisor-reading.test.ts`.

Plus the repo gates (Node 24, `nvm use`):

```bash
pnpm test
pnpm run test:contracts
pnpm run test:board      # rebuilds the artifacts; commit plot-registryd.mjs if it changes
pnpm run typecheck
```

Do not run `test:e2e` locally; CI runs it. Add a changeset (`'@plot-pm/board': patch`), with the description first. Write every new function, test helpers included, as an arrow function.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still changes). Do not run `gh pr create`.
- When the PR exists, append `PR: #<number>` inside this slice's heading in the plan's `## Slices`: `### A tick asks the host once (Branch: bug/a-tick-asks-the-host-once, PR: #N)`. A trailing `→ #N` does not parse on a heading.
- In the PR body, state that #1065 remains open and that this slice does not claim the 429.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/registryd-main.ts`
- `packages/board/src/server/supervisor.ts` (the empty-branch guard only)
- `packages/board/src/server/queue-reading.ts` (only if the guard or the world interface needs to change there)
- the four test files above, the rebuilt `skills/plot/scripts/board/plot-registryd.mjs`, and one changeset

On 2026-09-29 no other remote branch changes any of the three source files. `packages/domain/src/rules/landed.ts` is out of scope. If the fix seems to need a change there, report that and do not change it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
