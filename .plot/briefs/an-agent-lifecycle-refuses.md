## Implementation brief — an-agent-lifecycle-refuses (slice: The agent's lifecycle)

- **Plan (canonical):** `docs/plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md` on `main`
- **Design:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-agent.md`
- **Branch:** `feature/an-agent-lifecycle-refuses` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of five. Slice 1 (`a-story-lifecycle-refuses`) merged as #707 and is the pattern this copies.

## What this delivers

`packages/domain/src/transitions/agent.ts` — the eight states `DESIGN-agent.md` names, as a rule that refuses illegal transitions, with a unit test per refusal.

## The plan asks you to verify before asserting, and this is that verification

The slice says: *"Verify which exit is the violation, then assert against that exit."* Done on 2026-09-05, and **the answer moves the target.**

**The cited line has moved.** `plot-worker-loop.sh:1270` is now **`:1296`** — `exit 124`, reached from three arms of one `case`:

| line | `write_ending` | when |
|---|---|---|
| `:1274` | `quiet monitor` | the WorkerMonitor reported idle |
| `:1287` | `unreadable bound` | the floor fired, no transcript readable |
| `:1291` | `bound bound` | the floor fired, transcript readable |

**Three more self-exits exist** and are not this one: `:1179` (the wait budget ran out), `:1402` and `:1404` (`wait_for_work` returned non-zero). The narrow assertion the plan insists on matters exactly here — a test written against *an agent may not end itself* would cover four exits with one claim, and three of them are a free agent's wait expiring rather than a running agent stopping its own work.

## THE ASSERTION AS WRITTEN CONTRADICTS A SHIPPED TYPE

**`EndingActor` already admits the agent as an actor.** `packages/domain/src/entities/ending.ts:57`:

```ts
export const EndingActorSchema = z.enum(['bound', 'monitor', 'agent']);
```

with `:55` documenting it: *"`agent` — the agent stopped itself."*

So *"an agent cannot end itself on a bound"* cannot be asserted flatly without making an existing, documented enum value unreachable by rule. **Verified 2026-09-05: no caller writes `actor: 'agent'`** — the three `write_ending` calls pass `monitor` and `bound` only. The value is admitted, documented, and never produced.

**That is the finding, and it is what this slice must resolve first.** Three readings are possible and they lead to different code:

1. **The actor is right and the assertion is about the ACTOR, not the exit.** `:1296` exits with `actor=bound` or `actor=monitor` — the agent's process runs the exit, but the *party that acted* is the watchdog or the monitor. On this reading nothing is violated today, the plan's premise is stale, and the assertion becomes *no ending may record `actor: 'agent'`* — which would make the enum value dead and should delete it.
2. **`actor: 'agent'` is legitimate and simply unreached.** Then the refusal is narrower still: some *specific* self-exit is illegal and the others are not, and the test must name which.
3. **The design does not settle it.** Checked: `DESIGN-agent.md` states *"the registry spawns an agent"* (`:156`) and that a worker *"cannot outlive it as a worker"*, but **states no termination refusal**. The plan's summary — *"an agent is terminated by the Registry"* — is not a quotation from the spec, and grep finds no such rule in it.

**Pick one, say which in the code, and let the design say it too if it should.** A refusal that refuses nothing is the exact shape the plan warns against, and it warns against it because an earlier draft of this slice already produced one.

## The rest of the lifecycle

**The eight states split along a line the repo has already settled**, and CLAUDE.md states it: four are Worker facts read from the process (`running`, `failed`, `ended`, `none`), two are **Agent** facts read from the desk (`waiting` — a `PLOT-BLOCKED` marker; `stalled` — unlanded work), `finished` is a Worker fact the desk refines, and `elsewhere` is a Machine answer.

`DESIGN-agent.md:366` tabulates each with what reads it and what to do. `plot-worker-state.sh:46` decides the two workflow states from the TREE, never from the process.

**A transition rule must respect that split.** A state answering *what is the process doing?* is not interchangeable with one answering *what does this agent still hold?*, and a transition between them is not a process event.

**The other two refusals the plan names are real and checkable:**

- **A manifest belongs to the Registry.** `plot-dispatch.sh:346`'s `write_agent_manifest` is one of two writers; `manifest-stamp.ts` is the other, and its docstring requires the two stay byte-identical.
- **`elsewhere` means no worktree on this machine.** CLAUDE.md calls this the proof that a Worker is the LINK between Agent and Machine rather than a view of either: *"a view of an agent cannot be somewhere the agent is not."*

## The pattern to follow

`transitions/plan.ts` and now `transitions/story.ts` (#707, merged). Shape:

```
Precondition · RefusalReason · Refusal · Decision · TransitionResult
isDecision / isRefusal · <verb>able(x) · <verb>(x, input)
```

`transitions.test.ts` holds 41 tests with 46 `isRefusal` assertions for the plan lifecycle — that is the standard a refusal set is held to here.

**Readings as values, not ports.** The rule performs no I/O; the caller reads and passes in. `rules/quiet.ts` and `rules/free.ts` are the models.

**Arrow functions**, purity gate holds (outside `adapters/`, the domain imports `zod` and nothing else), TSDoc says what an export does rather than why it was decided — the reasoning goes in the commit.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

**A test per refusal**, and each must fail against a real violation rather than a hypothetical. The plan's own warning: an earlier draft's assertion *"would have passed on the day it was written."*

## Done when

- `transitions/agent.ts` exists with a refusal per illegal transition and a test per refusal
- the `actor: 'agent'` question above is decided, the decision is stated in the code, and the enum matches it
- the assertion about self-ending names a specific exit and fails against current behaviour, or the plan's premise is corrected in the same PR
- the Worker/Agent state split is respected — no transition treats a desk fact as a process event
- the gates above pass

## Do not

- **Do not assert that an agent cannot end itself,** flatly. Four self-exits exist and three are a free agent's wait expiring. Name the one.
- **Do not leave `actor: 'agent'` both admitted and unreachable.** Either it is legitimate and something writes it, or it is dead and goes.
- **Do not move a workflow state onto the process side.** They share one enum for a historical reason, which CLAUDE.md says is not a licence to add to it.
- **Do not generalise to worktree or slice.** Those are their own slices, blocked behind this one so they copy a settled pattern.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
