# Every section has one subject

> Four rules from the operator, and together they say one thing: **each section
> has a subject, and a row belongs to the section whose subject it is.** WORKING
> is about agents. WAITING ON A MACHINE is about a build or a pipeline. WAITING ON
> YOU is about anything needing a decision — and an agent only when the agent is
> broken.
>
> Measured on the live board 2026-08-20: `bug/one-component-renders-every-row`
> appears in **WORKING** *and* in **WAITING ON A MACHINE**, five minutes apart on
> one screen. From `/api/fleet` for that row: `worker: running`, **`pr: None`** —
> so there is no CI, no check, nothing a machine is doing. The section is listing
> the agent itself as the machine.

## Status

- **Phase:** Approved
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — the doubling was measured with `pr: None`, so it cannot be the two-waits case the rule was written for
- **Started:** 2026-08-20, Jan Wloka, `bug/an-agent-is-not-a-machine-you-wait-on`

## The rule

| section | subject | an agent appears |
|---|---|---|
| **WORKING** | the **agent** — the branch is what it holds | **always**, and only here while it works |
| **WAITING ON A MACHINE** | a **build or pipeline** on a PR, branch or plan | **never** — an agent *is* a machine, not a wait |
| **WAITING ON YOU** | anything needing a person: PR, branch, plan, release, build | **only when broken** — crashed, abandoned, out of context |

The corollaries are what change code: no branch appears in WORKING without an
agent holding it, no agent appears in the machine section at all, and an agent in
WAITING ON YOU is by construction a problem report.

## Problem

Reported by the operator: *"This makes no sense. WAITING ON A MACHINE is not
waiting on an agent."*

### The rule was wrong about its own justifying case

`feature/a-local-run-is-a-machine-working` introduced it, and the plan states the
case it was for:

> *"an agent watching its own CI is listed in both sections at once — once as an
> agent, once as a process — because the two sections list different things"*

The sections do list different things, and that is why the conclusion does not
follow. **An agent watching its own CI is two subjects, not one subject twice.**
The agent belongs in WORKING; the PR whose checks are running belongs in WAITING
ON A MACHINE. Both rows appear, and neither is the same row twice.

Reading it as one subject in two sections is what produced the duplicate the
operator saw — and it produces it *whether or not* CI is running, because the
implementation cannot tell the justifying case from any running worker.

**The membership rule is in the client, not the server** — measured, and worth
stating because the first reading of this defect got it wrong. `AgentList.tsx:230`:

    export function inMachineSection(row: AgentRow): boolean {
      return row.group === 'waiting-on-machine' || processesOf(row).length > 0;
    }

Two halves, and the section is **additive to the group**. The left half is the
server's grouping (`fleet.ts:2501`, a pending PR check). The right half admits
**any row carrying a `processes` entry at all** — and `machineProcesses`
(`fleet.ts:3009`) writes one for every running worker:

    if (worker === 'running') { out.push({ origin: 'local', … }) }

So a row can be `group: 'working'` *and* appear in WAITING ON A MACHINE, which is
exactly what the measurement shows: `/api/fleet` reports `group: working` for the
screenshot's row while the tab renders it twice.

An agent **is** a process, so the right half catches the case the plan never
considered: **agent running, no PR, no CI.** Nothing is waiting on a machine —
the only machine in sight is the agent, and WORKING already names it.

`fleet.ts:3009` is where the *description* is built; `AgentList.tsx:230` is where
*membership* is decided. **The fix belongs to the second**, and the branch must
not be sent looking at the first.

### What the comment defends, and what it does not

`fleet.ts:2995` argues the doubling is deliberate:

> *"one observation, read twice for two questions — so the two can never disagree
> about whether a worker is alive. **Who is working?** is answered by the agent;
> **what am I waiting on?** by the process."*

**Consistency was never the problem.** Two rows for one thing do not disagree;
they repeat. And the second question has no answer here: *what am I waiting on?*
— an agent, which is the first question's answer.

The comment's care is aimed at a real hazard (two sections computing liveness
separately and drifting) and it solves that correctly, by reading one
observation twice. What it does not check is whether the second reading has
anything to report.

### Why the section's name is the argument

**WAITING ON A MACHINE means: you cannot act, something automated is working.**
For CI that is exactly true — you wait, then you read a verdict.

For a local agent it is also technically true, and **WORKING is the better
sentence**, because it says *who*. Given both, the reader learns nothing from the
second and has to reconcile two rows describing one branch.

## Design

### An agent is the machine. It is never the thing you wait on.

Settled 2026-08-20 by the operator, and it is categorical rather than
conditional: **an agent appears in WORKING and in no other section.**

The section answers *what am I waiting on?* An agent is not an answer to that —
it is the thing doing the work, which is what WORKING says. What belongs here is
**a branch, a PR, or a PR's plan** whose progress now depends on something
automated: a check running, a build queued. Those are things a reader waits on
because they cannot act.

| in the section | why |
|---|---|
| a PR whose checks are pending | a machine is deciding; you wait |
| a branch whose build is queued | same |
| **an agent, in any state** | **never — an agent IS the machine, and WORKING names it** |

**The two-waits case disappears, and that is the point.** The rule was introduced
for *"an agent watching its own CI"*, listed twice — once as an agent, once as a
process. But those are not two views of one thing: the agent belongs in WORKING
and **the PR** belongs here. Two rows, two subjects, no duplication. The original
framing put one subject in two sections; the correct reading has two subjects in
one section each.

### WORKING is about agents, not about branches

The other half of the same rule, settled 2026-08-20: **no branch, PR or plan
appears in WORKING on its own.** They appear only as what an agent is working
on — *Agent A is working on branch foo.*

Today the section is branch-centred. Measured from `/api/fleet`, the one WORKING
row is:

    branch: bug/one-component-renders-every-row
    worker: running
    note:   "worker running (pid 37463)"

The row **is** the branch; the agent is a note hanging off it. The reader is told
what is being worked on and has to infer who from a pid.

**Inverted:** the row is the agent, and the branch is what it holds.

| | subject | vehicle |
|---|---|---|
| WORKING | **the agent** | the branch it is working on |
| WAITING ON A MACHINE | **a PR, a branch, a plan** | — |

This is not a new mechanism. `an-agent-outlives-its-branch` landed today and
keys an agent on its **session id** precisely so it can outlive the branch — and
the payload already carries both shapes side by side:

    rows:   [ { branch: bug/one-component…, worker: running, … } ]   ← branch-centred
    agents: [ { session: 297683ca-…, branch: bug/one-component…, startedAt, … } ]

Two representations of one agent. This wave makes WORKING read the second and
stop rendering the first.

**And it is the tuple's agent kind.** `a-row-is-a-tuple` specifies slot 3 for an
agent as the session id, with the branch as an artifact link — so this is that
row, in the one section where an agent belongs. A branch that no agent holds is
**not in WORKING at all**: it is eligible, held, or waiting, and those sections
already exist for it.

### WAITING ON A MACHINE is for a build or a pipeline. Nothing else.

Settled 2026-08-20, and it closes the remaining gap: the section holds a PR,
branch or plan **only while an automated build or pipeline is running on it.**

Not when an agent is making changes — an agent writing to a worktree is an agent,
and it belongs in WORKING. Not when a lock file says a write is in progress. The
distinction is *who or what could I be waiting for, and can I act?* A pipeline
runs on a machine nobody can hurry. An agent is somebody working.

### Five paths reach WORKING today, and one involves an agent

Measured in `fleet.ts`:

| line | note it sets | agent involved |
|---|---|---|
| 2764 | `worker running (pid N)` | **yes** |
| 2816 | `worker waiting on you: …` | **yes** — stopped to ask |
| 2905 | `unstarted` | no |
| 2934 | `last commit N ago` | no |
| 3116 | `a write is in progress in a local worktree` | **no** — a lock file |

So WORKING is today mostly **agentless**: three of five paths are branch states
dressed as work. Line 3116 is the sharpest — a `locked` flag means some process
holds a write lock, which is neither an agent nor a pipeline.

### Where each row goes

| what is true | today | after |
|---|---|---|
| an agent is running on the branch | WORKING (as the branch) | **WORKING**, as the *agent*, branch as its artifact link |
| an agent stopped to ask | WORKING | **WORKING** — still an agent, and the question is why it needs a person |
| a build or pipeline is running | WAITING ON A MACHINE | unchanged |
| held by a worktree, no agent | WORKING | **NOT STARTED** — *approved, nobody has taken it*, which is what its hint already says |
| uncommitted work, no agent | WORKING | **NOT STARTED**, keeping the mark it already carries |
| a write lock, no agent | WORKING | **NOT STARTED** — a lock is not a worker; the mark says a write is in progress |
| last commit N ago, no agent | WORKING | **QUIET** or NOT STARTED by its own age, not by a section that means *an agent is on it* |

The two WORKING rows the operator saw earlier today — *"held in a local worktree"*
and *"uncommitted work in a local worktree"* — are exactly this: branches with
**no agent at all** sitting in the section for agents. Measured then: no worker
files, no claim ref, no session transcript. Nobody was working; the section said
somebody was.

**Which target each agentless case takes is the branch's judgement**, from the
sections' own hints (`not-started`: *approved — nobody has taken it*; `quiet`:
*still thinking, or dead?*). What is settled is that they leave WORKING.

### WAITING ON YOU may hold anything — and an agent only as an exception

Settled 2026-08-20. The section is for what needs a **person's decision**, so its
normal population is a PR, a branch, a plan, a release or a build. An agent has no
business there while it is working; an agent *is* the worker.

**An agent appears here only when something is wrong with the agent** — and its
presence is then itself the signal. Three cases named:

| case | what the reader must do |
|---|---|
| **crashed** | read the log, decide whether to restart or abandon |
| **abandoned** | it stopped without finishing and without asking; decide |
| **compact context** | it is still running but out of room to think |

**Two of the three are already representable, one is not.** Measured against
`WorkerStateSchema`'s eight values:

| case | existing state |
|---|---|
| abandoned | **`stalled`** — this is what it describes |
| crashed | **`failed`** / **`ended`** |
| compact context | **none** |

`compact context` is unrepresentable today, and worse: it is invisible. An agent
whose context is full still reports `running`, because the process is alive — the
condition is not in the process, it is in the transcript. The registry reads
`contextTokens` for exactly this, and measured on the live board it is **absent**:

    agents[0]: contextTokens: ABSENT, model: ABSENT, lastActivity: ABSENT

Because this repo's `Worker command` carries no `--session-id`, so the runtime's
transcript does not land where the manifest points and the join degrades to the
absence the registry treats as honest. **So the third case cannot be detected
until that is fixed**, and this plan does not claim otherwise — it is recorded as
the open point below rather than designed against data that is not arriving.

**The exception must stay rare, and rarity is a property of the rule, not a hope.**
Only a *problem* state admits an agent here. A working agent, a waiting agent
(one that stopped to ask is in WORKING — it is working, and its question is the
note), a finished one: none of them.

### `origin: 'local'` is removed

`machineProcesses` keeps only its host half. The local branch (`fleet.ts:3009`)
goes, and with it the `inMachineSection` doubling it fed.

**The objection this plan first raised is measured and wrong.** The earlier
version declined removal because *"an agent that exited while its checks still
run would land nowhere"*. It lands in the section by two independent paths that
never look at a worker:

- `fleet.ts:2501` — `pr.checks === 'pending'` sets `group: 'waiting-on-machine'`
- `machineProcesses`' host half — `prState(pr) === 'pending'` pushes
  `origin: 'host'`

So removal loses no row. The case that justified the local origin was already
covered by the CI path, and the local origin only ever added a duplicate.

### `inMachineSection` becomes one statement again

`AgentList.tsx:230` is today:

    row.group === 'waiting-on-machine' || processesOf(row).length > 0

The right half exists so a locally-observed process could join a section the
server had not grouped it into. With no local origin, `processes` carries only
host entries — which the server already grouped — so the disjunction is
redundant, and a redundant `||` is where the next local case would silently
re-enter.

Whether the predicate collapses to `row.group === 'waiting-on-machine'` or keeps
reading `processes` for host entries is an implementation choice; what must hold
is that **no worker state can put a row in this section**.

### What must not change

- **`processes` stays on the row.** It is descriptive data and other things read
  it; this removes the local *entry*, not the field.
- **The CI case is untouched.** A pending check with or without a local worker
  lists the row exactly as it does now.
- **One liveness derivation.** The comment at `fleet.ts:2995` guards against two
  sections computing aliveness separately and drifting. After this there is only
  one consumer of worker state for sections at all, which is the strongest form
  of what it asked for.
- **WORKING is unchanged.** It already lists a running worker; nothing about it
  moves.

### Open Points

- [ ] **`compact context` cannot be detected yet.** The registry's `contextTokens`
      is the field for it and it arrives absent, because this repo's
      `Worker command` forwards no `--session-id` so the transcript join fails.
      Fixing the forward is a one-line config change; deciding *what counts as
      full* is a judgement — a fraction of the window, or the runtime saying it
      compacted. Neither is designed here.
- [ ] Does the `⏳` hint *"nothing — a machine is working"* still read correctly
      when the section only ever holds host work? It was written when a local run
      could be the machine.

## Branches

The order is **remove, then invert**. Removing the local machine entry is a
three-line predicate change that stands alone; making WORKING agent-centred
changes what the section *is* and depends on the registry the same day landed.

### Removed
- `bug/an-agent-is-not-a-machine-you-wait-on` (PR #300) — `machineProcesses` loses its `origin: 'local'` half and `inMachineSection` stops admitting rows on worker state. Tests: **a running worker with no PR appears in WORKING only**; **a running worker with a pending check appears in WORKING, and the PR's row is in WAITING ON A MACHINE — the agent is not**; a stopped worker with a pending check is still listed, which is the case the local origin was wrongly credited with covering; no worker state of any kind (`running`, `waiting`, `stalled`, `finished`) puts a row in the machine section; `processes` still carries host entries; the CI grouping at `fleet.ts:2501` is unchanged.

### Surfaced
- `feature/a-broken-agent-needs-you` — a crashed or abandoned agent appears in WAITING ON YOU, naming what went wrong and where to look; every other agent state stays out of it. Tests: a `failed` worker appears in WAITING ON YOU; a `stalled` one appears, and the note distinguishes *stopped without finishing* from *crashed*; a **`running`** worker does not; a **`waiting`** worker does not — it stopped to ask and is working, with its question as the note; a `finished` one does not; the row names the log path and the worktree so the reader can act; no PR, branch or plan row moves.

### Inverted
- `feature/working-is-about-agents` — WORKING renders the `agents` list rather than branch rows, each naming its agent with the branch as an artifact link; the four agentless paths into `working` (`unstarted`, `last commit N ago`, `locked`, `held`) go to the section their state belongs to. Tests: a running agent appears once, identified by its session, with its branch linked; **a branch with no agent does not appear in WORKING** — held, uncommitted, and write-locked branches all leave it carrying the marks they already have; **a `locked` worktree with no worker is not called working**; an agent holding **no** branch is listed, which is what the registry exists for; two agents on two branches are two rows; the same agent is never two rows; no other section loses a row.

## Notes

Found by the operator seeing one branch twice on one screen, five minutes apart,
with `pr: None` — so the doubling could not be the two-waits case the rule was
written for.

The shape is one this estate keeps producing and is worth naming: **a rule keyed
on a mechanism when the intent was a situation.** The plan meant *"an agent
watching its own CI"*; the code says *"a process is running"*, and an agent is
always a process. The same distinction the tuple plan reached from the other side
— `kind` answers *what is being decided here*, not *what object did this come
from*.
