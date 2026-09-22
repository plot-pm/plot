# Vocabulary and state-model lens — a-free-agent-is-not-a-finished-one

**Verdict: amend.**

The defect is real and worth fixing. The **word** is wrong, the **placement** is wrong, and the
plan's own scope statement is contradicted by the mechanism it proposes.

---

## 1. Does the stated problem exist, verified in the code?

**Yes.** Traced in the shell, not from the prose.

`plot-worker-state.sh:~860`: with the wrapper pid alive and a `.plot-worker.wrapper.pid` file
present, the script asks `plot_worker_agent_alive "$pid"`. That function sweeps the ppid map for a
descendant whose `comm=` basename contains `claude`, and excludes the root:

```
# THE ROOT ITSELF IS EXCLUDED. The recorded pid is the loop shell by
# construction, and a shell that matched would make every desk read alive.
```

On `exit 1` (agent definitely absent) the reading routes to `plot_worker_task_state "$wt"`, which on
a clean desk with no `PLOT-BLOCKED` marker answers `finished`. A free agent's desk is clean by
construction — `plot-dispatch.sh --start` cuts it detached at `origin/<main>` — so the free agent
lands on `finished`.

Downstream that is fatal exactly as described. `contract/schema.ts:3256` lists `finished` in
`NOT_LIVE_STATES`, so `isLiveState('finished')` is false and WORKING drops the row. And
`rules/free.ts:64` reads `if (reading.state !== 'running') return false` — so a `finished` free agent
is also **not free**, and `freeAgents` in `auto-dispatch.ts` filters it out. The agent is invisible
*and* unassignable. The plan's `/api/fleet agents: 0` is consistent with both.

The premise passes. The two things the plan says it ruled out — `dropSettledWorkers`'s predicate and
the `startedAt`/`lstart` comparison — are correctly not the cause.

## 2. Is `free` as a ninth state the smallest change that fixes it?

**No, and the estate has already rejected this exact shape twice, in writing.**

### `free` is not a state — it is the *availability* axis, and that is settled

`DESIGN-agent.md:487`, section heading verbatim: **"The process states do not say whether an agent is
*free*"**. Its table:

| | asks | answered by |
|---|---|---|
| `state` | what is the **process** doing | the pid, the exit code, the tree |
| **availability** | can this agent **take a slice** | the state **plus its slice** |

And at `:506`: **"So `free` is derived, not stored"**, with the formula
`agent.isFree = state is live ∧ (its slice has merged ∨ it holds none)`.

`:529` makes the three-question split explicit — *what is this worker doing?* → `state`; *does it
hold a machine?* → live; *can it take work?* → **free**. Three questions, three answers. The plan
takes the third answer and stuffs it into the first answer's enum.

That is not a stylistic objection. The doc names the consequence one line down: availability needs
**the state plus its slice**, and a state value is computed from the process and the desk alone. A
`free` *state* is an availability answer computed without the availability input.

### The estate refused a ninth state by name, for a near-identical case

`entities/agent.ts:39`, on `AgentActivitySchema`:

```
/**
 * A cue on a `running` agent, never a ninth state.
 */
// plot-state: reading — ... A cue on a running agent, deliberately not a ninth
//                       state — see the state enum above.
```

`activity` (`working` / `idle` / `''`) is the *same shape of fact* — the loop is up, the child is
doing nothing — and the estate deliberately modelled it as a **sibling field on `running`**, not as
an enum member. `DESIGN-agent.md:535` carries the section "`activity` is a cue, never a ninth
state", and the mermaid diagram's note repeats it: *"activity working or idle is a cue, not a
state."*

The plan proposes the ninth state that two documents and one schema comment refuse, and it never
mentions that refusal. That is the omission that decides my position.

### The nearer mechanism

A free agent is `running` with `branch === ''`. That is already true, already on disk, already the
exact input `isAgentFree` reads. The minimal fix is for the shell to keep answering `running` for a
branchless desk whose loop is alive:

```
if plot_worker_agent_alive "$pid"; then running
elif [ "$?" -eq 1 ]; then
    # A branchless desk has no agent BY CONSTRUCTION. The loop is the worker.
    [ -z "$branch" ] && { printf 'running\t%s\t' "$pid"; return; }
    plot_worker_task_state ...
fi
```

That is one arm, one new reading (the manifest branch the plan already proposes to read), **zero new
vocabulary**, and it makes the agent live *and* free in one move — because `isLiveState('running')`
is true and `isAgentFree({state:'running', branch:''})` is true. The plan's own table agrees that
`branch` is the discriminator; it just spends a new enum value to express what `running` already
expresses.

If the row must *say* "free" to an operator, that word already exists and already renders:
`tuple-row.ts:960`, `agentAvailability()` returns the literal string `'free'` from `isAgentFree`.
The operator-facing word is built. Only the state feeding it is wrong.

## 3. What the plan claims that I could NOT verify

- **"The state is a PROCESS fact and `free` keeps it one."** I could not verify this, and I believe
  it is false. `DESIGN-agent.md:400`'s ownership table sources each state: `running`/`failed`/
  `ended`/`none` from the process, `waiting`/`stalled` from the desk, `elsewhere` from the machine.
  `free` as the plan defines it is read from **the manifest's `branch` field** — a registry
  artifact, neither process nor desk nor worktree list. It is a fourth source with no row in
  `STATE_SOURCE` (`transitions/agent.ts:43`), which is an exhaustive
  `Record<AgentState, StateSource>` and will fail to typecheck the moment the enum grows.
  Per CLAUDE.md's own split — *Machine sees processes / Registry sees identities* — reading the
  manifest makes this **Registry-side**, and `Agent` is Registry-side vocabulary. So by the plan's
  own cited rule it is an Agent fact, not the Worker fact it claims to be.

- **"`free` … reusing `waiting` collides with `PLOT-BLOCKED`."** True as far as it goes, but the plan
  never checks the collision it actually causes: `rules/free.ts` exports `isAgentFree`/`whyNotFree`,
  `assign.ts` has the hold reason `'no-free-agent'`, `auto-dispatch.ts` has
  `freeAgentCount`/`freeAgentLabels`/`freeAgents`, `entities/agent.ts` has `isFree`, `tuple-row.ts`
  renders the string `'free'`, and `decision.ts:250` and `quiet.ts:158` both reference the concept.
  `free` is among the most heavily loaded words in this domain, and it means *availability*
  everywhere it appears. The plan introduces a second, incompatible meaning under the same word.

- **"no wire field is added."** Literally true, but it understates the wire change: the state enum
  *is* the wire. `plot-worker-state.sh` emits it, `registry.ts:56` derives `KNOWN_STATES` from
  `AgentStateSchema.options`, `refreshStates` at `:813` coerces anything outside that set to
  `'unknown'`, and `plot-dispatch.sh --restart` branches on the word. Adding a value is a
  producer-and-consumer migration. `DESIGN-agent.md:462` says exactly this about the `finished` split
  — *"`WorkerState` is a wire enum … Splitting it is a producer-and-consumer migration … and it wants
  its own plan for the same reason."*

- **The measurement itself.** One agent, one session, 2026-09-22. I could not re-run it; the desk,
  pid 1794 and the manifest are gone. The mechanism I traced independently in the shell corroborates
  it, so I do not dispute the finding — only that n=1 is doing the work here.

## 4. What breaks if this ships as written

The plan's one slice says "leaving every other arm unchanged … `dropSettledWorkers` is untouched."
Shipping only the shell arm breaks five things:

1. **The agent is still not free.** `rules/free.ts:64` is `if (reading.state !== 'running') return
   false`. A `free` state is not `'running'`, so `isAgentFree` returns **false** —
   `whyNotFree` prints `not running — free`. `freeAgents` filters it out, `matchQueue` never matches
   it, and the supervisor hands it nothing. **The plan's stated goal — an operator starts agents and
   work reaches them — is not achieved by the plan's own slice.** This is the single most important
   finding: the new value does not reach the rule named `isAgentFree`. The plan never checks this,
   and its Slices section never mentions `free.ts`.

2. **`registry.ts:813` coerces it to `unknown`.** `KNOWN_STATES` is derived from
   `AgentStateSchema.options`. Until the domain enum is widened, the shell's `free` is not a member,
   so every free agent renders `unknown` — which `isBrokenState` (`schema.ts:3303`) reports as a
   **broken worker in WAITING ON YOU**. The plan trades an invisible agent for a false alarm.

3. **The corpus test fails, and the contract says the branch stops.**
   `packages/domain/corpus/agent-state.corpus.test.ts` is a declared shell-versus-rule pair: it runs
   `agentState` (TS) against `plot_worker_state` over every desk on the machine. Changing the shell
   alone makes them disagree by construction. `docs/shell-and-domain.md`, quoted in that file's own
   header: *"On a disagreement the branch stops; adjusting either side to make this pass is the one
   move forbidden."* The plan does not name this test.

4. **Exhaustive `Record<AgentState, …>` tables.** `STATE_SOURCE` and `NEXT` in
   `transitions/agent.ts:43,66` are both `Readonly<Record<AgentState, …>>`. Widening the enum fails
   the typecheck until both are filled — and filling `STATE_SOURCE` requires answering the question
   §3 above shows the plan has answered wrongly. `NEXT` also needs edges: `none → free`,
   `free → running`, `running → free`. None are in `diagrams/agent-lifecycle.mmd`.

5. **`NOT_LIVE_STATES` is a denylist.** `isLiveState` (`schema.ts:3271`) returns true for anything
   not in the list, so `free` reads as **live** and renders in WORKING. That happens to be the
   direction the plan's Notes call wrong — *"a free agent is not working."* The note at
   `schema.ts:3244` names this exact hazard: *"Widening the enum without widening this is the
   measured hazard."*

Items 3 and 4 are hard stops at CI. Item 1 means that even with 2–5 fixed, the plan as scoped does
not deliver its own changelog entry.

## 5. Existing mechanism, or a nearer one ignored

Three, all in-tree, none named by the plan:

- **`isAgentFree` / `agentAvailability`** — the availability question is already modelled, already
  derived, already rendered as the word `free`. `free.ts`'s own docstring pre-refutes the plan:
  *"DERIVED, NEVER STORED, AND NEVER READ FROM THE DESK. A `free` flag written somewhere would need
  clearing by whoever hands over the work."* A `free` state emitted by the shell is that stored flag,
  derived from a manifest field the dispatcher writes.

- **`AgentActivity`** — the precedent for a cue on `running` rather than a ninth state. If the fleet
  needs to *display* "started, holding nothing", `activity` is the shaped slot: it is already a
  sibling field on `running`, already schema'd, already rendered, and it already carries `idle`.
  Extending it costs no enum widening, no `STATE_SOURCE` row, no `NEXT` edges, no corpus break.

- **`branch === ''`** — carried on every `AgentEntry`, read by `isAgentFree`, `assign.ts:145`
  (*"`isAgentFree` already reads `branch === ''` as available"*) and `freeAgentLabels`, which already
  prints `(between slices)` for exactly this population. The discriminator the plan identifies is
  already the discriminator the domain uses. The plan re-encodes it as a word instead of routing the
  existing word to it.

---

## What an amendment needs

1. **Drop the ninth state.** Make the shell answer `running` for a live loop on a branchless desk.
   That is smaller, needs no enum change, no `STATE_SOURCE` row, no `NEXT` edges, no corpus
   disagreement, and it makes the agent live and free in one move because `isAgentFree` already
   reads `running` + `branch === ''` as available.
2. **Mirror it in `rules/agent-state.ts`.** The corpus test pairs the two; the shell arm and
   `agentState`'s arm land in the same slice, and `AgentStateReadings` gains the branch reading.
3. **Say which word the operator sees.** `agentAvailability` already returns `'free'`. If the row
   should read *free* rather than *running*, that is a rendering decision in `tuple-row.ts` over an
   existing derivation — not a new state. Resolve this explicitly; the plan's Notes currently defer
   it ("which section is the board's question").
4. **If a ninth state survives review anyway**, the plan must add: the `STATE_SOURCE` entry and an
   argument for its source given that `branch` comes from the manifest; `NEXT` edges plus the
   `agent-lifecycle.mmd` update; the `NOT_LIVE_STATES` decision; the `free.ts` change that makes
   `isAgentFree` accept it; and the corpus-pair update — with `DESIGN-agent.md:462`'s
   producer-and-consumer warning answered rather than unmentioned.
5. **Amend `DESIGN-agent.md` in the same breath, or not at all.** `:487`–`:529` state that `free` is
   availability and unmodelled as a state. This estate's habit is to amend a line rather than quietly
   break it (the `plot-host.sh` and `plot-open-pr.sh` precedents in CLAUDE.md). A plan redefining
   `free` must either change those sections or stop using the word.

The bug is real, the discriminator is correctly identified, and the plan's honesty about its own
three wrong turns is worth keeping. It is the noun that is wrong — and the slice, as scoped, does not
reach the rule that would make the fix work.

Position: amend
