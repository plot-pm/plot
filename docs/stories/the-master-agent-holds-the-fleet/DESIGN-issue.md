---
title: Issue — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Issue — domain object specification

The board's inbox and Plot's tracker-facing entity, specified in full.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
> — serves **job 5** (*what do I show the operator?*); its read/write controller
> split is the worked example behind **job 4** (*what is safe to run?*).
>
> **Companion:** [The fleet's domain entities](DESIGN-entities.md) — the other
> eight entities, and the organizing finding this one is the exception to.

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What an Issue is](#1-what-an-issue-is) | the concept, and why it is called Issue |
| 2 | [Posture](#2-posture--who-owns-the-truth) | who owns the truth: `Tracker:` and `Issue tracker:` |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** — fields, identity, invariants |
| 4 | [Kinds and directions](#4-kinds-and-directions) | story · epic · other; inbound vs outbound |
| 5 | [Relations](#5-relations-to-plot-artefacts) | which Plot artefact each kind maps to |
| 6 | [Actions](#6-actions) | Create plan · Create story · Create sprint |
| 7 | [Scope](#7-scope--which-issues-reach-the-board) | the epic harbour, and the no-epic inbox |
| 8 | [The collaborators](#8-the-collaborators) | Tracker · Connector · Monitor · Writer |
| 9 | [Fleet control](#9-fleet-control) | what the board and the master agent each need |
| 9b | [Views](#9b-views) | what renders, where, and what must not |
| 10 | [Setup](#10-setup) | what `/plot-board-setup` must do |
| 11 | [Gaps](#11-gaps) | what is verified broken |
| 12 | [Invariants and open points](#12-invariants-and-open-points) | the rules, and what is unsettled |

**Where sections disagree, §3 is the specification** and the rest is
justification. Sections marked *corrected* record a position this document held
and abandoned, with the evidence that moved it — those are kept deliberately, so
a reader can see which arguments have already been had.

---

## 1. What an Issue is

### What it is

**An Issue is a signal from outside Plot that nobody has decided about yet.**

Not a work item, not a lifecycle stage, not a plan in an earlier phase. The
contract states the boundary in as many words:

> *NOT an `AgentRow`, and the distance is the point. […] Giving it an `AgentRow`
> with six empty fields would make it a plan in an earlier state, and the four
> phases would then have a fifth in everything but name.*

That is the design decision the whole entity turns on. Plot has exactly four
phases — Draft, Approved, Delivered, Released — and an Issue is in **none** of
them. It has not entered the lifecycle. Modelling it as a pre-Draft state would
add a fifth phase by accident and make Plot responsible for a queue it does not
own.

### What it is for

**The board's inbox, and one question only: *is this worth a plan?***

Everything about the entity follows from that single question, including
everything it refuses to carry.

Its lifecycle inside Plot is one transition and one exit:

```
tracker issue, open, no plan references it
        │
        ▼
   appears in the board's inbox
        │
        ├── someone writes a plan citing it  →  Issue LEAVES the board
        └── nobody does                      →  it stays, ageing
```

**Nothing marks an Issue as handled.** It disappears because a *plan* now
references it — `Issue: #226` in the plan file — and the filter is a set
difference recomputed every pass: open issues minus referenced issues. The exit
condition lives in Plot's own artefacts, never in the tracker.

This is why it is the cleanest foreign entity: **Plot never writes to the
tracker, so there is no state to keep in sync and nothing to age into a lie.**

### The name: Issue, not Ticket

**Settled 2026-08-28: the domain concept is `Issue`.** This document called it
Ticket in its first draft; the codebase had already decided otherwise, and the
counts say so plainly:

| layer | `ticket` | `issue` |
|---|---|---|
| `contract/` | 7 | 29 |
| `server/` | 17 | 215 |
| `app/` | 52 | 184 |
| `skills/` | 72 | 231 |

Every domain-facing name is already Issue: `issue-list`, `issue-view`,
`issueAnswer`, `referencedIssues`, `Issue:` in the plan format, `IssueRowSchema`
itself. `ticket` survives almost entirely in the **view** layer, as a row kind
and a chip style — which is exactly the confusion §1b corrects. So this is less
a rename of a concept than the removal of the last place two words compete for
one meaning.

#### What the change touches

Measured 2026-08-28: 148 occurrences of `ticket`/`Ticket` across 25 files under
`packages/board/src` and `skills/`, in three groups with very different risk.
The count is a case-insensitive text match, so it includes prose and this
document's own quotations — it sizes the sweep, and is not a list of edits.

**1. The wire value — `RowKind` and `IssueRow.kind`.**

```
RowKindSchema:  'ticket' → 'issue'
IssueRowSchema: kind: z.literal('ticket') → z.literal('issue')
```

Renamed outright, no transitional union. Server and client ship from one build
into one artifact; there is no independent deployment and no stored payload, so
the only skew window is a browser tab left open across a rebuild.

**2. The chip style — `what: 'ticket'` — which is TWO things.**

This is the part a blind rename gets wrong, and the code already says so:

> *`what: 'ticket'` is worn by TWO different things — an issue's
> number-and-title, and an AGENT's session id — so a hook keyed on it would
> stamp `data-issue-link` on an agent row.*

`tuple-row.ts:725` and `rows.tsx:2234` both emit `what: 'ticket'` for an
**agent's session id**, where it means *render this like a ticket chip* and has
nothing to do with a tracker. Renaming those to `'issue'` would label a session
id "Issue" — worse than the ambiguity being fixed.

So the value **splits**: `'issue'` for issue links, `'session'` for agent
session ids.

**And that is not cosmetic.** The overload already costs code. `nameHooks` can
answer `what: 'branch'` once for all seven row kinds — *"every `what: 'branch'`
link on every kind is a branch"* — but cannot answer `'ticket'`, because the
function is not told the row kind and the two meanings need different hooks.
The result is that a ticket's hooks are passed in as `nameAttr` from the one
call site that knows better. **Splitting the value makes the general answer
possible**: an unambiguous `'issue'` could be answered in the same place
`'branch'` is.

Stated carefully, because the first draft of this section overstated it:
`nameAttr` is a general escape hatch used by several kinds and does not
disappear. What the split removes is the *reason this particular kind needs
it* — and whether to then move the hooks into `nameHooks` is a judgement for
whoever does the work, not a promise this spec should make on their behalf.

**3. Prose — comments, skill docs, README tables.** ~90 occurrences, no risk.
Worth doing in the same pass so the vocabulary lands whole; worth doing last so
a mechanical sweep never touches code.

#### What does NOT change

- **`story-tracking`'s use of "ticket"** is about a Jira work item as a customer
  or PM speaks of it, not about this entity. Its rule — *a well-described ticket
  stays the umbrella* — is quoted in this document and reads correctly in its
  own vocabulary. Renaming there would be translating a domain that is not ours.
- **`Tracker:`** stays `Tracker:`. It names the SYSTEM (`plot`, `jira`,
  `github-issues`, `linear`), not the item, and `Issue system:` would be worse.
- **`plot-host.sh`'s ops** are already `issue-list` / `issue-view`.

#### Order, and the gate

The rename is only safe with the tests that pin the current vocabulary: 21
assertions across 10 test files, including four browser tests
(`unplanned-issues`, `issue-becomes-a-plan`, `tuple-row`, `one-grid`). Those
assertions are the contract, so they are what says the rename is complete rather
than partially applied.

1. Split `what:` into `'issue'` / `'session'`, and collapse the `nameHooks`
   exception the split makes unnecessary.
2. Rename the wire value in `contract/`, then follow the type errors.
3. Update the 21 test assertions.
4. `pnpm build:board`, then `pnpm run test:board` — the artifact is generated
   and the browser tests load it, so a stale artifact fails reassuringly
   (a rename is exactly the change that produces one).
5. Prose sweep — last, so a mechanical `s/ticket/issue/` never runs over code.

**The gate is the 21 assertions passing, not the sweep being finished.** A
rename is the archetypal change that looks complete while a renderer still
matches on the old string: `tsc` catches the enum, and only the browser tests
catch a `data-` attribute or a label that drifted. Neither alone is sufficient.

---

## 2. Posture — who owns the truth

### Two keys: who owns the truth, and which service is spoken to

**Corrected 2026-08-28, and this supersedes how the rest of this section reads
`Tracker:`.** Earlier drafts treated it as a connection setting — which service
to call — and hung `scheme`, `baseUrl` and `scope` off it. It is not that. It
sits under *"Plot 2 posture keys (repo-declared ceremony bounds)"*, beside
`Plan PRs`, `Implementation home` and `Hosts plans`, and every one of those
answers **what is this repo's role**, never *what to dial*.

`Tracker: plot` says it outright: *plans in this repo ARE the tracker.* That is
a claim about **who owns the truth**.

So there are two independent questions, and one key was answering both:

| key | question | values | default |
|---|---|---|---|
| **`Tracker:`** | **who owns the truth** | `plot` · `jira` | `plot` |
| **`Issue tracker:`** | **which service is spoken to** | `github` · `bitbucket` · `jira` · `none` | **the git host** |

Both default to what already happens, so a repo declaring neither is unchanged —
see [both keys default](#both-keys-default-and-both-defaults-are-what-already-happens).

#### The three postures

|  | `Tracker: plot` | `Tracker: jira` |
|---|---|---|
| **`Issue tracker: none`** | MD files are the sole truth; no tickets exist | **invalid** — refused |
| **`Issue tracker: jira`** | MD files are the truth; **tickets are a publishing act** | **Jira is the truth**; MD files are a projection |

**`Issue tracker: jira` is a prerequisite for `Tracker: jira`.** The fourth cell
is not an unused combination — it is a **contradiction**: a repo declaring that
Jira owns the truth while giving Plot no way to reach Jira, asserting its plans
live somewhere it cannot read.

So the two keys are orthogonal in *meaning* and **ordered in validity**: the
connection may exist without the posture (that is posture 2, publishing), but
the posture may never exist without the connection.

```
Issue tracker: jira   ──enables──►   Tracker: jira
     (connection)                      (posture)
```

**This is Plot's first cross-key config rule**, which is why it needs stating.
The other posture keys — `Plan PRs`, `Hosts plans`, `Implementation home` — are
each independently valid, so nothing until now has had to validate a
combination.

**It must refuse, not default.** Falling back to `Tracker: plot` would leave a
repo believing Jira leads while Plot treats its MD files as truth — the two
sides of the system disagreeing about which one is authoritative, silently. That
is worse than either posture, and it is the shape a wrong `Tracker:` already
takes: *"answers with an empty list, and the board renders an empty inbox that
reads as you have no tickets."*

Where setup writes the keys, the dependency is checked there (4e's neighbour);
where a human edits `CLAUDE.md` by hand, the first read of `Tracker: jira` with
no connection must say so and stop rather than proceed on a guess.

**1. `plot`, no issue tracker.** Today's default and this repo's own posture.
Git is the source of truth, nothing is published, and there is no inbox.

**2. `plot` + `Issue tracker: jira` — publishing.** The MD files remain the sole
truth. Tickets are **created to show clients what is happening**, not to record
it: a sprint publishes an **epic** ticket, and approved plans publish
**feature/bug/task** tickets carrying a content summary. Nothing is read back as
authority.

This is the posture I never modelled, and it re-reads the whole outbound side.
Those tickets are not records Plot must keep true — they are **publications**.
Which is exactly why the inbox rule falls out so cleanly:

> **A ticket with no linked doc is new client input.**

The client can only answer through the surface they were shown, so an
unlinked ticket is a signal that arrived *back* through the publication
channel — and it becomes the source for a new plan, story or sprint.

**3. `jira` + `Issue tracker: jira` — Jira leads.** The whole truth is in Jira.
Every plan is a feature/bug/task ticket, every story is a ticket, and **a sprint
is the epic ticket**. Plot *reads its plans from there*, and the MD files in the
repo are written **when tickets are updated** — a projection, not a record.

**This posture inverts Manifesto Principle 1 for the repo that declares it.**
Git stops being the source of truth. That is a real and deliberate departure,
and it must be stated rather than discovered: a repo in posture 3 has an MD
estate that is *downstream*, and the reconcile scan's whole idea of drift means
something different there.

#### What each posture makes of the same artefacts

| artefact | posture 2 — publishing | posture 3 — Jira leads |
|---|---|---|
| plan | truth; ticket is its **summary** | **projection** of the ticket |
| story | truth; ticket is its summary | projection |
| sprint | truth; **epic** is its summary | projection of the epic |
| unlinked ticket | **new client input** | work not yet projected |
| ticket edited by a client | a signal to read | **an edit to the truth** |

The difference that matters most is the last row. In posture 2 a client editing
a ticket has *said something*, and Plot decides what to do about it. In posture
3 they have **changed the plan**, and Plot's copy is now stale.

#### The one question this raises and does not answer

Posture 3 needs a **reader** — plans parsed *out of* Jira tickets — and nothing
in Plot does that. Every mechanism designed above writes outward or filters an
inbox. A projection needs the inverse: ticket → MD file, on update, with all the
conflict questions a two-way sync implies.

That is a larger piece of work than this entity, and naming it as unbuilt is
more useful than sketching it here. **Posture 2 is fully designable with what
exists; posture 3 is a different system.**

---

#### What this corrects in the sections below

- **`IssueTracker` as I specified it** — scheme, baseUrl, scope — is the
  **`Issue tracker:` key**, the connection. It is not `Tracker:`.
- **"Plot never writes to the tracker"** is true in posture 1, false as a
  publishing act in posture 2, and false as a bidirectional sync in posture 3.
- **The epic-as-harbour** design is posture 2's. In posture 3 the epic is not a
  harbour Plot fills — it *is* the sprint.
- **`Create sprint` from an inbound epic** is posture 2's inbound half; in
  posture 3 an epic already is a sprint and there is nothing to create.
- **The inbox filter** — *open minus referenced* — is posture 2's. It is exactly
  the *"ticket with no linked doc"* rule, arrived at from the other direction.

## 3. The domain object

### Domain object specification

> Specifies the **inbound Customer story ticket** — the kind that exists today.
> The two outbound kinds are specified by the workflow and unbuilt; their shape
> follows from the writer above and is not settled here.

The normative shape. Everything after this section explains or justifies it;
where the two disagree, this section is the specification.

#### Identity

```
Issue.id : string
```

**Opaque, and a string.** Plot compares issue identities and never orders,
increments or arithmetically manipulates them. GitHub yields `226`; Jira yields
`PROJ-123`; both are identifiers, and only one of them is a number by accident
of the host.

Declaring `string` and normalizing at the adapter boundary closes gap 1 at its
root: the current split — `z.number()` in the row, `Set<number>` in the filter,
`.key` in the Jira arm — is what makes the Jira filter silently always-false.
A rendered identity may add the tracker's own sigil (`#226`), which is a view
concern, not the id.

#### Fields

| field | type | required | source | rule |
|---|---|---|---|---|
| `id` | `string` | yes | tracker | opaque; equality only |
| `title` | `string` | yes | tracker | may be empty; never absent |
| `url` | `string` | yes | tracker, **verbatim** | `''` = no address; never composed |
| `createdAt` | `string \| null` | yes | tracker | ISO-8601; `null` = the host gave none |
| `body` | `string \| null` | no | `issue-view` only | `null` = **not fetched**; `''` = fetched and empty |

Five fields. Every one is a fact the tracker stated; none is computed, formatted,
or relative to now.

**`body` distinguishes not-fetched from empty**, because the list op omits bodies
entirely and only a click fetches one. `null` and `''` are different answers, and
collapsing them would make an issue with no description indistinguishable from
one nobody has opened yet.

#### Fields deliberately excluded

| excluded | why |
|---|---|
| `status`, `state` | tracker state Plot does not own; ages into a lie between refreshes |
| `assignee` | as above, and Plot never assigns |
| `labels`, `priority` | as above |
| `kind` (epic/story/bug) | not fetched today; see Open |
| `ageMinutes` | a *presentation* of `createdAt` — belongs to the view |
| row `kind: 'issue'` | a renderer discriminator — belongs to the view |

The rule behind the first three: **Plot never writes to the tracker, so any
mirrored field is a copy that is wrong between refreshes and wrong forever after
an outage.** The tracker is the authority on tracker state; the model points at
it and carries nothing it would have to keep in sync.

#### Askability — a property of the ANSWER, not of an Issue

```
IssueAnswer : 'answered' | 'unsupported' | 'failed'
```

Carried once per fetch, beside the collection — never on an individual Issue,
which by existing has already been answered for.

| value | means | renders as |
|---|---|---|
| `answered` | the host replied | the list, empty honestly meaning none |
| `unsupported` | this tracker cannot be asked at all | **no section** |
| `failed` | asked, did not come back | last good list, marked stale |

`unsupported` renders nothing rather than an empty list: an empty inbox would
claim an empty tracker.

#### Invariants

1. **`id` is opaque.** Equality only — no ordering, no arithmetic, no sigil.
2. **`url` is verbatim or empty.** Plot composes no tracker address it was not
   given; `''` renders as plain text.
3. **`null` is never `0` and never `''`.** Absent is a distinct answer from
   empty at every field that has both.
4. **No mirrored tracker state.** Adding a field the tracker owns requires a
   reason this rule does not already refuse.
5. **Read-only — for this kind.** No operation writes to a Customer story
   ticket. The outbound kinds (Feature, Epic) are Plot's own artefacts and are
   written; see [Three kinds, both directions](#three-kinds-both-directions).
   The distinction is ownership, not politeness: Plot must not edit a ticket a
   customer owns, and must own the ones it mints.
6. **An Issue leaves by being referenced**, never by being marked — the exit
   condition lives in the plan estate.
7. **Askability is carried apart from the answer**, once per fetch.

#### Derivation to the view

```
toIssueRow(issue: Issue, now: number) -> IssueRow
```

`now` is an **argument**, not a capture, because `ageMinutes` depends on it and
a controller must not silently recompute a display value on every pulse. The
row adds `kind: 'issue'` and `ageMinutes`; it adds nothing else.

#### Not specified here

- **`kind` (epic / story / bug).** Plot fetches no issue type from any tracker
  today. Whether to add one is open: the board deliberately does not branch on
  it (both create actions are offered unconditionally), so the field would need
  a consumer before it earns a place — and a kind, unlike a status, does not age
  into a lie, so the usual exclusion does not settle it.
- **A parent or epic link.** Would mirror tracker hierarchy; refused for now on
  the same ground as `labels`.

---

### How it is modelled

**Correction, 2026-08-28.** An earlier draft of this section listed
`IssueRowSchema`'s fields as the entity's properties. That was wrong:
**`IssueRow` is a VIEW, not a domain model.** It sits in `RowKindSchema`'s list
of seven — `ticket`, `plan`, `pr`, `build`, `agent`, `branch`, `release`,
`wave` — which is a *rendering* taxonomy, and its `kind: 'ticket'` field exists
so *"one row component can read slot 2 from the data."* A domain object does not
carry a field naming which component draws it.

The domain object is what the tracker was asked about, before anything decided
how to show it.

#### The domain object

Specified normatively above — see [Domain object
specification](#domain-object-specification). Five fields, every one a fact the
tracker stated: `id`, `title`, `url`, `createdAt`, `body`. Nothing computed,
formatted, or relative to now; no labels, assignee, status or priority, because
*"those age into lies the moment the tracker moves"* and Plot never writes them
back.

#### What belongs to the view instead

Two things in the old table were view concerns, and naming them is what the
correction buys:

- **`kind: 'ticket'`** — a row discriminator. The domain object is a ticket by
  being one; it does not need to say so.
- **`ageMinutes`** — a *presentation* of `createdAt`. The adapter returns
  `createdAt`; `refreshIssues` converts it to minutes-since-now, which is
  correct only at the instant of render and must be recomputed every pulse. The
  domain holds the timestamp; the view holds the age.

The rule that produced `ageMinutes: null` rather than `0` is still right and
still belongs to the view: *0 would claim the issue was opened this instant.*
Absent-is-not-false applies at both layers.

#### The layering defect this exposes

`CacheEntry.issues` is typed **`IssueRow[]`** (`fleet.ts:498`). So the
controller — the thing the reactive section calls the fleet control — holds
view rows rather than domain objects. `refreshIssues` fetches from the adapter
and converts to rows *in the same function*, and no domain representation is
ever materialized.

That is why the earlier draft made this mistake so easily: **there was no domain
model to read, only a row.** The consequences are concrete rather than
theoretical:

- `ageMinutes` is recomputed inside the controller on every pulse, so a value
  whose only consumer is a renderer is refreshed by the data layer.
- A second consumer of tickets — a supervisor asking *"what is unplanned?"* from
  the CLI, with no board open — would receive rows shaped for a grid it is not
  drawing.
- The Jira `string | number` defect (gap 1) lives in the row schema, which is
  where it was noticed. Whether the *domain* id is a string or a number is a
  separate question that no type currently asks.

**The fix is not to rename `IssueRow`.** It is a good view type and should stay
one. The gap is that the controller should hold the domain object and the view
should be derived at the boundary — `toIssueRow(ticket, now)`, with `now` an
argument precisely because the age depends on it.

This generalizes past Issue, and it is the reason to record it here: **every
entity in this document is currently defined by its row.** `FleetBranch`,
`AgentEntry`, `Card` and `PrRecord` are all shapes the board renders. Whether
each is also the right domain shape is a question this design has not yet asked
of any of them — and asking it is what the remaining entity sections should do.

## 4. Kinds and directions

### Three kinds, both directions

**Corrected 2026-08-28** against the agentic workflow diagram. An earlier draft
of this section modelled Issue as ONE thing — an inbound signal nobody has
decided about. The workflow has **three**, at three points, flowing in two
directions:

| workflow ticket | phase | kind | typical direction | lifecycle |
|---|---|---|---|---|
| **Customer story** | Discovery | `story` | inbound — the signal | one ticket · one story; enters the inbox |
| **Feature** | Development | (any) | outbound — Plot writes it | one per plan, *"only now, because the cut now holds"* |
| **Epic** | Development → Testing | `epic` | outbound — Plot writes it | one per release; collects every feature ticket; **closes with the release** |

These are the workflow's three *roles*, and the direction column says which way
each **typically** runs — not which way it must. Direction is a property of the
individual issue, not of its kind: a Story with no customer ticket can produce
an outbound story ticket, and a customer can file an epic. See
[direction is a property of the issue](#direction-is-a-property-of-the-issue-not-of-the-kind).

Two of the three roles are **written by Plot**, and that is what the earlier
draft got wrong. Its invariant *"read-only; no operation writes to the tracker"* is a true
statement about the connector **today** and a false one about the workflow this
is designed toward.

#### What survives the correction, and what does not

**Survives — everything about the inbound kind.** The Customer story ticket is
exactly the entity specified below: impoverished, read-only, exiting by being
referenced. *"NOT an `AgentRow`, and the distance is the point"* still holds;
so does carrying no labels, assignee or status.

**Does not survive — the claim that Plot never writes.** It does not write
*today* because the write path does not exist: `issue-create` appears nowhere in
`plot-host.sh`, and neither "feature ticket" nor "epic ticket" appears anywhere
in `skills/` or `docs/` (verified 2026-08-28). The workflow is a **target
state**, and the honest reading is that the read-only rule holds for the inbound
kind and is *unbuilt* for the two outbound ones.

**Does not survive — my sprint→epic answer.** An earlier section argued: derive
the epic from the union of the plans' `Issue:` refs, and never store it. That is
right for an epic Plot *reads* and wrong for one it *creates*. The workflow's
epic is **per release**, and it is Plot's own artefact — so it has an identity
Plot minted, and a derivation cannot invent one. The correction is below.

##### Direction is a property of the issue, not of the kind

**Corrected 2026-08-28.** An earlier draft of this section fixed direction to
kind — epic outbound, story and plan inbound. That is wrong: **every relation
runs in both directions**, and the two axes are independent.

|  | **inbound** (the tracker minted it) | **outbound** (Plot minted it) |
|---|---|---|
| **story** | a customer story ticket → a Story | a Story with no ticket → Plot files one |
| **plan** | a bug or task → a Plan | a Plan → its **Feature ticket** |
| **epic** | a customer's epic → an inbound signal | a Release → its **epic harbour** |

All six cells are real. The draft denied two of them while this same document
described them elsewhere: the **Feature ticket per plan** is the outbound plan
case, specified one section above; and an inbound epic is the ambiguity named
two sections below. The story case is `story-tracking`'s own — *"no ticket
exists because the customer is not in the loop"* — where the Story is the
umbrella and a ticket may be filed for visibility rather than the reverse.

##### What actually differs: who minted the identity

The distinction the draft was reaching for is real, but it belongs to the
**individual issue**, not to its kind:

| | inbound | outbound |
|---|---|---|
| identity minted by | the tracker | **Plot** |
| Plot's job | *record* the reference | *mint it, and remember having minted it* |
| failure if lost | a broken link | **two artefacts for one thing** |
| Plot may edit it? | **no** — someone else owns it | yes — it is Plot's own |
| lifecycle owner | the tracker | Plot (a feature ticket follows its plan; an epic closes with its release) |

So the asymmetry that matters is **ownership**, and it is per issue: a Feature
ticket Plot created is Plot's to close, while a bug someone filed is not — even
though both map to a Plan.

**How Plot tells them apart: by having recorded the id.** An issue whose key
appears in a Plot artefact — `Issue:` on a plan, the epic id beside `Released:`
— is one Plot knows about; whether Plot *minted* it is the same record read one
step further. This needs no provenance field and fails in the safe direction: an
unrecorded issue is treated as inbound, so Plot declines to edit something that
might not be its own.

**Why this matters more than tidiness.** Direction decides the write policy. An
inbound issue is read-only by the rule that Plot must not edit what a customer
owns; an outbound one is Plot's to close and must never be minted twice. Getting
that per-kind rather than per-issue would either forbid Plot from closing its
own feature tickets, or license it to edit a customer's epic.

#### Why the timing is the design

The workflow says the feature ticket is written *"only now, because the cut now
holds"* — at **Plans approved**, not at Draft.

That is the same discipline as every other Plot record. A ticket written at
Draft would name a plan whose branches may still be re-sliced; the cut holding
is what makes the ticket's scope true. It is the tracker-side twin of
`Approved:` — a record written when the fact becomes true, not when it is
first imagined.

And the epic *"closes with the release"*, which gives the outbound kinds
something the inbound kind explicitly refuses: **a lifecycle Plot owns.** A
customer story's state belongs to the tracker and would age into a lie if
mirrored. A feature ticket's state is Plot's own — the plan's phase *is* the
ticket's truth.

#### The `kind` question, now settled

Two sections above, `kind` (epic/story/bug) was deferred for want of a consumer.
It has three:

1. An inbound Customer story and an outbound Feature ticket are **different
   entities that live in the same tracker** — without `kind`, Plot's own feature
   tickets would reappear in its inbox as unplanned signals the moment a plan
   stopped referencing them.
2. The epic→feature relation needs to know which is which.
3. A reader asking *is this worth a plan?* is asking a different question of an
   epic than of a bug.

`kind` is therefore not a mirrored status and does not age into a lie — it is
**structural**, and it is what keeps the three kinds apart.

**And it is what selects an Issue's counterpart**: `story` → Story, `epic` →
Release, anything else → Plan. See
[the relations](#the-relations--which-plot-artefact-an-issue-maps-to). Without
`kind` there is no rule to apply, so the field moves from *deferred for want of
a consumer* to *required by the mapping*.

**It must be fetched, and today it is not.** Neither arm asks for it — GitHub
requests `number,title,url,createdAt`, Jira requests `summary,created`. Both can
supply it free in the call already being made (`--json issueType`, `fields=…,
issuetype`), so this is a field to add rather than a call to add.

**And it needs a value for *cannot tell*.** A tracker with no type concept, an
older payload, or a type Plot does not recognise must render as `''` — the same
absent-is-not-false shape every other field here uses. The mapping then falls to
the default (Plan), which is the safe direction: it offers a plan for something
that might have deserved a story, rather than silently filing it nowhere.

---

## 5. Relations to Plot artefacts

#### The relations — which Plot artefact an Issue maps to

Settled 2026-08-28. `kind` selects the counterpart, and this is the rule that
makes the field load-bearing rather than decorative:

| `kind` | Plot artefact | mapping |
|---|---|---|
| `story` | **Story** | one ticket · one story |
| `epic` | **Release** | one epic · one release |
| anything else | **Plan** | one ticket · one or more plans |

```
Issue(kind=story)  ─────►  Story  ──┐
                                    ├──►  Plan  ──►  Feature ticket ──┐
Issue(kind=bug|task|…) ─────────────┘                                 │
                                                                      ▼
Issue(kind=epic)  ◄────────────────  Release  ◄─────────────  epic collects
```

##### `story` → Story

*One ticket · one story* — the workflow's own words for the Discovery input.

**The link exists as a naming convention and nothing else.** `story-tracking`
names story directories `{slug}/` **or** `{JIRA-ID}-{slug}/`, so the ticket key
can be part of the path. Verified 2026-08-28: no story in this repo uses the
keyed form, and no STORY file carries a ticket field in its frontmatter.

That is thinner than the plan relation, which has a parsed `Issue:` field. A
`ticket:` frontmatter key would make it symmetric and machine-readable — but the
directory convention already exists and works for a human, so this is a gap to
name rather than a defect to rush.

**The umbrella rule governs whether a Story is created at all**, and it is
`story-tracking`'s, not this entity's: *a well-described ticket stays the
umbrella*, and *"implement this ticket as described" never opens a story*. So
`kind=story` says which **counterpart type** applies; it does not say a Story
must exist.

##### anything else → Plan

The default, and the only relation fully built today. `Issue:` on a plan is
parsed (`#N` and `PROJ-123` alike), and one plan may answer several signals —
*"a plan can answer several"*, which is why the field is a list.

**One ticket may also produce several plans.** The workflow's *Build n plans*
step is exactly this: one approved story fans out into n plans, each citing the
same origin. So the cardinality is many-to-many, and neither side is a key.

This is where gap 3 bites: the reference is recorded on the plan and **never
read back**, so the board can say which tickets are unplanned but not which plan
answers `PROJ-123`.

##### `epic` → Release

The outbound one, and the only relation where Plot mints the identity.

```
epic(2.11.0)  ⟷  Release 2.11.0
```

- **Keyed by the release version** — the key the estate already carries, since
  sprint files declare `Release:` from the day they open.
- **Membership is the feature tickets** of every plan in that release, added at
  creation rather than swept in later.
- **It closes with the release**, which is the lifecycle Plot owns. A customer
  story's state belongs to the tracker; an epic's state belongs to Plot.

**The identity must be recorded where a re-run finds it.** `/plot-release` is
idempotent by design — every step tests the source it would have written — and
minting an epic breaks that unless the epic's key is written down. The existing
pattern is `→ #N` on a branch line: the artefact records what was created, so
the second run finds it rather than repeating the act. The epic's id belongs
beside `Released:` for the same reason.

##### What the mapping must not become

- **Not an importer.** `kind=epic` does not mean *read its children and create
  plans*. The epic Plot writes and the epic a customer might file are different
  things, which is exactly why `kind` alone is not enough — see below.
- **Not a type equivalence.** A `bug` ticket does not force a `Type: bug` plan.
  The plan's type is a decision about the work; the ticket's kind is a fact
  about the signal.
- **Not a requirement.** A plan needs no `Issue:`; a release needs no epic. Both
  relations are optional, and the majority of this repo's plans carry neither.

##### The ambiguity `kind` alone cannot resolve

An epic Plot minted and an epic a customer filed have the **same `kind`** and
opposite meanings — one is Plot's own release harbour, the other is an inbound
signal that might deserve a Story. Distinguishing them needs provenance, not
type: *did Plot create this?*

The cheapest honest answer is that Plot knows its own by **having recorded the
id** — the same record idempotency already requires. An epic whose id appears
beside a `Released:` line is Plot's; any other is inbound. No new field, and it
fails in the safe direction: an unrecorded epic is treated as inbound, which
shows a row rather than hiding one.

#### Mapping a Sprint to an epic

**Derive it; do not store it.** A sprint carries plans, and a plan carries
`Issue:` — so the sprint-to-epic relation already exists as a union over the
sprint's members:

```
sprint  →  its plans  →  their Issue: refs  →  the epic they share
```

Nothing new is written. This is the same shape `plot-sprint-release.sh` uses to
derive a release's contents from plan phases rather than from a stored list, and
the reason is this repo's most repeated lesson: **the copies are what drift.**
An `Epic:` field on the sprint file would be a second source of truth about a
fact the plans already state, and it would go stale the first time a plan joined
or left the sprint.

Verified 2026-08-28: `Issue:` is parsed on **plans only** — no sprint file in
this repo carries a ticket reference, and `plot-plan-meta.sh` has no sprint-level
issue field. So the derivation is the *only* mapping there is, and the question
is whether to surface it rather than whether to build it.

What a reader would get from surfacing it:

- **A sprint's tracker footprint** — *this timebox answers PROJ-100, PROJ-104*
  — computed, always current, and free once `meta.issues` stops being discarded
  (gap 3).
- **The inverse, which is the useful direction under `Tracker: jira`:** *which
  sprint is working on PROJ-100?* That is what a PM asks, and it is the same
  index read the other way.

Two things this must not become:

- **Not a sprint field.** `Sprint: <name>` on a plan and `Issue:` on a plan are
  enough; a third annotation would need maintaining in a file nobody re-reads.
- **Not an epic→sprint import.** Plot does not read a Jira epic's children and
  create plans from them. `story-tracking` already rules that a well-described
  ticket *stays* the umbrella, and the manifesto keeps issues as signals rather
  than commitments. The mapping is a **report about what was decided**, never a
  queue to work through.

**One honest limit.** A plan cites its `Issue:` as a flat list; nothing says
whether `PROJ-100` is an epic or a sibling ticket. Distinguishing *the epic this
sprint serves* from *the tickets it closes* needs the `kind` field this design
has so far deferred — which is the first concrete consumer for it, and the
argument to reconsider.

## 6. Actions

##### The actions an inbound Issue offers

The mapping is what a reader acts on, so each relation gets an action. Settled
2026-08-28:

| action | offered when | starts | maps to |
|---|---|---|---|
| **Create plan** | **always** | `/plot-idea` | Plan |
| **Create story** | `kind = story` | `/story-tracking` | Story |
| **Create sprint** | `kind = epic` | *(unbuilt)* | Sprint → Release |
| **Open on host** | always | navigation | — |

**Create plan is unconditional**, and stays the default for every kind. An epic
or a story may still deserve a plan directly — the workflow's own *Build n
plans* fans one approved story into several — so nothing gates it. It is also
the fallback where `kind` is `''`, which is the safe direction: offering a plan
for something that deserved a story beats filing it nowhere.

**The other two are gated on a fact, not on a guess** — and this reverses an
earlier position in this document, deliberately. That draft said *"both create
actions are offered unconditionally; the board does not inspect a ticket to
decide whether it is epic-shaped or plan-shaped, and that restraint is the
design."* It was right **while no kind was fetched**: with no type available,
any gating would have been an inference from the title. Now that `kind` is a
fetched fact, gating stops being a guess and becomes a reading.

The restraint was never about refusing to gate. It was about refusing to
*infer* — and the rule is unchanged: **Plot may act on what the tracker stated
and must not act on what it inferred.**

##### `Create sprint` — the unbuilt one

An inbound epic is a customer saying *here is a body of work*. The counterpart
is a Sprint, because a sprint is Plot's unit for a body of work with a release
attached — and the epic is keyed by exactly that.

```
Issue(kind=epic)  ──Create sprint──►  Sprint(Release: <version>)
                                             │
                                             └──►  epic harbour for that release
```

The relation closes on itself, which is the property worth noticing: an inbound
epic creates a sprint, and that sprint's release then has an epic — **the same
one**. So *Create sprint* is where an inbound epic becomes the outbound harbour,
and the two directions meet in one artefact rather than producing two.

**What it needs, none of which exists:**

| piece | status |
|---|---|
| `Sprint command` config key | **absent** — no such key in `plot-config.sh` |
| `POST /api/sprint` route | **absent** — no sprint module in `server/` |
| the sprint's `Release:` value | the epic must carry or imply a version |

**The version is the hard part, and it is a judgement.** A sprint declares
`Release: 2.11.0` from the day it opens, but an epic titled *"Q3 reporting"*
names no version. So *Create sprint* cannot mint the sprint outright the way
*Create plan* mints a draft — it spawns an agent that proposes the sprint and
asks, exactly as `/plot-sprint` does today. That keeps the version a decision a
person makes, which is the same line every other Plot gate draws.

**It follows the two existing spawn actions in every other respect**: brief
written to a file outside the repo and named in the environment, so no part of
an epic's body becomes a shell word; localhost-only, because it writes to this
disk; and refusals named rather than hidden — `no-sprint-command` joins
`no-story-command` as a reason a reader can act on.

##### Actions an outbound Issue offers

**None, on the row.** An outbound issue is Plot's own artefact and its lifecycle
follows the artefact: a feature ticket tracks its plan, an epic closes with its
release. There is nothing for a reader to decide, which is why outbound issues
do not appear in the inbox at all — they are subtracted by the same filter that
removes any referenced issue.

An outbound issue that *does* surface in the inbox is a defect, not a row with
missing actions: it means Plot minted something and lost the record of having
done so.

### An Issue leads to a plan OR a story — the reader chooses

The ticket row carries **three** actions, and the design decision is that the
board offers all of them and guesses at none:

| action | what it starts | refuses when |
|---|---|---|
| **Create plan** | `/plot-idea` agent → a Draft plan | the host cannot be asked; the lookup broke |
| **Create story** | `/story-tracking` agent → a story | no `Story command`; several story homes; non-localhost binding; host unreadable |
| **Open on host** | navigation to `issue.url` | never — no guard, no fetch |

**Both create actions are offered unconditionally.** The board does not inspect
a ticket to decide whether it is epic-shaped or plan-shaped, and that restraint
is the design.

> **Revised once `kind` is fetched.** This holds while no type is available —
> gating on an inferred shape would be a guess. With `kind` as a fetched fact,
> *Create story* is offered on `kind = story` and *Create sprint* on
> `kind = epic`, while *Create plan* stays unconditional. See
> [the actions an inbound Issue offers](#the-actions-an-inbound-issue-offers).
> The rule is unchanged: act on what the tracker stated, never on what was
> inferred. It cannot know: an epic's title looks like a story's, a
well-scoped bug looks like a plan, and the same ticket can honestly be either
depending on how much of it the team intends to take on. Guessing wrong costs
either a story nobody wanted or a missing option on the row that needed it.

So the judgement stays with the person who read the ticket — Principle 3 applied
to an action rather than to a report. What the board contributes is **making
both cheap and naming why either is refused.**

This is also the answer to *when a Jira epic and a Plot Story both claim the
umbrella*: nothing resolves it automatically, because `story-tracking` already
rules on it and its rule needs a reader —

> *A well-described **ticket** holds [the umbrella]; the ticket stays the
> umbrella. […] **Negative rule:** "implement this ticket as described" never
> opens a story.*

A rich Jira epic is not duplicated into a local Story. That is the same
discipline as carrying no labels and no assignee: **do not mirror what the
tracker already owns better.** The board offers *Create story*; the skill behind
it declines to create one where the ticket is already the umbrella.

**The menu is always present**, whatever the binding — *Create story* and *Open*
are there even where they refuse, so a ticket row is never menuless. A refusal
that names its cause is more useful than an absent button, and each refusal
sends the reader somewhere different: `no-story-command`, `several-story-homes`,
`tracker-unsupported`, `issue-unreadable`.

**Both actions spawn agents, and that is fenced.** The issue body is written by
whoever can file an issue, and `Story command` is a shell fragment run through
`sh -c` — so the brief is written to a file **outside the repo** and named in the
environment, never interpolated. *"No part of an issue ever becomes a shell
word, whatever it contains."* Outside the repo because `pnpm board` runs under
`node --watch`, so a prompt written inside would restart the server that just
spawned the agent. And neither action is available over a non-localhost binding:
*"the phone that reads the board does not write stories from it."*

## 7. Scope — which issues reach the board

#### The epic is the harbour — it scopes the inbox and receives what Plot mints

Settled 2026-08-28. Once an epic matching the release is found, it becomes the
**one place both directions meet**:

```
                    epic(2.11.0)
                    ╱          ╲
        READ: scope of        WRITE: every feature
        what we look for      ticket Plot mints joins it
                    ╲          ╱
              one harbour, two directions
```

**Reading — the epic replaces the scope heuristic.** Two sections above, the
inbox's stage 2 was flagged as a gap: Jira scopes to `assignee = currentUser()`,
GitHub to every open issue, and I proposed a declared `scope: mine | all` to
reconcile them. **The epic is a better answer and this supersedes it.** Both of
those were guesses at relevance; an epic is a *declaration* that these tickets
belong to this release. So:

```
inbox = children(epic(release)) − referenced(every plan file)
```

Stage 2 stops asking *whose issues* and asks *which epic* — answered by the
release key the estate already carries. Where no epic is found the previous
behaviour stands unchanged, which is what keeps a repo with no epic working.

**Writing — every ticket Plot mints joins the epic.** A feature ticket created
at Plans approved is added to `epic(release)` at creation, not swept in later.
That makes membership an act rather than a reconciliation, and it is what makes
the harbour hold: a feature ticket outside its epic is invisible to the inbox
scope above, so a later run would offer it as an unplanned signal.

**The two halves are the same fact read twice**, which is the property worth
protecting: what Plot writes into the epic is exactly what Plot later looks for
in it. If they can disagree, the harbour has become a mirror to keep in sync —
the failure this entity avoids everywhere else.

##### Without an epic — all open, newest first

Settled 2026-08-28, and it is the majority case: **no epic, no scope
heuristic.** One rule on both arms.

```
inbox = open(tracker) − referenced(every plan file)
  sort   created DESC
  limit  50, and the count says so
```

| arm | query | change |
|---|---|---|
| Jira | `resolution = EMPTY ORDER BY created DESC` | **drops `assignee = currentUser()`** |
| GitHub | `--state open --search "sort:created-desc"` | **adds an explicit sort** |

**This changes Jira's behaviour, deliberately.** Today its arm asks
`assignee = currentUser() AND resolution = EMPTY` — *my* open tickets — so a
team's unassigned backlog never reaches the board at all. That is the wrong
default for a triage inbox, because **an unassigned ticket is the most likely
thing to be worth a plan.** A filter that hides untriaged work defeats the one
question the inbox exists to ask.

`PLOT_JIRA_JQL` still overrides for a team that wants narrower, so nothing is
taken away — only the default moves from *mine* to *everything nobody has
planned*.

**And it fixes a GitHub gap found while specifying this.** The arm passes no
sort at all and relies on `gh`'s default ordering, so *newest first* is
currently an assumption rather than a request. Verified 2026-08-28:
`--search "sort:created-desc"` returns the expected order.

**Why not filter by assignee at all.** Two reasons, and the second is the
decisive one:

1. **It costs an identity Plot does not have.** Jira resolves `currentUser()`
   server-side from the auth token, free. GitHub does not — nothing in the
   adapter resolves a user, and the board has no user concept. Assignee
   filtering would introduce one on one arm to match a convenience on the other.
2. **The inbox's question is triage, and triage is about the unassigned.**
   "Is this worth a plan?" is asked hardest of tickets nobody has picked up.
   Scoping to assigned tickets answers a different question — *what is on my
   plate* — which is what the tracker's own UI already does better.

**The limit must state itself.** 50 is a bound on the fetch, not a claim about
the tracker, so a truncated list renders as *showing 50 of N* (gap 2). With no
epic and no assignee filter this matters more, not less: the inbox is now the
whole open backlog, and 50 of 400 shown as "50" is a materially wrong picture.

**Where an epic exists, it replaces this entirely** — `children(epic(release))`
is a declaration of membership rather than a bound on recency, so neither the
sort nor the limit is doing the same job.

##### The bootstrap, and why it is not circular

The epic is keyed by a release version, and *"is this worth a plan?"* is asked
before any plan exists — so it is worth showing the order does not bite:

| when | what is known | epic |
|---|---|---|
| sprint opened | `Release: 2.11.0` **declared in the sprint file** | may be created here |
| plan approved | the release the plan is heading for | feature ticket joins it |
| `/plot-release` | the version is cut | epic **closes** |

Verified 2026-08-28: sprint files carry `Release:` from the day they open —
`2.6.0`, `2.8.0`, `2.9.0`, and a live `2.11.0` — while `/plot-release` only
*determines* a version at the end. **So the key exists long before the release
does**, and the epic can be found or created at sprint open rather than at
release time.

Where no sprint declares a release — the majority case — there is no epic, no
harbour, and the inbox scopes as it does today. That must stay true: the epic is
an *addition* for teams that run releases through a tracker, never a
prerequisite for the board's inbox.

##### What must not follow from this

- **The epic is not a work queue.** Its children are scoped, not assigned. The
  inbox still asks *is this worth a plan?* and still subtracts what plans
  already reference.
- **Plot does not manage the epic's own state** beyond closing it with the
  release — no reordering, no priority, no assignment.
- **A customer story ticket does not join the epic.** It is inbound and belongs
  to whoever filed it; the epic collects what Plot mints. Conflating them is
  what `kind` prevents.

**Still not an import.** Nothing reads an epic's children to create plans.
`story-tracking`'s rule stands for the *inbound* kind: a well-described customer
ticket stays the umbrella. The outbound epic is a **report Plot publishes about
a release it made**, which is the opposite direction and does not touch that
rule.

##### Which issues reach the board — the whole filter

Four stages, and **only one of them is Plot's own judgement**. Stated together
because they are currently spread across the adapter, the monitor and a
constant, and no single place says what a reader is looking at.

| # | stage | decided by | today |
|---|---|---|---|
| 1 | **open** | the tracker | `--state open` / `resolution = EMPTY` |
| 2 | **scope** — which issues | the epic, or all open | epic children where one exists; else everything |
| 3 | **unplanned** | the plan estate | `− referenced(every plan file)` |
| 4 | **limit** | `ISSUE_LIMIT = 50` | **truncates silently** ← gap 2 |

Stage 3 is the only one Plot decides, and it is a set difference with no
judgement in it. There is deliberately **no ranking, no relevance scoring and no
sorting** beyond the tracker's own order: the single question is *is this worth
a plan?*, and that is a reader's call made from the title. A score here would be
the same mistake `plot-sprint-candidates.sh` refuses to make — *"which plans
serve a stated goal is the semantic judgement"* — and it would rank by whatever
a shell can compute rather than by what matters.

Two of the four stages are unsound as they stand, and both fail the same way:
**a filter the reader cannot see.** Stage 2 differs per tracker without saying
so; stage 4 removes rows without saying so. A filter is honest only when its
result carries what it excluded.

##### What "matching" means — and the asymmetry to fix

The monitor shows *open issues no plan references*. But **what counts as open is
scoped differently per arm**, and that scoping is undeclared:

| arm | query | inbox means |
|---|---|---|
| Jira | `assignee = currentUser() AND resolution = EMPTY` | **my** open tickets |
| GitHub | `gh issue list --state open` | **every** open issue in the repo |

On a small repo these converge. On a busy one they are different inboxes
entirely — and `ISSUE_LIMIT = 50` then truncates *somebody else's* backlog onto
the board, silently (gap 2).

**Measured here 2026-08-28: 1 open issue, 0 assigned to the operator.** So this
repo would show one row under the GitHub arm and **an empty inbox under Jira's
scoping** — the two arms disagreeing about the same estate at the smallest
possible scale, where they were supposed to converge. The asymmetry is not
waiting for a busy repo to appear; it is visible at n=1, and the divergence
grows with backlog rather than beginning there. Only Jira can be re-scoped, via `PLOT_JIRA_JQL`,
and only through an environment variable rather than the config every other
posture is declared in.

**Resolved 2026-08-28, and `scope` is not the answer.** Both cases are now
settled without a new config key:

- **With an epic** — `children(epic(release))` scopes the inbox. A declaration
  of membership, not a guess at relevance. See
  [the epic is the harbour](#the-epic-is-the-harbour--it-scopes-the-inbox-and-receives-what-plot-mints).
- **Without one** — every open ticket, newest first, capped at 50 with the count
  stated. See [without an epic](#without-an-epic--all-open-newest-first).

The asymmetry is removed by making both arms ask the same question, rather than
by declaring which of two answers a repo prefers. `PLOT_JIRA_JQL` remains the
escape for a team that wants narrower. Two properties follow:

- **The monitor never invents a scope.** It asks the connector for what the
  tracker declared; a filter the board applied after the fetch would be a third
  place issues are selected.
- **A truncated list says so.** *Showing 50 of N* is a different claim from
  *there are 50*, and the entity is scrupulous about that distinction
  everywhere else.

#### Sprint → epic, corrected

The release is the unit, not the sprint. `plot-sprint-release.sh` already reads
a sprint's declared `Release:` target, so the mapping runs through it:

```
sprint --Release:--> release --epic ticket--> collects each plan's feature ticket
```

**The epic's key is the release version, and that is the whole model.** An epic
collects the feature tickets of one release, so `2.11.0` names it, finds it, and
closes it. Verified 2026-08-28: `plot-sprint-release.sh` already reports a live
sprint targeting `2.11.0`, so the key exists and is read today — nothing new has
to be invented for the epic to be addressable.

Membership is therefore derived, not maintained:

```
epic(2.11.0)  ⊇  { feature ticket of every plan released in 2.11.0 }
```

- **The epic is per release**, so a sprint with no `Release:` has none — which is
  the majority case and must stay silent.
- **Two sprints may target one release**, which the release gate already handles
  (*"two teams, one train"*). One epic, several sprints: the derivation must not
  assume a single owner.
- **The epic's identity is minted, not derived.** Once `/plot-release` creates
  it, the id must be recorded where a re-run will find it — a `Released:` line's
  neighbour, on the same principle as `→ #N`.

## 8. The collaborators

### The three collaborators

Settled 2026-08-28. Three roles, named — and **all three exist today, unnamed
and scattered.** Naming them is the design: it says which decision belongs to
which, so a change to one does not silently become a change to another.

```
IssueTracker            what this repo tracks with, and how the inbox is scoped
      │                 (configuration — a declaration, not a connection)
      ▼
IssueTrackerConnector   how that tracker is asked; the ONE place a tracker's
      │                 shape is known; emits one vocabulary whatever answered
      ▼
IssueTrackerMonitor     when it is asked, how often, and what it costs;
                        owns the filter, the failure policy and the gate
```

#### `IssueTracker` — the declaration

What the repo tracks with, and **how much of it is ours**. Today this is
`Tracker:` in `## Plot Config`, read by `tracker_raw` / `tracker_scheme` /
`tracker_base_url`.

| property | today | note |
|---|---|---|
| `scheme` | `plot` \| `jira` \| `github-issues` \| `linear` | `plot` = no inbox at all |
| `baseUrl` | second token of `Tracker:` | `''` for a bare `jira`; never composed |
| `scope` | **per-arm, undeclared** | see below — the one real gap |

**It is independent of `Git host`, and that is load-bearing:** a Bitbucket repo
tracking in Jira is the normal enterprise case, so the connector dispatches on
`scheme`, never on the git host.

**`scheme: plot` means there is no tracker to connect to.** *Plans in this repo
ARE the tracker.* The connector is never built and the monitor never runs — the
default case costs nothing, and every other scheme is the *addition* of an inbox
to a system that works without one.

#### `IssueTrackerConnector` — the one place a tracker's shape is known

`plot-host.sh`'s `issue-list` and `issue-view`, plus the Jira helpers
(`jira_curl`, `jira_check`, `jira_require_config`). Its whole contract:

1. **Two ops, both read-only.** There is no `issue-create`, `issue-close` or
   `issue-comment`, and there must not be.
2. **One vocabulary out, whatever answered.** Both arms emit the same JSON and
   the same exit codes — *"a consumer that already maps 4 to `unsupported` and
   anything else to `failed` must not need a second table."* Nothing above the
   connector learns which tracker replied.
3. **Three outcomes, never collapsed:** answered / cannot-be-asked (exit 4) /
   failed.
4. **It composes no address it was not given.** `''` is a real value.
5. **A scheme with no arm must exit 4, not fall through.** Today `linear` falls
   through to the git-host arm, so a Linear-tracking GitHub repo silently lists
   *GitHub* issues. The connector is the layer that must refuse a scheme it
   cannot serve.

**Where a new tracker is added, and the only place.** Adding one means one arm
here — nothing above it changes, which is the test of whether this boundary is
real.

#### `IssueTrackerMonitor` — when, how often, and what matches

`refreshIssues` plus the shared PR gate. This is the collaborator your question
names, and it owns four decisions the other two must not make:

**1. Cadence, on a shared gate.** It rides `prNextAt` rather than opening a
second timer — *"the issue lookup cannot become a second cadence quietly
spending the host budget the gate exists to ration."* Sequential, not
concurrent, *"because two calls at one instant is what a rate limit counts."*
A rate limit on either pushes the shared gate out, **extend-only**.

**2. Independent failure.** It runs *after* and *outside* `refreshPrs`, because
*"a tracker outage must not blank the PR map, and a PR failure must not retract
the inbox."* Two sources, one gate, separate failure domains.

**3. The filter.** One set difference, recomputed every pass:

```
inbox = open(tracker) − referenced(every plan file)
```

with the completeness gate: **if `referenced` cannot be computed, nothing is
reported at all** — not the unfiltered list (which surfaces planned issues), not
an empty one (which claims the inbox is clear).

**4. Degrade, never refuse.** It is a read controller: a failure keeps the last
good list and marks it stale. The write controllers beside it do the opposite.

#### What this means for the three collaborators

The split holds and gains a fourth role, unbuilt:

| collaborator | inbound | outbound |
|---|---|---|
| `IssueTracker` | scheme, scope | **project/board to write into** — undeclared |
| `IssueTrackerConnector` | `issue-list`, `issue-view` | **`issue-create`, `issue-close`** — do not exist |
| `IssueTrackerMonitor` | polls the inbox | — |
| **`IssueTrackerWriter`** | — | **unbuilt**: mints feature and epic tickets, closes them |

The writer is the collaborator the workflow implies and the codebase lacks. It
is deliberately a **fourth** rather than an extension of the connector, for the
reason this document keeps finding: reads degrade, writes refuse. A connector
that both polls an inbox and creates tickets would have two failure policies in
one place, and the read policy is *keep the last good answer* — precisely wrong
for a write that must never happen twice.

**Its hardest problem is idempotency, and Plot already has the pattern.** A
feature ticket must be created once per plan, and re-running approval must not
mint a second one. That is what `→ #N` annotation does for PRs: **the plan file
records the identity of what was created**, so the second run finds it rather
than repeating the act. The same field shape (`Issue: PROJ-123`) is already
parsed — today it is only ever written by a human.

### The two ops, both read-only

| op | cost | when |
|---|---|---|
| `issue-list` | one call, on the PR timer | the inbox; bodies omitted |
| `issue-view <n>` | one call per click | one body, for the row's create actions |

`issue-view` fetches a body **only when a human clicks**, because a body is the
problem statement handed to `/plot-idea` and is worthless until someone acts.
That split — a cheap list on a timer, an expensive detail on demand — is the
same shape Build needs (§6) and the reason Issue is the template.

**There is no `issue-create`, `issue-close`, or `issue-comment`, and there must
not be.** Per CLAUDE.md: *"a plan referencing an issue is Plot's record, not the
tracker's."*

### Askability is a separate field from the answer

`IssueAnswer` — the shape this design generalizes to every entity:

| value | means |
|---|---|
| `answered` | the host replied; an empty list honestly means none are unplanned |
| `unsupported` | this host has no issue listing (Bitbucket) — nothing missing, nothing broken |
| `failed` | the question was asked and did not come back |

> *COLLAPSING ANY TWO REBUILDS `an-outage-is-not-an-answer`. An empty list is a
> claim about the tracker; a failed lookup is the absence of one, and a board
> that renders the second as the first tells a reader their inbox is clear using
> data it never received.*

`unsupported` renders **no section at all** rather than an empty one — an empty
inbox on Bitbucket would imply an empty tracker.

### How the read controller behaves

`refreshIssues` in `fleet.ts`, and it already does everything the reactive
section asks of a controller. Worth stating explicitly, because it is the
reference implementation:

- **Rides the PR timer** (`prNextAt`) — *"it asks the same host at the same
  cadence and its cost belongs to the same budget."* One gate, not two.
- **Keeps the last good list on failure.** `entry.issues` is untouched when the
  fetch fails — *"a row vanishing on a fetch error looks like someone planned
  the issue."*
- **Pushes the shared backoff out, extend-only.** A rate limit here moves
  `prNextAt`, so the PR fetch does not immediately re-spend an exhausted budget.
  It never pulls the gate in: a longer backoff another fetch set is a floor the
  host named.
- **Survives a malformed line.** One unparseable row is discarded; the rest
  stand, and the lookup is not called failed.
- **Refuses to answer when the filter cannot be computed.** If the plans cannot
  be read, `referencedIssues` returns null and the whole answer becomes
  `failed` — because the unfiltered list would surface planned issues, and an
  empty one would claim the inbox is clear. *Neither is known*, so neither is
  said.

That last point is the completeness gate from the reactive section, already
implemented, in the one place it was needed first.

### The controllers

Four, and they divide by what they are for rather than by what they touch.

| controller | kind | cadence | on failure |
|---|---|---|---|
| `refreshIssues` | read | PR timer (60 s × host cost) | keep last good list, mark stale |
| `referencedIssues` (fleet) | read — the filter | per refresh | `null` → the whole answer is `failed` |
| `referencedIssues` (idea) | **write precondition** | per click | `null` → **refuse the write** |
| `handleIdea` / `handleStory` | write | per click | refuse, naming which of four reasons |

#### Read and write controllers fail in opposite directions

`referencedIssues` exists **twice**, and it is not duplication to remove. Same
question, opposite failure direction, and the code argues it:

> *There it filters a list on a timer; here it is a PRECONDITION on a write. […]
> reporting an unfiltered list is a display error that a refresh corrects, while
> spawning an agent on an unchecked precondition writes a plan file nobody asked
> for.*

So a read controller degrades — last good value, marked stale — and a write
controller refuses. That is the general rule for every entity in this document,
and Issue is where it is already implemented.

The write side has a second job the read side does not: a second click on a row
the board has not yet refreshed away would start a second `/plot-idea` for an
issue that already has a plan, and **two plans answering one signal is worse
than the stale row that prompted them.**

#### What must be monitored, and at what price

Four sources, three of which the board already watches:

| source | what it yields | cost | cadence |
|---|---|---|---|
| the tracker (`issue-list`) | open issues | 1 host call | PR timer, shared gate |
| the plan estate (`plot-plan-meta.sh`) | every `Issue:` reference | 1 parser run, 132 ms / 59 plans | per refresh |
| the tracker (`issue-view`) | one body | 1 host call | **per click only** |
| the agent's own output | did the click's agent finish? | local state file | per poll |

Two properties of this set are worth stating because they are choices:

**The plan estate is read WHOLE, not from the pulse.** `referencedIssues` walks
every plan file rather than `pulse.plans`, and the reason is a measured trap:

> *The pulse carries active plans plus a rolling 24 hours of delivered ones […]
> A plan delivered last week is still the decision that was made about its
> issue, and reading the pulse would drop it from this set and put the issue
> back on the board a day later, under a heading that says nobody has decided
> about it.*

**The reference has to outlive the branch.** That is the sharpest illustration
of the entity's whole shape: what removes an Issue from the inbox is a decision,
and decisions do not expire on a 24-hour window.

**The issue poll rides the PR gate rather than opening its own.** Same host,
same budget, one cadence — and a rate limit on either pushes the shared gate
out, extend-only. A second independent timer would spend an exhausted budget to
be refused again.

#### How the issues are filtered

One set difference, recomputed every pass, with a refusal built in:

```
inbox = open(tracker) − referenced(every plan file)
```

- **`open`** is the tracker's own answer. On GitHub it is `gh issue list`, not
  `gh api /issues` — *"on GitHub every PR IS an issue"*, so the REST endpoint
  would deliver every open PR as an unplanned signal. The subcommand filters
  them out, and the code notes the trap *"is invisible while it works."*
- **`referenced`** is every `Issue:` value any plan carries, GitHub `#N` and
  Jira `PROJ-123` alike.
- **If `referenced` cannot be computed, nothing is reported.** Not the
  unfiltered list (which would surface planned issues), not an empty one (which
  would claim the inbox is clear). `issueAnswer: 'failed'` — *neither is known,
  so neither is said.* This is the completeness gate, already built.

No sorting, no ranking, no relevance scoring. The one question is *is this worth
a plan?*, and that is a judgement the reader makes from the title.

#### How different trackers are handled

The adapter is the only place that knows, and it **dispatches on `Tracker:`,
never on the git host**:

| `Tracker:` | how issues are read | note |
|---|---|---|
| `plot` (or absent) | — | *plans in this repo ARE the tracker*; there is no inbox |
| `github-issues` | `gh issue list` / `gh issue view` | ids are numbers |
| `jira` | REST `search/jql` + `issue/<key>` | ids are **keys** (`PROJ-123`) |
| `linear` | **nothing** — see below | config accepts it; no arm exists |
| Bitbucket as git host | — | `bb` has no issue listing → exit 4 → `unsupported` |

**`linear` is declared and unimplemented.** `plot-config.sh` documents
`Tracker: plot | jira | github-issues | linear`, and `plot-host.sh` contains the
string `linear` **zero times** (verified 2026-08-28). `tracker_scheme` returns
`linear`, no arm matches it, and the request falls through to the git-host arm —
so a Linear-tracking GitHub repo would silently list GitHub issues instead, and a
Linear-tracking Bitbucket repo would exit 4 and report `unsupported`. Neither
is an honest answer to *"list my Linear issues"*.

This is the same absent-is-not-false failure the entity is otherwise careful
about, one layer up: **the config advertises a capability the adapter does not
have.** Either the arm is built, or `linear` leaves the documented values, or
`tracker_scheme` refuses a scheme it has no arm for with the exit code that
already means *this cannot be asked*. The third is the cheapest and is probably
right — an explicit `unsupported` is what every other unaskable case returns.

Three things make the implemented arms work, and each is a decision:

**Dispatch on the tracker, not the host.** *"A Bitbucket repo tracking in Jira
is the normal enterprise case, so the git host is irrelevant here."* The two
questions are independent and the config keys are separate (`Git host`,
`Tracker`).

**One vocabulary out, whatever answered.** Both arms emit the same JSON shape
and the same exit codes — *"a consumer that already maps 4 to `unsupported` and
anything else to `failed` must not need a second table."* The board never learns
which tracker replied.

**The URL is composed only where its shape is known.** `Tracker: jira <url>`
carries the base as its second token; `tracker_base_url` returns `""` for a bare
`jira`, and an empty URL renders as plain text. Plot composes no address it was
not given.

**`Tracker: plot` is the case that needs no controller at all.** The default —
*plans in this repo ARE the tracker* — has no external inbox, so the whole
read path is inert and the board shows no issue section. Every other tracker
is the *addition* of an inbox to a system that works without one, which is why
`unsupported` renders nothing rather than an empty list.

#### The gap, restated as a controller

The four controllers above are all **inbox-side**: they answer *what has nobody
decided about?* Nothing answers the inverse — *which plan answers `PROJ-123`?* —
because `meta.issues` is consumed as set membership and discarded (gap 3). That
is not a missing fetch but a missing controller: the same parser run that builds
`referenced` already holds the plan-to-issue mapping and throws away everything
but the keys.

---

#### Why three and not one

Each owns a decision the others must not make, and each has a different reason
to change:

| collaborator | changes when | must not decide |
|---|---|---|
| `IssueTracker` | a repo is configured | how to ask, or how often |
| `IssueTrackerConnector` | a tracker is added or its API moves | when to ask, or what is unplanned |
| `IssueTrackerMonitor` | the cost or cadence changes | a tracker's URL shape or auth |

The measured argument for the split is `linear`: a value the **declaration**
accepts and the **connector** cannot serve. With the two collapsed, that
mismatch has nowhere to be caught. With them separate, the connector's exit 4 is
exactly where it belongs.

---

## 9. Fleet control

#### Fleet control for Issue — what each consumer needs

Two consumers, one derivation. The board has it; the command line does not.

##### Today: total asymmetry

| capability | board | master agent (CLI) |
|---|---|---|
| the inbox (open − referenced) | `/api/board` → `issues[]` | **nothing** |
| whether the tracker answered | `issueAnswer` | **nothing** |
| the failure text | `issueError` | **nothing** |
| create a plan from an issue | `POST /api/idea` | `/plot-idea` by hand |
| create a story from an issue | `POST /api/story` | `/story-tracking` by hand |
| raw tracker read | — | `plot-host.sh issue-list` |

Verified 2026-08-28: **no script in `skills/plot/scripts/` mentions issues at
all** — not `plot-context.sh`, not `plot-fleet-scan.sh`. The only CLI access is
the raw adapter, with no filter, no plan-estate subtraction, and no answer-state
vocabulary above it.

**So a master agent asking *"what is unplanned?"* with the board closed must
re-implement `refreshIssues` in shell.** That is precisely the failure the story
names: *"a hand-written `for` loop over worktrees, rewritten from scratch
perhaps a dozen times in one session, each time slightly differently."* The
inbox is the same shape of question, one derivation away from a script that does
not exist.

##### Query — one script, both consumers

```
plot-issue-scan.sh [--json] [--limit N]
```

The Issue counterpart to `plot-fleet-scan.sh`, and it must be the **same
derivation the board runs**, not a second implementation:

```
inbox = open(tracker) − referenced(every plan file)
```

Its output carries what the answer means, never just the rows:

| field | why |
|---|---|
| `answer` | `answered` · `unsupported` · `failed` — the three, never collapsed |
| `error` | the host's own words when `failed` |
| `issues[]` | id, title, url, createdAt, kind |
| `total` | what the tracker reported **before** the limit |
| `shown` | what this answer contains — so *50 of 400* is expressible |
| `posture` | `plot` or `jira`, since it changes what the inbox means |

**`total` beside `shown` is what closes gap 2.** The board needs it as much as
the CLI does; today neither can express truncation because the count is lost at
the fetch.

##### Monitor — the board's cadence, unchanged

`refreshIssues` on the shared PR gate is right and this design does not move it.
What it should gain is what the scan gains:

- **the pre-limit total**, so the board can render *showing 50 of 400*
- **`kind`**, fetched in the call already being made
- **the epic's children** as the scope where a release-matched epic exists

**No new timer.** A second cadence spending the same host budget is the failure
the shared gate exists to prevent, and it applies to any new issue capability as
firmly as it applied to the first.

**The CLI has no monitor**, deliberately. A master agent asks when it wants to
know; a background poll from the command line would compete with the board for
the same budget while nobody was reading it — the coupling the story's job 4 is
about.

##### Status — what a master agent reports about issues

Job 5 is *what do I show the operator?*, and the board is the surface. What the
CLI needs is the **one-line answer** a supervisor puts in a status update:

```
inbox: 3 unplanned (of 12 open) · jira PROJ · answered
inbox: unavailable — jira: 401 Unauthorized
inbox: none — this host has no issue listing
```

Three shapes for the three answers, and the middle one is the point: **an
unavailable inbox must never render as an empty one.** That is
`an-outage-is-not-an-answer` in the place a supervisor is most likely to
paraphrase it away.

##### What the master agent must NOT get

- **A write path of its own.** Creating a plan or story from an issue already
  has two entrances — the board's routes and the skills — and both spawn agents
  through the configured commands. A third would be a second implementation of
  a write.
- **A cached inbox.** The scan is stateless like its fleet sibling: asked, then
  discarded. An inbox held between invocations is a record of what *was*
  unplanned, and plans land while nobody is looking.
- **Its own tracker credentials.** Everything goes through `plot-host.sh`, which
  is the one place a host is spoken to.

##### The one capability neither consumer has

**Plan → Issue.** Both can answer *which issues are unplanned*; neither can
answer *which plan answers `PROJ-123`* (gap 3). The same parser run that builds
`referenced` already holds the mapping and discards everything but the keys.

Under `Tracker: jira` this is not a convenience but the primary direction: the
ticket is what a client, a PM and a standup name, and the plan estate knows the
answer while nothing surfaces it. It is one field on `PlanMetaSchema` and one
link on the row — no fetch, no new host call.

## 9b. Views

One domain object, several renderings. Each is derived at the boundary
(`toIssueRow(issue, now)`) and holds no authority — §3's rule, applied.

### What exists today: one view

**A row in WAITING ON YOU**, gated on `issueAnswer === 'answered'`:

```
key === 'waiting-on-you' && fleet.issueAnswer === 'answered'
```

It renders id, title, age and a `⋯` menu, and it is placed in the section that
means *a person owes this something* — correct, because an unplanned issue is
waiting on a human decision and on nothing else.

**And the guard hides a failure.** When `issueAnswer` is `failed`, no issue rows
render and **nothing says why**. The section shows its branch rows and looks
complete, so an unavailable inbox is indistinguishable from an empty one — the
exact confusion this entity is scrupulous about everywhere else, in the one
place a reader actually looks. `issueError` is carried in the payload and
rendered nowhere.

### The views this design needs

| view | where | shows | why |
|---|---|---|---|
| **inbox row** | WAITING ON YOU | id · title · age · actions | exists |
| **answer state** | the section header | *unavailable* · *50 of 400* · *none* | **missing** — the failure above |
| **plan backlink** | plan / branch row | *answers `PROJ-123`* → link | **missing** — gap 3 |
| **sprint footprint** | sprint card | the epic, and its ticket count | **missing** — posture 2 |
| **detail** | on demand | the body, from `issue-view` | exists, behind *Create plan* |

#### The answer state belongs in the header, not in a row

Three states, three renderings, and none of them is an absent row:

| `issueAnswer` | header reads |
|---|---|
| `answered` | *3 unplanned* — or *3 unplanned of 50 shown, 400 open* when truncated |
| `failed` | ***inbox unavailable*** — with `issueError`'s own words on hover |
| `unsupported` | nothing at all — no count, no row, no empty state |

`unsupported` renders nothing because an empty inbox on Bitbucket would claim an
empty tracker. `failed` must render *something*, because silence there is a
claim too — the claim that there is nothing to see.

This is the same three-way split the payload already carries and the view
already flattens to two.

#### The backlink is a view on Plan, not on Issue

*Which plan answers `PROJ-123`?* renders on the **plan row**, not in the inbox —
by the time it is answerable the issue has left the inbox by definition.

That is why gap 3 reads as a missing *view* as much as a missing field: the
data is one parser run away, and the place it belongs is a row that already
exists.

Under `Tracker: jira` it stops being a convenience. The ticket is what a client
and a standup name, so a board that cannot answer *which plan is that* is
missing its primary index.

#### The sprint footprint is posture 2's view

Where a sprint declares a release and an epic exists, the sprint card shows the
epic and what it holds — *`PROJ-100` · 7 feature tickets*. It is the publishing
posture made visible: what the client can currently see.

Where no epic exists — the majority — it renders nothing, on the same rule
`unsupported` follows.

### What must not become a view

- **No issue detail panel.** The body is fetched per click for an agent to
  read, not for a human to browse. A tracker's own UI does that better, and
  `Open on host` is one click away.
- **No status, assignee or label chips.** Not in the domain object (§3), so not
  in a view — a view that renders what the model refuses would need its own
  fetch and would age into the same lie.
- **No inbox sorting or grouping controls.** The order is *newest first* and the
  filter is *unplanned*; a control implying Plot ranks relevance would promise a
  judgement it declines to make.

### One rendering rule, from §3

**A view may present what the model holds; it may not add to it.** `ageMinutes`
is a presentation of `createdAt` and belongs to the view; a rendered `#226`
belongs to the view; the identity does not. Every view listed here derives from
the five fields and the answer state, and none needs a field the domain object
does not already justify.


## 10. Setup

#### Setting an `IssueTracker` up — what `/plot-board-setup` must do

The skill already asks the tracker question, and asks it well. What follows
separates **what to keep unchanged** from **what the Issue design adds**.

##### Both keys default, and both defaults are what already happens

| key | default | means |
|---|---|---|
| `Issue tracker:` | **the git host** (`github`, or `bitbucket`) | ask the host you already talk to |
| `Tracker:` | **`plot`** | plans in this repo are the truth |

**Neither default is new behaviour — both name what runs today.** `Tracker`'s
absence already reads as `plot` (*"absent = same"*, in the config's own words),
and the connection default is equally real: verified 2026-08-28 on this repo,
where `Tracker` is unset, `tracker_scheme` returns `""`, no Jira arm matches,
and `issue-list` falls through to the git host and returns a GitHub issue,
exit 0.

So this is naming a behaviour rather than adding one, which is the cheapest kind
of config key: **a repo that declares nothing sees no change.**

The pair of defaults lands a repo in posture 1 with an inbox — *MD files are the
truth, and the git host's issues are the signals nobody has planned yet*. That
is the right zero-config state: the board's inbox works out of the box on GitHub
without anyone declaring anything, and no ticket is ever written until a repo
asks for it.

**It also retires `github-issues`.** That value belongs to the posture key's old
vocabulary, where one key answered both questions. With the connection defaulting
to the git host, the implemented arms are `github` and `bitbucket` — the same two
`plot-host.sh` dispatches on — and `github-issues` was the connection wearing the
posture key's name.

**Bitbucket's default is `unsupported`, not empty.** `bb` has no issue listing,
so the default connection there answers exit 4 and the board renders no inbox
section — which is already the behaviour and already correct. A default that
resolves to *cannot be asked* is still a default; it is not a failure.

##### The order: connection first, then posture

**The prerequisite dictates the sequence.** `Issue tracker:` must be settled
before `Tracker:` can be asked, because the answer to the first bounds the
answers available to the second:

```
1. Issue tracker: ─── absent ──────────►  Tracker: plot  (only valid answer)
   (connection)   └── jira ───────────►  Tracker: plot | jira  (a real choice)
                                              publish      project
```

So setup asks two questions in this order:

**1. "Does this repo speak to an issue tracker, and which?"** — a question about
*infrastructure*, answerable from evidence: a `ticket_prefix`, an existing Jira
config, the git host's own issues. This is where `scheme`, `baseUrl` and the
`4d` connector check belong.

**2. "Who owns the truth?"** — a question about *process*, which no probe can
answer. It is the same class as `Plan PRs` and `Hosts plans`: a team decision,
and one with visible consequences worth stating when asking:

> Jira is reachable. Where does the truth live?
> - **`Tracker: plot`** — plans in this repo are the record; Plot **publishes**
>   tickets to Jira so clients can see progress. Unlinked tickets arrive as new
>   client input.
> - **`Tracker: jira`** — Jira holds the record; plans and stories *are*
>   tickets, a sprint *is* an epic, and the MD files here are a projection
>   written when tickets update.

**Where the connection is absent, question 2 is not asked at all** — `plot` is
the only valid answer, and asking would imply a choice that does not exist.

##### Today's order is the reverse, and the fallback is wrong

The skill asks `Tracker:` in step 2 with no connection question anywhere, and
step 3 writes it with this warning:

> *"A `Tracker: jira` or `Tracker: linear` is recorded but unread: the board's
> inbox will show nothing until a backend for that tracker lands."*

**That is now false for Jira.** The backend landed: `plot-host.sh` dispatches on
`tracker_scheme` with a full Jira arm — `jira_curl`, a JQL search, `issue/<key>`
— and the skill's stated derivation (*"if the confirmed `Tracker` value is
neither `github` nor `bitbucket`, warn"*) is precisely what that arm broke. The
warning is now correct only for `linear`, which is the value that genuinely has
no arm (4e).

So setup currently **discourages the posture this model needs**, telling a user
their inbox will be empty when it will work. Fixing the order and fixing this
warning are the same edit: once the connection is asked first and verified by
4d, the warning is replaced by a measurement — *Jira reached `PROJ`* or *no arm
for `linear`* — rather than a claim about what has landed.

##### What already works, and must not be disturbed

Three properties, each earned from a measured failure:

1. **Propose from named evidence, never from a default.** *"Found `QUACDS-*` in
   6 of 80 commit subjects → propose `Tracker: jira`."* The prefix is
   explicitly one-directional — Linear and GitHub issues carry prefixed keys
   too — so it proposes and a human confirms.
2. **Absence proves nothing.** An empty `ticket_prefix` *"is not evidence
   against a tracker"*, so setup **asks** and never proposes `Tracker: none`
   from silence.
3. **Unanswered means unwritten.** Under `PLOT_UNATTENDED` it refuses and
   discloses, and its reasoning is this entity's own: a wrong `Tracker: jira`
   *"answers with an empty list, and the board renders an empty inbox that reads
   as you have no tickets."*

##### The gap: nothing ever asks the tracker

**4a verifies the CLI is authenticated. 4b verifies the board serves. Neither
asks the tracker anything.**

So a repo passes every gate today with `Tracker: jira` pointing at a project
that holds none of its work — `bb`/`gh` authenticated, board serving, columns
populated from git — and the first symptom is an empty inbox weeks later,
indistinguishable from a genuinely empty backlog.

The skill already names that failure as the thing it exists to prevent, but only
for a **guessed** key. A **confirmed** key gets no verification at all, and a
human confirming `jira` is confirming the tracker's *name*, not that Plot can
reach the right project in it.

##### 4d — the connector answers

A new sub-gate, in the shape 4b already established: ask once, report three
outcomes, never round up.

```bash
../plot/scripts/plot-host.sh issue-list --limit 1
```

| result | report |
|---|---|
| exit 0, ≥1 issue | **verified** — name one, so the reader sees *which* tracker answered |
| exit 0, empty | **answered, empty** — the tracker has no open issues, or none in scope |
| exit 4 | **unsupported** — this host has no issue listing; not a failure |
| any other | **failed** — print the CLI's own words |

**Naming the issue it found is the point.** *"`PROJ-412: Reporting export
times out`"* proves the connector reached the **right** project; a bare *"3
issues"* does not, and neither does an exit code. This is the same standard 4b
holds the board to — it prints the payload rather than asserting a 200.

**`Tracker: plot` skips this entirely.** Plans in this repo *are* the tracker,
so there is no connector to verify and no inbox to render. Running the check
would be asking a question the configuration has already answered.

**Not a hard stop**, matching 4a: *"the board is useful with no host auth at
all."* An unreachable tracker degrades the inbox and nothing else.

**Verified 2026-08-28** — the check runs today and returns exactly the shape the
gate needs, on the first try, with no new script:

```
$ plot-host.sh issue-list --limit 1
{"number":333,"title":"Bitbucket: the PR-list join is silently partial past
 50 PRs per state","url":"…","createdAt":"2026-08-23T05:13:02Z"}
exit=0
```

One call, one JSON line, and a title a human can recognise. So 4d costs a
sub-step in the skill and nothing else — no helper, no new adapter op, and one
host request on a gate that already spends several.

##### 4e — the scheme has an arm

Before asking anything, check the declared scheme is one the connector serves.
`linear` is a documented `Tracker:` value that appears **zero times** in
`plot-host.sh`, so it falls through to the git-host arm — a Linear-tracking
GitHub repo silently lists *GitHub* issues.

Setup must not write a scheme the adapter cannot serve without saying so. The
cheapest fix is in the connector (exit 4 for an unserved scheme), and until it
lands, setup names it:

> `Tracker: linear` is accepted by the config and not implemented by the
> adapter — the inbox will show this repo's GitHub issues instead. Write it
> anyway, or choose another?

##### What setup does NOT need to ask

Two questions this design considered and retired, worth recording so they are
not re-raised:

- **`scope` (`mine` / `all`)** — retired. The epic scopes the inbox where one
  exists; every open ticket, newest first, where none does. Both cases are
  answered without a key.
- **The epic** — not a setup question. It is keyed by a release version, and a
  repo being adopted has no sprint declaring one yet. The epic is found or
  created when a sprint opens, which is where the key first exists.

##### The summary must say which inbox the board will show

Step 5 reports what was configured. For the tracker, *what* is not enough —
**which inbox** is the fact a reader can check:

> `Tracker: jira` · verified, reached `PROJ` · inbox shows every open ticket no
> plan references, newest first, capped at 50.

That sentence is falsifiable at a glance by someone who knows the project, which
is the only kind of verification that catches a right-shaped wrong answer.

## 11. Gaps

### Three genuine gaps

**1. A Jira key is a string; the board types it as a number.**

Verified 2026-08-28. `plot-plan-meta.sh` parses Jira-style `PROJ-123` into
`issues[]` when `Tracker:` names a non-GitHub tracker (#447), and `issue-list`
emits `number: .key` — a string — on the Jira arm. But the board declares:

```ts
IssueRowSchema.number: z.number()
referencedIssues(): Promise<Set<number> | null>
```

So on a Jira repo the filter is `Set<number>.has(string)`, which is **always
false**. Every Jira ticket would stay in the inbox forever, including ones a
plan already cites — and `IssueRowSchema` would reject the row outright.

The adapter and the parser both handle Jira; the board's contract is the layer
that did not follow. The identity type is `string | number`, or a normalized
string throughout.

**Not reachable in this repo** — `Tracker` is unset here, so the GitHub arm runs
and `number` is genuinely a number. It is reachable in any adopting repo that
sets `Tracker: jira` or `linear`, which is a configuration the adapter, the
parser and `plot-config.sh` all document as supported. Untested rather than
broken-in-practice, and worth a test before it is worth a fix.

**2. `ISSUE_LIMIT = 50` truncates silently.**

The list is capped, and a truncated list is presented identically to a complete
one. That is the same absent-is-not-false shape the entity is otherwise
scrupulous about: *"showing 50 of N"* is a different claim from *"there are
50"*. The Jira arm already notes it deliberately does not paginate because the
inbox is small by construction — which is a sound reason to cap and no reason at
all to hide the cap.

**3. The link is one-way: a plan cites a ticket, and nothing links back.**

Verified 2026-08-28. `plot-plan-meta.sh` emits `issues` — every `Issue:`
reference a plan makes — and the board reads it in exactly two places:

```ts
fleet.ts:1680   for (const n of meta.issues ?? []) referenced.add(n);
idea.ts:456     for (const n of meta.issues ?? []) referenced.add(n);
```

Both do the same thing: add the number to a set, use the set to answer *is this
ticket already planned?*, and discard it. **`issues` never reaches
`PlanMetaSchema`, and never reaches `Card`.**

So the relationship exists in one direction only:

| direction | works? | how |
|---|---|---|
| Issue → plan | yes | the ticket VANISHES from the inbox once cited |
| plan → Issue | **no** | nothing on the board says which ticket a plan answers |

The association is modelled purely as a *disappearance*. That is why the entity
reads as clean — the harder direction was never built, so it never went wrong.

**This is where `Tracker: jira` changes the stakes.** Under `Tracker: plot`
(the default — *"plans in this repo ARE the tracker"*) a backlink is a
convenience: the plan is already the record, and the issue number is
provenance. Under `Tracker: jira` the ticket is what the customer, the PM and
the standup all reference — and the board cannot say which plan answers
`PROJ-123`, nor offer a link to it. The plan estate knows; the board drops the
fact one layer before rendering.

Carrying it costs nothing new, and every piece already exists:

- the parser emits `issues`, GitHub `#N` and Jira `PROJ-123` alike (#447)
- both board call sites already parse it, then drop it
- `Tracker: jira https://acme.atlassian.net` carries the base URL as its second
  token, and `tracker_base_url` returns `""` for a bare `jira` — the same
  honest-absence shape `IssueRow.url` uses, where `''` renders as plain text
  rather than a fabricated link
- `IssueRow.url` already proves the board can hold a tracker link honestly

What is missing is `issues` on `PlanMetaSchema` and a link on the plan row —
**no new fetch, and no new URL knowledge.** The link a plan needs is the one
`issue-list` already returned for the same ticket before it left the inbox.

## 12. Invariants and open points

### Invariants

1. **Read-only, at the adapter.** No op writes to the tracker; a plan is Plot's
   record.
2. **An Issue leaves by being referenced**, never by being marked. The exit
   condition lives in the plan estate.
3. **Nothing that mirrors tracker state** joins the model — no labels, assignee,
   status, or priority.
4. **Askability is carried apart from the answer.** Three values, never
   collapsed.
5. **`null` age, never `0`.** Absent is not "just now".
6. **A failed lookup keeps the last good list** and says it is stale.
7. **A tracker link is carried verbatim or not at all.** `''` renders as plain
   text; Plot composes no tracker URL it was not given — the rule
   `AgentRow.pr.url` and `branchUrlBase` already follow.

### Open

- Does an aged, never-planned Issue deserve a signal? `ageMinutes` is carried
  and rendered, but nothing says *this has sat for three weeks*. That is
  arguably the inbox's whole point — and equally arguably the tracker's job.
- Should `issue-view` bodies be cached for the session? One click, one call
  today; a second click on the same ticket asks again.

---
