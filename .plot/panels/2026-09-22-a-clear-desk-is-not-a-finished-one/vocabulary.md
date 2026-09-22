# Verdict — the vocabulary lens

Position: reject

Subject: `docs/plans/2026-09-22-a-clear-desk-is-not-a-finished-one.md`
Lens: vocabulary — is `idle` the right word in the right place?

## The finding in one sentence

The plan avoids `free` and collides with `idle` instead — and this collision is worse than its predecessor's, because `idle` is not merely taken, it is taken **twice in the same enum file** by a value whose TSDoc is a standing refusal of exactly this change, and a third time by a field whose meaning is the plan's own inverse.

---

## 1. Is `idle` free?

**No. Four live meanings, three of them in the blast radius.**

| # | where | what `idle` means there | collides? |
|---|---|---|---|
| 1 | `entities/agent.ts:49` `AgentActivitySchema` | a cue on a `running` agent — its child's CPU clock is frozen | **directly** |
| 2 | `entities/fleet.ts:156` `WorkerActivitySchema` | the same cue, on the branch row | **directly** |
| 3 | `rules/queue.ts:161` `QueueMatch.idle` | **a free agent that got no slice this pass** | **inverts** |
| 4 | `rules/attention.ts:64,94` `FindingVerdict='idle'` | a process burning no CPU over an unchanged tree | adjacent |

`rules/sample.ts:97` adds a fifth site that reasons about the word explicitly, and stakes out its side of the Agent/Worker line: *"It is called `idle` and never `stalled`. The spec owns `stalled` for an AGENT fact… an idle worker may just be waiting on the network, and this rule watches a PROCESS."*

**Collision 1 is the fatal one, and it is spatial.** `AgentActivitySchema` sits **ten lines below** `AgentStateSchema` in the same file, and its comment reads:

```
/**
 * A cue on a `running` agent, never a ninth state.
 ...
// plot-state: reading — two CPU samples of the descendant tree, compared.
//                       A cue on a running agent, deliberately not a ninth
//                       state — see the state enum above.
export const AgentActivitySchema = z.enum(['working', 'idle', '']);
```

The plan's slice is *"add `idle` to `AgentStateSchema`"*. That is the enum the comment points at with *"see the state enum above"*. After this change `entities/agent.ts` holds `idle` in both enums, ten lines apart, one of them documented as existing so that the other never gains it.

**Collision 2 states the refusal twice more, in shipped code, in almost the plan's own words:**

- `entities/fleet.ts:140` — *"This tells the first from the last WITHOUT promoting `idle` to a ninth `worker` state and WITHOUT adding it to `AgentStateSchema`, whose members are pinned by a test."*
- `board/src/contract/schema.ts:2906` — *"…without a ninth `worker` state and without adding `idle` to `AgentStateSchema`."*

Two files in two packages already say, by name, that the exact edit this plan's slice line specifies must not be made. The plan cites neither. Its "Risk, stated plainly" section names the consumer blast radius and does not name the word.

**Collision 3 is the one that will mislead a reader fastest.** `QueueMatch.idle` is documented *"The agents that were free and got nothing, by session id"* and rendered by `registryd.ts:324` as `idle=${queue.idle.length}`. That is the `idle=3` in the plan's own measurement block:

```
plot-registryd tick  agents=3 left=3 handed=0 idle=3 no-free-agent=0
```

The plan quotes this as evidence of the bug. It is not — `idle=3` there means *three agents were free and I handed them nothing*, which is the supervisor correctly reporting spare capacity it could not spend. After this plan, the same tick line would print `idle=3` meaning *three agents are in state `idle`*, and the two numbers are computed from opposite predicates (`free.slice(next)` versus `agentState() === 'idle'`) yet coincide on the measured fleet. A future reader cannot tell which `idle=` they are reading, and the two disagree the moment one agent is handed a slice.

---

## 2. Is it on the right side of the Agent/Worker split?

**No, and the plan's own done-when is where this surfaces.**

`CLAUDE.md` and `DESIGN-agent.md:400` draw the line by source: a state answering *what is the process doing?* is the Worker's and read from the process table; one answering *what does this agent owe or still hold?* is the Agent's and read from the desk. `STATE_SOURCE` (`transitions/agent.ts:43`) is the table:

```
running/failed/ended/none/finished: 'worker'
waiting/stalled:                    'desk'
elsewhere:                          'machine'
```

The plan requires `STATE_SOURCE` to source `idle` and cites the test that enforces it. But which source?

- The **meaning** the plan gives it — *"this process is alive and has nothing to do"* — is a Worker fact about the process.
- The **reading** the plan gives it — `taskState`'s final arm, refined by a new `hasSlice` boolean read off the desk's git head — is a desk fact. `taskState` is documented as *"What a worker whose process has already exited left behind"*, and the shell's own line is *"the DESK decides what that means"*.

So the plan must source it `desk`, which puts a state meaning *the process is alive and idling* in the column `DESIGN-agent.md` reserves for *what this agent still holds*. And the desk answer is **no slice, nothing held** — the emptiest possible reading on the Agent side, made to carry a claim about process liveness. That is the same word-spanning-two-sources defect `DESIGN-agent.md:437` already files as an open point under *"`finished` is two answers wearing one word"*, reproduced rather than reduced.

The measured population makes this concrete: all three desks are **orphaned** — the wrapper pid is alive, no agent runs. `agentState` reaches `taskState` there *because the process reading ran out*, not because the desk is authoritative about liveness. A state whose truth condition is *alive* cannot honestly be sourced from the reading taken when liveness could not be read.

---

## 3. Does `DESIGN-agent.md` already have a word for it?

**It has three, and the plan cites the weakest one.**

The plan cites `:487` for `free` being availability and unmodelled. That is accurate, and `DESIGN-agent.md:483–520` is stronger than the plan uses it: it tabulates *three questions, three answers* — `state` (eight values), **live** (`running|waiting`), **free** (unmodelled) — and says *"The third is what the registry needs to place a slice, and it is the one nothing computes."* The spec's own remedy for this exact gap is a **derived availability predicate**, which is `isAgentFree` — already built, already the thing `matchQueue` filters on.

Two sections the plan does not cite:

- **`:536` is a heading**: *"`activity` is a cue, never a ninth state."* The plan adds a ninth state and names it with that cue's value.
- **`:400`'s table** assigns every one of the eight a side. A ninth has no row, and the plan proposes none for the spec.

`DESIGN-agent-first-class.md:218` does ask for this — *"Give the lifecycle a word for it. Eight states and none says running and idle"* — and `:44` states the absence. So the **need** is anticipated and endorsed. The **word** is not: `:44` uses "idle" as English prose describing the gap, in a document whose sibling spec forbids that spelling as a state. An informal adjective in a gap statement is not a naming decision, and reading it as one is precisely how the rejected predecessor arrived at `free`.

---

## 4. Does the spec need amending, and does the plan say so?

**Yes, in at least four places. The plan says so nowhere.**

The spec is the authority and code follows it. A ninth state requires:

1. `DESIGN-agent.md` §"The eight" — the table, the count, and the prose word *eight* that recurs throughout.
2. `diagrams/agent-lifecycle.mmd` — the plan's state must have an edge in and an edge out. `NEXT` in `transitions/agent.ts:68` is *"Transcribed from `diagrams/agent-lifecycle.mmd`"*, and `observeAgentState` refuses an unlisted transition. A state with no `NEXT` entry is a `Record<AgentState, …>` that does not typecheck, and one with an empty array is a state nothing may leave — which is what `ended` and `elsewhere` mean.
3. `DESIGN-agent.md:400`'s ownership table — which side the ninth belongs to.
4. The diagram note that currently reads *"activity working or idle is a cue, not a state"* — which becomes false on this change.

The plan's "What this deliberately does not touch" lists four items and none is a spec file. Its done-when reaches `AgentStateSchema`, `STATE_SOURCE`, `isAgentFree`, `whyNotFree`, the shell, the corpus test and the board — every consumer, and not the authority. Under this repo's stated order, that is the change made backwards.

---

## 5. Is `hasSlice` the right name?

**No, and it is wrong in the direction that matters.**

`DESIGN-slice.md` and `CLAUDE.md`: a **Slice** holds exactly one branch and belongs to one plan; a plan writes it. `CLAUDE.md` also records that the code says `Wave` where it means `Slice` as a known defect, and that **no new code may add to it** — so slice vocabulary is under active repair and a new misuse is explicitly out of budget.

What `hasSlice` would actually read is the **desk's git head**: detached, or on a branch. That is not whether a slice exists. A slice exists because a plan names a branch under a wave heading — `plot-open-pr.sh` searches the plan directory for exactly that. The desk's head says only whether *this checkout* was cut with a branch checked out. The two come apart in the population the estate already documents:

- A **hand-made worktree** on a branch, which `plot-reconcile-scan.sh` §21 reports as a third population precisely because no dispatch record places it — `hasSlice: true`, no slice.
- A desk whose slice was **`deferred:` or `moved:`** in the plan — branch checked out, the plan has given it up.
- `plot-dispatch.sh --restart`'s inherited tree, where the slice's ownership is exactly the open question.

And on the Agent side the field is redundant with a fact already modelled: `AgentReading.branch` is *"The branch it holds, or `''` while it holds none"*, and `isAgentFree` already reads it. The plan adds a second spelling of *does this agent hold a branch* to `TaskReadings`, on the desk, under a name that claims more than it measures — two records of one fact, which is the shape `plot-reconcile-scan.sh` §16 and §18 exist to count.

`TaskReadings`'s own docstring is *"What was measured of one worktree whose worker has exited"* and *"Every field is a reading."* `detachedHead` would be a reading. `hasSlice` is a conclusion.

---

## Does it avoid the predecessor's mistake, or rename it?

**It renames it, and lands on a worse word.**

The predecessor proposed `free`, colliding with one rule that returns that word. `idle` collides with:

- a cue in the **same enum file**, ten lines away, whose comment forbids this edit by name;
- the same cue in `entities/fleet.ts`, whose comment forbids it by name;
- the board schema, which forbids it by name;
- `QueueMatch.idle`, whose meaning is the **inverse**, and whose rendered counter the plan quotes as its own evidence;
- a monitor verdict in `attention.ts`.

The plan's argument for the word is one paragraph: *"`idle` says this process is alive and has nothing to do, which is a state; `free` says this agent may be given work, which is a verdict."* The distinction is sound. The plan then does not check whether the estate had already spent the word — and it had, on a reading that means *alive and its child has nothing to do*, which is the same sentence about a narrower subject.

## What would change this verdict

Not a rename alone. The three refusals in shipped code are refusals of the **ninth state**, not of the spelling — `entities/fleet.ts:140` reads *"WITHOUT promoting `idle` to a ninth `worker` state AND WITHOUT adding it to `AgentStateSchema`"*, two conjuncts. A plan that proceeds must:

1. amend `DESIGN-agent.md` (the eight, the ownership table, `:536`) and `agent-lifecycle.mmd` (a node with real in- and out-edges) **first**, as the plan's own first slice;
2. answer the three shipped comments that refuse this edit by name, either by superseding them in the same branch or by explaining why they were wrong;
3. name the state something the estate has not spent — `between`, `unassigned`, `idling` are each untaken as a state here;
4. rename `hasSlice` to what it reads (`detachedHead`), or drop it and read the branch the Agent already reports;
5. decide `STATE_SOURCE` for it and reconcile that answer with `DESIGN-agent.md:400`.

The defect the plan diagnoses is real and the chain in §"The chain, every link read" checks out link by link. The fix is named wrong, sourced wrong, and made against the spec instead of through it.
