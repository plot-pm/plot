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
| 4 | [Lifecycle](#4-lifecycle) | four states, and the gate none of them has |
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

### It binds plans to a release

**The sprint is the binding element**: it is what attaches a set of plans to a
version *before that version exists*.

```
plan ──Sprint:──► sprint ──Release:──► release      knowable while planned
plan ──────Released:───────────────► release         knowable only after the cut
```

Measured across 113 released plans: **110 carry `Released:`** and **43 carry
`Sprint:`** — so two thirds reached a release with no sprint, and were knowable
only retrospectively, by asking git which tag contains each merge.

**That is the sprint's structural job.** A release is `planned` for most of its
life (Release §4), and during that time **the sprint is the only artefact that
knows what it will contain** — which is why the release gate reads the sprint
rather than the tag.

**And every plan that reaches Testing makes the release more likely and more
valuable.** That is a live quantity the sprint carries and the release cannot:
`plot-sprint-release.sh` scores every item `done`/`open`/`disputed`, and **that
tally is the release's readiness**, moving each time a plan is delivered.

### It commits; it does not contain

**A sprint does not own its plans.** Plans declare `Sprint: <slug>` and the
sprint file lists them as MoSCoW items — so the sprint file is a **statement of
intent**, and the plan estate is what actually happened.

That double record is unusual in Plot and it is deliberate: the checkbox says
*we said we would*, the plan's state says *we did*. `plot-sprint-release.sh`
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

> **Identity:** a **slug** — [three kinds](DESIGN-review.md#1-identity-three-kinds),
> and this one fails by *collision*.
> **State:** **STATED** — [four sources](DESIGN-review.md#2-state-where-each-entitys-truth-lives),
> going wrong by *being wrong*, so transitions are **gated** — a file can say `Approved` when nobody approved.


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
| `state` | `Planning`\|`Committed`\|`Active`\|`Closed` | 4/4 | written `Phase:` in the file — see §4 |
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

### A MoSCoW item IS a plan

**Corrected 2026-08-28.** An earlier draft called the slug optional. It is not:
**an item names a plan**, and the exceptions prove it rather than qualifying it.

```
{ tier: must|should|could|deferred,
  checked: boolean,
  plan: Plan,                 // [slug] — resolved, not a string
  text: string,               // the sprint's own wording of it
  annotation: string }        // <!-- status: delivered -->
```

Measured across all four sprint files, 81 items:

| | count |
|---|---|
| name a plan slug | **72** |
| **malformed line**, but name a plan | **6** |
| genuinely not a plan | **3** |

**The six are a typo, not a category.** They read `- [a-startable-slice-says-so]
…` — missing the checkbox, so the line is `- [slug]` rather than `- [ ] [slug]`.
All six resolve to real plan files. That is a lint finding, and one nothing
currently makes.

**And the three that are not plans should not have been items.** They are:

| item | what it actually is |
|---|---|
| *"Set the 32 delivered-but-unreleased plans to Released"* | housekeeping — a one-off act with no design |
| *"Decide PR #57"* | a decision, not work |
| *"A release window… (drafted, not yet committed)"* | **a plan not yet written**, and it says so |

None is work Plot would plan. The first two have nothing to design; the third is
a plan in waiting whose own annotation admits it.

#### Why this matters more than tidiness

**An item that is a plan can be judged by the estate. An item that is only prose
can be judged by nothing but its checkbox** — and a checkbox is the weakest
claim in the format, which is exactly why `plot-sprint-release.sh` exists to
outrank it.

So the three exceptions are the only items in this estate whose completion
**cannot** be verified, and the release gate must take their word for it.

#### The item's `text` is not the plan's title

The sprint states the item in **its own words**, aimed at the sprint's goal —
*"My Jira tickets appear in the board's inbox, so I can turn one into a plan
without leaving the board"* — while the plan carries a title of its own.

**That is worth keeping.** The same plan can serve two sprints for different
reasons, and the item's text is the sprint's *commitment* rather than a copy of
the plan's name. It is the one field here that is genuinely the sprint's.

### What is derived, not stored

| question | from |
|---|---|
| which plans are in this sprint | the estate — plans declare `Sprint:` |
| is an item really done | **the plan's state**, outranking the checkbox |
| how many are open | count over the above |

**The plan estate outranks the checkbox, in one direction only** — and
`plot-sprint-release.sh` states the asymmetry: *"a checked box over an
undelivered plan is `disputed`, while an unchecked box over a delivered one is
`done`, because `/plot-deliver` moves the plan and nobody re-ticks the box."*

---

## 4. Lifecycle

### Four states, and no gate on any of them

```
Planning ──► Committed ──► Active ──► Closed
```

**These are states, not phases** — the distinction the Plan spec settles (§4
there), applied here, and Sprint is its cleanest case.

**A plan's state at least has a workflow mapping**: the workflow maps `approved`
onto Development and `delivered` onto Testing, so the file's borrowed word had a
referent even though the thing it held was a state.

**A sprint's has none.** The workflow maps no phase onto `Planning`,
`Committed`, `Active` or `Closed` — the board has five columns and not one of
them is *Committed*. So the file's field name is borrowed from a vocabulary this
entity never participates in, with nothing behind the borrowing.

Sprint is also where *state* fits best of the three: a sprint is not **at** a
stage of the team's process, it **is in** a condition. `Committed` describes the
sprint, not where the work has reached.

**The field stays named `Phase:`** for the same reason the plan's does — it is
the established spelling across four files and the board's `SPRINT_PHASES`
enum, and renaming a parsed field to fix an imprecision costs more than it
buys. **The word in the file is `Phase:`; the thing it holds is a state; and unlike a
plan's state, the workflow maps no phase onto it at all.**

Unlike a plan's states — each gated, each written by a spoke command — **a
sprint's state is a hand-written field that nothing enforces and nothing
observes.**

**Measured 2026-08-28, and it has already gone wrong:**

| sprint | state | release | tag cut? |
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
| **Open** | lifecycle | `/plot-sprint` | the file, `Planning` |
| **Add** | lifecycle | `/plot-sprint` | a MoSCoW item |
| **Move** | lifecycle | by hand | an item to Deferred, logged in `### Scope Changes` |
| **Close** | lifecycle | `/plot-sprint close` | state → `Closed`, refuses on false completion |
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

**Every sprint file is read; the state decides what each means.** There is no
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
| sprint card | slug, title, state, release, members |
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
| 1 | **A sprint's state is stale and nothing detects it** — 2.9.0 shipped, sprint still Active | **now, measured** |
| 2 | **`end` holds two facts** — one file records `(closed …)` as prose in the date | **now, measured** |
| 3 | **Setup never asks about `Sprint directory`** | now |
| 4 | **Six MoSCoW lines are malformed** — `- [slug]` without the checkbox, so they parse as neither checked nor unchecked | **now, measured** |
| 5 | **`start`/`end`/`goal` reach no view** — the board cannot show whether a sprint is on time | now |
| 6 | Inbound and outbound epic acts unbuilt | posture 2 |

**Gap 1 is the one to fix, and it belongs to the Release rather than here.**
*"A sprint whose `Release:` has a tag is over"* is a statement about **the
release's state** (Release §4), which the sprint reads:

```
release(2.9.0).state === 'shipped'   →   this sprint is over
```

The fix is a derivation rather than a field:
a sprint whose `Release:` has a tag is over, whatever its state says. The data
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

- **Should the state be derived rather than stated?** A sprint whose release is
  tagged is Closed in every sense but the field.
- **Should `end` split into planned and actual?** One file already needs it.
- **Should the board show the timebox?** `start` and `end` are parsed nowhere,
  so a sprint's own axis — time — is the one thing its card cannot show.
