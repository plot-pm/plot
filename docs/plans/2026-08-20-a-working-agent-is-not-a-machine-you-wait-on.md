# A working agent is not a machine you wait on

> Measured on the live board 2026-08-20: `bug/one-component-renders-every-row`
> appears in **WORKING** *and* in **WAITING ON A MACHINE**, five minutes apart on
> one screen. From `/api/fleet` for that row: `worker: running`, **`pr: None`** —
> so there is no CI, no check, nothing a machine is doing. The section is listing
> the agent itself as the machine.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

Reported by the operator: *"This makes no sense. WAITING ON A MACHINE is not
waiting on an agent."*

### The rule is right about one case and too wide by one

`feature/a-local-run-is-a-machine-working` introduced it, and the plan states the
case it was for:

> *"an agent watching its own CI is listed in both sections at once — once as an
> agent, once as a process — because the two sections list different things"*

That case is real: **agent running AND CI running** is two waits, and two rows
say so honestly. The reader is waiting on a machine (the CI) *and* an agent is
working.

The implementation keys the section on the **process** (`fleet.ts:3009`):

    if (worker === 'running') { out.push({ origin: 'local', … }) }

An agent **is** a process, so the rule also catches the case the plan never
considered: **agent running, no PR, no CI.** Nothing is waiting on a machine —
the only machine in sight is the agent, and WORKING already names it.

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

### A local run enters the section only when something else is also pending

`origin: 'local'` is kept — a process this board can see is a real fact and the
`evidence`-not-verdict wording stays. What changes is when it is **listed**:

| worker | PR checks | WORKING | WAITING ON A MACHINE |
|---|---|---|---|
| running | **pending** | yes — an agent is working | **yes** — you are also waiting on CI |
| running | none / passed / failed | yes | **no** — nothing is pending |
| not running | pending | no | yes — the case the plan names: an agent exited, checks still run |
| not running | none | no | no |

Two rows appear exactly where there are **two waits**, which is the plan's own
justification, applied.

**The membership rule stays one rule.** The plan warns that special-casing the
host case beside the local case *"would leave the section with two rules about its
own membership, which is how the pair drifts"* — that warning holds and this does
not violate it: the section still lists **pending machine work**, and a local run
qualifies when there is machine work to wait on.

### An alternative, recorded and declined

Drop `origin: 'local'` entirely — the section becomes CI-only, as it was. Cheaper,
and it loses the case the plan measured: **an agent that exited while its checks
still run**, which without the local origin lands nowhere. That row is the reason
the origin exists, and it survives here (row 3 above).

### What must not change

- **The evidence-not-verdict wording.** *a worker process is running in a local
  worktree (pid N)* is what was seen; the pid travels so a reader can look.
- **One liveness derivation.** The comment's hazard is real: both readings must
  come from the same classifier. This changes which rows are *listed*, never how
  aliveness is decided.
- **The CI case.** A pending check with no local worker is unchanged.
- **Membership elsewhere.** No other section gains or loses rows.

### Open Points

- [ ] Does a **stalled** worker with pending checks belong here? `plot-worker-state.sh`
      distinguishes `waiting` and `stalled` as TASK states rather than process
      states, and the comment excludes them from `origin: 'local'` on purpose. The
      CI half would still list the row; whether the local half should too is a
      question about what a stalled agent means, not about this rule.

## Branches

### Narrowed
- `bug/a-working-agent-is-not-a-machine-you-wait-on` — a local run is listed in WAITING ON A MACHINE only when a check is also pending. Tests: a running worker with **no PR** appears in WORKING and **not** in WAITING ON A MACHINE; a running worker with a **pending** check appears in both; a **stopped** worker with a pending check appears in WAITING ON A MACHINE only, which is the case the origin exists for; a running worker with **passed** checks appears in WORKING only; the local entry's wording and its pid are unchanged; liveness is still derived once; no other section's membership moves.

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
