# The domain owns the agent lifecycle

> A lifecycle rule lives in the domain, a bundle answers for it, and the shell
> keeps only what is genuinely a process. An agent gains a declaration, so the
> thing being supervised can be named.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 3
- **Approved:** 2026-09-03, Jan Wloka, pr
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-03, Jan Wloka, `feature/an-agent-declares-what-it-is`
- **Started:** 2026-09-04, Jan Wloka, `feature/the-task-state-is-a-domain-rule`
- **Started:** 2026-09-04, Jan Wloka, `feature/a-worker-names-its-session`
- **Started:** 2026-09-04, Jan Wloka, `feature/an-agent-knows-what-it-spent`
- **Started:** 2026-09-04, Jan Wloka, `feature/the-registry-supervises-its-agents`
- **Started:** 2026-09-04, Jan Wloka, `feature/the-machine-keeps-the-daemon-alive`
-->

## Changelog

- Agent lifecycle rules move into `@plot-pm/domain`, where a test can hold them.
  An agent is declared rather than inferred — its harness, model, effort and
  capabilities become a record — so the fleet can say which agent should take a
  slice, and an ending can carry a reason other than a clock.

<!-- Board impact: yes. The registry's state vocabulary changes, the agent row
     gains a declaration, and `plot-worker-state.sh` stops deciding. The plan
     format is untouched. -->

## Motivation

**Nothing owns the agent lifecycle, so nothing can supervise it.** Four
measurements on `main` at `e7f3586e7`, each a lifecycle rule with no single
implementation:

- **An agent terminates itself.** `plot-worker-loop.sh:626` SIGKILLs its own
  process group. `registry.ts` contains no `kill` — and no write of any kind:
  no `writeFile`, `unlink`, `mkdir`, `rename` or `rmSync`. `drop.ts:258`
  removes the *record* while the process keeps running.
- **Four state vocabularies.** `entities/agent.ts:11` has eight,
  `entities/fleet.ts:89` eight, `plot-worker-state.sh:26` eight, and
  `registry.ts:35` **five** — dropping `failed`, `ended`, `none`, `elsewhere`.
  `DESIGN-agent.md:797` already records it: *"The shell and the contract agree
  on eight; only the registry disagrees."*
- **One agent, two states.** `plot-worker-state.sh:535` returns `finished` when
  handed a PR fact. `plot-fleet-scan.sh:1637` passes it; `registry.ts:793`
  passes `''` deliberately, because *"the registry must not be behind anything
  that can fail"*. So a finished agent with a merged PR reads `stalled` in one
  place and `finished` in the other.
- **An ending with no record.** `_ended_detail` is set at
  `plot-worker-loop.sh:744`, `:756` and `:813`, and **written nowhere** — no
  file, no stdout. There is no channel for it to arrive on.

### An agent has no identity, only a receipt

Every field of `AgentEntry` (`registry.ts:105`) describes a run: `session`,
`resumeId`, `attempts`, `branch`, `worktree`, `command`, `startedAt`, `pid`,
`previousPid`, `relaunches`, `state`. None describes an agent. With one
`Worker command` (`CLAUDE.md:32`), every dispatched agent is the same agent.

**That is why a worker ends for exactly two reasons, and both are time** — the
bound expired (`:744`) or the monitor reported idle (`:756`). The three reasons
an operator actually names land differently:

| reason | whose fact | today |
|---|---|---|
| the context ran out | Worker | **unmodelled, but measurable today** — `contextPct`/`tokenBudget`/`contextWindow` return zero hits, yet the harness transcript carries `message.usage` and Plot already opens that file (`plot-transcript-quiet.sh:67`). See *Context is readable* below |
| the session ended | Agent | half-present — `resumeId` exists; `registry.ts:724` records that a synthesized agent *"costs the entry its resume path"* |
| the work needs a different expert | Registry | **unrepresentable** — `entities/agent.ts` has no `kind` |

A bound is a guess about all three. Eight hours is wrong in the safe direction
for every one: it kills an agent whose context died at minute forty, and keeps
one alive whose slice needed a capability it never had.

### The rules are in the shell because nobody re-asked after the pattern existed

**21,649 lines across 36 scripts** — and 69% of the largest is comment
(`plot-fleet-scan.sh`: 2,731 of 3,945; dispatch 55%; the worker loop 71%). The
estate is mostly *recorded reasoning*, which is the asset and the argument: a
measured rule like *"a guard restarted one branch TWICE while its worker waited
on an answer"* (`plot-worker-state.sh:527`) belongs where a test holds it, not
where only a reader can.

**The replacement pattern already exists, four times over.** `plot-verdicts.mjs`,
`plot-transition.mjs`, `plot-movable.mjs` and `plot-monitor.mjs` are domain
rules compiled to bundles. `plot-fleet-scan.sh:3436` pipes readings into one;
`plot-approve.sh:453` and `plot-deliver.sh:320` call another.

Every objection to generalising it is already disproved by the repo:

| objection | measured |
|---|---|
| a worker may lack Node | `plot-worker-loop.sh:253,297,486` run `node -e` |
| a skill needs a script with no build | `plot-board-setup/SKILL.md:274` runs `node <artifact>`; `build.mjs:26` is `bundle: true` with no `external` |
| the domain cannot reach git | `ports/refs.ts` has 22 ops, `trees.ts` 10, `processes.ts` 4 |
| the bundles need installing | `plot-movable.mjs` — **1,215 bytes** — ran from `/tmp` with no `node_modules` and answered correctly |

## Design

### Approach

**Three moves, in order: name the agent, move the rule, give the ending a
channel.** Each is separately useful and separately reviewable.

The target shape is the one four bundles already have:

```
SKILL.md  →  node board/plot-<verb>.mjs  →  domain  →  port  ←  adapter  →  git / ps
```

### What stays in shell, and the test that decides it

**A script survives when it IS a process, not when it computes an answer.**

`plot-worker-loop.sh` is the only script that passes: it is the process bracket
itself — `trap ALRM` (`:747`), `trap USR1` (`:759`), `trap EXIT` (`:792`),
`bash -c '. "$1"' &` (`:816`), and a SIGKILL over a pgrep'd descendant tree
(`:626`). Its comment at `:608–620` records two measured failures that depend on
shell semantics: reaping children before the root lets the sourced prompt *"run
its NEXT line before the kill reaches it"*, and killing the root first makes
`pkill -P` find nothing because SIGKILL reparents the orphan to init.

**Its lifecycle rules still leave** — *when* to end and *why*. What stays is the
bracket that carries the ending out.

`plot-config.sh` (23 sourcing callers) and `plot-host.sh` (2,920 lines, 151
world calls) are pure adapter: no lifecycle rule to extract, so moving them buys
risk and no answer. **They go when their callers are gone, and not before.**

The three monitors have **zero** daemon lines and compute an answer per pass;
`plot-dispatch.sh`'s six are one detached start the `Performer` port can own.

### Context is readable, and it is a verdict rather than a number

**Measured 2026-09-03.** A harness transcript carries `message.usage` — 59 of
400 sampled lines in one real session — and the newest carried
`cache_read_input_tokens: 642532`, which with `input_tokens` and
`cache_creation_input_tokens` is **643,808 tokens, 64.4% of a 1M context**.

**Plot already opens that file.** `plot-transcript-quiet.sh:67` resolves
`~/.claude/projects/<slug>` from a worktree and reads the newest line's age for
quiet-detection. Reading one more field on a line it already parses adds no
dependency and no new adapter.

**The domain carries a VERDICT, never the percentage.** `Machine` is the
precedent: `machine.ts:43` *"reads a spawn cost as a headroom verdict"* rather
than exposing milliseconds, because a threshold in a value means every consumer
owns the threshold. Context is the same shape — a reading becomes *ample* or
*spent*, and a board that wants to render 64% renders it from the reading, not
from a decision.

### A fourth reason: an agent can be spent without being broken

The three reasons above are all endings. **`spent` is not.** An agent at 88% has
nothing wrong with it; it simply should not be handed another slice.

So it ends the way the lifecycle already allows: **it finishes its slice and is
not given a next one.** `an-agent-holds-one-desk` established that an agent
which finishes stays alive and waits (`feature/an-agent-waits-for-work`, #674);
`spent` is the answer to that wait — *nothing more for you*, rather than
*nothing available*.

**This is why it is a reason and not a dispatch filter.** A filter would make a
spent agent look identical to an idle fleet, and an operator watching the board
could not tell "no work" from "this agent is done". The distinction is exactly
the one `plot-fleet-scan.sh --why-nothing` exists to draw.

### What a declaration carries

**Capability — what this agent IS.** The harness, the model, the effort, and the
capabilities it holds. None exists today.

**Bounds — what this agent MAY spend.** A context ceiling and what happens at
it. This is what turns *"the bound expired"* into *"the context ran out"*.

**What it must NOT carry: any run fact.** No pid, branch, worktree or
`startedAt`. Those are the manifest's, and a declaration holding them would be a
second record of one run — the duplication `registry.ts:105` already is.

**`capabilities`, not `skills`.** This repo already uses *skill* for
`skills/plot/*` and states *"skills interpret and adapt; scripts collect and
report"* (`CLAUDE.md:162`). Two meanings for one word in a repo with a
vocabulary section is how `Wave`/`Slice` drifted.

### Not chosen: rewrite the scripts wholesale

The reasoning is the asset, and 69% comment means a rewrite discards more than
it moves. Each rule migrates with its measurements, the way
`production-calls-the-domain-one-rule-at-a-time` did — delivered 2026-09-02
across six slices (#577, #590, #614, #619, #638, #643), which is the pattern
this plan continues rather than invents.

### Not chosen: infer the capability from the plan text

A matcher could read a slice's plan and guess. Rejected for the reason
`DESIGN-plan.md` gives for not inferring dependencies from shared files: a guess
that is usually right produces a fleet whose wrong answers cannot be explained.
A declaration is a fact a person wrote.

### Open Questions

- [ ] **Who writes a declaration?** A committed file, or a board action? The
      manifest is machine-written and the plan is human-written; this sits
      between them.
- [ ] **Where does it live?** `.plot/agents/` holds transient manifests that
      `drop.ts:258` unlinks; a permanent record there mixes two lifetimes.
- [ ] **Does matching belong in this plan?** Declaring agents makes *choosing*
      one possible. `hasRoomToDispatch` (`entities/machine.ts:99`) is a boolean
      about headroom, not a choice among candidates. Probably its own plan.
- [x] **Is a context reading available at all?** *Answered 2026-09-03:* yes.
      The transcript carries `message.usage`; one real session read 643,808
      tokens (64.4% of 1M) from a file `plot-transcript-quiet.sh:67` already
      resolves. It is now a slice rather than a risk.
- [ ] **Is `synthesized` a defect again once declarations exist?**
      `DESIGN-agent.md:787` says it is; `entities/agent.ts:29` encodes it as an
      identity. **The code is right today** only because nothing can be
      declared. This plan should settle which document changes.

## Branches

### Declaring

- `feature/an-agent-declares-what-it-is` — the record: location, fields, and
  what it refuses. Capability only; **a test asserts it carries no run fact**,
  because a second copy of the manifest is the defect this removes.
  **Its consumer is the PROMPT, not the `Worker command`.** Round 3 measured
  the seam and found it one level deeper than round 2 assumed: `Worker command`
  is `plot-worker-loop.sh` — the loop, not a harness — and the real invocation
  is one shell file, `.plot/worker-prompt.sh:6`, where `claude -p`, the model
  and the whole instruction string are fused into a single line. `prompt_file`
  is hardcoded at `plot-worker-loop.sh:526`: **one prompt per repo, not one per
  agent.** So the declaration's first consumer is the prompt's *resolution* —
  the loop asks which prompt this agent runs instead of assuming the repo's
  one. A branch with no declaration keeps `.plot/worker-prompt.sh`, so nothing
  on the estate changes until a declaration exists. → #679

### Deciding in the domain

- `feature/the-task-state-is-a-domain-rule` — `plot_worker_task_state`
  (`plot-worker-state.sh:533`) becomes a domain rule behind a bundle, the way
  `plot-movable.mjs` already is. **Four lines of logic over four booleans** —
  `has_pr`, `blocked`, `dirty`, `unpushed` — carrying 40 lines of measured
  reasoning, including the ordering rule that dirtiness is checked AFTER
  blocked. The shell keeps the 21 world reads and stops deciding.
  **The function survives; only its body moves.** `plot_worker_task_state`
  stays a shell function that pipes its four readings to a bundle, exactly as
  `plot-fleet-scan.sh:3436` already pipes into `plot-verdicts.mjs`. All nine
  sourcing callers are untouched, and no window exists in which two
  implementations both decide — which is what drifted before, when this script
  carried five of its six states in duplicate until 2026-08-18. → #685

### Agreeing on the states

- `feature/the-registry-reads-eight-states` — `AgentState` (`registry.ts:35`)
  stops collapsing eight into five, reading the same rule as the scan. Closes
  `DESIGN-agent.md:797`. **Asserted: one agent reads one state**, which it does
  not today. The PR fact stays the caller's to supply — a rule taking readings
  as values makes the choice visible in a signature instead of hidden in an
  argument default. → #686

### Ending for a reason

- `feature/an-ending-carries-its-reason` — `_ended_detail` gains the channel it
  never had: the worker writes reason and actor to the desk beside
  `.plot-worker.exit`, and the state rule reads it. **Asserted: a bound expiry
  and a context exhaustion are different endings**, because today they are the
  same one. `_ended_by` is carried with it.

### Reading what an agent has spent

- `feature/a-worker-names-its-session` — **the prerequisite round 3 found.**
  `plot-dispatch.sh:774` exports `PLOT_SESSION_ID` and the loop forwards it, but
  `.plot/worker-prompt.sh` never passes `--session-id`, so no transcript can be
  attributed to an agent. `plot-worker-loop.sh:1063` already reports this in
  prose — *"Pass --session-id from .plot/worker-prompt.sh to make the reading
  available"* — and then ends the worker because nothing could tell. One
  argument, and it unblocks both the reading below and resume. → #689

### Knowing what it spent

- `feature/an-agent-knows-what-it-spent` — the context reading: the transcript
  yields `message.usage`, and the domain turns it into a verdict.
  **Read PER SESSION, never per worktree.** Quiet-detection deliberately takes
  *"the newest line across ALL of a worktree's sessions"*
  (`plot-transcript-quiet.sh:44`), which is right for *is anything happening*
  and wrong for *what has this agent spent*: one project directory measured
  2026-09-03 held **45 session files, 30 of them subagents**, and a sum across
  them belongs to no one. Same file, opposite joins — which is why the slice
  above comes first.
  **Asserted: the domain exposes no percentage** — a threshold in a value is a
  threshold every consumer owns, which is why `Machine` reports `Headroom` and
  not milliseconds. **Also asserted: a missing or unattributable transcript
  answers *unknown*, never *ample*** — silence is not headroom, the rule
  `plot-worker-state.sh` already applies to an unreadable worktree.
  **Nothing measures the window, found 2026-09-04.** A transcript turn carries
  four token counts and names its model, and no key in the file matches
  `window` or `limit` — so the numerator is measurable and the denominator is
  not. The window is therefore DECLARED, on `CharterBounds` beside the ceiling,
  for the reason this plan gives for not inferring a capability from plan text;
  a model-to-window table is also wrong here, since this repo runs
  `claude-opus-5` at both 200k and 1M. An agent declaring no window reads
  `unknown`, which is every agent on the estate today. → #692

### Supervising

- `feature/the-registry-supervises-its-agents` — `plot-registryd`: the tick, the three bounds, the correction-and-resume path, the reap on success, and the `needs a person` stop. Stateless across restarts by construction. **Moved here from `the-registry-supervises-its-agents` on 2026-09-04**, which delivered without it: its gate was lifted the same day on measurements this estate produced, but a delivered plan dispatches nothing, so the branch could never be started and `an-agent-holds-one-desk`'s last wave waited on a branch that would never exist. This plan is where the work belongs now — the registry cannot supervise what it cannot name, and `feature/an-agent-declares-what-it-is` gave it the name. → #695

### Watching

- `feature/the-machine-keeps-the-daemon-alive` <!-- waits: feature/the-registry-supervises-its-agents --> — the launchd/systemd unit, and what the daemon does on a tick it cannot complete. Last, because a supervisor worth keeping alive has to exist first. Moved with the wave above, for the same reason. → #699

## Notes

Written 2026-09-03 from a review of the fleet layer (Machine, Registry, Board),
interrogated the same day. Every measurement was taken on `main` at `e7f3586e7`.

**Sequencing.** `production-calls-the-domain-one-rule-at-a-time` is
**delivered** — all six slices merged (#577, #590, #614, #619, #638, #643) — so
nothing blocks this. It proved the per-rule migration this plan continues.

**Adjacent, deliberately separate:** `an-agent-holds-one-desk` is about the
*desk* — which worktree an agent owns and who resets it. This is about the
*agent* — who it is, what it may do, and how it ends.

**What this plan does not do.** It does not schedule, and it does not migrate
`plot-host.sh` or `plot-config.sh`. It moves four lifecycle rules and gives the
agent a name to be supervised under.
