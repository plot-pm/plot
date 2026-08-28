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
| 2 | [Posture](#2-posture) | **nothing** — a wave has no form outside the repo |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | a derived state, and the middle it does not cover |
| 5 | [Direction](#5-direction) | none, and it is the only entity with none |
| 6 | [Relations](#6-relations) | Plan · Branch · Worker |
| 7 | [Actions](#7-actions) | dispatch · reslice · ask |
| 8 | [Scope](#8-scope) | one wave, one branch — and the 32 that disagree |
| 9 | [The collaborators](#9-the-collaborators) | the scan derives; nothing stores |
| 10 | [Fleet control](#10-fleet-control) | the entity the fleet is built around |
| 11 | [Views](#11-views) | the wave row, and the two arms |
| 12 | [Setup](#12-setup) | no key, and none wanted |
| 13 | [Gaps](#13-gaps) |  |
| 14 | [Invariants and open points](#14-invariants-and-open-points) |  |

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

## 2. Posture


**No posture changes what a Wave is**, and that is worth stating rather than
omitting: a wave is the only entity here with **no representation outside the
repo at all**.

| posture | what a Wave is |
|---|---|
| `plot` | headings in a plan file |
| `plot` + a tracker | **unchanged** — nothing publishes a wave |
| `jira` leads | **unchanged** — see below |

**Under publishing, a wave is invisible to the client.** A sprint publishes an
epic and a plan publishes a feature ticket; a wave publishes nothing. The
client sees *what is being built*, never *in which order it is being proved* —
which is right, because the ordering is an engineering concern rather than a
commitment.

**Under `jira` leads it is the one thing that cannot project.** If the plan is a
ticket, its waves would have to be sub-tasks with an ordering constraint — and
a wave is not work, it is a *gate over* work. So posture 3 either loses the
ordering or reinvents it in a tracker that has no notion of *may not start
until*.

That is a sharper version of the Story spec's objection to posture 3: a story
loses its narrative, and a wave loses its **only reason to exist**.

---

## 3. The domain object


### Identity

```
Wave.id = plan.slug + '#' + wave.name        e.g. a-wave-is-a-thing#Sized
```

**The name alone is not an identity; the pair is.** `Counted` appears in 11
plans and means something different in each, so a wave is addressed as
`(plan, name)` — never by name alone.

**Verified 2026-08-28: 303 waves, 303 distinct pairs, zero collisions.**

**And nothing enforces it.** That is the same shape as the plan slug (158 files,
zero duplicates, no check) with one difference that makes Wave's case weaker: a
plan slug is a **filename**, so the filesystem enforces uniqueness by accident.
A wave name is a **heading**, and nothing stops a plan carrying `### Counted`
twice. The 303/303 result is authorial care, not a constraint.

**A collision would be worse here than for a plan**, because the pair is what
the fleet addresses. Two `Counted` waves in one plan would make `--next`, the
dispatcher and the board disagree about which one a verdict describes — and the
symptom would be a branch dispatched against the wrong gate rather than an
error.

**The default wave has an empty name**, so its id is `slug#`. Five plans carry
one, and by construction a plan can have at most one default wave — the
unnamed case is the *absence* of headings, not a heading with no text.

### The identity must be addressable, because a blocker is pointed at

**A wave's identity is not only a key — it is a target.** `blocked` means *an
earlier wave has not landed*, and the reader's next action is to go look at
that wave, so the verdict is useless unless the blocker can be reached.

**The board already implements this**, spelling the pair as a scoped selector
rather than a composite key — `marks.tsx`:

```js
`[data-wave-list="${plan}"] [data-wave-row="${wave}"]`
```

`data-wave-list` scopes to the plan; `data-wave-row` names the wave within it.
**That is `plan#name` in DOM form**, and it confirms the identity above: the one
place that has to *locate* a wave arrived at the same pair independently.

`blockedBy` carries the name and `Wave.section` carries which section it sits
in, so `BlockedByMark` unfolds that section before scrolling — a blocker in a
collapsed group is found rather than silently missed.

#### Two attributes, and the failure that costs

**A two-part anchor works only where both parts are present.** Measured earlier
in this repo: the blocked-wave jump broke because **only NOT STARTED carried the
`data-wave-list` wrapper** — the inner half was on every row, the outer half on
one section, so the selector matched nothing everywhere else.

**A single composite anchor cannot fail that way.** `data-wave-id="plan#name"`
has no outer half to forget: a row either carries the identity or it does not,
and the same string that identifies the wave in the payload addresses it in the
DOM.

**And it removes the escaping.** The scoped form needs `CSS.escape` twice
because a plan slug and a wave name are both interpolated into a selector; one
attribute needs it once, over a string the domain object already produced.

#### The empty-name case is where the pair strains

A wave with no branches has `branch: ''`, and `rowKey` is
`repo/branch/plan` — **it carries no wave component at all**. So the 11 empty
waves (§8) collapse to `repo//plan`, and two of them in one plan would share a
row key entirely.

**That is the argument for the composite id reaching the payload**, not just the
DOM: `rowKey` is what React keys on and what change-detection compares, and a
wave that cannot be told from its sibling is a row that flashes.

### Fields

**Measured across 303 waves in 155 plans, 2026-08-28.**

| field | type | note |
|---|---|---|
| `name` | string | `''` for the default wave — 5 of 303; unique **within its plan** |
| `plan` | Plan | the owner; the name means nothing without it |
| `branches[]` | Branch[] | **the wave OWNS these** — 1 in 271 of 303, see §8 |
| `index` | number | position among its plan's waves — **the ordering** |
| `nameIsLabel` | derived | replaces the plan's `long_wave_names[]` — see above |

**No verdict field.** The verdict is derived (§3), and storing it would be the
error the entities doc names: a derived relation cached where it can disagree
with its source.

### The wave owns its branches; the plan asks

**A branch belongs to a wave, and to a plan only through it.** The plan file
says so directly — a branch is named *inside* a wave's heading:

```markdown
### Truth (Branch: feature/rows-mark-real-activity, PR: #182)
```

There is no place in the format where a plan names a branch outside a wave. Even
the default wave is a wave: a plan listing branches without `### ` headings has
**one unnamed wave** holding them (§3), not a bare branch list.

**So `plan.branches` is a method, not a field:**

```ts
wave.branches      // the record — what this slice will build
plan.branches      // derived: waves.flatMap(w => w.branches)
```

**And the ownership is what makes the gate work.** A wave's verdict is computed
from *its own* branches against *prior waves'* branches — a question that cannot
be asked of a flat plan-level list at all, because the list has forgotten which
wave each belongs to.

**The Plan spec measures the cost** of the flat form: `branches[]` has no board
consumer (every one iterates `wave.branches`), and `prs[]` is flattened so far
that `plot-deliver.sh` re-queries the host to rebuild the pairing.

**This spec adds the reason.** Not merely *the flat array is lossy* — the
containment is **the domain's own shape**, stated by the file, relied on by the
gate, and flattened only in the record.

### A name is a label — and that judgement belongs to the wave

**`long_wave_names[]` is a Plan field holding a verdict about its Waves**, and
it should be a method on the wave that has the name:

```ts
wave.nameIsLabel        // false where the heading is a sentence
plan.longWaveNames      // derived: waves.filter(w => !w.nameIsLabel)
```

The rule itself is right — *"a wave name is a label (`Shaped`, `Gated`,
`Offered first`); a sentence-length heading is a plan-authoring mistake the
board can only render badly"* — and **reported, never refused.** 5 plans carry
one. The estate's vocabulary bears it out: `Implementation` 19, `Counted` 11,
`Named` 9, `Offered` 5, `Sized` 4 — one word, naming what the slice achieves.

#### It is the same flattening as `branches[]`, one level down

A per-wave property is **hoisted into a plan-level list**, losing which wave it
describes — exactly the shape the Plan spec identifies for `branches[]` and
`prs[]`.

**And it is worse than either**, because it is a **judgement rather than a
fact**. `branches[]` at least holds real values; this holds *the subset of names
that failed a threshold*. So the plan carries a verdict about its waves, and a
consumer asking *"is this wave's name a label?"* must search a list of strings
for a match.

**The one consumer proves the cost.** `plot-reconcile-scan.sh:1087` reads the
field and immediately re-pairs each name back to its file:

```jq
.long_wave_names[]? | [$f, .] | join("")
```

**It is reassembling the association the flattening removed** — the same
`plot-impl-status.sh` pattern the Plan spec measures for `prs[]`, at smaller
scale.

#### Why the judgement is the wave's, not the plan's

The threshold `LONG_WAVE_NAME_MAX` is *"set from the estate's longest legitimate
name"* — a property of **what a wave name is for**, not of any plan. A plan has
no opinion about name length; it merely contains waves that have names.

**And it makes the finding actionable.** Today the scan reports *this plan has a
long wave name*; a reader then opens the file and finds which. With the method,
the wave that is wrong is the thing that says so — and it already has an
identity to be named by (§3).

---

## 4. Lifecycle


**Corrected 2026-08-28.** An earlier draft said *"a wave has no lifecycle"* and
called the verdict a reading. That is too strong: **the verdict is what the
board tracks a wave's progress by** — `rows.tsx:1023` routes a wave into a
section by it, and `menus.tsx:1110` gates its actions on it. Functionally it is
the wave's state.

**What is true is narrower: a wave is never *written to*.** A Plan's state is
recorded in its file and changed by a spoke command; a wave's is **recomputed
every pulse**, and what looks like a transition is a branch elsewhere merging.

So it is a **derived state**, and the entities doc's rule places it exactly: a
value that depends on a pair belongs to the derivation rather than to the
object's stated fields — the same reason `FleetBranch.state` is a field on a
derivation while `Issue` carries none.

### The four words do not cover the middle

**Measured live 2026-08-28:**

| wave verdicts | | branch states | |
|---|---|---|---|
| `unapproved` | 40 | `merged` | 43 |
| `blocked` | 8 | `wip` | **5** |
| `eligible` | 5 | `open` | 5 |
| `complete` | 5 | `deferred` | 5 |

> **Corrected.** A first reading of this table used `--no-fetch` and reported
> **48 open, 0 merged**. The scan's own docs warn of exactly that: *"the fetch
> also PRUNES remote-tracking refs, so skipping it keeps whatever stale refs
> this checkout holds — a branch merged and deleted upstream may read `wip`
> rather than `merged`."* Three sampled `open` branches turned out to be PRs
> #490, #492 and #494, all merged in this session. The footer reports
> `merge_detect` so a consumer can tell; I passed the flag for speed and read
> the output as authoritative.

**There is no verdict for *in progress*.** A wave whose branch is claimed and
being worked still reads `eligible`, because eligibility asks *would a dispatch
take this* — not *has one already*. The five `wip` branches sit under waves that
call themselves startable.

**So the board tracks a wave's progress through three sources, not one:**

| what | from |
|---|---|
| may this start | the **wave's** verdict |
| is it under way | the **branch** — `claimed`, `wip`, `merged` |
| is anyone on it | the **agent** — running, stalled, finished |

That division is deliberate, and it is why the verdict is thin: a wave is a
**gate over work**, so its vocabulary is about the gate, and the work's own
progress belongs to the things doing it.

**The cost is that `eligible` means two things to a reader** — *nobody has
started this*, and *somebody has, and another dispatch would still be taken*.
The board disambiguates by rendering the branch beneath; the wave's own word
does not.

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

### It is derived, so it is a method rather than a field

Recomputed every pulse from three things: the plan's state, the prior waves'
branch states, and this wave's own. **Nothing about the wave itself changes**
when its verdict moves from `blocked` to `eligible` — a branch somewhere else
merged.

So on the domain object it is `wave.verdict(plan, priorWaves)` — a method over
the estate, never a value the parser could emit, because the parser reads a plan
file and cannot see git.

### `--loose` is the one relaxation, and it must be verified

*"A prior wave counts as satisfied when its branches carry **pushed** work, not
only merged work. Buys throughput, pays in rebase risk — the plan requires a
stated reason for using it."*

**And it is refused where it cannot be checked**: `loose_verifiable` gates on a
host CLI, because *"`--loose` promises the prior wave's PRs are green and ready,
which needs the host. Readiness must be VERIFIED, never assumed."*

A flag that would silently degrade to *assume ready* is instead refused.

---

## 5. Direction


**A wave has no direction**, and it is the only entity here with none.

| | |
|---|---|
| inbound | **impossible** — nothing outside the repo describes a wave |
| outbound | **nothing publishes one** (§2) |
| neither | **always** — a wave exists because a plan was sliced |

**A wave is created only by slicing**, never by conversion. `/plot-idea` writes
the headings, or `/plot-reslice` rewrites them; there is no ticket, no
discussion and no external artefact a wave can come from.

That follows from §2: an entity with no representation outside the repo cannot
have a direction, because direction is a statement about crossing that boundary.

---

## 6. Relations


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

## 7. Actions


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

## 8. Scope


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

## 9. The collaborators


**One, and it derives rather than stores:** `plot-fleet-scan.sh`.

It reads plans through `plot-plan-meta.sh`, asks git about each branch, and
emits a verdict per wave — *"stateless; re-derived from git refs every run."*

**No writer, no cache, no record.** The nearest thing to persistence is
`PLOT_TERMINAL_CACHE`, which caches *branch* answers and is checked against git
every pass.

---

## 10. Fleet control


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

## 11. Views


| view | shows |
|---|---|
| wave row | name, verdict, its branches |
| wave head | the plan above its waves, with actions |
| the pulse's summary | `waves=N eligible=N blocked=N` |

**Two render arms with opposite defaults** — grouped rows and ungrouped — which
has produced bugs of its own. A wave that renders in the wrong arm shows the
right verdict in the wrong place.

---

## 12. Setup


**No config key, and none is wanted.**

A wave is structure inside a plan file, so it inherits everything: `Plan
directory` locates the file, `Branch prefixes` decides what parses as a branch
name, and nothing else applies. There is no `Wave directory` to declare and no
wave-shaped behaviour to configure.

**The one thing adoption should know is the model** — *one wave, one branch* —
and that is documentation rather than configuration. A repo cannot opt out of
it; 21 waves here disagree with it and the scan reports them (§8).

---

## 13. Gaps


| # | gap | reachable |
|---|---|---|
| 1 | **9 prose headings parse as waves** — design sections under `## Branches`, vacuously `complete` | **now, measured** |
| 1b | **2 labelled waves lost their branches** — plausibly a reslice | now, measured |
| 2 | **21 waves hold several** — against the 1:1 model | now, reported |
| 3 | **Ordering is positional** — no `after:`, so reordering headings reorders the gate | now |
| 4 | Wave names are scoped to a plan but rendered bare | cosmetic |
| 5 | **Nothing enforces `plan#name` uniqueness** — 303/303 distinct today, by authorship rather than by a check | now |
| 6 | **The anchor is two attributes, not one** — a blocked-wave jump breaks wherever the outer `data-wave-list` is missing, as measured | now |
| 7 | **`rowKey` has no wave component** — the 11 empty waves collapse to `repo//plan` | now |

**Gap 1 is half-reported.** `long_wave_names` already flags the sentence-length
headings — it just flags them as *names too long to render*, not as *not a wave
at all*. Nothing catches gap 1b: `unsliced-wave` catches too many branches, and
nothing catches none.

---

## 14. Invariants and open points


### Invariants

1. **A wave is derived; it has no file and no record.**
2. **The verdict is a DERIVED state** — recomputed every pulse, never stored,
   and never covering *in progress*.
3. **`blocked` and `unapproved` never collapse** — one waits on work, the other
   on a decision.
4. **`eligible` is the only word that promises a dispatch agrees.**
5. **A wave is never dispatched; its branches are.**
6. **A wave's identity is `plan.slug#wave.name`** — the name alone is
   meaningless, and `Counted` appears in 11 plans.
7. **`--loose` is refused where it cannot be verified.**

### Open points

- **Should an empty wave be a finding?** 11 exist; 9 are prose headings the
  parser should arguably not read as waves at all, and 2 are labelled waves
  that lost their branches.
- **Should ordering be explicit?** Positional ordering is simple and reorders
  the gate when headings move.
- **Should the composite id reach the payload?** The DOM already needs it and
  builds it from two attributes; `rowKey` needs it and has none.
- **Is the 1:1 model enforced or relaxed?** 21 waves disagree and most already
  shipped.
