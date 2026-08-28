---
title: Story — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Story — domain object specification

Plot's umbrella for work that spans plans, specified as a domain object.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [The fleet's domain entities](DESIGN-entities.md) ·
> [Issue](DESIGN-issue.md) · [Plan](DESIGN-plan.md) — the solution-space half
> of the pair this entity opens

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Story is](#1-what-a-story-is) | problem space vs solution space; who creates one |
| 2 | [Posture](#2-posture--what-tracker-jira-makes-of-a-story) | what `Tracker: jira` makes of a Story |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | statuses, and why nothing derives them |
| 5 | [Direction](#5-direction--inbound-and-outbound) | inbound from a ticket; outbound unbuilt |
| 6 | [Relations](#6-relations) | Plan · Issue · Sprint · Unit |
| 7 | [Actions](#7-actions) | six lifecycle acts, and the quality acts beside them |
| 8 | [Scope](#8-scope--which-stories-are-shown) | which homes, not which stories |
| 9 | [The collaborators](#9-the-collaborators--story-has-almost-none) | why Story needs none |
| 10 | [Fleet control](#10-fleet-control--the-master-agent-cannot-see-stories) | the board sees stories; the CLI does not |
| 11 | [Views](#11-views) | what renders, and what does not |
| 12 | [Setup](#12-setup) | three keys nobody writes |
| 13 | [The four-way divergence](#13-the-four-way-divergence) | estate vs schema vs skill vs lint |
| 14 | [Gaps](#14-gaps) | consolidated, ranked by reachability |
| 15 | [Invariants and open points](#15-invariants-and-open-points) |  |

---

## 1. What a Story is


### Problem space and solution space

**A Story describes the problem. A plan describes the solution.** That is the
distinction the two artefacts turn on, and everything else about them follows
from it.

| | **Story** — problem space | **Plan** — solution space |
|---|---|---|
| **asks** | what problem do users have, and how should software support them with it | how should *this system* change |
| **carries** | the problem · how a solution should help · **desired qualities** · workflow — how users want the system to behave, which steps should be automated and how | the change to the current system · **the steps to land it** · the non-functional requirements of *this* solution |
| **is true** | independently of any system | only of the system it targets |
| **outlives** | implementations, rewrites, whole stacks | its own delivery |

**Qualities appear on both sides, and they are different qualities.** A story
says *"this must stay usable while the network is flaky"* — a property of the
problem, true whatever gets built. A plan says *"the retry backoff is capped at
30 s and the queue drains in under 2 s"* — a property of **this** solution,
meaningless without it. Reading them as one thing is how a plan ends up
carrying requirements that outlive it, and how a story ends up specifying an
implementation.

**Workflow belongs to the story**, and this is the part most easily lost: *how
users want the system to behave*, and *which steps should be automated and how*,
are statements about the problem — they constrain a solution without being one.
A plan that invents its own workflow is answering a question the story should
have settled.

### The templates already enforce this, and say so nowhere

Measured 2026-08-28:

| Story sections | Plan sections |
|---|---|
| Objective · Why Now · Decisions Taken in Scoping · Current Plan · Open Points · Key Findings · Excluded from Scope | Status · Changelog · Motivation · **Design** · **Branches** · Notes |

**A story has no `Design` and no `Branches`** — nowhere to put a solution. **A
plan has one `Motivation` section** against `Design` plus `Branches` — barely
anywhere to put a problem.

The split is already structural. What is missing is that **nothing states it**:
neither template explains what the other is for, so the boundary is enforced by
the shape of a form rather than by an understanding, and a contributor learns it
by having a section refused rather than by being told.

**And there is no story template at all.** `.plot/templates/` holds `plan.md`
and nothing else, so a story's shape is whatever the last author copied. That is
the likelier explanation for §12's four-way divergence than any of the four
sources being wrong: a form nobody wrote cannot be filled in consistently.

### Who creates a Story: the `brainstorming` skill

**Corrected 2026-08-28.** §6 below documents `POST /api/story` → the
`Story command` agent as the creation path. That is *one* entrance — the
board's, for turning an inbound issue into a story. **The general one is the
`superpowers` plugin's `brainstorming` skill**, and it is the process that
produces problem-space knowledge in the first place.

Its checklist is the problem space, step by step:

| step | what it produces |
|---|---|
| 1. explore project context | the ground the problem sits on |
| 3. **clarifying questions** — purpose, constraints, success criteria | the problem, its bounds, and what "solved" means |
| 4. **propose 2-3 approaches** with trade-offs | the qualities a solution must have |
| 5. present design, approved section by section | the agreed problem statement |
| 6. write the design doc | the artefact |
| 9. **invoke `writing-plans`** | **the handoff to solution space** |

**Step 9 is the story → plan boundary made operational.** Brainstorming ends by
handing off to plan-writing, which is the transition this spec has described as
a *relation* and never as a *process*. The two spaces are not just two document
shapes; they are two phases of one conversation, with an approval gate between
them:

> *Do NOT invoke any implementation skill, write any code, scaffold any
> project, or take any implementation action until you have presented a design
> and the user has approved it.*

That gate is the problem/solution boundary enforced as a rule — and it is
`/plot-approve`'s counterpart one level up: **a plan may not start until it is
approved; a solution may not be designed until the problem is.**

#### The seam: two conventions for one artefact

Brainstorming writes to:

```
docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md
```

Plot's stories live at:

```
docs/stories/<slug>/STORY-<slug>.md
```

**Both are live in this repo.** Measured 2026-08-28: one superpowers spec
(`2026-08-18-plot-board-setup-design.md`) and nine Plot stories — and
`plot-board-setup` exists as **both**, a spec and a story, for the same effort.

This is the likeliest explanation for §12's four-way divergence, more than the
missing template: **the skill that creates the artefact does not know Plot's
convention**, so the frontmatter Plot's lint expects is written by whoever
remembers to. A spec produced by brainstorming has no `status:`, no `unit:`, and
no place in `docs/stories/`.

#### Settled: `story-tracking` invokes `brainstorming`

**Decided 2026-08-28.** `/story-tracking` is the command that creates a story,
and **its content comes from the `brainstorming` skill** rather than from a
template it copies.

The two split cleanly along what each knows:

| `brainstorming` owns | `story-tracking` owns |
|---|---|
| the problem — purpose, constraints, success criteria | **which home** the story belongs to |
| 2-3 approaches and their trade-offs | the `{slug}/STORY-{slug}.md` shape |
| the qualities a solution must have | Plot's frontmatter, `unit:` included |
| approval, section by section | the index entry |
| the handoff to plan-writing | the triage that decides a story is warranted at all |

So `story-tracking` keeps the triage front door, the placement question and the
bookkeeping; **brainstorming produces what goes inside.**

##### This fixes the divergence at its source

Step 4 of *Creating a Story* today reads:

> *Copy the story template → `STORY-{slug}.md`*

**There is no story template.** `.plot/templates/` holds `plan.md` and nothing
else, so every agent that has followed this step improvised the frontmatter
instead — which is exactly why nine stories carry the same five keys, why
`unit:` is never written despite step 5 requiring it, and why §5's four sources
disagree.

Replacing that step with *invoke `brainstorming`* removes the missing file from
the path: the content comes from a process that exists, and the frontmatter
becomes `story-tracking`'s to write because it is the only participant that
knows Plot's conventions.

**A template may still be worth having** — as the shape brainstorming's output
is poured into, not as a file an agent copies blind.

##### What this makes of a brainstorming spec

Brainstorming's own step 6 writes to
`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`. Invoked *through*
`story-tracking`, the output lands as a story instead — so the spec path is
what brainstorming does when nobody has told it where the story belongs.

**Both remain live in this repo**, and that is now explicable rather than
contradictory: `2026-08-18-plot-board-setup-design.md` is what a direct
brainstorming run produced, and `docs/stories/plot-board/` is what the story
flow produced for related work. Whether the standalone spec path should
continue to exist in a Plot repo is a smaller question than it looked — a
direct brainstorm is still legitimate; it simply has not been placed.

##### Not a setup activity — but setup has a gap beside it

**"`story-tracking` invokes `brainstorming`" is a skill edit, not setup.** It
changes how the skill works, ships in the repo, and is true for every adopting
project — there is nothing per-repo to record, so no config key and no setup
question.

The test Plot already applies: **setup writes config keys and verifies
capabilities; it does not change how skills behave.** A repo cannot opt out of
brainstorming any more than it can opt out of the triage front door.

**What *is* setup's business is the per-repo half**, and it is currently absent
altogether. Measured 2026-08-28: **neither `/plot-board-setup` nor `/plot-init`
mentions stories at all** — not `Story directory`, not `Story command`, not
`Story index`. Every story key is undeclared in every adopting repo, running on
its default.

| key | default | what setup should do |
|---|---|---|
| `Story directory` | `docs/stories/` | probe for an existing home; propose it |
| `Story index` | `README.md` | ask only where a story home exists |
| `Story command` | — | needed for the board's *Create story*; verify like `Idea command` |

**The probe already has the shape.** `git ls-files '*STORY-*.md'` is the skill's
own home-discovery command, and it is exactly the kind of structural signal
`plot-detect-repo.sh` reports for trackers and CI: several homes found →
**ask**, one found → **propose it**, none found → **write nothing**, because
absence of a story home is not evidence against stories, only against having
started.

That last clause matters for the same reason the tracker's does: **a wrong
`Story directory` sends `/story-tracking` to create a story where nobody looks
for one**, and a missing one sends it to a default that may be wrong in a
multi-unit repo — the case the skill goes out of its way to support and the
board cannot see (§13).

**And the board's *Create story* is unverifiable today.** `handleStory` refuses
with `no-story-command` when the key is unset, and no setup step ever writes it
— so the action ships refused in every repo that has not found the key by
reading the source. That is the same 4d shape as the tracker: a capability the
config accepts and nothing proves.

##### The gate carries over

Brainstorming's hard gate — *"do NOT invoke any implementation skill … until you
have presented a design and the user has approved it"* — becomes the story's
gate too. That is `/plot-approve`'s counterpart one level up: **a plan may not
start until it is approved; a solution may not be designed until the problem
is.**

### Why overflow is a consequence, not the definition### Why overflow is a consequence, not the definition

An earlier draft of this section defined a Story by the `story-tracking` skill's
**umbrella rule** — a story exists when knowledge overflows the umbrella that
holds it. That explains *when* a story is needed and not *what one is*.

With the two spaces named, overflow follows: **problem-space knowledge overflows
a solution-space artefact because the plan has no section for it.** Research
before implementing, multi-repo coordination, external gates, dev-team-only
topics — every overflow signal the skill lists is problem-space knowledge with
nowhere to go.

The negative rule reads the same way. *"Implement this ticket as described"
never opens a story* precisely because a described ticket **is** the problem
statement — the problem space is already occupied, and only the solution remains
to be planned.

So the umbrella rule is kept below as the operational test, and this is what it
is testing for.

---

**A Story is the home for knowledge that no single plan can hold.**

Not a bigger plan, not a phase, not a container. The `story-tracking` skill
states the test in one line — *"would you tell a story about it?"* — and its
triage makes the boundary sharp:

> **The umbrella rule:** a story exists only when no umbrella can hold the
> effort's knowledge — or when knowledge overflows the umbrella that exists.

### The umbrella hierarchy

Three artefacts can hold an effort, and the story is the **last** resort:

```
a well-described ticket   ──► holds implement-as-described work
        │ overflows
        ▼
a plan                    ──► holds a bounded, clearly-scoped piece
        │ overflows
        ▼
a STORY                   ──► holds what spans plans
```

*"A plan is an umbrella too — in repos where plot is the tracker, an
implementation slice is a plan, full stop; the story layer is for what spans
plans."*

**The negative rule is the sharpest part of the definition:** *"implement this
ticket as described" never opens a story, however large the diff.* Size is not
the trigger. **Overflow of knowledge** is.

### What makes knowledge overflow

The skill names six signals, any one sufficient:

| signal | why a plan cannot hold it |
|---|---|
| research/unknowns before implementing | the plan cannot be written yet |
| multi-repo or multi-ticket coordination | no single home exists |
| long-lived divergence (feature-toggle scale) | outlives any one plan |
| significant non-app artifacts | specs and assets are not code |
| external gates and calendar tail | vendor/store waits outlast plans |
| **dev-team-only technical topics** | no ticket exists because the customer is not in the loop |

That last one is worth naming: a story is *"what keeps that work visible instead
of running undercover."* The Story is the only artefact in Plot whose purpose
includes **being seen**.

### An epic is the opposite signal

*"Epics structurally cannot hold narrative, so epic-scale work usually warrants
a story even when tickets exist."*

This is the inbound half of the Issue design's `kind = story` → Story relation
(§4), arrived at from the Story side: a tracker item that is too big to describe
itself needs a home that can.

### Late promotion, not prophecy

*"Create the story at the moment knowledge overflows, not 'just in case'."*
A Story is created **late**, backfilled from sources that already exist —
tickets, PRs, meeting notes, sessionlogs. This is the same discipline as the
feature ticket written at *Plans approved* rather than at Draft: **a record is
written when the fact becomes true.**

---

## 2. Posture — what `Tracker: jira` makes of a Story


The Issue spec's three postures apply here, and the middle and last make very
different things of a Story.

| posture | what a Story is |
|---|---|
| **`plot`, no issue tracker** | the sole home of problem-space knowledge |
| **`plot` + an issue tracker** | the sole home; a ticket may **publish** it to clients |
| **`jira` leads** | *"every story is a jira ticket"* — the MD file is a **projection** |

**Posture 2 is where the Story is most itself.** The narrative, the Decisions
table and the session log stay in the repo where the dev team works, and a
ticket carries a summary outward. The dev-team-only overflow signal — *"no
ticket exists because the customer is not in the loop"* — is precisely a story
that has **not** been published, and the model must keep that a legitimate
state rather than an omission.

**Posture 3 inverts it, and the cost is specific.** If Jira holds the truth, a
story's *narrative* lives in a ticket description — and the one thing this
entity's §2 insists on is that **the body is the artefact**. A Jira description
is a poor home for a Decisions table and a session log that grow over months,
which is the same objection `story-tracking` already raises about epics:
*"epics structurally cannot hold narrative."*

That is worth stating plainly rather than deferring: **posture 3 asks a Story to
live where the skill says stories cannot live.** Either the projection keeps the
narrative in the repo and syncs only the frontmatter — a narrower claim than
*"the whole truth is in Jira"* — or the story layer degrades to a stub under
that posture. This design does not settle which, and it should not be discovered
by a team that adopts posture 3 and finds their session log truncated.

---

## 3. The domain object


The normative shape. Where this document disagrees with itself, this section is
the specification.

### Identity

```
Story.slug : string
```

The directory name, and a filename component: `<slug>/STORY-<slug>.md`.

**The slug resolves to a file directly** — no date, no index, no precedence —
because it *is* the directory name. That is the one identity difference from
Plan, whose slug sits inside a dated filename (`YYYY-MM-DD-<slug>.md`) and
needs a three-step lookup. **Both entities are identified by their slug**; only
the resolution differs, and Plan §3 records why.

The slug appears **twice** on disk by convention, which is why `StoryCard.path`
is carried rather than reconstructed — *"rebuilding it client-side means
encoding that convention twice and letting the copies drift."*

A slug may carry a tracker key: `{JIRA-ID}-{slug}` (`FOOBAR-1234-wcag-audit`).
That is the only link to an Issue that exists today (§4).

### Fields

**Validated field by field, 2026-08-28** — against all nine stories'
frontmatter and against `StoryCardSchema`.

| field | type | in the estate | in `StoryCard` | source |
|---|---|---|---|---|
| `slug` | string | derived | **yes** | directory name |
| `title` | string | **9/9** | **yes** | frontmatter |
| `status` | `StoryStatus` | **9/9** | **yes** | frontmatter — the only field the lint enforces |
| `path` | string | derived | **yes** | `<slug>/STORY-<slug>.md`, `''` if unfound |
| `created` | date | **9/9** | **no** | frontmatter |
| `updated` | date | **9/9** | **no** | frontmatter |
| `author` | string | **9/9** | **no** | frontmatter |
| `unit` | string | **0/9** | no | skill requires it (§14) |
| `archived` | date | **0/9** | no | on `done` only (§14) |

**The estate is perfectly consistent** — all nine stories carry exactly the same
five keys, with no extras and no omissions. That is a stronger result than the
Plan's, and it makes §14's divergence sharper: the files agree with each other
and disagree with the skill.

**`StoryCard` carries four fields and the estate has five.** `created`,
`updated` and `author` are parsed by nothing in the board — verified, they
appear in no story-related code path. So the board knows *what* a story is and
*where*, and nothing about *when* or *whose*.

That is defensible for `author` (one-time provenance) and questionable for
`updated`: it is the only field that says whether a story is being worked on,
and §13 declines to render a staleness cue partly because the value never
reaches the client to begin with.

**Measured 2026-08-28** across all nine stories in this repo: every one carries
exactly `title`, `status`, `created`, `updated`, `author`. **None carries `unit`
or `archived`**, though the skill names both.

### The body is the object

Unlike every other entity in this design, **a Story's value is its prose.** The
frontmatter is metadata; the artefact is the narrative, the Decisions table and
the session log.

That has a consequence worth stating: **the domain object cannot represent a
Story.** It represents what a *board* needs to know about one — enough to list
it, place it and link to it. Any consumer that needs the story reads the file.

This is the opposite of Issue, whose five fields are the whole object because
its body lives in a tracker Plot does not own.

### Fields deliberately excluded

| excluded | why |
|---|---|
| plan list | derived — plans declare `Story:`, not the reverse |
| progress / percentage | a Story has no unit of completion; that is the point |
| assignee | `author` is who opened it, not who owns it; ownership is `unit`'s job |
| a ticket mirror | the same rule Issue follows |

---

## 4. Lifecycle


### Six statuses, two in use

```
draft ──► ready ──► active ──► in-review ──► done
              ↘  paused  ↗
```

**Measured:** of nine stories, **6 `active`, 3 `draft`**. Four of the six
declared statuses have never been used in this repo.

That is not automatically a defect — a vocabulary can be wider than its
current use — but it is worth knowing which parts are exercised. `done` in
particular is untested here, and it is the one with a documented side effect
(`archived:` plus a move to `archived/`).

### Nobody moves a Story but a person

**A Story has no derived status.** Unlike Plan (whose phase is a record of
transitions) or Branch (whose state is read from refs), a Story's status is a
frontmatter value a human writes.

That is correct and should stay: the statuses describe *what the humans are
doing about the knowledge*, and no mechanism can observe that. A story whose
plans have all delivered may still be `active`, because the knowledge is still
being added to.

**Consequence for the board:** a Story's status can go stale, and nothing will
detect it. The lint checks the key exists, never that it is current.

### Archiving

`status: done` plus `archived: {YYYY-MM-DD}`, and the directory moves to
`archived/`. Two writes that must agree — and §5 records that neither has been
exercised here.

---

## 5. Direction — inbound and outbound


Story has no kinds. It has both directions, and the Issue spec's rule applies
unchanged: **direction is a property of the individual artefact, not of the
type.**

| direction | act | mechanism |
|---|---|---|
| **inbound** | **Create Story** — a ticket becomes a Story | *Create story* on an issue row (`kind = story`) |
| **outbound** | **Create Issue** — a Story publishes a ticket | posture 2 — **unbuilt** (§7) |
| *(neither)* | **Create** — a person starts one | `/story-tracking` → `brainstorming` |

**The third row is the common case**, and it has no direction because no
artefact precedes it: six of nine stories here began with a person deciding
knowledge had overflowed.

**Inbound exists**: `POST /api/story`, keyed by issue number, spawning the
`Story command` agent. The story-tracking triage still governs whether one is
warranted — a well-described ticket stays the umbrella.

**Outbound does not.** Nothing publishes a story to a tracker, and under posture
2 that is the missing half: a client sees plans as feature tickets and releases
as epics, but the problem-space knowledge that justified them has no
publication. Whether it should is a genuine question — a story is often
*deliberately* internal — which is why this is named as unbuilt rather than as a
gap.

**Direction is a property of the individual story**, not of stories in general
— the rule the Issue spec states and this inherits. The same story may be
created from a ticket and later publish a different one.

---

## 6. Relations


| relation | direction | mechanism | state |
|---|---|---|---|
| **Plan → Story** | plan declares | `Story: <slug>` in `## Status` | **built** |
| **Issue → Story** | slug prefix | `{JIRA-ID}-{slug}` directory name | **convention only** |
| **Story → Sprint** | — | none | **absent** |
| **Story → Unit** | frontmatter | `unit:` | **declared, unused** |

### Plan → Story is the only real one

Plans declare their story; stories do not list their plans. Measured
2026-08-28:

| story | plans |
|---|---|
| `plot-board` | **90** |
| `the-board-is-blank-where-it-matters` | 15 |
| `plot-planning-model` | 9 |
| `plot-gates` | 6 |
| 5 others | **0** |

**Four of nine stories have no plan referencing them**, and that is legitimate:
a story exists for knowledge, and knowledge can precede or outlive plans. A
story with no plans is not an orphan.

**The direction is right, and the derivation already exists.**

**Corrected 2026-08-28.** An earlier draft said story → plans was *"derivable in
166 ms, derived nowhere."* The first half is right; the second is wrong. It is
derived in **two** places, both client-side:

```ts
Swimlanes.tsx:80    cards.filter((c) => c.story === s.slug)
StoryModal.tsx:40   plansInStory(cards, slug)   // filter + sort by phase
```

There is even a named function for it. So a story **does** know its plans — it
asks, every render, from the cards it already holds.

**That is the whole mechanism, and it is the right one.** A story does not
record its membership; it queries for it. The knowledge lives in the plans,
which declare `Story: <slug>`, and any consumer with the plan list can
reconstruct the grouping in a filter.

A `plans:` list in a story's front matter would be a second source of truth
that goes stale the moment a plan is written, renamed, moved between stories or
superseded — with nothing to detect the drift, because the story's copy would be
the only place that claim lived. The same argument made sprint→epic a
derivation.

**What is missing is not the derivation but its reach.** Both call sites are in
the browser, working from `board.cards`, so:

- the **board** can group plans under a story — and does, in two views
- the **CLI has no equivalent**: no script derives it, so a master agent asking
  *what does this story hold?* re-implements the filter (§10)
- the **count** appears in neither: `plansInStory` returns the cards, and no
  view renders *how many* (§13)

So the honest statement is: **a story knows its plans in the browser and
nowhere else.**### Issue → Story is a filename convention

`{JIRA-ID}-{slug}/` is the whole mechanism. No frontmatter field, no parser
support, nothing machine-readable.

**Measured: zero stories in this repo use the keyed form.** Under
`Tracker: plot` that is expected — there are no tickets to key against. Under
`Tracker: jira` (Issue §2, posture 3) *every story is a ticket*, and a filename
convention is too thin to carry that: it cannot be validated, cannot be
resolved to a URL, and breaks silently on a rename.

**A `ticket:` frontmatter key would make it symmetric** with the plan's
`Issue:` field. That is the one field this design proposes adding, and only for
repos with an issue tracker.

### Story → Sprint does not exist, and should not

A sprint is a *timebox*; a story is a *knowledge home*. A story spans sprints by
construction — that is close to what "spans plans" means in practice. Linking
them would suggest a story belongs to one timebox.

The relation that does exist is transitive and enough: sprint → its plans →
their `Story:`.

---

## 7. Actions

Seven acts in two kinds. **Six are lifecycle acts** — they create an artefact
or change a status — and **one is a quality act**, which does neither.

The first three are commonly confused because all three say "create". **They
differ in where the content comes from**, which is the only distinction that
matters:

| act | kind | content comes from | direction | status |
|---|---|---|---|---|
| **Create** | lifecycle | **a conversation with a person** | — | exists; template step broken (§1) |
| **Create Story** *(from an issue)* | lifecycle | a ticket body someone else wrote | inbound | **exists** |
| **Create Issue** *(from a story)* | lifecycle | a story file Plot already holds | **outbound** | **unbuilt** |
| **Resume** | lifecycle | the story file, read back | — | exists, CLI only |
| **Attach** | lifecycle | a session entry appended | — | exists, CLI only |
| **Challenge** | **quality** | **the story, interrogated** | — | agents exist, **no question set** |
| **Archive** | lifecycle | `status: done` + `archived:` + move | — | exists, **never run here** |

### Create — "let's start a new story"

**Yes: the user is the input.** The skill says so directly —

> *A story is created **before** its work exists, so its home cannot be derived
> from anything on disk.*

There is nothing to read and nothing to convert. That is precisely why Create
invokes `brainstorming` (§1): the problem statement does not exist yet, so it
has to be elicited — purpose, constraints, success criteria, approaches, and
approval, in dialogue.

Its triggers are conversational by nature: *"create story"*, *"new story"*,
*"work on"*, *"continue on"*. A person arriving with a problem is the whole
input, and the triage front door decides whether a story is the right home for
it at all.

**So Create is an origin, not a conversion.** It is the only one of the three
where no prior artefact exists.

### Create Story — from an issue

A conversion **inbound**: a ticket someone else wrote becomes a story. The
content is the issue body, fetched by `issue-view` and handed to the spawned
agent.

The distinction from Create is not the trigger but the **provenance**: here a
problem statement already exists in a system Plot does not own, and the story
is a home for the knowledge that ticket cannot hold. The triage still governs —
*a well-described ticket stays the umbrella* — so this act is legitimate exactly
when the ticket is **not** self-sufficient.

### Create Issue — from a story, and it is the missing one

A conversion **outbound**: an existing story publishes a ticket so people
outside the repo can see it. **Unbuilt** — nothing in Plot writes a ticket from
a story.

**This is the story-side half of the publishing posture.** Under
`Tracker: plot` + an issue tracker, a client already sees plans as feature
tickets and releases as epics; the problem-space knowledge that justified them
has no publication. The Issue spec calls this outbound direction unbuilt from
its side; this is the same gap named from the Story's.

**What it publishes is a summary, never the story.** The story's body is the
artefact (§3) — a Decisions table and a session log spanning months — and a
ticket is not a home for it. What a client needs is *what problem is being
solved and why*, which is the story's `## Objective`, not its narrative.

**Three properties it must have**, all inherited from decisions already made:

- **It is a publishing act, not a sync.** The story stays the truth; the ticket
  is a view. Nothing reads back.
- **It must be idempotent**, recording the ticket's id in the story's
  frontmatter — the same job `→ #N` does for a plan's PRs, and the same reason:
  a second run must find what the first created rather than mint a duplicate.
- **It is optional, per story.** The dev-team-only overflow signal is
  *"no ticket exists because the customer is not in the loop"* — a story
  deliberately unpublished is a legitimate and common state, so this can never
  be automatic.

**Where it is offered** is an open question. A board action on a story card is
the obvious place; a step in `/story-tracking` is the other. It should not be
part of Create — publication is a decision about audience, taken later than the
decision to write a story at all.

### Resume and Attach are the most-used and the least visible

*"Continue on X"* is the skill's own trigger phrase, and the triage's second
branch — *"an existing story that covers the effort: attach, don't create"* —
makes attaching the **preferred** outcome over creating.

Neither has a board affordance: a reader looking at a story card cannot log a
session against it.

That is defensible — both are conversational acts, and a button that spawned an
agent to write a session entry would be doing the writing a person came to do.
But it means the board shows stories it cannot help you work on, which is a
different relationship than it has with plans.

### Challenge — a quality act, not a lifecycle one

**A story is interrogated, and that is an action too** — but of a different kind
from the six above. The workflow names its agents beside Problem-space analysis:
**critic** and **reality-checker**, in a box labelled *"Agents advise"*, and
*"Challenge the story"* as its own step before approval.

| | **lifecycle** acts | **quality** acts |
|---|---|---|
| examples | Create · Create Story · Archive | **critic · reality-checker · challenge-the-story** |
| writes | a status change, a file, a directory move | **the story refines itself** |
| gated | archive requires `done` | **no** — nothing requires a challenge |
| skippable | no | **yes** |

**What they check is specific to problem space**: *how coherent the story is,
and how precisely the problem can be grasped from it.* That is not a review of
correctness — there is no solution yet to be correct about — it is a review of
whether the problem statement holds together and can be acted on.

Which makes it the exact counterpart of `challenge-the-plan`, one space up:

| | interrogates | asks |
|---|---|---|
| **critic / reality-checker** | a **story** | is the problem coherent and precisely grasped? |
| **challenge-the-plan** | a **plan** | does the solution survive technical, domain, UX and NFR questioning? |

**Both are advisory, and both leave `## Open Questions`.** The skill that does
this for plans is a *Companion* in CLAUDE.md rather than a spoke, and the same
is true here: a challenged story is at the same status it was before.

**Story has no equivalent skill.** `challenge-the-plan` *"works on any
PLAN/SPEC/STORY file; no plot conventions required"* — so it can be pointed at a
story — but its five question categories are solution-space
(stack, architecture, implementation, error states, scalability). Asking those
of a problem statement gets solution answers, which is the one thing a story
must not contain.

**So the gap is a question set, not a skill.** The critic and reality-checker
agents exist and the workflow names their slot; what has not been written is the
problem-space interview — coherence, precision, whose problem, what changes if
it is solved.

### Archive is the untested one

`status: done` plus `archived:`, and the directory moves to `archived/` — the
only story action with a filesystem side effect, and **never run in this repo**
(§14).

## 8. Scope — which stories are shown


**No filter question, unlike Issue.** Every story in the directory is shown;
there is no *unplanned* subtraction, no limit, no sort beyond directory order.
That is correct — a story is not an inbox item and nobody triages the list.

**Story's scope question is *which homes*.** Measured (§13): the board reads one
directory via a single `readdirSync`; the skill searches every declared home
with `git ls-files '*STORY-*.md'`. In an aggregating repo the board's story
surface is silently partial.

`archived/` is excluded by name in `collectStories`, which is right and is the
one deliberate scope rule that exists.

---

## 9. The collaborators — Story has almost none


Issue needs four (Tracker, Connector, Monitor, Writer) because it is a **foreign
entity**: its truth lives in a system Plot does not own, reached over a metered
network. **Story is local.** Files in the repo, read with `readdirSync`, parsed
from frontmatter.

| Issue needs | Story needs | why |
|---|---|---|
| `IssueTracker` (declaration) | — | no external system to declare |
| `IssueTrackerConnector` | — | no host to speak to |
| `IssueTrackerMonitor` (cadence, budget) | — | **no cadence at all**: local reads are free |
| `IssueTrackerWriter` | — | writes go through the skill, not a service |

**The absence is the finding.** Everything the Issue spec spends four
collaborators on — askability, rate limits, degradation, last-good-value —
**does not apply to a Story**, because a local file read either succeeds or the
repo is broken. `StoryCard` carries no `answer` field and needs none.

The one place this could change is posture 3, where stories become tracker
objects and acquire every foreign-entity concern at once. That is a further
argument for treating posture 3 as a different system rather than a
configuration (§4b).

---

## 10. Fleet control — the master agent cannot see stories


**Measured 2026-08-28: no script in `skills/plot/scripts/` reads a story.**
`plot-plan-meta.sh` parses a plan's `story:` field — the reference, not the
story — and `plot-story-lint.sh` checks the estate's structure without reporting
its contents. There is no `plot-story-scan.sh`.

| capability | board | master agent |
|---|---|---|
| list stories | `board.stories[]` | **nothing** |
| a story's status | `StoryCard.status` | **nothing** |
| which plans a story holds | derivable, not derived | derivable via `plot-plan-meta.sh` |
| open a story | modal + `/story/<slug>` | `cat` the file |
| lint the estate | — | `plot-story-lint.sh` |

**The same asymmetry as Issue, with a weaker case for closing it.** A supervisor
asking *"what is unplanned?"* needs the inbox; a supervisor asking *"what
stories exist?"* can list a directory, and the answer changes weekly rather than
by the minute.

What a supervisor plausibly does need is the **relation**: *which story does this
plan belong to, and what else is under it?* The first half is already in
`plot-plan-meta.sh`'s output and unused; the second is a group-by away.

**No monitor, for the same reason as Issue's CLI:** stories are local and
static, so a poll would burn cost to observe a directory that changes when a
person edits it.

---

## 11. Views


### Reading — `collectStories`

`board.ts:1107` walks the story directory and parses each `STORY-*.md`
frontmatter into a `StoryCard`. Cheap, local, no host call.

The `Story directory` config key (default `docs/stories/`) resolves the
location, and the skill supports **several homes** in an aggregating repo —
found with `git ls-files '*STORY-*.md'` rather than a filesystem walk, *"so it
never wanders into a submodule or an ignored directory."*

Verified 2026-08-28 at `board.ts:1107`: a single `readdirSync` on one root,
skipping `archived/`, with no multi-home traversal.

**The board reads one directory; the skill searches all homes.** That is a
second divergence, milder than §5's: a multi-home repo's stories would be
invisible to the board.

### Writing — `handleStory`

`POST /api/story` spawns the `Story command` agent, keyed by issue number, with
four named refusals: `no-story-command`, `several-story-homes`,
`tracker-unsupported`, `issue-unreadable`.

**`several-story-homes` is the write side of the read gap above** — the route
refuses where the skill would ask. Refusing is right for a write; but it means
a multi-home repo can neither create stories from the board nor see the ones it
has.

### Views

| view | where | status |
|---|---|---|
| story card | the board's story surface | **exists** |
| story page | `/story/<slug>` | **exists** |
| plan's story link | plan row | **exists** (`Card.story`) |
| plans-per-story count | story card | **missing** — derivable |
| stale-status cue | story card | **not proposed** — see below |

**A staleness cue is deliberately not proposed.** `updated:` is a human-written
date and a story can be legitimately quiet for months. A cue would flag the six
`active` stories here as stale by any threshold — and be wrong about most of
them.

---

## 12. Setup


**Neither `/plot-board-setup` nor `/plot-init` mentions stories** — see §1's
setup note for the measurement and the proposed probe. In summary:

| key | default | setup should |
|---|---|---|
| `Story directory` | `docs/stories/` | probe with `git ls-files '*STORY-*.md'`; several → ask, one → propose, none → write nothing |
| `Story index` | `README.md` | ask only where a home exists |
| `Story command` | — | write and verify, or *Create story* ships refused |

---

## 13. The four-way divergence


**Four sources disagree about what a Story is**, and each is authoritative about
something different. This is the Story's version of Agent's three competing
state models.

| source | says a Story has | enforces |
|---|---|---|
| the **live estate** (9 files) | 5 frontmatter keys | — |
| the **schema** (`STORY_STATUSES`) | 6 statuses | client-side parse |
| the **skill** (`story-tracking`) | `unit:` required, `archived:` on done | nothing |
| the **lint** (`plot-story-lint.sh`) | `status:` must exist | **exit 1** |

### The three specific gaps

**1. `unit:` is required by the skill and absent everywhere.**
*"Fill frontmatter — including `unit:`, the owning unit, so the placement is
recorded."* Nine of nine stories omit it, and the lint does not ask for it. A
field required by prose and by nothing else is the shape CLAUDE.md's own
gates-over-rules section warns about: *"if prose-only, it's a rule and will
eventually be violated."*

Either it is enforced or it is not required. **The measurement says it is not
required in practice** — so the honest fix is likely to drop it from the skill,
unless multi-unit repos need it, in which case the lint must ask.

**2. Four of six statuses are unexercised.**
`ready`, `in-review`, `paused`, `done` have never been used here. `done` matters
most because it carries the archive side effect, and an untested transition with
a filesystem move is where a defect waits.

**3. `archived:` has never been written.**
The `archived/` directory is documented in the skill's structure and does not
exist in this repo. The transition is entirely untested.

### What is NOT a divergence

The lint's minimalism is deliberate and correct. It checks the file exists, has
frontmatter, has a `status:`, is not done-but-unarchived, and is in the index —
**structural facts a machine can settle.** It does not check `unit:` because it
cannot know the right value. That is the right split; the problem is the skill
asking for something nothing verifies.

---

## 14. Gaps


Consolidated, ranked by whether they are reachable today.

| # | gap | reachable | where |
|---|---|---|---|
| 1 | **The story template does not exist** — `story-tracking` step 4 says to copy it | **now, every story** | §1 |
| 2 | **Setup never asks about stories** — three keys, no step; *Create story* ships refused | **now, every repo** | §11 |
| 3 | **The board reads one home**, the skill searches all | multi-home repos | §8, §13 |
| 4 | **`unit:` required by prose, written nowhere**, enforced by nothing | now, silently | §12 |
| 5 | **`Issue → Story` is a filename convention** — unvalidatable, breaks on rename | with a tracker | §4 |
| 6 | **`archived:` and `status: done` never exercised** — a filesystem move, untested | at first archive | §3, §12 |
| 7 | **Create Issue unbuilt** — no story publishes a ticket, so posture 2 shows plans and releases to clients but never the problem | posture 2 | §6 |
| 8 | **Posture 3 asks a Story to live where narrative cannot** | posture 3 | §5 |

**Gaps 1 and 2 are the ones to fix first**, and they compound: an agent told to
copy a missing template, in a repo whose story keys were never declared,
produces exactly the divergence §12 measures. Neither needs a decision — both
are things that were specified and never built.

**Gaps 7 and 8 are questions, not defects.** A story is often deliberately
internal, and whether posture 3 should support stories at all is a design
choice nobody has made.

---

## 15. Invariants and open points


### Invariants

1. **A Story is problem space; a plan is solution space.** A story is true
   independently of any system and outlives implementations; a plan is true only
   of the system it changes.
2. **Qualities live on both sides and are not the same qualities.** A story's
   are properties of the problem; a plan's are properties of that solution.
3. **Workflow belongs to the story** — how users want the system to behave, and
   what should be automated, constrain a solution without being one.
4. **A Story is a knowledge home, not a work container.** Size never triggers
   one; overflow of knowledge does — and it overflows *because* the plan has no
   section for problem-space knowledge.
5. **A Story is created late**, at the moment of overflow, and backfilled.
6. **`slug` appears twice on disk** — directory and filename — so `path` is
   carried, never reconstructed.
7. **Plans declare their story; stories do not list their plans.**
8. **A Story's status is written by a person and derived by nothing.**
9. **A story with no plans is legitimate**, not an orphan — measured, 4 of 9.
10. **The body is the artefact.** The domain object represents what a board needs
   to know, never the Story itself.

### Open points

- **Is `unit:` required?** The skill says yes, the estate says no, the lint is
  silent. Enforce it or drop it — the current state teaches contributors to
  ignore a documented field.
- **Should a `ticket:` frontmatter key replace the `{JIRA-ID}-` convention?**
  Needed under `Tracker: jira`, where every story is a ticket; unnecessary under
  `Tracker: plot`.
- **Should the board search all story homes?** The skill does; the board reads
  one. A multi-home repo's stories are invisible today.
- **Should a story template exist?** Settled in part: `story-tracking` step 4
  tells an agent to copy a template that does not exist, which is §5's root
  cause. With `brainstorming` producing the content, a template becomes the
  shape that output is poured into rather than a file copied blind — still
  possibly worth having, no longer load-bearing.
- **Should setup ask about stories at all?** Neither setup skill mentions them
  today, so every story key runs on its default. The probe already exists
  (`git ls-files '*STORY-*.md'`), and `Story command` is a capability the board
  offers and nothing verifies.
- **Should the standalone spec path remain in a Plot repo?** A direct
  brainstorm writes `docs/superpowers/specs/…`; invoked through
  `story-tracking` it lands as a story. Both are live here.
- **Should each template name the other's scope?** The problem/solution split is
  enforced structurally and stated nowhere, so it is learned by having a section
  refused.
- **Where do a plan's qualities go?** The template has no section for
  non-functional requirements; today they land in `Design` or in `Done when`.
- **Does `done` work?** The transition writes two fields and moves a directory,
  and has never run in this repo.
