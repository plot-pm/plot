# plot-agents

> An agent is declared, not inferred: identity, skill and capability become a
> record the fleet reads, so the reason an agent ends can be something other
> than a clock.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- Agents are declared rather than inferred. A `plot-agents` record carries who
  an agent is — its harness, model, effort, and the skills it holds — so the
  fleet can say *which* agent should take a slice, and can end one because its
  context ran out or because the work needs a different specialism, rather than
  only because a clock expired.

<!-- Board impact: yes. The registry's state vocabulary, the agent row, and the
     manifest format all change. `plot-dispatch.sh` writes the record, so the
     plan format is untouched but the agent format is new. -->

## Motivation

**An agent has no identity today. It has a receipt.** `AgentEntry`
(`packages/board/src/server/registry.ts:105`) carries `session`, `resumeId`,
`attempts`, `branch`, `worktree`, `command`, `startedAt`, `pid`,
`previousPid`, `relaunches`, `state`. **Every field describes a run.** None
describes an agent: not what it is good at, not what it may do, not what it
costs, not which model is behind it.

The estate has one `Worker command` (`CLAUDE.md:32`) and every dispatched agent
is that command. So "this agent" and "this process" are the same sentence, and
the fleet has no way to say the two things an operator says constantly: *this
one is the wrong agent for this slice*, and *this one is finished as an agent
even though its process is alive*.

### The three reasons an agent ends, and why Plot can state only one

Measured 2026-09-03 in `plot-worker-loop.sh`: a worker ends for exactly two
reasons — it exceeded `WORKER_BOUND_SECONDS` (`:744`) or the monitor reported
idle (`:756`). **Both are time.** Neither is capacity, and neither is fit.

| reason | whose fact | Plot today |
|---|---|---|
| the context ran out | Worker (the process) | **unmodelled** — `contextPct`, `tokenBudget`, `contextWindow` return zero hits across `packages/domain/src`, `packages/board/src` and `skills/plot/scripts/*.sh` |
| the session ended | Agent | half-present — `resumeId` exists, and `registry.ts:724` records that a synthesized agent *"costs the entry its resume path"* |
| the work needs a different expert | Registry | **unrepresentable** — `entities/agent.ts` has no `kind`, so "wrong agent" cannot be said |

**A bound is a guess about all three.** Eight hours is the number that is
wrong in the safe direction for every one of them: it kills an agent whose
context died at minute forty, and it keeps one alive whose slice needed a
specialism it never had.

### The registry cannot supervise what it cannot name

`DESIGN-agent.md:220` says the manifest *belongs to the Registry* and lives as
long as *the agent is declared*. In code the registry declares nothing:

- **`registry.ts` performs no write of any kind** — no `writeFile`, `unlink`,
  `mkdir`, `rename` or `rmSync`. It is a pure reader.
- `plot-dispatch.sh:586` writes the manifest; `drop.ts:258` unlinks it.
- `drop.ts` removes the **record**, never the process. The board can forget an
  agent; it cannot stop one.
- The only real termination is the agent SIGKILLing its own process group
  (`plot-worker-loop.sh:626`).

**So "the registry terminates agents" is not late, it is unstateable.** A
component that holds no definition of an agent has nothing to end — which is
why `the-registry-supervises-its-agents` could deliver (#609, #629) without
this appearing.

### The state vocabularies already disagree, in the same direction

| source | states |
|---|---|
| `packages/domain/src/entities/agent.ts:11` | 8 |
| `packages/domain/src/entities/fleet.ts:89` | 8 |
| `skills/plot/scripts/plot-worker-state.sh:26` | 8 |
| **`packages/board/src/server/registry.ts:35`** | **5** — drops `failed`, `ended`, `none`, `elsewhere`; adds `unknown` |

`DESIGN-agent.md:797` already records this as an open point: *"The shell and
the contract agree on eight; only the registry disagrees."* The five it keeps
are process outcomes. The three it drops are the ones that need an agent to be
about — which is the same gap seen from the enum side.

## Design

### Approach

**One new record, owned by the registry, read by everyone else.** A
`plot-agents` entry declares an agent; the manifest keeps describing a run and
points at the declaration it instantiates.

The split matters and is the whole design:

| | declares | lives as long as | written by |
|---|---|---|---|
| **agent record** | who it is, what it can do | the declaration stands | a person, in the repo |
| **manifest** | this run of it | the run | `plot-dispatch.sh` |
| **worker** | the process | the run | the machine |

That is `DESIGN-agent.md:220`'s own table with the missing first row supplied.

### What a declaration carries

Two groups, and the boundary between them is load-bearing.

**Capability — what this agent IS.** The harness (which CLI), the model, the
effort, and the skills it holds. These are the fields that let the fleet choose,
and none of them exists today.

**Bounds — what this agent MAY spend.** A context ceiling, and what to do when
it is reached. This is what turns *"the bound expired"* into *"the context ran
out"*, and it is the field the third termination reason needs.

**What it must NOT carry: any run fact.** No pid, no branch, no worktree, no
`startedAt`. Those belong to the manifest, and a declaration that carried them
would become a second record of the same run — the exact duplication
`registry.ts:105` already is.

### The termination reasons become nameable

The point is not more states; it is that an ending carries a REASON that says
who should act:

- **context exhausted** → the worker is spent, the agent is fine. Resume it.
- **session ended** → the agent is done with this slice. Free it.
- **wrong specialism** → the slice needs re-matching. Neither is broken.

Today all three arrive as `ended` with `_ended_detail` prose
(`plot-worker-loop.sh:744`) that nothing parses.

### Not chosen: infer the specialism from the plan

A slice's plan text describes the work, so a matcher could read it and guess.
Rejected for the same reason `DESIGN-plan.md` gives for not inferring
dependencies from shared files: a guess that is usually right produces a fleet
whose wrong answers are unexplainable. A declaration is a fact a person wrote.

### Not chosen: make the record a new port

The registry already reads manifests through the filesystem and liveness
through `scriptsShell` (`registry.ts:820`). A declaration is another file in
the same directory family; adding a port for it would widen the adapter surface
without adding an answer.

### Open Questions

- [ ] **Who writes the declaration?** A file a person commits, or a board
      action? The manifest is machine-written and the plan is human-written;
      this sits between them.
- [ ] **Does matching belong in this plan?** Declaring agents makes *choosing*
      one possible, but `hasRoomToDispatch` (`entities/machine.ts:99`) is a
      boolean about headroom, not a choice among candidates. Scheduling may be
      its own plan.
- [ ] **Is `synthesized` still a defect?** `DESIGN-agent.md:787` says *"a
      synthesized entry is a defect, not a category"* while
      `entities/agent.ts:29` encodes it as an identity. **The code is currently
      right** — a hand-made worktree is a real agent — but only because nothing
      can be declared. Once a declaration exists, synthesis means *an agent
      nobody declared*, which is what the spec meant. This plan should settle
      which document changes.
- [ ] **Where does a context reading come from?** No component measures it
      today. The harness reports it; nothing in Plot reads the harness.

## Branches

### Declaring

- `feature/an-agent-declares-what-it-is` — the record: its location, its
  fields, and what it refuses. Capability only (harness, model, effort,
  skills); **no run facts**, asserted by a test, because the manifest already
  holds those and a second copy is the defect this plan exists to remove.
  Parser and contract, nothing consuming it yet, so the shape settles before
  three components read it.

### Pairing

- `feature/a-manifest-names-its-agent` — the manifest gains the declaration it
  instantiates; `plot-dispatch.sh:586` writes it, `parseManifest`
  (`registry.ts:361`) reads it. **A manifest naming no declaration keeps
  working** — every manifest on the estate predates this — and reads as the
  undeclared agent it is, which is what `identityWasDeclared`
  (`entities/agent.ts:150`) already asks.

### Ending for a reason

- `feature/an-ending-carries-its-reason` — `_ended_detail`
  (`plot-worker-loop.sh:744`) becomes a value the fleet reads rather than prose
  nobody parses. The three reasons above, each with the actor it implies.
  **Asserted: a bound expiry and a context exhaustion are different endings**,
  because today they are the same one.

### Agreeing on the states

- `feature/the-registry-reads-eight-states` — `AgentState`
  (`registry.ts:35`) stops collapsing eight into five. Closes
  `DESIGN-agent.md:797`'s open point. **Asserted: an agent reads the same state
  in the registry and in the scan**, which it does not today — the registry
  passes an empty PR fact by design (`registry.ts:793`), so a finished agent
  with a merged PR reads `stalled` there and `finished` in the scan
  (`plot-worker-state.sh:535`).

## Notes

Written 2026-09-03 from a review of the fleet layer (Machine, Registry, Board).
Every measurement above was taken on `main` at `e7f3586e7`.

**Adjacent, deliberately not merged with this plan:** `an-agent-holds-one-desk`
is about the *desk* — which worktree an agent owns and who resets it. This is
about the *agent* — who it is and what it can do. They share the word and not
the subject.

**What this plan does not do.** It does not schedule. Declaring agents makes
matching possible and does not perform it; see the Open Question above.
