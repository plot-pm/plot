# The registry supervises its agents

> An agent whose worker dies still owes its work. The registry becomes the
> supervisor the spec already says it is: it spawns, judges an envelope, resumes
> a failed session with a correction, and reaps — instead of a person noticing
> a crashed worker on the board.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** the-domain-is-one-implementation
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- A dispatched agent that does not finish is picked up again instead of going
  quiet: the registry judges each agent by the envelope it writes, resumes an
  unfinished one with a correction naming what is missing, and gives up only
  after a bounded number of attempts.

Board impact: real. The manifest gains `envelope`, `attempts` and a filled
`session`; `AgentEntry`/`AgentRow` gain fields the board renders; a `WAITING ON
YOU` row stops meaning *"a worker died"* and starts meaning *"the registry gave
up"*. `plot-worker-loop.sh` and `plot-dispatch.sh` both change. Rebuild the
artifact (`pnpm build:board`).

## Motivation

**Measured 2026-08-31.** Three dispatched workers hit their 8 h `Worker bound`
and died at `exit 124`. All three had **committed and pushed real work**. None
had opened a PR. Nothing reported it.

```
feature/a-decision-writes-what-the-script-writes   3 commits, pushed, no PR
feature/the-master-agent-asks-the-controller       4 commits, pushed, no PR
feature/a-manifest-names-every-process             3 commits, pushed, no PR
```

They were found because a person looked at the board and asked *"what about the
crashed workers?"* — the board said `worker crashed — exited 124`, which reports
that a **process** died and says nothing about work being stranded.

**One of them was a rescue of a rescue.** `perform-fs.ts` on the first branch is
239 lines whose own commit message reads *"Committed UNVERIFIED: no tests were
written for it"* — an earlier worker on the same branch had already died leaving
it untracked. Two deaths, twice inherited, and the incompleteness surfaced only
when a human read a coverage report (0 % on that file, against the domain's hard
100 % gate).

**Why nothing noticed is structural, not an oversight.**
`plot-worker-state.sh:46` states it: *"every worker exits 0, so the exit code
cannot say whether the work is done."* Plot infers completion from a process
ending. That inference has now been wrong at least four times in one estate.

**And nothing was left to care.** `plot_monitor_subject` ends both monitors when
the agent pid is gone, so at the moment work becomes stranded, the last
component that could report it exits. The AgentMonitor's findings
(`owes a review`, `holds unlanded work`) are real and correct — and are written
to a file in a worktree that nothing reads.

## Design

### The spec already assigns this job, and the code never took it

`DESIGN-agent.md` is explicit:

> **the operator asks the REGISTRY for N agents**
> **→ the registry SPAWNS each agent; spawning it IS starting its process**

and

> | removed | by the loop, on its own success | **by the registry, when the agent ends** |

**`registry.ts` does none of that.** Every export is a reader —
`readAgentRegistry`, `parseManifest`, `gitWorktrees`, `bashCleanliness`. Its
only `execFileSync` calls ask git questions. What actually spawns is
`plot-dispatch.sh`, invoked by a person or by the board's auto-dispatch, and the
registry *observes* the result: when a manifest is missing it **synthesizes a
row** from the worktree rather than reporting an orphan.

So the registry is a **read model wearing an orchestrator's name**. This plan
gives it the job the spec assigned.

### The shape this takes, and why each part earns its place

The pattern is *agent proposes, code disposes*: a supervisor spawns one headless
process, then **judges the result** rather than trusting it — an envelope parse
plus gates. The agent never controls retries or transitions.

Four mechanisms, and what each is worth here:

| Mechanism | Plot today | Taken? |
|---|---|---|
| **Envelope** — typed JSON; no envelope = no completion | exit code + inference | **yes**, in full |
| **Gates** — run after, read only what was left behind | `Done when` prose nobody executes | **yes** |
| **Correction into the same session** (`--resume`) | `--restart` loses all context | **yes** |
| **`Run` holds the workflow in memory** | manifests on disk | **no** — see below |

**The last one is not portable, and that is the important difference.** An
orchestrator may hold state in memory when *a run is bounded* — it starts, it
finishes, and nothing outlives it. Plot's estate is continuous and its
supervisor must survive its own restart, so the ledger stays on disk and the
daemon holds **no authoritative state**: it reads `.plot/agents/` each tick,
acts, writes back.

That single constraint buys the retroactive property for free. A daemon starting
for the first time sees exactly what a daemon that has run for a week sees — the
manifests — so **the three agents that died before this existed are recovered by
the first tick**, with no migration and no special case.

### The envelope decides completion

Every worker ends by writing `.plot-worker.envelope.json` in its worktree:

```json
{
  "branch": "feature/x",
  "status": "ok",
  "artifacts": ["packages/domain/src/rules/reap.ts", "test/reap.test.ts"],
  "pr": 571,
  "summary": "one sentence"
}
```

`status` is `ok` or `blocked`, and two values are enough: an agent may report
that it *cannot* proceed, which is information, and is different from silence.
A third value for *failed* would duplicate what the gates already decide.

**Absence is the load-bearing case.** No envelope means the work did not
complete, **whatever the exit code says**. A worker killed by the `Worker bound`
never gets to write one — which is precisely tonight's three, and precisely why
absence has to mean incomplete rather than unknown.

**This replaces inference, it does not join it.** The derived signals the
AgentMonitor computes (`commits && clean tree && no PR`) can be wrong in both
directions: a branch with an open draft PR looks finished, and a legitimately
finished branch whose PR was closed looks unfinished. The envelope is *declared*
and cannot. Once it lands, `owes a review` becomes a reading of the envelope
rather than a re-derivation from git.

### Gates run after, and read only what was left behind

A gate returns `null` (passed) or a human-readable failure. The constraint that
makes gates worth having: **they verify post-execution claims, never
predictions** — they run AFTER the agent finishes and look only at the files it
left behind. A check that runs before, or that reads the agent's own account of
its work, is not a gate.

Plot already owns most of them as scripts — they have simply never been run
against a finished worker:

| Gate | Existing implementation |
|---|---|
| a PR exists for this branch | `plot-pr-merged.sh` / `plot-host.sh pr-list` |
| a changeset was added | `check-changeset-packages.sh` |
| the tree is clean | `plot_worker_dirty` |
| the branch is not blocked | `plot_worker_blocked` |
| the plan line is annotated | `plot-plan-meta.sh` |

The failure text goes verbatim into the correction prompt, so the next attempt
is told what is missing rather than asked to re-derive it.

### Retry resumes the session

`plot-worker-loop.sh` captures the session id from
`claude -p --output-format stream-json`, whose first message is
`{"type":"system","subtype":"init","session_id":...}`, and writes it to the
manifest.

**The manifest already has the field.** `AgentEntrySchema` carries `session`,
used today only for the board's Drop action; a synthesized entry has
`session: ''`. So the identity plumbing exists and this fills it for a second
purpose.

A relaunch then resumes rather than restarts:

```
claude -p --resume <session> "Your work did not complete:
  - no PR was opened for feature/x
  - .changeset/*.md is missing"
```

The agent keeps its context and its prompt cache, and does not re-derive an
hour of reading. `--restart`'s fresh-worker path stays for the case where the
session is gone or unusable.

### Two bounds, and the machine is asked

A supervisor that relaunches unconditionally is a fork bomb with good
intentions. Three conditions, all of which must hold:

```
relaunch IF   attempts < MAX_ATTEMPTS          (default 2)
        AND   the last worker made progress    (new commits since it started)
        AND   hasRoomToDispatch(machine)       (already in the domain, #569)
```

**Progress is the discriminating one.** It separates *"ran out of time"* from
*"was never going to finish"* — a worker that died having committed nothing gets
no second chance without a person. Tonight's three all committed, so all three
qualify.

**`attempts` is a new manifest field, distinct from `relaunches`.** `relaunches`
counts operator-initiated `--restart`s and is a human's record; `attempts`
counts the supervisor's own tries and is what the bound reads. Conflating them
would let a person's three manual restarts exhaust the automatic budget, or the
reverse.

When the budget is spent the agent is marked `needs a person` — a visible stop,
which is the failure mode to prefer over a loop.

### The daemon, and who supervises it

`plot-registryd`, one per repo. Each tick:

```
read .plot/agents/*.json  +  the desks they name
  for each agent:
    worker alive?          -> nothing to do
    envelope ok?           -> gates pass? reap the desk : correct and resume
    envelope absent/blocked-> bounds met? resume with correction : mark needs-a-person
```

**It holds nothing in memory that it cannot re-read**, so `kill -9` costs one
tick.

**Who supervises the supervisor is answered by the Machine — the real one.**
`launchd` on macOS, `systemd` on Linux. That is the correct owner because *"is a
process that should be running actually running?"* is a machine-side question,
and it terminates the regress instead of adding another Plot component to
babysit.

**Plot's own `Machine` entity is not that supervisor and must not become one.**
`DESIGN-machine.md` settled the direction and defended it:

> *"A first version of this had the machine start idle workers for agents to
> claim. **It was withdrawn** — a worker is a relation […] no new object is
> needed."*

`Machine "1" --> "*" Agent : hosts` is a resource relation. The machine answers
*is there room?* (`hasRoomToDispatch`) and initiates nothing. The daemon **asks**
the machine before spawning; the machine never tells the daemon anything.

```
launchd/systemd  ── restarts ──►  plot-registryd
plot-registryd   ── spawns   ──►  agents        ── run ──►  workers
plot-registryd   ── asks     ──►  Machine (headroom, read-only)
```

### What this does NOT change

- **`plot-dispatch.sh` stays the spawner.** The daemon calls it rather than
  re-implementing worktree creation, claiming and manifest writing. One writer,
  as `start_worker` already is.
- **The claim stays a ref push.** *"The push is the claim, and it is the whole
  locking mechanism"* — two daemons on two machines cannot both win a branch.
- **`--restart` stays a person's call**, and its documented reasoning stands:
  *"replacing a stopped worker rather than reviewing, reaping or abandoning its
  work is a person's call."* The daemon's automatic path is narrower than that
  verb — it acts only where the agent's own envelope says the work is
  unfinished, which is not a judgement about whether the work is *wanted*.
- **The monitors keep their subjects.** The WorkerMonitor watches the process and
  dies with it. The AgentMonitor watches the desk and dies with its agent. What
  changes is that the *daemon* now reads what they publish.

### Open Questions

- [ ] Does the AgentMonitor survive at all once the daemon reads envelopes and
      runs gates? Its four findings become derivable by the supervisor from the
      desk. It may be that the right end state is no per-worktree agent monitor
      — decide after the daemon lands, not before.
- [ ] What tick interval? Long enough not to compete with the board's 5 s poll
      and the fleet scan's 18 s, short enough that a dead worker is not stranded
      for an hour. Measure the tick's own cost first.
- [ ] Does the daemon need a lock so two of them on one repo cannot both act?
      The ref-push claim already prevents double-spawning a branch; whether it
      covers reaping and manifest writes needs checking, not assuming.
- [ ] Is `blocked` handled by the daemon or escalated straight to a person? A
      `PLOT-BLOCKED` marker is already the *"your turn"* signal, and duplicating
      it in the envelope risks two answers to one question.

## Branches

### Declaring

- `feature/a-worker-declares-what-it-finished` — the envelope: worker writes
  `.plot-worker.envelope.json`, a typed parse in the domain, `status: ok |
  blocked`, and the rule that **absence means incomplete**. Nothing consumes it
  yet — this slice is the contract and its parser, so the shape is settled
  before three components read it.

### Judging

- `feature/the-gates-read-what-was-left-behind` — the gate interface and the
  five gates above, each wrapping a script that already exists. Pure functions
  over a desk; a gate returns `null` or a failure string, and the string is
  written to be pasted into a prompt.

### Remembering

- `feature/an-agent-remembers-its-session` — capture `session_id` from
  `--output-format stream-json` into the manifest's existing `session` field,
  plus `attempts`, and prove a `--resume` with a correction prompt actually
  continues the same conversation.

### Supervising

- `feature/the-registry-supervises-its-agents` — `plot-registryd`: the tick, the
  three bounds, the correction-and-resume path, the reap on success, and the
  `needs a person` stop. Stateless across restarts by construction.

### Watching

- `feature/the-machine-keeps-the-daemon-alive` — the launchd/systemd unit, and
  what the daemon does on a tick it cannot complete. Last, because a supervisor
  worth keeping alive has to exist first.

## Done when

- A worker killed mid-work leaves no envelope, and the registry reports that
  desk as incomplete **without consulting the exit code** — asserted by killing
  a real dispatched worker in a sandbox, not by stubbing one.
- An agent whose gates fail is resumed **in the same session** with a correction
  naming each failure, and the second attempt is observably the same
  conversation (same session id, and it does not redo work the first attempt
  did).
- The three bounds refuse in the three ways they must: budget spent → `needs a
  person`; no progress → no relaunch; no machine headroom → deferred, not
  dropped. Each asserted separately, since a single test passing all three
  proves only the happy path.
- **A daemon started fresh against an estate that already holds unfinished
  desks picks them up on its first tick** — the retroactive property, asserted
  against the state tonight's three left behind.
- `kill -9` on the daemon loses no decision: the next tick reaches the same
  conclusions from the same manifests.
- A gate failure message is legible as a prompt — checked by reading one, not by
  asserting a substring.
- `pnpm test`, `pnpm run test:board`, `pnpm run test:e2e`, `pnpm run typecheck`,
  `pnpm build:board`, changeset.

## Notes

**Where this came from.** Three crashed workers on 2026-08-31, and the question
*"when does the AgentMonitor take care of the crashed workers?"* The answer was
that it does not and cannot: it dies with its agent, and the work is stranded
precisely because the agent died. The operator's model — *"the agent should not
die with its worker; if the worker dies and the agent discovers its work is not
done, it should recover the worker or start a new one"* — is what this plan
implements, via a supervisor rather than an immortal agent.

**It contradicts a settled paragraph, and that is deliberate.**
`DESIGN-agent.md` §*Agent and Worker are one entity* says a worker *"cannot
predate its agent, cannot outlive it"* and that a worker is *"the Agent,
observed through the process table"*. Read strictly, a dead worker is a dead
agent and recovery is a category error.

That paragraph survived one challenge already (*"raised and withdrawn
2026-08-30"*), but the withdrawn proposal was different: idle workers waiting to
be claimed. **Nothing here waits.** The registry starts a worker, exactly as the
spec demands; the only change is that it may start **another one**. The spec's
own argument — that splitting would produce *"two descriptions of one thing plus
an invented rule for pairing them"* — holds only while the two always die
together, and `relaunches`/`previousPid`/`--restart` already prove they do not.

The narrow edit `DESIGN-agent.md` needs:

| Keep | Change |
|---|---|
| Nothing starts a worker except its agent | A worker's death is not its agent's death |
| A worker cannot predate its agent | An agent may run a **sequence** of workers |
| Worker names a relation, not an object | The relation is **one-at-a-time**, not one-for-life |

**The load-bearing rule, stated once:** a process that closes without a result
message is a **rejection, not a result**. Plot has never had that rule, which is
exactly why a dead worker and a finished one look identical to it. Every other
mechanism in this plan — the gates, the bounds, the daemon — is downstream of
adopting it.

**What this plan does not claim.** That the daemon is cheap. It is a new
long-lived process, a new failure mode, and a new thing to explain to an
adopting project. The three bounds and the OS-level supervision are what make it
defensible; if the Declaring and Judging slices alone turn out to close the
observed failures, the Supervising slice deserves re-argument before it lands.
