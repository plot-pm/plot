---
title: Wave — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Wave — domain object specification

A plan's unit of dispatch: one slice of the work, and the ordering between
slices.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Plan](DESIGN-plan.md) ·
> [Sprint](DESIGN-sprint.md) · [Story](DESIGN-story.md) · [Issue](DESIGN-issue.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Wave is](#1-what-a-wave-is) | the slice, and the ordering |
| 2 | [The domain object](#2-the-domain-object) | **the normative spec** |
| 3 | [The verdict](#3-the-verdict) | four words, and why none is a state |
| 4 | [Relations](#4-relations) | Plan · Branch · Worker |
| 5 | [Actions](#5-actions) | dispatch · reslice |
| 6 | [Scope](#6-scope) | one wave, one branch — and the 21 that disagree |
| 7 | [The collaborators](#7-the-collaborators) | the scan derives; nothing stores |
| 8 | [Fleet control](#8-fleet-control) | the entity the fleet is built around |
| 9 | [Views](#9-views) | the wave row, and the two arms |
| 10 | [Gaps](#10-gaps) | |
| 11 | [Invariants and open points](#11-invariants-and-open-points) | |

---

## 1. What a Wave is

**A Wave is one slice of a plan's work, plus its place in an order.**

Two jobs in one entity, and the second is the reason it exists:

- **the slice** — a coherent piece of the change, small enough for one branch
- **the ordering** — a wave may not start until every prior wave has landed

**Without ordering there would be no Wave.** A plan with independent branches
needs no waves at all; the entity earns its place the moment one piece must
prove something before the next is built.

### The ordering is a gate, not advice

*"A wave becomes eligible only once every non-deferred branch in every **prior**
wave is merged, so this never hands you work that builds on an unproven seam."*

That is what `--next` enforces, what the dispatcher honours, and what makes a
tracer bullet expressible: wave 1 proves the approach, waves 2..n build on it,
and nothing can start early by accident.

### It is derived, entirely

**A Wave has no file and no record.** It is the `### ` headings under
`## Branches` (or a `## Waves` section), read from a plan and joined against
git's answer about each branch. Nothing writes a wave's state anywhere.

That makes it the first entity here with **no persisted form at all** — Plan,
Story and Sprint are files; Issue and PR come from a host; Wave is computed.

---

## 2. The domain object

### Identity

```
Wave.name : string        within its plan
```

**The name is the identity, and it is scoped to the plan.** `Counted` appears in
11 plans and means something different in each. So a wave is addressed as
`(plan, name)` — never by name alone.

**5 waves are unnamed** (the default wave, where a plan lists branches without
`### ` headings), which is why the name may be `''` and why the board carries a
default-wave label of its own.

### Fields

**Measured across 303 waves in 155 plans, 2026-08-28.**

| field | type | note |
|---|---|---|
| `name` | string | `''` for the default wave — 5 of 303 |
| `plan` | Plan | the owner; the name means nothing without it |
| `branches[]` | Branch[] | **1 in 271 of 303** — see §6 |
| `index` | number | position among its plan's waves — **the ordering** |

**No verdict field.** The verdict is derived (§3), and storing it would be the
error the entities doc names: a derived relation cached where it can disagree
with its source.

### Names are labels, and the parser says so

`long_wave_names[]` reports names past a threshold — *"a wave name is a label
(`Shaped`, `Gated`, `Offered first`); a sentence-length heading is a
plan-authoring mistake the board can only render badly."*

**Reported, never refused.** 5 plans carry one. The estate's own vocabulary
bears the rule out: `Implementation` 19, `Counted` 11, `Named` 9, `Offered` 5,
`Sized` 4 — one word, naming what the slice achieves.

---

## 3. The verdict

Four words, and the contract states what a reader may **do** with each:

| verdict | means | resolves by |
|---|---|---|
| `complete` | every non-deferred branch merged | — |
| `eligible` | **a dispatch would take this** | doing the work |
| `blocked` | an earlier wave has not landed | **merging** that work |
| `unapproved` | the plan is not approved | **a person approving** — no merge helps |

### `blocked` and `unapproved` are kept apart deliberately

*"Kept apart from `blocked` because the reader's next action differs."*

Both mean *you cannot start this*. But one is waiting on **work** and the other
on a **decision**, and collapsing them would tell a reader to go merge something
when what is needed is an approval.

**A terminal plan lands in `unapproved` too** — a superseded plan is not
approved — *"the board routes those to DONE by phase before the verdict is
read."* So the verdict is only meaningful for a plan still in the process.

### The verdict is not a state

**It is a relation**, recomputed every pulse from three things: the plan's state,
the prior waves' branch states, and this wave's own. Nothing about the wave
itself changes when its verdict moves from `blocked` to `eligible` — **a branch
somewhere else merged.**

That is why §2 gives it no field, and why the Issue spec's rule applies here
unchanged: a value that depends on a pair belongs to the derivation, not to the
object's stated fields.

### `--loose` is the one relaxation, and it must be verified

*"A prior wave counts as satisfied when its branches carry **pushed** work, not
only merged work. Buys throughput, pays in rebase risk — the plan requires a
stated reason for using it."*

**And it is refused where it cannot be checked**: `loose_verifiable` gates on a
host CLI, because *"`--loose` promises the prior wave's PRs are green and ready,
which needs the host. Readiness must be VERIFIED, never assumed."*

A flag that would silently degrade to *assume ready* is instead refused.

---

## 4. Relations

| relation | mechanism | state |
|---|---|---|
| Plan → Wave | `### ` headings | **built** |
| Wave → Branch | `(Branch: x)` in the heading, or list items | **built** |
| Wave → prior Wave | document order | **built — implicit** |
| Wave → Worker | one worker per dispatched branch | via Branch |

**The ordering is positional and unnamed.** A wave knows it comes after the one
above it because of where it sits in the file — there is no `after:` field. That
is simple and it is also fragile: reordering the headings reorders the gate.

---

## 5. Actions

| action | who | what |
|---|---|---|
| **Dispatch** | `plot-dispatch.sh` | one worktree + worker per eligible branch |
| **Reslice** | `/plot-reslice` | rewrite `## Branches` into one wave per branch |
| **Ask** | `--next` | name one claimable branch; exit 1 = nothing to start |

**A wave is never dispatched — its branches are.** The wave decides *whether*,
the branch is *what*. That is why `--next` returns a branch name.

**Reslice is the only writer**, and it needs a person: *"re-slicing needs NAMES
for the new waves, and naming is judgement."*

---

## 6. Scope

### One wave, one branch — and the 32 that disagree

The model settled 2026-08-21: **plan → \* wave → 1 branch**.

Measured across 303 waves:

| branches | waves |
|---|---|
| **1** | **271** |
| 0 | **11** |
| 2 | 13 |
| 3 | 5 |
| 4 | 2 |
| 5 | 1 |

**271 of 303 conform.** 21 hold several branches (`unsliced-wave`, reported by
the scan), and **11 hold none at all** — a heading with no branch under it.

#### The 11 empty ones are mostly not waves at all

**Investigated 2026-08-28, and the first reading was wrong.** They are not
*"waves that dispatch nothing"* — 9 of the 11 are **prose headings the parser
reads as waves**, across four plans:

```
'What an agent IS — settled 2026-08-20'
'Where the blocker reference goes — three placements, two measured failures'
'A deferred branch is not a wave's work'
'Superseded — reached main by other routes'
```

Those are **design-discussion sections** written under `## Branches`, not slices
of work. And they are already flagged by a different name: `long_wave_names`
reports exactly this shape — sentence-length headings that are *"a
plan-authoring mistake the board can only render badly."*

**Only 2 look like real waves with no branches** — `Sized` and `Marked`, one
plan, both short labels. Those are plausibly waves whose branches were dropped
during reslicing.

So the finding splits:

| | count | what it is |
|---|---|---|
| prose headings parsed as waves | **9** | the `long_wave_names` problem, seen through a different field |
| labelled waves with no branch | **2** | plausibly a reslice that lost its branches |

**A wave with no branches is still `complete` vacuously** — *every non-deferred
branch has merged* is trivially true of none — so it blocks nothing and
dispatches nothing either way. But the fix differs: the 9 want a parser rule or
an authoring convention, and only the 2 want a wave-shape check.

---

## 7. The collaborators

**One, and it derives rather than stores:** `plot-fleet-scan.sh`.

It reads plans through `plot-plan-meta.sh`, asks git about each branch, and
emits a verdict per wave — *"stateless; re-derived from git refs every run."*

**No writer, no cache, no record.** The nearest thing to persistence is
`PLOT_TERMINAL_CACHE`, which caches *branch* answers and is checked against git
every pass.

---

## 8. Fleet control

**Wave is the entity the fleet is built around**, and the tooling shows it:

| capability | script |
|---|---|
| every wave's verdict | `plot-fleet-scan.sh` |
| one claimable branch | `--next` |
| all claimable branches | `--list-eligible` |
| fan out | `plot-dispatch.sh` |
| merge order | `plot-merge-queue.sh` |

**`--next` versus `--list-eligible` is a designed pair**: one for a caller that
will act (and whose answer can go stale the moment another session claims), one
for a caller that needs the count (*"a dry run changes nothing, so its answer
cannot go stale"*).

---

## 9. Views

| view | shows |
|---|---|
| wave row | name, verdict, its branches |
| wave head | the plan above its waves, with actions |
| the pulse's summary | `waves=N eligible=N blocked=N` |

**Two render arms with opposite defaults** — grouped rows and ungrouped — which
has produced bugs of its own. A wave that renders in the wrong arm shows the
right verdict in the wrong place.

---

## 10. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **9 prose headings parse as waves** — design sections under `## Branches`, vacuously `complete` | **now, measured** |
| 1b | **2 labelled waves lost their branches** — plausibly a reslice | now, measured |
| 2 | **21 waves hold several** — against the 1:1 model | now, reported |
| 3 | **Ordering is positional** — no `after:`, so reordering headings reorders the gate | now |
| 4 | Wave names are scoped to a plan but rendered bare | cosmetic |

**Gap 1 is half-reported.** `long_wave_names` already flags the sentence-length
headings — it just flags them as *names too long to render*, not as *not a wave
at all*. Nothing catches gap 1b: `unsliced-wave` catches too many branches, and
nothing catches none.

---

## 11. Invariants and open points

### Invariants

1. **A wave is derived; it has no file and no record.**
2. **The verdict is a relation, not a state** — recomputed every pulse.
3. **`blocked` and `unapproved` never collapse** — one waits on work, the other
   on a decision.
4. **`eligible` is the only word that promises a dispatch agrees.**
5. **A wave is never dispatched; its branches are.**
6. **A wave's name is meaningless without its plan.**
7. **`--loose` is refused where it cannot be verified.**

### Open points

- **Should an empty wave be a finding?** 11 exist; 9 are prose headings the
  parser should arguably not read as waves at all, and 2 are labelled waves
  that lost their branches.
- **Should ordering be explicit?** Positional ordering is simple and reorders
  the gate when headings move.
- **Is the 1:1 model enforced or relaxed?** 21 waves disagree and most already
  shipped.
