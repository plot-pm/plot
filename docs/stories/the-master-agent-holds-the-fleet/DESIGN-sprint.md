---
title: Sprint — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Sprint — domain object specification

Plot's timebox: a commitment about **when**, over plans that already exist.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Issue](DESIGN-issue.md) ·
> [Story](DESIGN-story.md) · [Plan](DESIGN-plan.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Sprint is](#1-what-a-sprint-is) | the timebox, and what it is not |
| 2 | [Posture](#2-posture) | what `Tracker: jira` makes of it |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | four phases, and the one nothing observes |
| 5 | [Direction](#5-direction) | inbound from an epic; outbound as one |
| 6 | [Relations](#6-relations) | Plan · Release · Issue · Person |
| 7 | [Actions](#7-actions) | open · add · close · the release gate |
| 8 | [Scope](#8-scope) | which sprints, and which items |
| 9 | [The collaborators](#9-the-collaborators) | three scripts, one estate |
| 10 | [Fleet control](#10-fleet-control) | the release gate is the consumer |
| 11 | [Views](#11-views) | card · chip · the gate's report |
| 12 | [Setup](#12-setup) | one key |
| 13 | [Gaps](#13-gaps) | |
| 14 | [Invariants and open points](#14-invariants-and-open-points) | |

---

## 1. What a Sprint is

**A Sprint is a commitment about *when*, over plans that already exist.**

It is the third umbrella, and it differs from the other two by *axis*:

| | asks | groups by |
|---|---|---|
| **Story** | what problem? | **subject** — knowledge that belongs together |
| **Sprint** | by when? | **time** — work committed to one box |
| **Release** | shipped as what? | **version** — what a tag contains |

A plan can sit in all three at once, and they do not nest: a story spans
sprints, a sprint spans stories, and a release may draw from both.

### It commits; it does not contain

**A sprint does not own its plans.** Plans declare `Sprint: <slug>` and the
sprint file lists them as MoSCoW items — so the sprint file is a **statement of
intent**, and the plan estate is what actually happened.

That double record is unusual in Plot and it is deliberate: the checkbox says
*we said we would*, the plan's phase says *we did*. `plot-sprint-release.sh`
exists to compare them, and calls the disagreement `disputed`.

### MoSCoW is the commitment's shape

Must · Should · Could, plus Deferred. **Only Must Haves are a promise** — the
release gate refuses on an open Must, prompts on an open Should, and reports a
Could without blocking (Plan §7's neighbour, `/plot-release` step 0).

That graduation is the whole point: a timebox with one priority level is a
queue with a date on it.

---

## 2. Posture

| posture | what a Sprint is |
|---|---|
| **`plot`** | the record — the sprint file is the commitment |
| **`plot` + a tracker** | the record, **published as an epic ticket** |
| **`jira` leads** | *a sprint IS the epic ticket*; the file is a projection |

**The publishing posture is where Sprint and Issue meet most concretely**: the
epic is keyed by the sprint's `Release:` version, and every feature ticket the
sprint's plans publish joins it (Issue §8, *the epic is the harbour*).

**And `Create sprint` is the inbound half** — an epic ticket a customer filed
becomes a sprint whose release the epic then harbours. The loop closes on one
artefact rather than two.

---

## 3. The domain object

### Identity

```
Sprint.slug : string
```

The filename without extension: `2026-W35-the-board-serves-an-enterprise-stack`.
**The slug carries its own week**, which is a convention no other entity has —
and it means two sprints in one week are distinguished only by their title half.

Resolution is direct: `docs/sprints/<slug>.md`. No date prefix to strip (the
week *is* the prefix), no index precedence — closer to Story's than to Plan's.

### Fields

**Validated against all four sprint files, 2026-08-28.**

| field | type | have | note |
|---|---|---|---|
| `slug` | string | 4/4 | from the filename |
| `title` | string | 4/4 | the `# Sprint: …` heading |
| `phase` | `Planning`\|`Committed`\|`Active`\|`Closed` | 4/4 | see §4 |
| `start` | date | 4/4 | |
| `end` | date | 4/4 | **one carries prose — see below** |
| `release` | version | **4/4** | the gate's key |
| `goal` | prose | 4/4 | `## Sprint Goal` |
| `items[]` | MoSCoW items | 4/4 | 25 in the live sprint |
| `notes` | prose | 4/4 | including `### Scope Changes` |

**`end` is carrying two facts in one field.** One sprint reads
`End: 2026-08-26 (closed 2026-08-23)` — an author needing to record *actual*
against *planned* had nowhere to put it, so it went into the date as prose.

That is the same shape as a plan's `Approved:` holding a free-text `who`
(Person, entities §1c): **a field that must hold two facts eventually holds one
of them as a comment.** The object should carry `plannedEnd` and `actualEnd`.

### An item is its own small object

```
{ tier: must|should|could|deferred,
  checked: boolean,
  slug: string | null,        // [slug] where the item names a plan
  text: string,
  annotation: string }        // <!-- status: delivered -->
```

**`slug` is optional, and that is real.** Some items name a plan; others name
work with no plan (*"Set the 32 delivered-but-unreleased plans to Released"*).
An item without a slug can only ever be judged by its checkbox.

### What is derived, not stored

| question | from |
|---|---|
| which plans are in this sprint | the estate — plans declare `Sprint:` |
| is an item really done | **the plan's phase**, outranking the checkbox |
| how many are open | count over the above |

**The plan estate outranks the checkbox, in one direction only** — and
`plot-sprint-release.sh` states the asymmetry: *"a checked box over an
undelivered plan is `disputed`, while an unchecked box over a delivered one is
`done`, because `/plot-deliver` moves the plan and nobody re-ticks the box."*

---

## 4. Lifecycle

### Four phases, and no gate on any of them

```
Planning ──► Committed ──► Active ──► Closed
```

Unlike a plan's states — each gated, each written by a spoke command — **a
sprint's phase is a hand-written field that nothing enforces and nothing
observes.**

**Measured 2026-08-28, and it has already gone wrong:**

| sprint | phase | release | tag cut? |
|---|---|---|---|
| `2026-W34-the-board-tells-the-truth` | Closed | 2.6.0 | yes |
| `2026-W34-working-shows-the-agent` | Closed | 2.8.0 | yes |
| `2026-W35-…-in-every-section` | **Active** | 2.9.0 | **yes — 2026-08-26** |
| `2026-W35-…-enterprise-stack` | Active | 2.11.0 | no |

**A sprint whose release shipped two days ago is still `Active`.** Nothing
noticed, because nothing compares a sprint's `Release:` against the tags — even
though `/plot-release` reads that exact field to run its gate.

That is the sprint's version of the defect the plan estate keeps hitting: **a
state that is stated rather than derived can be stale, and only a gate catches
it.**

---

## 5. Direction

| direction | act | status |
|---|---|---|
| **inbound** | an epic ticket becomes a sprint | *Create sprint* — **unbuilt** (Issue §7) |
| **outbound** | a sprint publishes an epic | posture 2 — **unbuilt** |
| *(neither)* | a person opens a sprint | `/plot-sprint` — **built, and all four here** |

---

## 6. Relations

| relation | mechanism | state |
|---|---|---|
| Plan → Sprint | plan declares `Sprint:` | **built** |
| Sprint → item → Plan | `[slug]` in a MoSCoW line | **built** |
| Sprint → Release | `Release: <version>` | **built** — the gate's key |
| Sprint → Issue | via the epic | unbuilt |
| Sprint → Person | none | — |

**Sprint is the only entity with a double link to Plan**: plans declare it *and*
it lists them. That is what makes `disputed` expressible — and it is a
deliberate exception to *"declared by the plan, derived by everyone else."*

**Two sprints may target one release** — *"two teams, one train"* — which the
release gate handles and which forbids assuming a release has one sprint.

---

## 7. Actions

| action | kind | command | writes |
|---|---|---|---|
| **Open** | lifecycle | `/plot-sprint` | the file, Planning |
| **Add** | lifecycle | `/plot-sprint` | a MoSCoW item |
| **Move** | lifecycle | by hand | an item to Deferred, logged in `### Scope Changes` |
| **Close** | lifecycle | `/plot-sprint close` | phase → Closed, refuses on false completion |
| **Gate a release** | **read-only** | `/plot-release` step 0 | **nothing** — it decides |

**The release gate is a Sprint action that changes no sprint.** It reads
`Release:` and every item's state, then refuses (Must), prompts (Should) or
reports (Could). `plot-sprint-release.sh` supplies the facts and *"decides
nothing"* — Principle 3, in the place it matters most.

**`--ignore-sprint` is the named escape**, and using it writes a note into the
sprint's `## Notes` — *"a release cut over its objection is something that
happened **to** the sprint."*

---

## 8. Scope

**Every sprint file is read; the phase decides what each means.** There is no
rolling window and no index — four files, all parsed.

**`plot-sprint-candidates.sh` scopes the other direction**: which plans a sprint
*could* contain. It collects and ranks **nothing**, deliberately — *"which plans
serve a stated goal is the semantic judgement `/plot-sprint` makes at Frontier
tier."*

---

## 9. The collaborators

Three scripts, and the split is unusually clean:

| script | answers |
|---|---|
| `plot-sprint-release.sh` | the release gate's facts — target, and every item `done`/`open`/`disputed` |
| `plot-sprint-candidates.sh` | which unfinished plans exist, unranked |
| `plot-review-status.sh` | review freshness per item |

**No monitor, no connector.** Sprints are local files read on demand.

---

## 10. Fleet control

**The release gate is the sprint's one real consumer**, and it is CLI-side.

| capability | CLI | board |
|---|---|---|
| the gate's facts | `plot-sprint-release.sh` | — |
| candidates | `plot-sprint-candidates.sh` | — |
| sprint membership | derived by the board | `SprintCard.members` |
| WIP per sprint | — | the sprint chip |

**A master agent is well served here** — the same inversion Plan shows, and for
the same reason: sprints exist to gate releases, and releases are cut from a
terminal.

---

## 11. Views

| view | shows |
|---|---|
| sprint card | slug, title, phase, release, members |
| sprint chip | WIP against the sprint |
| the gate's report | the refusal, naming each open Must |

**`SprintCard` carries five fields** where the file has nine — `start`, `end`,
`goal` and the items reach no view. So the board can say a sprint exists and who
is in it, and **not whether it is on time**.

---

## 12. Setup

One key: **`Sprint directory`**, default `docs/sprints/`. Neither setup skill
asks about it — the same gap Story has (Story §12).

---

## 13. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **A sprint's phase is stale and nothing detects it** — 2.9.0 shipped, sprint still Active | **now, measured** |
| 2 | **`end` holds two facts** — one file records `(closed …)` as prose in the date | **now, measured** |
| 3 | **Setup never asks about `Sprint directory`** | now |
| 4 | **`start`/`end`/`goal` reach no view** — the board cannot show whether a sprint is on time | now |
| 5 | Inbound and outbound epic acts unbuilt | posture 2 |

**Gap 1 is the one to fix**, and the fix is a derivation rather than a field:
a sprint whose `Release:` has a tag is over, whatever its phase says. The data
is already read by `/plot-release`.

---

## 14. Invariants and open points

### Invariants

1. **A sprint commits about *when*; it does not own its plans.**
2. **Only Must Haves are a promise** — Should prompts, Could reports.
3. **The plan estate outranks the checkbox, in one direction only.**
4. **Two sprints may target one release.**
5. **The gate decides; the script reports.**
6. **A release cut over a sprint's objection is recorded in the sprint.**

### Open points

- **Should the phase be derived rather than stated?** A sprint whose release is
  tagged is Closed in every sense but the field.
- **Should `end` split into planned and actual?** One file already needs it.
- **Should the board show the timebox?** `start` and `end` are parsed nowhere,
  so a sprint's own axis — time — is the one thing its card cannot show.
