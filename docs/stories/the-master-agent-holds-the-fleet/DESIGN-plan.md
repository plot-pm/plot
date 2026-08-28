---
title: Plan — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Plan — domain object specification

Plot's solution-space artefact, and the entity everything else is derived
around.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [The fleet's domain entities](DESIGN-entities.md) ·
> [Issue](DESIGN-issue.md) · [Story](DESIGN-story.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Plan is](#1-what-a-plan-is) | solution space; why the file is the truth |
| 2 | [Posture](#2-posture) | what each `Tracker:` makes of a plan |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | seven plan states, and the workflow phases they map into |
| 5 | [Direction](#5-direction--inbound-outbound-and-neither) | inbound from a ticket · outbound unbuilt · neither, the majority |
| 6 | [Relations](#6-relations) | Story · Issue · Sprint · Wave · Branch · PR |
| 7 | [Actions](#7-actions) | lifecycle acts, and the quality acts beside them |
| 8 | [Scope](#8-scope) | which plans are shown, and the rolling window |
| 9 | [The collaborators](#9-the-collaborators) | the parser is the contract |
| 10 | [Fleet control](#10-fleet-control) | the one entity the CLI serves well |
| 11 | [Views](#11-views) | card · row · wave · plan head |
| 12 | [Setup](#12-setup) | what adoption declares |
| 13 | [The shape the format should take](#13-the-shape-the-format-should-take) | **designing forward** — front matter, and a Qualities section |
| 14 | [Gaps](#14-gaps) |  |
| 15 | [Invariants and open points](#15-invariants-and-open-points) |  |

---

## 1. What a Plan is



**A Plan describes the solution: how *this system* should change, in which
steps, and to what standard.**

The Story spec states the pair; this is its other half:

| | Story — problem space | **Plan — solution space** |
|---|---|---|
| asks | what problem, and how should software help | **how should this system change** |
| carries | the problem · desired qualities · workflow | **the change · the steps to land it · this solution's NFRs** |
| is true | independently of any system | **only of the system it targets** |
| outlives | implementations | **nothing — it ends at its release** |

The template enforces it: `Motivation` is one section, against `Design` plus
`Branches`. A plan has barely anywhere to put a problem, and that is deliberate.

### The file is the truth

**Manifesto Principle 1, and the whole of Plot rests on it.** A plan is a
markdown file on a branch; git is the source of truth. There is no plan
database, no plan API, and no cached plan state — every consumer re-parses the
file.

Two consequences that recur through this document:

- **The parser is the contract** (§8). `plot-plan-meta.sh` is the single
  definition of what a plan file means, and everything else — board, scan,
  gates, sprint tooling — reads plans through it.
- **A record is written when the fact becomes true.** `Approved:`, `Started:`,
  `Delivered:`, `Released:` are transition records, not decorations, and the
  scan reads its rolling window from `Delivered:` rather than from a directory.

### A plan is a unit of *one decision*

The Story spec's umbrella hierarchy places it: a well-described ticket holds
implement-as-described work; a **plan** holds a bounded, clearly-scoped piece;
a story holds what spans plans.

*"In repos where plot is the tracker, an implementation slice is a plan, full
stop."*

---

## 2. Posture



| posture | what a Plan is |
|---|---|
| **`plot`** (default) | **the record.** The plan file is the truth; the tracker, if any, sees a published summary |
| **`jira` leads** | a **projection** — the plan *is* a feature/bug/task ticket, and the MD file is written when the ticket updates |

**Posture 2's publishing act is already specified from the Issue side**: an
approved plan publishes a feature ticket carrying a content summary, at *Plans
approved* — *"only now, because the cut now holds."*

**Posture 3 inverts Principle 1 for the plan estate**, and unlike the Story's
case there is no narrative objection: a plan's content — motivation, design,
branches — maps onto a ticket reasonably well. What it loses is the *estate*:
the reconcile scan, the phase gate, the fleet's whole derivation read plan
files, and a projection means they read a copy whose freshness nothing
guarantees.

That is why posture 3 remains named-but-unbuilt in all three specs: it is not a
configuration, it is a second implementation of everything downstream of the
plan file.

---

## 3. The domain object



The normative shape, as `plot-plan-meta.sh` defines it. **This section describes
an existing contract rather than proposing one** — the parser is authoritative
and this is its reading.

### Identity

```
Plan.slug : string          the identity
Plan.file : path            where it currently lives
```

**Corrected 2026-08-28.** An earlier draft said the identity *is* the file
path, which described the implementation rather than the identity — and made
Plan and Story answer the same question differently for no reason.

**Both entities are identified by their slug.** What differs is how expensively
a slug resolves to a file:

| | slug → file | why |
|---|---|---|
| **Story** | `<slug>/STORY-<slug>.md` — **direct** | the slug IS the directory name |
| **Plan** | try `docs/plans/*<slug>.md`, then `active/<slug>.md`, then `delivered/<slug>.md` | the filename carries a **date** the slug does not know |

A plan's file is `YYYY-MM-DD-<slug>.md`, so the slug alone cannot name it — and
the two index directories may hold symlinks under the bare slug. Hence the
three-step precedence that `plot-approve.sh`, `plot-deliver.sh`,
`plot-dispatch.sh` and `plot-fleet-scan.sh` all share, *"so a slug resolves
identically whoever is asking."*

**The slug is unique in practice and unenforced.** Measured 2026-08-28: **158
plans, zero duplicate slugs.** Nothing checks it — two plans could take the same
slug on different dates, and the precedence above would silently resolve to
whichever the glob returned first. That has not happened here, and nothing
prevents it.

**`file` is carried rather than derived**, for the same reason `StoryCard.path`
is: the resolution encodes a convention, and rebuilding it in a consumer means
encoding that convention twice and letting the copies drift.

**The index directories are not identity.** A plan with no symlink is a valid
plan; `/plot-deliver` treats the index move as best-effort for exactly this
reason.

### Fields

**Validated field by field against the parser's output over all 158 plans,
2026-08-28.** The `have` column is how many plans carry a non-empty value —
which is the difference between a field that exists and one that is used.

| field | type | have | note |
|---|---|---|---|
| `file` | path | 158 | always present |
| `format` | `list` \| `frontmatter` | 158 | which spelling this file uses |
| `state` | state | 155 | written `Phase:`/`status:`; `state_raw` is lossy-mapped, not spelling — see below |
| `state_alt` / `state_alt_raw` | state | **0** | two states in one file — modelled, never seen |
| `type` | `feature`\|`bug`\|`docs`\|`infra` | 155 | |
| `title` | string | 157 | |
| `sprint` | slug | 71 | |
| `story` | slug | **121** | most plans belong to a story |
| `assignee` | handle | 50 | |
| `issues[]` | numbers | **4** | 2% — see §5 |
| `branches[]` | strings | 155 | **flattened from `waves[]`** — see below |
| `waves[]` | objects | 155 | **the only field that keeps the structure** |
| `prs[]` | numbers | 136 | **flattened past the branch it belongs to** |
| `malformed_prs[]` | strings | **0** | near-misses; none in this estate |
| `changelog[]` | strings | 91 | **what a plan changes** |
| `review` | normalized | 150 | `review_raw` is unconsumed — see below |
| `impl` | normalized | 150 | `impl_raw` is unconsumed — see below |
| `approved` | record | 141 | **prose today** — see below |
| `started` | record list | 129 | one entry per branch |
| `delivered` | record | 141 | |
| `released` | record | 110 | |
| `design` | record | **0** | the design state is never used (§4) |
| `long_wave_names[]` | strings | 5 | a report, not a refusal |

| `rounds` | number | 68 | **an optional KEY, not just an optional value** |

**`rounds` is the format's one optional key.** 27 fields appear in every plan's
output; `rounds` appears in 68 of 158 and is simply absent from the rest. Every
other field is always emitted, empty when unset.

That distinction matters to a consumer: `"rounds" in meta` and
`meta.rounds !== ""` are different tests, and only one of them works here.

**Corrections this validation forced — including one in my own method.**

*I first reported `rounds` as unparsed.* It is parsed, from `## Status`, front
matter, **and** the `CHALLENGE-THE-PLAN-METADATA` block. The error was in the
validator: it read the field list from **one** plan's output, so a key absent
from that sample looked absent from the format. **That is the same
absence-is-not-evidence mistake this document warns about**, made while
checking for it — the fix was to union the keys across all 158 rows.

*`review_raw` and `impl_raw` were omitted from the earlier table.* Both are
emitted beside their normalized twins, and the pairing is the point: the
normalized value is what a consumer branches on, the raw one is what the file
said, so a value the parser could not normalize is reportable rather than lost.

*`error` is not emitted*, and an earlier draft listed it.

*`slug` is not emitted*, which §13 argues it should be.

**Two fields are modelled and unused**, and they are different cases.
`phase_alt` at 0/158 is a *conflict* nobody has hit — good. `design_raw` at
0/158 is a *state* nobody has entered, though `/plot-implement` gates on it.

### Is there a Person, to model "approved by"?

**No, and the measurement says there should be.**

A transition record is a **string** — `approved_raw`, `started_raw`,
`delivered_raw`, `released_raw` — and the approver is whatever the second
comma-separated chunk happens to be. Measured across 141 approval records,
2026-08-28:

| the "who" | records |
|---|---|
| `Jan Wloka` | **84** |
| `jwloka` | **43** |
| *(no who at all)* | 4 |
| **a prose clause** | **4** |

Three defects, and each is the format's rather than an author's.

**One person, two spellings, 84 and 43.** Nothing can tell they are the same
approver, so *who approved most of this estate?* has no answer a machine can
give.

**Four records name something that is not a person.** *"do not fall back to a
second budget"*, *"kind is a server-set field"* — the field is free text
containing commas, so a comma-split lands mid-sentence and returns a clause. The
parser is not wrong; there is nothing to parse.

**And the same split repeats in `assignee`** — 30 `Jan Wloka`, 16 `jwloka`,
4 `eins78` — where the parser documents the field as *"github handle"* and it
holds a display name.

#### What a Person would be

**Not a new entity with a lifecycle — an identity.** The estate needs one thing:
that two spellings of one person resolve to one value.

| carries | why |
|---|---|
| a handle | the stable identifier (`jwloka`) |
| a display name | what a record shows (`Jan Wloka`) |

**Everything else belongs to the transition, not the person.** *When* and
*through which channel* are properties of the approval; the person is only the
`who`.

#### And the record should be structured

The deeper issue is that a transition is stored as prose:

```
- **Approved:** 2026-08-17, Jan Wloka, plan-PR #179 merged
```

Three facts in one string, comma-separated, where one of them may itself contain
commas. **That is why four records parse a clause as an approver.** A structured
record — date, who, channel — makes the failure impossible rather than rare:

```yaml
approved:
  date: 2026-08-17
  by: jwloka
  channel: pr
  detail: plan-PR #179 merged
```

**This is the front-matter migration's hardest part** (§14), and it is the one
that pays most: the transition records are the fields other tooling depends on
most, and they are the least parseable thing in the format.

#### What it does not need

- **No permissions.** Plot does not decide who *may* approve; the review channel
  does — a PR's own approval, a person in the session, a ballot tally.
- **No roster.** A person exists because a record names them; there is no list
  to maintain and no membership to check.
- **No cross-repo identity.** A handle is meaningful in the repo that uses it.

### The `_raw` fields: two different things, one suffix

**Settled 2026-08-28.** `_raw` is worn by two kinds of field that want opposite
treatment.

#### Kind 1 — normalization pairs, which methods replace

| raw | normalized | the raw adds |
|---|---|---|
| `review_raw` `in-session` | `review` `in-session` | **nothing — identical** |
| `impl_raw` `own branches` | `impl` `own-branches` | **spelling** |

**These exist because the parser emits a flat record.** It cannot offer
behaviour, so it ships both forms and lets each caller choose — which is exactly
the shape an object removes:

```ts
plan.impl              // 'own-branches' — the answer
plan.impl.asWritten    // 'own branches' — only if a caller ever needs it
```

**And nothing needs them.** Measured 2026-08-28: `review_raw` and `impl_raw`
have **no consumer at all**. (`state_raw` has one — `plot-reconcile-scan.sh:387`
packs it into a `|`-separated row and never reads it back — but it is a
different kind of field; see below.)

So they are not even a view concern; they are unconsumed. On the domain object
they become a method nobody has yet called, and the flat record's obligation to
guess disappears.

#### `state_raw` is a third kind — a lossy mapping, not a spelling

**It does not belong in Kind 1**, though this estate makes it look like it does.
Measured across all 158 plans, every pair is pure casing:

```
113  'Released'   → 'released'
 31  'Delivered'  → 'delivered'
  5  'Approved'   → 'approved'
  3  'Superseded' → 'superseded'
  3  'Draft'      → 'draft'
```

**But that is a property of the estate, not of the field.** The parser does two
things a casing normalizer does not:

**It maps synonyms onto one state.**

```awk
if (t == "ready-for-review" || t == "in-review") return "approved"
```

`ready-for-review` and `approved` are **different words for one state**, and the
parser's own docs draw the boundary carefully — those normalize, while a
neighbouring value deliberately does not, *"those are synonyms; this is not."*
So the raw can hold a word the normalized form has discarded.

**And it tokenizes.** It strips leading and trailing non-letters and scans for a
known word, so `Phase: Approved (pending CI)` yields `approved` — with the
qualifier surviving **only** in the raw.

**Which makes `state_raw` genuinely different from `impl_raw`.** `impl_raw`
differs by a hyphen and always will. `state_raw` can differ by **meaning**:
a synonym collapsed, or a qualifier dropped.

**It still should not be a field.** The same method shape covers it —
`plan.state` for the answer, `plan.state.asWritten` where a reader needs to see
that the file said *ready-for-review* — and the object is where the losslessness
is preserved rather than duplicated.

**But it must be dropped last, not first.** Kind 1 is safe to delete because
nothing consumes it and nothing is lost. Deleting `state_raw` while a plan
somewhere says `Phase: Approved (pending CI)` loses the qualifier, and the
estate that proves it safe today is one repo's.

#### Kind 2 — records with no normalized twin, which need parsing

`approved_raw`, `started_raw`, `delivered_raw`, `released_raw`, `design_raw`
have **no** normalized counterpart. `_raw` there does not mean *as written
beside a parsed form* — it means **nobody parsed this**:

```
approved_raw: "2026-08-20 by jwloka (in-session) — measured 43s serial
               against 25s parallel, and the parallel run exposed a real race"
```

Four facts in one string: a date, a person, a channel, and a rationale that
itself contains commas. **That is why four records parse a prose clause as an
approver** (Person, §3 above).

**These do not want a method — they want a structure**, and the suffix should
disappear with the parsing:

```ts
plan.approved        // { date, by: Person, channel, detail } | null
plan.approved.by     // a Person — the 84-vs-43 question, answerable
```

`started` is a **list** (one entry per branch), which is another thing a single
string cannot express and a structured record can.

#### Why the two kinds must not be treated alike

**Kind 1 is safe to drop; kind 2 is not.** Removing `impl_raw` loses a spelling
nobody reads. Removing `approved_raw` before there is a structured record to
replace it would lose the only copy of the approval — the fields other tooling
depends on most.

**So the order is: parse kind 2 first, delete kind 1, and keep `state_raw`
longest.** The front-matter migration (§14) is where kind 2 gets its structure;
kind 1 can go the moment the object exposes the normalized answer, which it does
by construction; and `state_raw` goes only once `plan.state.asWritten` exists to
hold what the normalization discards.

### Waves hold branches; branches hold PRs — and the record flattens both

**Yes, and the flat arrays are the clearest case for a domain object in this
document.**

The plan file states the containment in **one line per wave**:

```markdown
### Truth (Branch: feature/rows-mark-real-activity, PR: #182)
### Prominence (Branch: feature/activity-marker-glows, PR: #189)
```

The parser reads both halves of that pairing — and emits them into **three
separate arrays**:

```json
"branches": ["feature/activity-marker-glows", "feature/group-shows-inner-activity",
             "feature/rows-mark-real-activity", "feature/unpushed-work-shows-still"],
"prs":      [182, 189, 199, 201],
"waves":    [{"name":"Truth","branches":[{"branch":"feature/rows-mark-real-activity"}]}, …]
```

**`waves[]` is the only one that keeps the structure.** `branches[]` is the same
set flattened and sorted; `prs[]` is flattened further still, and **nothing in
it says which branch each PR belongs to.**

#### The flattening is actively misleading

`branches[]` is sorted **alphabetically**; `prs[]` is sorted **numerically**. So
`branches[0]` is `feature/activity-marker-glows` while `prs[0]` is `182` — which
belongs to `feature/rows-mark-real-activity`.

**Any consumer pairing them by index is wrong**, and the arrays give no hint of
it. The association exists in the file, is read by the parser, and is discarded
before anything downstream can use it.

#### What the object should hold

**One structure, and the flat views derived from it:**

```
Plan
 └── waves[]          Wave   name, verdict
      └── branches[]  Branch name, deferred, claimed
           └── prs[]  PR     number, repo
```

```ts
plan.branches          // flattened, for callers that want the set
plan.prs               // flattened, likewise
branch.prs             // the association the arrays lose
plan.wave(branch)      // the other direction
```

**The flat lists stay available and stop being the record.** They are what
`plot-impl-status.sh` and the delivery gate ask for — *"which branches, which
PRs"* — and deriving them from the tree costs nothing, while deriving the tree
from them is impossible.

#### Why it is emitted flat today

**Because the record is JSON lines from a shell parser.** `waves[]` already
proves the format can carry nesting, so this is not a limitation — it is that
`branches` and `prs` predate `waves` and were never re-expressed in terms of it.

The parser's own docs say the two dialects *"emit the same array"* deliberately,
so a migration reading one file at a time never sees a plan go empty. **That
compatibility argument holds for `branches[]`; it never applied to `prs[]`**,
which is flattened past the point where either dialect could reconstruct it.

#### The one-wave-one-branch model makes this worse, not better

The settled model is *plan → \* wave → **1** branch* — so in the intended shape
each wave holds exactly one branch and one PR, and `branches[]` and `prs[]`
would be parallel by construction.

**They are not, because 8 waves hold several branches** (§6). So the flattening
is only safe under a model the estate violates — and it is exactly the plans
that violate it whose arrays are most misleading.

### Three parser rules worth lifting

These are decisions, not implementation details, and they generalize:

**1. A citation is not a claim.** A backticked branch name outside a list item —
mid-sentence, in a blockquote, on a wrapped line — claims nothing. *"Plans name
each other branches to declare dependencies, and doing so must not claim
them."*

**2. A near-miss is reported, never dropped.** `malformed_prs` carries `→#NNN`
(no space) verbatim, because *"no annotation is a claim the sweep acts on, so a
typo that reads as absence sends a human to add an annotation already
present."*

**3. Absent contributes nothing — not `""`, not `0`.** The rule `Issue:` and
`prs` both follow, and the one this whole design keeps rediscovering.

### Fields deliberately excluded

| excluded | why |
|---|---|
| a slug field | derived from the filename; a second copy would drift |
| plan → story back-reference | the plan declares `Story:`; the story does not list plans |
| branch state | git's, read per pulse — a plan says which branches, never how they are doing |
| progress % | a plan's progress is its waves' verdicts, derived |

---

## 4. Lifecycle



### Seven states, five on the path and two terminal

**Corrected twice, 2026-08-28.** An earlier draft listed the parser's seven
values against CLAUDE.md's four and called the difference a defect. A second
draft split them into "phases" and "terminal outcomes" — two kinds of thing.
**Both were over-modelled: they are simply states.**

A plan is a state machine with seven states. Five have outgoing transitions;
two do not. That is an ordinary property of a state machine, not a type
distinction.

```
draft ──► design ──► approved ──► delivered ──► released
  │          │           │
  ▼          ▼           ▼
rejected  rejected   superseded
```

| state | outgoing transitions | means |
|---|---|---|
| `draft` | approve · reject | written, not yet agreed |
| `design` | approve · reject | a spike still answering whether the approach works |
| `approved` | deliver · supersede | agreed; implementation may start |
| `delivered` | release | every non-deferred branch merged |
| `released` | — | shipped under a version |
| `rejected` | — | **terminal** |
| `superseded` | — | **terminal** — overtaken by another plan |

#### Phases belong to the workflow; states belong to the plan

**The two words have different subjects**, and conflating them is what made
`superseded` look anomalous:

| | **phase** | **state** |
|---|---|---|
| whose | **the workflow's** | **the plan's** |
| what | a stretch of process a team moves through | one value on one artefact |
| how many at once | many plans share a phase | one plan, one state |
| named by | Discovery · Design · Development · Testing · Released | draft · design · approved · delivered · released · rejected · superseded |
| rendered as | **the board's columns** | a plan's `Phase:` field |

The agentic workflow — Discovery → Design → Development → Testing → Released —
is the process the *team* runs. The board's columns render it, which is why
they are a partition and why several plan states fall into one column.

**A plan does not have a phase. It has a state — and the WORKFLOW maps states
onto phases.**

The direction matters and an earlier draft had it backwards ("its state places
it in a phase", as though the plan did the placing). **The plan knows nothing
about phases.** It carries a state; the workflow owns a many-to-one mapping from
states to its own phases, and the board renders that mapping as columns:

```
plan state            workflow phase        (the workflow's mapping, not the plan's)
  draft ─────────┐
  design ────────┼──► Discovery / Design
  approved ──────────► Development
  delivered ─────────► Testing
  released ──────────► Released
  rejected ──────┐
  superseded ────┴──► (none — the plan left the process)
```

**This is what keeps the domain object clean.** If a plan placed itself, the
object would need to know Discovery from Development — a rendering concern, and
exactly what the entities doc forbids putting on a domain object: *"`isApproved`
is a fact; 'show it in Development' is the board's mapping."*

This is also why `superseded` never fitted. It is a plan state with **no
workflow phase** — a superseded plan is not somewhere in the process, it left
it. Asking which column it belongs to has no answer, and the board's own
schema says so: *"plans that never appear on the board (rejected / superseded /
unknown / legacy plans)."*

**The field is named `Phase:` after the workflow's vocabulary**, applied to the
plan. It stays named that — it is the format's established spelling, and
renaming a parsed field would break every plan in every adopting repo — but the
name is borrowed from the wrong subject, and that borrowing is the whole source
of the confusion these three drafts worked through.

**The word in the file is `Phase:`; the thing it holds is a state; and the
workflow — not the plan — maps that state onto a phase.**

### What the estate actually holds

Measured across 158 files 2026-08-28:

| state | count | |
|---|---|---|
| `released` | 113 | |
| `delivered` | 31 | |
| `approved` | 5 | |
| `superseded` | 3 | terminal |
| `draft` | 3 | |
| `design` | **0** | declared, never used |
| `rejected` | **0** | declared, never used |
| *(no `Phase:`)* | 3 | not plans — decision logs, worker reports |

**Two states are reachable in the tooling and unreached in the estate.**
`design` is gated on by `/plot-implement` and parsed as `design_raw`; `rejected`
is a documented terminal state. Neither has ever been used here.

That is worth knowing rather than fixing: a state machine may legitimately
carry states a given estate has not needed. What it does mean is that both are
**untested transitions** — and `delivered → released` was in exactly that
condition until recently, when it turned out that a phase flip without the
`Delivered:` record made a plan invisible to the scan.

**And `superseded` is used but undocumented.** CLAUDE.md names four states, so a
contributor has no vocabulary for a plan that was overtaken — the value is being
applied from the parser rather than from the documentation.

### How a plan knows its state

**It reads it off itself.** No comparison, no other artefact, no derivation —
`plot-plan-meta.sh:363`:

```awk
if (fm_status != "" || fm_phase != "") {
  praw     = (fm_status != "") ? fm_status : fm_phase
  palt_raw = (fm_status != "" && fm_phase != "") ? fm_phase : ""
}
```

Front matter `status:` first, `phase:` second, the `## Status` list third. The
state is **written in the file**, and reading it is a lookup.

**That is the sharpest contrast in this whole design**, and it is worth putting
beside its neighbours:

| entity | how it knows its state | what it needs |
|---|---|---|
| **Plan** | **reads it off itself** | the file alone |
| **Branch** | compares a ref to the default branch | **two git refs** |
| **Issue** | compares the tracker's answer to the plan estate | **two systems** |
| **Agent** | compares a pid, an exit code and a tree | **three readings** |
| **Story** | reads it off itself (`status:`) | the file alone |

**Plan and Story are the only two entities whose state is a stated fact rather
than a derived relation** — and both for the same reason: they are artefacts
Plot writes, so Plot records what it did to them. Everything else is an
observation of something Plot does not own.

That is also why the Issue spec could refuse a `state` field while this one
carries `phase`: an issue's state is a property of a *pair*, a plan's is a
property of *itself*.

**The cost of a stated state is that it can be wrong.** A ref cannot lie about
whether it is merged; a file can say `Approved` when nobody approved it. Which
is precisely why the transitions are gated and why `plot-phase-gate.sh` reads
the plan from `origin/<main>` rather than the working tree — *"an approval
nobody else can see is not one."*

**And it is why the transition records exist.** `Approved:`, `Started:`,
`Delivered:`, `Released:` are the evidence beside the claim: the state says
*where*, the record says *when, by whom, and through which channel*. A state
without its record is the shape that has bitten this repo twice — a phase flip
with no `Delivered:` makes a plan invisible to the scan's window.

### Two states in one file is a modelled condition

`phase_alt` exists because a file can carry both front-matter `status:` and a
`## Status` `Phase:`. The parser reports both rather than picking — an
ambiguity surfaced, not resolved. A plan in that condition has no single state,
and the parser declines to invent one.

### The transitions are gates

| transition | gate |
|---|---|
| Draft → Approved | a reviewed plan, through its declared `Review:` channel |
| Approved → *started* | staleness preflight; branch claimed by ref push |
| → Delivered | **every non-deferred branch merged** |
| → Released | the sprint gate, then a tag containing the merge commit |

**And one is enforced as a hook rather than prose**: `plot-phase-gate.sh` blocks
implementation commits while the governing plan is Draft — reading the plan from
`origin/<main>`, never the working tree, because *"an approval nobody else can
see is not one."*

---

## 5. Direction — inbound, outbound, and neither



A plan can originate from a ticket, publish one, or exist without either. The
rule the other specs state applies here unchanged: **direction is a property of
the individual plan, not of plans in general.**

| direction | act | mechanism | status |
|---|---|---|---|
| **inbound** | a ticket becomes a plan | *Create plan* on an issue row → `/plot-idea` | **built** |
| **outbound** | a plan publishes a feature ticket | posture 2, at *Plans approved* | **unbuilt** |
| *(neither)* | a person writes a plan | `/plot-idea <slug>: <title>` | **built, and the majority** |

**Both directions were specified from the Issue side and never from this one.**
The feature ticket appears in the Issue spec as *"the outbound plan case"*, and
*Create plan* appears there as an issue-row action. Neither was stated here,
where the plan is the subject — the same displacement the Story spec had before
its three create-acts were separated.

### Inbound — a ticket becomes a plan

*Create plan* is the board's most-used write action, and it is unconditional
across every issue kind (Issue §7): an epic or a story may still deserve a plan
directly, and it is the fallback where `kind` is empty.

**What arrives is a problem statement, not a plan.** The issue body is handed to
`/plot-idea`, which produces a **Draft** — the ceremony questions, the branches,
the design are all still to be answered. So the inbound direction supplies
*motivation*, and the solution space remains to be written.

**The plan records the origin** as `Issue: #N`, which is what removes the ticket
from the inbox. That record is the only trace of the direction: a plan written
by hand and a plan created from a ticket are otherwise identical files.

### Outbound — a plan publishes a feature ticket

**Unbuilt.** Under `Tracker: plot` with an issue tracker, an approved plan
publishes a feature/bug/task ticket carrying a content summary, so a client can
see what is being built.

**The timing is the design** and it is already argued in the Issue spec: the
ticket is written at *Plans approved*, *"only now, because the cut now holds."*
A ticket written at Draft would name a plan whose branches may still be
re-sliced — so this is the tracker-side twin of the `Approved:` record, written
when the fact becomes true.

**What it publishes is the changelog, not the plan.** `changelog[]` is the one
parsed field that says *what a plan changes* — which is precisely what a client
needs and what `Design` and `Branches` are not. The plan stays the truth; the
ticket is a view.

**It must be idempotent**, recording the ticket id where a re-run finds it. The
pattern is `→ #N`, and the field already exists: `Issue:` is parsed as a list,
so a plan can carry both the issue it answers and the ticket it published —
though nothing today distinguishes the two.

**That is the one modelling question this direction raises.** An inbound
`Issue: #226` and an outbound `Issue: PROJ-45` would sit in the same list
meaning opposite things: *this plan answers that signal* versus *this plan
published that view*. Distinguishing them needs either a second field or the
provenance rule the Issue spec proposes — Plot knows its own by having recorded
the id.

### Neither — and it is the majority

Measured 2026-08-28: **4 of 158 plans carry an `Issue:` line — 2%.** This repo
runs `Tracker: plot` with no publishing, so 154 plans were written by a person
deciding a piece of work was bounded enough to plan, with no ticket at either
end.

**That is the default case and must stay cheap.** A plan needs no ticket in
either direction; both relations are optional, and the estate demonstrates it at
scale.

---

## 6. Relations



The Plan is the hub: every other entity relates to it, and most relate *through*
it.

| relation | direction | mechanism | state |
|---|---|---|---|
| Plan → **Story** | plan declares | `Story: <slug>` | **built** |
| Plan → **Issue** | plan declares | `Issue: #N` | **built, one-way** (Issue §13 gap 3) |
| Plan → **Sprint** | plan declares | `Sprint: <slug>` | **built** |
| Plan → **Wave** | contains | `## Waves` headings | **built** |
| Wave → **Branch** | contains | `Branch:` in a heading | **built, 1:1 intended** |
| Branch → **PR** | annotation | `→ #N` | **built** |
| Plan → **Release** | record | `Released:` + git tag | **built** |

**Every one of these is declared by the plan and derived by everyone else.**
That is the estate's organizing choice: a sprint does not list its plans, a
story does not list its plans, a release does not list its plans — they are all
recomputed by reading every plan file.

**The cost is a full-estate parse**, and it is measured: 132 ms for 59 plans in
one batched invocation. The benefit is that no copy can drift, which is the
lesson this repo has learned repeatedly and expensively.

**One wave, one branch** is the model settled 2026-08-21 — *plan → \* wave →
1 branch* — and the estate disagrees: 49 waves hold one branch, 8 hold more, 7
of those 8 already complete. `unsliced-wave` is the reported defect.

---

## 7. Actions



Eight acts in two kinds. **Seven are lifecycle acts**, each a spoke command
that moves the plan or its branches; **one is a quality act** that changes the
plan's content and not its state.

| action | kind | command | what it writes |
|---|---|---|---|
| **Create** | lifecycle | `/plot-idea` | the plan file, Draft, with ceremony answers |
| **Challenge** | **quality** | `challenge-the-plan` | **open questions woven in — no state change** |
| **Approve** | lifecycle | `/plot-approve` → `plot-approve.sh` | state flip, `Approved:`, holds cleared, PR merged |
| **Implement** | lifecycle | `/plot-implement` | branch claimed, brief written, `Started:` |
| **Dispatch** | lifecycle | `/plot-dispatch` | worktree + worker per eligible branch |
| **Deliver** | lifecycle | `/plot-deliver` → `plot-deliver.sh` | state flip, `Delivered:`, index moved |
| **Release** | lifecycle | `/plot-release` | tag, `Released:`, sprint gate |
| **Reslice** | lifecycle | `/plot-reslice` | rewrites `## Branches` only, after a person confirms |

**Reslice is the odd lifecycle act**: it changes the plan's shape rather than
its state, and needs a person's confirmation because naming waves is judgement.
It is still a lifecycle act — the branches it writes are what the fleet
dispatches against.

### Two kinds of action: lifecycle and quality

The table above is **lifecycle** actions — each writes a state transition or
creates an artefact, and each has a gate. There is a second kind that does
neither:

| | **lifecycle** | **quality** |
|---|---|---|
| examples | approve · deliver · release | **challenge-the-plan** · plan-challenger |
| writes | a state transition | **the artefact refines itself** |
| gated | yes — a guardrail refuses | **no** — approval never requires it |
| leaves | `Approved:`, `Delivered:` | an `## Open Questions` section |
| skippable | no | **yes, and often is** |

**A challenged plan is still Draft.** The interrogation changes the plan's
*content*, never its state — which is precisely why it is a Companion in
CLAUDE.md's own table rather than a spoke: *"usable standalone, not a plot
spoke."* The taxonomy already knew.

`challenge-the-plan` interviews across technical, domain, UX, non-functional and
trade-off dimensions, weaves the answers **back into the plan's narrative**
(*"no meta-commentary… expand existing sections as if always there"*), and
tracks deferrals in `## Open Questions`. The plan comes out better and
identically staged.

**Its slot is named and it is advisory:** *"after `/plot-idea` refinement,
before `/plot-approve` — wrong directions get caught while they still cost
markdown edits, not code."*

**Why it is not a gate.** Making it one would be defensible — it catches
mistakes at their cheapest — but it would also make every plan pay an interview,
and the estate's 158 plans include many whose design fits in a paragraph. The
manifesto's ceremony-matched-to-change principle applies: **the challenge is
offered, and a person decides the plan needs it.**

**The one thing the quality kind leaves behind is `## Open Questions`, and
nothing reads it.** Measured 2026-08-28: **45 of 158 plans carry the section**
— over a quarter of the estate — and it appears in no script, no scan, no
schema and no view.

So a plan approved with three unresolved questions is indistinguishable, to
every consumer, from one with none. The section exists precisely to survive
into approval and be answered later, and nothing surfaces it — not the board's
plan card, not `plot-plan-meta.sh`, not the reconcile sweep.

That is the largest unread field in the plan format, and it is a **view** gap
before it is a parser one: the questions are already written down and already
in the file every consumer opens.

**The mechanical halves are scripts; the judgement stays in the skills** —
Principle 3, and the split is explicit: `plot-approve.sh` merges, flips, fills,
clears and pushes, while the skill decides whether a draft is *ready*.

**Two entrances, one implementation.** The board's Approve button and
`/plot-approve` both call `plot-approve.sh`, so a project declaring an
`Approve command` cannot get a second path to the same outcome.

**Idempotency is the pattern.** `plot-approve.sh` and `plot-deliver.sh` both
perform an irreversible write partway through, so *"re-running is the repair"* —
every step tests the source it would have written, never a progress file.

---

## 8. Scope



**Which plans are shown depends on who is asking**, and the two answers differ
deliberately:

| consumer | scope | why |
|---|---|---|
| the board | every plan file | a board shows the estate |
| the fleet scan | active plans **+ a rolling window of delivered ones** | a delivered plan's branches stop being actionable |
| `referencedIssues` | **every plan file, always** | a decision does not expire (Issue §8) |

**The rolling window reads `Delivered:`**, not the directory — which is why a
phase flip without the record makes a plan invisible to the scan. Measured
2026-08-20: zero plans reported for a plan in exactly that state.

**A file with no `Phase:` is not a plan.** `docs/plans/` also holds decision
logs and worker reports; three such files exist here, and every consumer applies
the same rule — *the parser's own answer decides*.

---

## 9. The collaborators



**One, and it is the contract**: `plot-plan-meta.sh`.

Unlike Issue (four collaborators, because it is foreign) and Story (none,
because it is local prose), Plan has exactly one — a parser that every other
component reads plans through.

| what reads plans | through the parser? |
|---|---|
| the board | yes |
| `plot-fleet-scan.sh` | yes |
| `plot-reconcile-scan.sh` | yes |
| `plot-approve.sh` / `plot-deliver.sh` | yes |
| `plot-sprint-release.sh` / `-candidates.sh` | yes |
| `plot-phase-gate.sh` | yes |

**That is the strongest single design decision in the estate.** One definition
of what a plan file means, tested by `pnpm run test:reconcile`, so a format
change is one edit and one test suite rather than a hunt through eight readers.

**No monitor, no connector, no writer** — the file is local and the writes are
the spoke commands'.

---

## 10. Fleet control



**Plan is the one entity the CLI serves better than the board**, which inverts
the pattern Issue and Story both show.

| capability | CLI | board |
|---|---|---|
| parse a plan | `plot-plan-meta.sh` | via the same |
| which plan governs this branch | `plot-context.sh` | — |
| wave/claim state | `plot-fleet-scan.sh` | consumes its pulse |
| drift across the estate | `plot-reconcile-scan.sh` | — |
| merge order + collisions | `plot-merge-queue.sh` | — |
| deliverable plans | `plot-impl-status.sh` | — |
| sprint contents | `plot-sprint-release.sh` | consumes |

**A master agent is well equipped here and poorly equipped for Issue and
Story.** That asymmetry is not arbitrary: plans are what the fleet acts on, so
the tooling grew where the acting happens.

---

## 11. Views



| view | where | shows |
|---|---|---|
| **card** | a board column | title, type, waves, PRs, sprint, story |
| **plan head** | grouped fleet rows | the plan above its waves, with actions |
| **wave row** | fleet | one wave, its verdict, its branches |
| **branch row** | fleet | state, worker, PR, age |
| **plan page** | `/plan/<file>` | the file, rendered |

**The plan appears in more views than any other entity**, because it is what
every section groups by. `PlanActions` opens on `canOpen`, not on `willAct` —
an action that will be refused still renders, so the refusal can name itself.

---

## 12. Setup



Plans are what `/plot-init` exists to establish, and its keys are the
best-covered of any entity:

| key | default |
|---|---|
| `Plan directory` | `docs/plans/` |
| `Active index` / `Delivered index` | `docs/plans/active/`, `delivered/` |
| `Plan template` | the shipped template |
| `Branch prefixes` | `idea/, feature/, bug/, docs/, infra/` |
| `Plan PRs` | `optional` |
| `Hosts plans` | `yes` |
| `Implementation home` | `this repo` |

**Adoption is additive and never rewrites plans.** `/plot-board-setup` reports
which files parse as `format: none` and why — *"report only. Never rewrite the
user's plans."*

---

## 13. The shape the format should take


Designing forward rather than describing. Two changes, and the first is
**smaller than it looks** because the parser has already made it.

### The `## Status` section holds no status

```markdown
## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** …   **Issue:** …   **Story:** …
- **Review:** …   **Impl:** …    **Rounds:** …
<!-- Approved: / Started: / Delivered: / Released: -->
```

**It is frontmatter written as a list**, and the naming is wrong in both
directions: the section is called *Status* and contains no `Status:` field,
while the field is called *Phase* and holds a state (§4).

Three different lifetimes are also mixed in one block:

| kind | fields | changes |
|---|---|---|
| **identity & shape** | title, type | once, at creation |
| **placement** | sprint, story, issue, assignee | when the plan is filed |
| **ceremony** | review, impl | once, at creation |
| **transitions** | approved, started, delivered, released | **accumulate over the plan's life** |

The transition records are the odd ones: they are *appended* as things happen,
and they are the fields other tooling depends on most — the scan's rolling
window reads `Delivered:`, and a phase flip without the record makes a plan
invisible.

### The parser has already moved; the template has not

**Verified 2026-08-28** at `plot-plan-meta.sh:363`:

```awk
praw = (fm_status != "") ? fm_status : fm_phase
```

**Front matter `status:` is the PRIMARY spelling**, and `phase:` is the
fallback. Eleven other fields already have a front-matter spelling too —
`title`, `type`, `sprint`, `story`, `issue`, `assignee`, `review`, `impl`,
`approved`, `delivered`, `released`, `design`.

So a plan written as front matter parses **today**, unchanged:

```markdown
---
title: A worker registers where the board reads
status: draft
type: bug
story: plot-agent-identity
review: pr
impl: own-branches
---
```

**Demonstrated, not inferred.** That exact file, parsed 2026-08-28:

```json
{ "format": "frontmatter", "phase": "draft", "type": "bug",
  "title": "A frontmatter plan parses today",
  "story": "plot-agent-identity", "sprint": "2026-W35-example",
  "issues": [226, 228], "review": "pr", "impl": "own-branches" }
```

Every field resolved, including the issue list, and the parser labels the
spelling `frontmatter` in its own output — so it is a first-class format rather
than a tolerated one.

**The format the future wants already exists and is already preferred.** What
is behind is the template, which teaches the list spelling, and 158 plans
written from it.

**This also settles the field name.** An earlier sketch proposed `state:` to
match §4's vocabulary. That would be a **third** spelling for one value, and
worse than either: `status:` is canonical, primary and tested. **The field is
`status:` and the thing it holds is a state** — the same reconciliation §4
makes for `Phase:`.

### A plan should emit its own slug

**Yes — and its absence is the same defect `StoryCard.path` was created to
prevent.**

`plot-plan-meta.sh` emits `sprint` and `story` — **other entities' slugs** — and
not the plan's own. So every consumer that needs one strips the date prefix
itself, re-encoding `YYYY-MM-DD-<slug>.md` at each site. The schema already
states why that is wrong, about the story:

> *"A story slug is a directory name AND a filename component, so rebuilding it
> client-side means encoding that convention twice and letting the copies
> drift."*

**Story learned this lesson and Plan did not**, which is the asymmetry that
makes the two specs read differently. The fix is one field:

```
slug   the plan's own slug, from the filename with the date prefix removed
```

Derived, never declared — a `slug:` field a human could write would be a second
source of truth against the filename, and they would disagree the first time a
file was renamed.

#### Why it has none: an omission, not a decision

**There is no design reason.** The asymmetry is the tell — the parser emits
`sprint` and `story` as slugs, so slugs are clearly the right abstraction here;
a plan simply cannot name *itself* that way:

```
file:   docs/plans/2026-08-27-a-worker-registers-where-the-board-reads.md
slug:   ABSENT
sprint: 'the-board-tells-the-truth-in-every-section'   ← a slug
story:  'plot-board'                                    ← a slug
```

#### What the omission costs, measured

Every consumer strips the prefix itself. The clearest case is **two
byte-identical `planSlug` functions**, in `auto-deliver.ts:114` and
`auto-dispatch.ts:67`:

```ts
path.basename(file).replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/, '')
```

**And the duplication is deliberate**, argued in a comment:

> *A private twin rather than an import, deliberately kept byte-identical: the
> two modules are independent actors on the same clock, and a shared helper
> would make one able to break the other's slug resolution.*

**That reasoning is coherent and it is on the wrong axis.** It is correct *if*
slug resolution is a helper two modules call: isolate the actors, accept two
copies, neither can break the other.

But the slug is not a function — **it is a property of the plan.** Once the Plan
object carries it, there is nothing to import and nothing to isolate: both
actors read the same object's field, and the failure the comment guards against
cannot arise.

**So the duplication is not a mistake. It is the correct workaround for a
missing domain object** — and that makes it the strongest evidence in this
document for the four rules the entities doc states, because a careful author
reasoned their way to duplication rather than to the layer that removes the
need for it.

**It also makes the uniqueness gap visible.** §3 records that 158 plans have
zero duplicate slugs and nothing enforces it; a parser that emits the slug is
where a duplicate could be detected at all.

### Should a story know its member plans?

**No — and this is the one place the two entities should stay asymmetric.**

The pull is real: a story is an umbrella, and an umbrella that cannot name what
it covers feels incomplete. But the direction is a deliberate choice with a
measurement behind it.

**Deriving it is cheap.** Measured 2026-08-28: parsing **all 158 plans in one
batched invocation takes 166 ms** — against 4.0 s for one invocation per file,
which is the mistake to avoid rather than an argument against the derivation.
So *"which plans belong to this story"* is a group-by over a query the estate
already runs.

**Storing it is not cheap, and the cost is correctness rather than time.** A
`plans:` list in a story's front matter would go stale the moment a plan is
written, renamed, moved between stories, or superseded — and nothing would
detect the drift, because the story's copy would be the only place that claim
lives.

This estate has paid that bill repeatedly. **Every relation in Plot is declared
by the plan and derived by everyone else** (§6): a sprint does not list its
plans, a release does not list its plans, and neither does a story. The plan
declares `Sprint:`, `Story:`, `Issue:` — one writer, many readers.

**The derivation already exists, twice.** An earlier draft of this section said
it was derived nowhere; it is derived client-side in `Swimlanes.tsx:80` and in
`StoryModal.tsx`'s `plansInStory`, both as `cards.filter(c => c.story === slug)`.

| | today |
|---|---|
| Plan → Story | `Story: <slug>`, parsed, **rendered on the plan row** |
| Story → Plans | **derived in the browser, in two views; nowhere else** |

So the gap is the derivation's *reach*, not its absence: no script does it, so
a master agent asking *what does this story hold?* re-implements the filter.

Measured for this repo: `plot-board` holds 90 plans,
`the-board-is-blank-where-it-matters` 15, `plot-planning-model` 9,
`plot-gates` 6, and five stories hold none. **That table took one command and
appears in no view.**

So the answer to *"should a story know its member plans?"* is: **it should be
able to say, and it should not record.** The story spec's §13 already names the
missing view — a plans-per-story count on the story card — and this is the same
gap seen from the plan's side.

### What migration would actually cost

| step | cost |
|---|---|
| parser change | **none** — both spellings already read |
| template change | one file |
| new plans | free — they parse either way |
| 158 existing plans | **nothing required**; the list spelling stays supported |
| `plot-plan-meta.sh` tests | extend, do not replace |

**Nothing has to move at once**, which is the property that makes this
tractable: both spellings coexist by design, exactly as `## Branches` and
`## Waves` do — *"the parser reads both so a migration that moves files one at
a time never makes a plan silently empty."*

**One thing genuinely does not fit front matter:** the transition records
accumulate (`Started:` is one line per branch), and a YAML list of
`{date, who, branch}` objects is a poor fit for something a human appends to
mid-flight. A `## Transitions` section, or leaving those in the body while the
stable fields move up, is the open part of this design.

### `## Qualities` — the missing section

The Story spec's pair says a plan carries *"the non-functional requirements of
**this** solution"*. **The template has nowhere to put them.**

Measured: the template has `Motivation`, `Design`, `Branches`, `Changelog`,
`Notes` — so qualities land inside `Design` prose or as `Done when` assertions,
by improvisation.

```markdown
## Design
  how the system changes

## Qualities              ← proposed
  - the pulse spends no additional host call
  - the scan stays under 5 s on 90 branches
  - a failed fetch keeps the last good value

## Branches
  the steps to land it
```

**Why a section rather than folding into `Done when`.** They are different
claims: `Done when` says *this branch is finished*, and a quality says *the
solution must hold this property* — which outlives any one branch and is what a
reviewer challenges. A quality buried in design prose is not reviewable as a
list, and `challenge-the-plan`'s non-functional round has nothing to read.

**And it gives the challenge something to bite on.** The skill interrogates
security, performance and scalability today by inferring them from `Design`; a
named section is what turns that from extraction into review.

**It stays optional.** Most of this estate's 158 plans have no NFRs worth
stating, and a mandatory section would be filled with "n/a" — the failure mode
the manifesto's ceremony principle exists to avoid.

---

## 14. Gaps



| # | gap | reachable |
|---|---|---|
| 1 | **Outcomes are undocumented** — `superseded` is used by 3 plans and named nowhere in CLAUDE.md; `design` is a real phase the four-phase list omits | **now** |
| 2 | **Plan → Issue is one-way** — `issues[]` is parsed, consumed as a set membership test, and never surfaced | **now** (Issue §13) |
| 3 | **`unsliced-wave`** — 8 waves hold several branches against a 1:1 model | now, reported |
| 4 | **`docs` type unused** — 0 of 158; either it is dead or docs plans are being mistyped | cosmetic |
| 5 | **`plot-reap.sh` reads `mergedAt` via `gh` directly**, bypassing the host adapter | now |

**Gap 1 is documentation, not code.** The parser and the board are both right;
what is missing is that CLAUDE.md names four phases without naming the two
terminal **outcomes** a plan can end in, or the `design` phase between Draft and
Approved. A contributor has no vocabulary for a plan that was overtaken — and
three plans are in exactly that state.

---

## 15. Invariants and open points



### Invariants

1. **The file is the truth.** Every consumer re-parses; nothing caches plan
   state.
2. **The parser is the contract.** One definition, read by every component.
3. **A citation is not a claim.** A branch named in prose claims nothing.
4. **A near-miss is reported, never dropped.**
5. **Absent contributes nothing** — not `""`, not `0`.
6. **Transition records are load-bearing**, not provenance — the scan's window
   reads `Delivered:`.
7. **A file with no `Phase:` is not a plan.**
8. **The index is convenience**; a plan with no symlink is valid.
9. **Re-running a transition is the repair** — every step tests the source, not
   a progress file.
10. **A plan declares its relations; nothing lists its plans.**

### Open points

- **Should CLAUDE.md name the outcomes and `design`?** Four phases plus two
  terminal outcomes is the honest model; the current text implies the four are
  everything.
- **Is `design` premature?** Declared, gated on by `/plot-implement`, parsed as
  `design_raw`, and used by zero plans.
- **Is `docs` a dead type?** Zero of 158 plans use it.
- **Where do a plan's qualities go?** The template has no NFR section, so they
  land in `Design` or `Done when` by improvisation (Story §1).
- **Does the one-wave-one-branch model get enforced or relaxed?** Eight waves
  disagree with it and seven of those already shipped.
