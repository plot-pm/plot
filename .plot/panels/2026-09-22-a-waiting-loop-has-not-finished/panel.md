# Panel moderation — a waiting loop has not finished

**Subject:** `docs/plans/2026-09-22-a-waiting-loop-has-not-finished.md`
**Reconciliation:** `divided` — `amend=causal-chain`, `reject=discriminator,corpus`. **3 of 3 gated. Nobody said proceed.**

## The rewrite fixed what the last panel broke, and broke something new

| Lens | Evidence | Position |
|---|---|---|
| causal-chain | **Traced all six links and reproduced the defect twice** | amend |
| discriminator | Read the loop's write sites and `PidLiveness` | **reject** |
| corpus | Read `agentState`'s arm ordering against the estate | **reject** |

**What the rewrite got right, verified independently:**

> The asserted chain holds at every link I could test … and the plan's negative claim about both `workerAlive` implementations is **confirmed**. This rewrite has fixed the predecessor's wrong causal story.

So the display-not-assignment narrowing is correct, the guards against touching `workerAlive` and `dropSettledWorkers` are correct, and the root-exclusion analysis is now endorsed by **three** jurors across two panels.

## Why it is rejected anyway

### The discriminator fires on a population it was never meant to reach

`PidLiveness` already carries **`orphaned`** — *the pid answers and is the right process, and no agent runs* — and `agentState` returns on it **before any exit arm**, with a comment saying why: an orphaned wrapper has written no exit file.

**So the proposed arm — *pid alive AND no exit record → running* — fires on every orphaned desk.** Measured on this estate the day it was written:

```
free-719604d9   pid 27820 alive, no exit
free-c810e5bb   pid  6542 alive, no exit   ← the ONLY one actually working
free-fe7ff576   pid   243 alive, no exit
```

**Three matches, one real.** The other two would have read `running`, re-introducing the defect commit `64787cd4b` fixed: *"four agents ended mid-slice and every one reported `running`"*.

The plan's own guard — *"a dispatched agent with an EXIT RECORD still reads `finished`"* — protects a population that was never at risk.

### And the claim it rests on is refuted, not merely unverified

> *"the estate already distinguishes exited from never exited: `.plot-worker.exit` is written by the wrapper when the child returns."*

**The first half is false and the second is why.** The file is written by the wrapper at teardown, so its absence cannot distinguish *never started* from *wrapper died* from *waiting*. A fact about a different process at a different time cannot answer a question about this one.

### The corpus claim was the one I leaned on, and it fails

I claimed the pair passes because the answer is `running`. `AgentStateReadings` **does** carry `exit` — so the slice is not wider for want of a field, and the juror says so explicitly. But `agentState`'s `orphaned` arm returns before any exit arm, by documented design. **Reordering a comment-documented ordering is a different change from adding a reading**, and a larger one.

## The finding that matters most, and it is about method

> **The rewrite corrected the predecessor's causal error and then repeated its structural one**: it named a discriminator without reading what already answers the question.

And the root cause, named by the juror and mine:

> The plan presents the previous panel as the thing to answer. It answers that panel faithfully. **It does not re-verify the code, and the code moved.**

**A panel's findings are not a specification.** Answering every objection is not the same as re-reading the estate — and this repo's own rule says the same thing about plans: check what already exists first.

## What the moderation recommends

**A third attempt must START from `orphaned`, not from this panel.**

1. **Keep** the display-not-assignment narrowing, the six-link chain, and the root-exclusion analysis. All verified, twice each.
2. **Start by reading `PidLiveness` and `agentState`'s arm order.** `orphaned` already decides this population, backed by a four-desk measurement the new plan must either refute with its own or accept.
3. **State the sixth link**: the drop is conditional on `fleet.ts:2983` passing `bashCleanliness`; `defaultCleanliness()` drops nobody. An unstated link is how the predecessor went wrong.
4. **The discriminator must be a launch-time fact**, taken by the party that starts the agent, not a teardown record written by another process. `.plot-worker.envelope.json` and `.plot-worker.ending.json` are named by a juror as existing candidates with load-bearing absence.
5. **`waiting` already exists** and is what this plan's title describes. Read it before arguing against a new state.

**Nothing is approved and nothing is dispatched.** The plan stays Draft with its slice deferred.
