# Panel moderation — a free agent is not a finished one

**Subject:** `docs/plans/2026-09-22-a-free-agent-is-not-a-finished-one.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `divided` — `reject=discriminator,blast-radius`, `amend=vocabulary,measurement`. **4 of 4 gated.**

## The division is not a tie, and it says one thing

**Nobody said proceed.** The two `amend`s and the two `reject`s agree on the diagnosis and split on whether the plan can be repaired or must be replaced. Read together they say: **the defect is real and exactly located; the fix is wrong in three independent ways.**

| Lens | Evidence | Position |
|---|---|---|
| measurement | **Built a fixture and reproduced it** | amend |
| discriminator | Read `plot-worker-loop.sh`'s manifest writes | **reject** |
| blast-radius | Traced every consumer of the state | **reject** |
| vocabulary | Read `DESIGN-agent.md` against `rules/free.ts` | amend |

## What survives: the diagnosis

**The measurement juror reproduced it from a fixture** after finding the estate had moved:

```
plot_worker_state <fixture>  →  finished    (live pid)
```

with the path named: `plot_worker_state:860` → `plot_worker_agent_alive` returns 1 → `plot_worker_task_state` on a clean desk → `finished`.

**The root-exclusion analysis is endorsed** by the juror who rejected the plan: *"absent is not false, a free agent's missing `claude` child is its normal state, and the code reads one of two meanings. Keep that."*

## Why it is rejected: three findings, each fatal on its own

### 1 · The fix makes the started agents undispatchable (blast-radius)

`rules/queue.ts:249`:

```ts
const free = readings.agents.filter((agent) => isAgentFree(agent.reading));
```

`isAgentFree` returns `false` for any state that is not `running`. **A desk answering `free` is filtered OUT of the free list** — and `matchQueue` is the supervisor's assignment lock.

**The plan's stated goal is that an operator who started agents sees them appear. As written it would make them undispatchable.** `whyNotFree` would print `not running — free`.

### 2 · The discriminator is already the estate's word for something else (discriminator)

`plot-worker-loop.sh:2150` writes `branch: ""` when a slice FINISHES, with the comment:

> `# THE AGENT IS NOW FREE, so the manifest stops naming a slice`

**Verified in this session.** So `branch: ""` is reachable for an agent that just finished its last slice and is exiting — which the plan's table reads as `free`, breaking the plan's own guard: *"A dispatched agent with no `claude` child still reads `finished`."*

And `rules/free.ts` disagrees in the other direction too: `sliceHasMerged` makes a **branch-naming** agent free. The plan proposes writing into the shell the exact `branch !== ''` arm that `whyNotFree`'s docstring records as already refuted once.

### 3 · A declared corpus pair forbids the shell-only change (blast-radius, vocabulary)

`packages/domain/corpus/agent-state.corpus.test.ts` pairs the shell against `agentState`. **Verified: the file exists and `AgentStateSchema` does not contain `free`.** A shell-only change fails it on three assertions, and `docs/shell-and-domain.md` forbids adjusting either side to make a corpus comparison pass.

## The shared blind spot, and it is the author's

**All four jurors found the same omission: the plan never names `rules/free.ts`.** It is the rule that already answers *is this agent available*, already handles the merged-slice case, already refuses a non-running agent, and already renders the word `free`.

The plan treated a shell state as the subject when the estate's answer is a domain rule being fed a wrong reading. **The honest defect is narrower than the plan's:** `stateOf` asks `world.workerAlive(entry.worktree)`, which routes to the shell, which answers `finished` — so the shell poisons a rule that would otherwise be right.

## What the moderation recommends

**Withdraw and rewrite, rather than amend.** Two jurors said reject and the third and fourth's amendment lists are long enough to be a different plan: a different noun, a different discriminator, a corpus pair, and a change that reaches the domain rule.

The rewrite's shape, on which all four agree:

1. **Keep the root-exclusion analysis.** It is correct and independently endorsed.
2. **Fix the reading where it is wrong** — the process arm for a desk whose loop is alive and never had a `claude` child — not by re-reading a manifest field four other things write.
3. **Find a discriminator that is a MEASUREMENT of the process.** `.plot-worker.wrapper.pid` is the estate's precedent for *what proves a worker really ran here*; the free path could write a launch-time fact the dispatched path does not.
4. **Reach `rules/free.ts` or declare a corpus pair.** Not both sides silently.
5. **Do not call it `free`.** `agentAvailability` already returns that word, and `DESIGN-agent.md:487` states `free` is availability and unmodelled as a state. Amend that section or use a different noun.

**Nothing is approved and nothing is dispatched.** The plan is Draft and stays Draft.
