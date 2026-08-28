---
title: Ports and adapters — keeping the domain free of technical code
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Ports and adapters

**The goal, stated once: the domain does not know that git, a filesystem, a
host CLI or a process table exist.**

This is the layer the entity specs were written for. It is drafted last on
purpose — three of its decisions were open questions until the round-3 pass, and
one of them (*where do monitors live?*) turns out to have been a ports question
wearing a process costume.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Reviews:** [stage 1 — the model](DESIGN-review.md) ·
> [stage 2 — the workflows](DESIGN-review-workflows.md)

## Contents

| § | section |
|---|---|
| 1 | [What the domain is, and what it may not import](#1-what-the-domain-is-and-what-it-may-not-import) |
| 2 | [The driven ports — one per source of truth](#2-the-driven-ports--one-per-source-of-truth) |
| 3 | [The driving ports — who asks the domain](#3-the-driving-ports--who-asks-the-domain) |
| 4 | [The adapters already exist](#4-the-adapters-already-exist) |
| 5 | [Monitors are the proof the split works](#5-monitors-are-the-proof-the-split-works) |
| 6 | [The rule that keeps adapters honest](#6-the-rule-that-keeps-adapters-honest) |
| 7 | [How wide is a port? The measured answer](#7-how-wide-is-a-port-the-measured-answer) |
| 8 | [Two entrances, one implementation](#8-two-entrances-one-implementation) |
| 9 | [What is unresolved](#9-what-is-unresolved) |

---

## 1. What the domain is, and what it may not import

**The domain is fourteen entities, their states, their relations, and the rules
that gate transitions.** Nothing else.

**The test is an import list.** A domain module may import types and other
domain modules. It may not import `node:fs`, `node:child_process`,
`node:http`, or anything that reaches a network, a disk or a process table.

**That test is a gate, not a rule** — in exactly the sense
[CLAUDE.md](../../../CLAUDE.md) means. *"Did I keep this pure?"* is answerable by
recollection and therefore worthless; *"does this module's import graph reach
`node:fs`?"* is a script. **Write the script, run it in CI, and the layer cannot
erode.**

The estate already proved the same gate works one level down. `auto-deliver.ts`
states its own invariant as a grep — *"grep this package for a phase write and
find nothing. That absence is the design"* — and it holds today, verified.

---

## 2. The driven ports — one per source of truth

**A port exists because an entity's truth lives somewhere the domain may not
look.** So the port list is the [four sources of
state](DESIGN-review.md#2-state-where-each-entitys-truth-lives), enumerated.

| port | answers | serves | today's adapter |
|---|---|---|---|
| `PlanStore` | plan · story · sprint files | **STATED** | `plot-plan-meta.sh` (914 ln) |
| `Refs` | branch state, merges, tags, the pulse | **DERIVED** | `plot-fleet-scan.sh` (3479 ln) |
| `Host` | PRs, builds, issues | **FOREIGN** | **`plot-host.sh` (1545 ln)** |
| `Processes` | is this pid alive, what did it exit with | **DERIVED** | `plot-worker-state.sh` (725 ln) |
| `Trees` | worktree list, cleanliness | **DERIVED** | `git worktree` |
| `Machine` | spawn cost | **MEASURED** | 100 × `git rev-parse` |
| `Clock` | now, and elapsed | — | `Date.now()` |

**`Clock` looks trivial and is not.** Four entities carry staleness rules — a
claim goes stale after 24 h, a delivered plan leaves a rolling window, a sprint
outlives its release, a machine reading decays on the next spawn. **Every one of
those is untestable against a real clock** and trivial against an injected one.

### What a port returns

**Facts, and their askability, kept apart.** The `Host` port already does this
and says why: an unrecognised answer reads as *cannot verify*, never as
*authenticated*. The same three-way shape recurs everywhere:

```
merged | not-merged | unknown          ← never a boolean
```

**`unknown` is not `false`.** That is the estate's most-repeated lesson —
a `--no-fetch` scan reading 43 merged branches as open, a timed-out pulse read
as a claim about branches, `state: CLOSED` on a merged PR. **A port that
collapses the third value has thrown away the only value that made it safe.**

---

## 3. The driving ports — who asks the domain

| port | used by | asks |
|---|---|---|
| `FleetQuery` | the board, the master agent | *what is the state?* |
| `FleetCommand` | the spoke commands, the board's buttons | *approve · deliver · dispatch* |
| `FleetEvents` | subscribers | *what changed* — [job 3](STORY-the-master-agent-holds-the-fleet.md#3-what-changed-since-i-last-looked) |

**`FleetEvents` is the one that does not exist**, and it is the story's third
job. A delta needs a previous reading, and a pure domain holds none — so the
**storage** of the last pulse is an adapter's and the **diff** is the domain's.
That is not a compromise; it is the split applied to the one property whose
value is a comparison.

---

## 4. The adapters already exist

**This is the finding that makes the layer tractable rather than a rewrite.**

**Every driven port above already has a working adapter**, and it is a shell
script the board already spawns. Measured across `packages/board/src/server/`:

| script | spawn sites in the board |
|---|---|
| `plot-plan-meta.sh` | 7 |
| `plot-host.sh` | 5 |
| `plot-config.sh` | 4 |
| `plot-dispatch.sh` | 3 |

**So the board is already an adapter-calling application.** What it lacks is a
domain between the calls and the decisions — which is why 235 spawn sites are
spread across 27 of its 30 server modules rather than concentrated in seven.

**The work is not building adapters. It is naming the seam they already sit
on**, and moving the decisions to the domain side of it.

---

## 5. Monitors are the proof the split works

**A monitor computes a verdict from readings. It does not take them.**

```
AgentMonitor   : (readings) → AgentState
WorktreeMonitor: (readings) → TreeState
BuildMonitor   : (readings) → BuildState
MachineMonitor : (readings) → Headroom
```

**Three specs recorded *where does a monitor live when the board is closed?* as
an open question, and the ports layer dissolves it.** A monitor with nowhere to
live was a monitor that owned its own readings. Once the reading is the
`Processes` port's job, **a monitor is a function — and functions do not need a
home.** Each caller answers for itself: the board on its 5 s pulse, a supervisor
before starting work, a test with a fixture.

**`plot-worker-state.sh` is already this shape and already proves the value.**
It is *sourced, not run*, by two callers who need different renderings of one
computation — `--status` for a person, `--json` for a machine. It carried five
of its six states in duplicate until 2026-08-18, and **the copies had already
drifted on the sixth.** One computation, two callers, is the whole argument.

**The accepted cost, stated plainly: nothing watches while nobody asks.**
Continuous watching is what a daemon buys, and it buys it with a daemon to
supervise — which Plot has deliberately never had. Manifesto Principle 1 already
made this trade.

---

## 6. The rule that keeps adapters honest

**An adapter may not decide.**

The estate states this twice, in its own words, without naming it as a rule.
`plot-host.sh`: *"this collects, a human concludes."* `plot-sprint-release.sh`:
*"a script that refused would be making this call itself."*

**So a port returns facts and the domain applies rules** — Manifesto Principle 3
(*scripts collect and report; skills interpret and adapt*) expressed as an
architecture rather than a convention.

### The one licensed exception, and why it is licensed

`plot-resolve-artifact.sh` performs the estate's only automatic write, and its
own comment gives the reason: **judgement's absence is the permission.** The
merge driver keeps the file valid, the rebuild is deterministic, and CI's
no-diff gate proves it. **An adapter may act without deciding when three
verified properties leave nothing to decide** — that is not a loophole in the
rule, it is the rule's boundary condition, and it is the only case in 14,133
lines of shell.

---

## 7. How wide is a port? The measured answer

**A port that answers every question is not a port — it is the CLI with extra
steps.** The width comes from measurement, not taste:

> **Expose what a consumer reached past it for, and no more.**

**Measured 2026-08-28.** `plot-host.sh` exposes nine operations. Consumers that
call `gh`/`bb` directly:

| script | direct calls | distinct operations |
|---|---|---|
| `plot-reconcile-scan.sh` | 18 | **3** (`pr list` ×2, `pr view`) |
| `plot-reap.sh` | 1 | **1** (`pr list --json mergedAt`) |

> **Stage 2 reported 18 direct calls as the gap and called `plot-reap.sh` the
> smallest violation. That over-stated it.** The 18 are three operations, mostly
> one PR-enumeration block. **The real gap is one field**: `pr-state` already
> returns `mergeCommit` and not `mergedAt`, so `plot-reap.sh` reached past the
> port for the one fact it needed — *has any PR for this branch merged?*

**One missing operation across 23 scripts is a port in good health.** The
corrected finding is the stronger argument: **the port works, and the
specification for widening it is the list of things people went around it for.**

---

## 8. Two entrances, one implementation

**Plot has two front doors — a CLI of shell scripts and a board — and the domain
must serve both without being duplicated for either.**

**The question was whether a shell entrance can call a compiled domain.** It is
settled by precedent: **six scripts already invoke `node`**, and
`plot-sprint-candidates.sh` argues for it in its own comment — *"node is already
required to run the board and every test suite."* `packages/board` already
declares a `bin`.

```
    skill  →  plot-<verb>.sh  ─┐
                               ├─→  domain  ─→  ports  ─→  adapters
    board  →  /api/<verb>     ─┘
```

**The board already has this shape for approving**, and its own comment states
the principle: *"the two entrances are not two implementations: the skill calls
the script, so the seven mechanical steps go through ONE implementation either
way."*

**Where it is not yet true is the deliver rule** — two implementations, in two
languages, with two bug histories ([stage 2
§4](DESIGN-review-workflows.md#4-where-the-same-rule-lives-twice)). The board's
survives: it has the three-valued `unknown`, the vacuous-truth guard, and 25
tests against the shell's zero.

---

## 9. What is unresolved

| # | question | note |
|---|---|---|
| 1 | **Does the domain ship as a package or a bundled artefact?** | the board builds an artefact today; a script needs something stable to call |
| 2 | **Where does the pulse cache live?** | it is an adapter's, but `Refs` returning a 18 s answer needs a warm path |
| 3 | **Do the ports get shell shims, or does the shell call the domain?** | §8 settles that it *can*; it does not settle per-script whether it *should* |

**None of these blocks the first plan.** They are shape questions about a layer
whose decisions are made — which is the difference between this document and the
open questions the reviews carried.
