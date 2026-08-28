---
title: Slice — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Slice — domain object specification

A plan's unit of dispatch: one slice of the work, and the ordering between
slices.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [Entities](DESIGN-entities.md) · [Plan](DESIGN-plan.md) ·
> [Sprint](DESIGN-sprint.md) · [Story](DESIGN-story.md) · [Issue](DESIGN-issue.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Slice is](#1-what-a-slice-is) | the slice, and the ordering |
| 2 | [Posture](#2-posture) | **nothing** — a slice has no form outside the repo |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | a derived state, and the middle it does not cover |
| 5 | [Direction](#5-direction) | none, and it is the only entity with none |
| 6 | [Relations](#6-relations) | Plan · Branch · Worker |
| 7 | [Actions](#7-actions) | dispatch · reslice · ask |
| 8 | [Scope](#8-scope) | one slice, one branch — and the 32 that disagree |
| 9 | [The collaborators](#9-the-collaborators) | the scan derives; nothing stores |
| 10 | [Fleet control](#10-fleet-control) | the entity the fleet is built around |
| 11 | [Views](#11-views) | the slice row, and the two arms |
| 12 | [Setup](#12-setup) | no key, and none wanted |
| 13 | [Gaps](#13-gaps) |  |
| 14 | [Invariants and open points](#14-invariants-and-open-points) |  |

---

## 1. What a Slice is


**A Slice is one branch's worth of a plan's work, plus its place in an order.**

Two jobs in one entity, and the second is the reason it exists:

- **the piece** — a coherent part of the change, **exactly one branch**
- **the ordering** — a slice may not start until every prior slice has landed

**Without ordering there would be no Slice.** A plan with independent branches
needs no ordering at all; the entity earns its place the moment one piece must
prove something before the next is built.

### One branch, by definition — not by repair

**A slice holds exactly one branch.** That is not a constraint this spec hopes
for and measures violations of; it is what the word means. A plan section
naming three branches is **not a slice holding three** — it is a plan that has
not been sliced yet, and `/plot-reslice` is the act of slicing it.

**This entity was called a Wave until 2026-08-28, and the rename fixed a word
doing two jobs.** Measured across 158 plans and 303 sections: **271 held one
branch, 21 held several, 11 held none** (9 of those being prose headings the
parser reads as sections — a parser defect, unchanged by the rename). The 21
were counted as violations of a rule the estate kept trying to enforce:
`/plot-reslice` exists solely to repair them, and `plot-reconcile-scan.sh`
carries a counter named `unsliced_waves=` whose message reads *"a wave holds
one"*.

**The estate had already reached for this word and could not get to it.** This
spec's own opening read *"a Wave is one **slice** of a plan's work"* — a
sentence needed only because one word carried two concepts. Naming them apart
dissolves the violation rather than deciding it: **an unsliced plan is a shape,
not an error.**

### A Wave is now something else entirely

**A Slice is what one agent works on. A Wave is what the fleet lands together.**

| | Slice | Wave |
|---|---|---|
| holds | **exactly one branch** | **many slices** |
| scope | one plan | **the fleet — slices from several plans** |
| sized by | the work | **the agents available, bounded by what can land** |
| written | in the plan, as a section | **nowhere — formed at dispatch** |

**The two are not nested versions of one idea.** A slice is authored by a
person and lives in a plan file; a wave is assembled by the fleet at the moment
of dispatch and has no persisted form at all. **A slice belongs to exactly one
plan; a wave belongs to none.**

That distinction is not yet built. Today `plot-dispatch.sh:199` requires a plan
slug and computes ordering within one plan, so nothing forms a cross-plan
cohort. The machinery is split across two commands that do not know about each
other: `plot-fleet-scan.sh` computes which slices are **eligible** across all
plans, and `/plot-merge-queue` computes which finished branches can **land
together**. A wave is those two joined, bounded by `parallelAgents`.

**Which bound wins is an open question** (§14): the agent count is a ceiling,
but starting five agents whose work cannot land together is precisely the burst
`/plot-merge-queue` was written to predict.

### The ordering is a gate, not advice

*"A slice becomes eligible only once every non-deferred branch in every **prior**
slice is merged, so this never hands you work that builds on an unproven seam."*

That is what `--next` enforces, what the dispatcher honours, and what makes a
tracer bullet expressible: slice 1 proves the approach, slices 2..n build on it,
and nothing can start early by accident.

### It is derived, entirely

**A Slice has no file and no record.** It is the `### ` headings under
`## Branches` (or a `## Waves` section), read from a plan and joined against
git's answer about each branch. Nothing writes a slice's state anywhere.

That makes it the first entity here with **no persisted form at all** — Plan,
Story and Sprint are files; Issue and PR come from a host; Slice is computed.

---

## 2. Posture


**No posture changes what a Slice is**, and that is worth stating rather than
omitting: a slice is the only entity here with **no representation outside the
repo at all**.

| posture | what a Slice is |
|---|---|
| `plot` | headings in a plan file |
| `plot` + a tracker | **unchanged** — nothing publishes a slice |
| `jira` leads | **unchanged** — see below |

**Under publishing, a slice is invisible to the client.** A sprint publishes an
epic and a plan publishes a feature ticket; a slice publishes nothing. The
client sees *what is being built*, never *in which order it is being proved* —
which is right, because the ordering is an engineering concern rather than a
commitment.

**Under `jira` leads it is the one thing that cannot project.** If the plan is a
ticket, its slices would have to be sub-tasks with an ordering constraint — and
a slice is not work, it is a *gate over* work. So posture 3 either loses the
ordering or reinvents it in a tracker that has no notion of *may not start
until*.

That is a sharper version of the Story spec's objection to posture 3: a story
loses its narrative, and a slice loses its **only reason to exist**.

---

## 3. The domain object

> **Identity:** a **minted** — [three kinds](DESIGN-review.md#1-identity-three-kinds),
> and this one fails by *nobody minting*.
> **State:** **DERIVED** — [four sources](DESIGN-review.md#2-state-where-each-entitys-truth-lives),
> going wrong by *staleness*, so the derivation is **re-run every pulse** — a state is a claim about a moment.



### Identity

```
Slice.id = plan.slug + '#' + slice.name        e.g. a-slice-is-a-thing#Sized
```

**The name alone is not an identity; the pair is.** `Counted` appears in 11
plans and means something different in each, so a slice is addressed as
`(plan, name)` — never by name alone.

**Verified 2026-08-28: 303 slices, 303 distinct pairs, zero collisions.**

**And nothing enforces it.** That is the same shape as the plan slug (158 files,
zero duplicates, no check) with one difference that makes Slice's case weaker: a
plan slug is a **filename**, so the filesystem enforces uniqueness by accident.
A slice name is a **heading**, and nothing stops a plan carrying `### Counted`
twice. The 303/303 result is authorial care, not a constraint.

**A collision would be worse here than for a plan**, because the pair is what
the fleet addresses. Two `Counted` slices in one plan would make `--next`, the
dispatcher and the board disagree about which one a verdict describes — and the
symptom would be a branch dispatched against the wrong gate rather than an
error.

**The default slice has an empty name**, so its id is `slug#`. Five plans carry
one, and by construction a plan can have at most one default slice — the
unnamed case is the *absence* of headings, not a heading with no text.

### The identity must be addressable, because a blocker is pointed at

**A slice's identity is not only a key — it is a target.** `blocked` means *an
earlier slice has not landed*, and the reader's next action is to go look at
that slice, so the verdict is useless unless the blocker can be reached.

**The board already implements this**, spelling the pair as a scoped selector
rather than a composite key — `marks.tsx`:

```js
`[data-wave-list="${plan}"] [data-wave-row="${slice}"]`
```

`data-wave-list` scopes to the plan; `data-wave-row` names the slice within it.
**That is `plan#name` in DOM form**, and it confirms the identity above: the one
place that has to *locate* a slice arrived at the same pair independently.

`blockedBy` carries the name and `Slice.section` carries which section it sits
in, so `BlockedByMark` unfolds that section before scrolling — a blocker in a
collapsed group is found rather than silently missed.

#### Two attributes, and the failure that costs

**A two-part anchor works only where both parts are present.** Measured earlier
in this repo: the blocked-slice jump broke because **only NOT STARTED carried the
`data-wave-list` wrapper** — the inner half was on every row, the outer half on
one section, so the selector matched nothing everywhere else.

**A single composite anchor cannot fail that way.** `data-slice-id="plan#name"`
has no outer half to forget: a row either carries the identity or it does not,
and the same string that identifies the slice in the payload addresses it in the
DOM.

**And it removes the escaping.** The scoped form needs `CSS.escape` twice
because a plan slug and a slice name are both interpolated into a selector; one
attribute needs it once, over a string the domain object already produced.

#### The empty-name case is where the pair strains

A slice with no branches has `branch: ''`, and `rowKey` is
`repo/branch/plan` — **it carries no slice component at all**. So the 11 empty
slices (§8) collapse to `repo//plan`, and two of them in one plan would share a
row key entirely.

**That is the argument for the composite id reaching the payload**, not just the
DOM: `rowKey` is what React keys on and what change-detection compares, and a
slice that cannot be told from its sibling is a row that flashes.

### Fields

**Measured across 303 slices in 155 plans, 2026-08-28.**

| field | type | note |
|---|---|---|
| `name` | string | `''` for the default slice — 5 of 303; unique **within its plan** |
| `plan` | Plan | the owner; the name means nothing without it |
| `branches[]` | Branch[] | **the slice OWNS these** — 1 in 271 of 303, see §8 |
| `index` | number | position among its plan's slices — **the ordering** |
| `nameIsLabel` | derived | replaces the plan's `long_wave_names[]` — see above |

**No verdict field.** The verdict is derived (§3), and storing it would be the
error the entities doc names: a derived relation cached where it can disagree
with its source.

### The slice owns its branches; the plan asks

**A branch belongs to a slice, and to a plan only through it.** The plan file
says so directly — a branch is named *inside* a slice's heading:

```markdown
### Truth (Branch: feature/rows-mark-real-activity, PR: #182)
```

There is no place in the format where a plan names a branch outside a slice. Even
the default slice is a slice: a plan listing branches without `### ` headings has
**one unnamed slice** holding them (§3), not a bare branch list.

**So `plan.branches` is a method, not a field:**

```ts
slice.branches      // the record — what this slice will build
plan.branches      // derived: slices.flatMap(w => w.branches)
```

**And the ownership is what makes the gate work.** A slice's verdict is computed
from *its own* branches against *prior slices'* branches — a question that cannot
be asked of a flat plan-level list at all, because the list has forgotten which
slice each belongs to.

**The Plan spec measures the cost** of the flat form: `branches[]` has no board
consumer (every one iterates `slice.branches`), and `prs[]` is flattened so far
that `plot-deliver.sh` re-queries the host to rebuild the pairing.

**This spec adds the reason.** Not merely *the flat array is lossy* — the
containment is **the domain's own shape**, stated by the file, relied on by the
gate, and flattened only in the record.

### A name is a label — and that judgement belongs to the slice

**`long_wave_names[]` is a Plan field holding a verdict about its Slices**, and
it should be a method on the slice that has the name:

```ts
slice.nameIsLabel        // false where the heading is a sentence
plan.longSliceNames      // derived: slices.filter(w => !w.nameIsLabel)
```

The rule itself is right — *"a slice name is a label (`Shaped`, `Gated`,
`Offered first`); a sentence-length heading is a plan-authoring mistake the
board can only render badly"* — and **reported, never refused.** 5 plans carry
one. The estate's vocabulary bears it out: `Implementation` 19, `Counted` 11,
`Named` 9, `Offered` 5, `Sized` 4 — one word, naming what the slice achieves.

#### It is the same flattening as `branches[]`, one level down

A per-slice property is **hoisted into a plan-level list**, losing which slice it
describes — exactly the shape the Plan spec identifies for `branches[]` and
`prs[]`.

**And it is worse than either**, because it is a **judgement rather than a
fact**. `branches[]` at least holds real values; this holds *the subset of names
that failed a threshold*. So the plan carries a verdict about its slices, and a
consumer asking *"is this slice's name a label?"* must search a list of strings
for a match.

**The one consumer proves the cost.** `plot-reconcile-scan.sh:1087` reads the
field and immediately re-pairs each name back to its file:

```jq
.long_wave_names[]? | [$f, .] | join("")
```

**It is reassembling the association the flattening removed** — the same
`plot-impl-status.sh` pattern the Plan spec measures for `prs[]`, at smaller
scale.

#### Why the judgement is the slice's, not the plan's

The threshold `LONG_WAVE_NAME_MAX` is *"set from the estate's longest legitimate
name"* — a property of **what a slice name is for**, not of any plan. A plan has
no opinion about name length; it merely contains slices that have names.

**And it makes the finding actionable.** Today the scan reports *this plan has a
long slice name*; a reader then opens the file and finds which. With the method,
the slice that is wrong is the thing that says so — and it already has an
identity to be named by (§3).

---

## 4. Lifecycle


**Corrected 2026-08-28.** An earlier draft said *"a slice has no lifecycle"* and
called the verdict a reading. That is too strong: **the verdict is what the
board tracks a slice's progress by** — `rows.tsx:1023` routes a slice into a
section by it, and `menus.tsx:1110` gates its actions on it. Functionally it is
the slice's state.

**What is true is narrower: a slice is never *written to*.** A Plan's state is
recorded in its file and changed by a spoke command; a slice's is **recomputed
every pulse**, and what looks like a transition is a branch elsewhere merging.

So it is a **derived state**, and the entities doc's rule places it exactly: a
value that depends on a pair belongs to the derivation rather than to the
object's stated fields — the same reason `FleetBranch.state` is a field on a
derivation while `Issue` carries none.

### The four words do not cover the middle

**Measured live 2026-08-28:**

| slice verdicts | | branch states | |
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

**There is no verdict for *in progress*.** A slice whose branch is claimed and
being worked still reads `eligible`, because eligibility asks *would a dispatch
take this* — not *has one already*. The five `wip` branches sit under slices that
call themselves startable.

**So the board tracks a slice's progress through three sources, not one:**

| what | from |
|---|---|
| may this start | the **slice's** verdict |
| is it under way | the **branch** — `claimed`, `wip`, `merged` |
| is anyone on it | the **agent** — running, stalled, finished |

That division is deliberate, and it is why the verdict is thin: a slice is a
**gate over work**, so its vocabulary is about the gate, and the work's own
progress belongs to the things doing it.

**The cost is that `eligible` means two things to a reader** — *nobody has
started this*, and *somebody has, and another dispatch would still be taken*.
The board disambiguates by rendering the branch beneath; the slice's own word
does not.

Four words, and the contract states what a reader may **do** with each:

| verdict | means | resolves by |
|---|---|---|
| `complete` | every non-deferred branch merged | — |
| `eligible` | **a dispatch would take this** | doing the work |
| `blocked` | an earlier slice has not landed | **merging** that work |
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

Recomputed every pulse from three things: the plan's state, the prior slices'
branch states, and this slice's own. **Nothing about the slice itself changes**
when its verdict moves from `blocked` to `eligible` — a branch somewhere else
merged.

So on the domain object it is `slice.verdict(plan, priorSlices)` — a method over
the estate, never a value the parser could emit, because the parser reads a plan
file and cannot see git.

### `--loose` is the one relaxation, and it must be verified

*"A prior slice counts as satisfied when its branches carry **pushed** work, not
only merged work. Buys throughput, pays in rebase risk — the plan requires a
stated reason for using it."*

**And it is refused where it cannot be checked**: `loose_verifiable` gates on a
host CLI, because *"`--loose` promises the prior slice's PRs are green and ready,
which needs the host. Readiness must be VERIFIED, never assumed."*

A flag that would silently degrade to *assume ready* is instead refused.

---

## 5. Direction


**A slice has no direction**, and it is the only entity here with none.

| | |
|---|---|
| inbound | **impossible** — nothing outside the repo describes a slice |
| outbound | **nothing publishes one** (§2) |
| neither | **always** — a slice exists because a plan was sliced |

**A slice is created only by slicing**, never by conversion. `/plot-idea` writes
the headings, or `/plot-reslice` rewrites them; there is no ticket, no
discussion and no external artefact a slice can come from.

That follows from §2: an entity with no representation outside the repo cannot
have a direction, because direction is a statement about crossing that boundary.

---

## 6. Relations


| relation | mechanism | state |
|---|---|---|
| Plan → Slice | `### ` headings | **built** |
| Slice → Branch | `(Branch: x)` in the heading, or list items | **built** |
| Slice → prior Slice | document order | **built — implicit** |
| Slice → Worker | one worker per dispatched branch | via Branch |

**The ordering is positional and unnamed.** A slice knows it comes after the one
above it because of where it sits in the file — there is no `after:` field. That
is simple and it is also fragile: reordering the headings reorders the gate.

---

## 7. Actions


| action | who | what |
|---|---|---|
| **Dispatch** | `plot-dispatch.sh` | one worktree + worker per eligible branch |
| **Reslice** | `/plot-reslice` | rewrite `## Branches` into one slice per branch |
| **Ask** | `--next` | name one claimable branch; exit 1 = nothing to start |

**A slice is never dispatched — its branches are.** The slice decides *whether*,
the branch is *what*. That is why `--next` returns a branch name.

**Reslice is the only writer**, and it needs a person: *"re-slicing needs NAMES
for the new slices, and naming is judgement."*

---

## 8. Scope


### One slice, one branch — and the 32 that disagree

The model settled 2026-08-21: **plan → \* slice → 1 branch**.

Measured across 303 slices:

| branches | slices |
|---|---|
| **1** | **271** |
| 0 | **11** |
| 2 | 13 |
| 3 | 5 |
| 4 | 2 |
| 5 | 1 |

**271 of 303 conform.** 21 hold several branches (`unsliced-slice`, reported by
the scan), and **11 hold none at all** — a heading with no branch under it.

#### The 11 empty ones are mostly not slices at all

**Investigated 2026-08-28, and the first reading was wrong.** They are not
*"slices that dispatch nothing"* — 9 of the 11 are **prose headings the parser
reads as slices**, across four plans:

```
'What an agent IS — settled 2026-08-20'
'Where the blocker reference goes — three placements, two measured failures'
'A deferred branch is not a slice's work'
'Superseded — reached main by other routes'
```

Those are **design-discussion sections** written under `## Branches`, not slices
of work. And they are already flagged by a different name: `long_wave_names`
reports exactly this shape — sentence-length headings that are *"a
plan-authoring mistake the board can only render badly."*

**Only 2 look like real slices with no branches** — `Sized` and `Marked`, one
plan, both short labels. Those are plausibly slices whose branches were dropped
during reslicing.

So the finding splits:

| | count | what it is |
|---|---|---|
| prose headings parsed as slices | **9** | the `long_wave_names` problem, seen through a different field |
| labelled slices with no branch | **2** | plausibly a reslice that lost its branches |

**A slice with no branches is still `complete` vacuously** — *every non-deferred
branch has merged* is trivially true of none — so it blocks nothing and
dispatches nothing either way. But the fix differs: the 9 want a parser rule or
an authoring convention, and only the 2 want a slice-shape check.

---

## 9. The collaborators


**One, and it derives rather than stores:** `plot-fleet-scan.sh`.

It reads plans through `plot-plan-meta.sh`, asks git about each branch, and
emits a verdict per slice — *"stateless; re-derived from git refs every run."*

**No writer, no cache, no record.** The nearest thing to persistence is
`PLOT_TERMINAL_CACHE`, which caches *branch* answers and is checked against git
every pass.

---

## 10. Fleet control


**Slice is the entity the fleet is built around**, and the tooling shows it:

| capability | script |
|---|---|
| every slice's verdict | `plot-fleet-scan.sh` |
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
| slice row | name, verdict, its branches |
| slice head | the plan above its slices, with actions |
| the pulse's summary | `waves=N eligible=N blocked=N` |

**Two render arms with opposite defaults** — grouped rows and ungrouped — which
has produced bugs of its own. A slice that renders in the wrong arm shows the
right verdict in the wrong place.

---

## 12. Setup


**No config key, and none is wanted.**

A slice is structure inside a plan file, so it inherits everything: `Plan
directory` locates the file, `Branch prefixes` decides what parses as a branch
name, and nothing else applies. There is no `Slice directory` to declare and no
slice-shaped behaviour to configure.

**The one thing adoption should know is the model** — *one slice, one branch* —
and that is documentation rather than configuration. A repo cannot opt out of
it; 21 slices here disagree with it and the scan reports them (§8).

---

## 13. Gaps


| # | gap | reachable |
|---|---|---|
| 1 | **9 prose headings parse as slices** — design sections under `## Branches`, vacuously `complete` | **now, measured** |
| 1b | **2 labelled slices lost their branches** — plausibly a reslice | now, measured |
| 2 | **21 slices hold several** — against the 1:1 model | now, reported |
| 3 | **Ordering is positional** — no `after:`, so reordering headings reorders the gate | now |
| 4 | Slice names are scoped to a plan but rendered bare | cosmetic |
| 5 | **Nothing enforces `plan#name` uniqueness** — 303/303 distinct today, by authorship rather than by a check | now |
| 6 | **The anchor is two attributes, not one** — a blocked-slice jump breaks wherever the outer `data-wave-list` is missing, as measured | now |
| 7 | **`rowKey` has no slice component** — the 11 empty slices collapse to `repo//plan` | now |

**Gap 1 is half-reported.** `long_wave_names` already flags the sentence-length
headings — it just flags them as *names too long to render*, not as *not a slice
at all*. Nothing catches gap 1b: `unsliced-slice` catches too many branches, and
nothing catches none.

---

## 14. Invariants and open points


### Invariants

1. **A slice is derived; it has no file and no record.**
2. **The verdict is a DERIVED state** — recomputed every pulse, never stored,
   and never covering *in progress*.
3. **`blocked` and `unapproved` never collapse** — one waits on work, the other
   on a decision.
4. **`eligible` is the only word that promises a dispatch agrees.**
5. **A slice is never dispatched; its branch is.**
5b. **A slice holds exactly ONE branch, by definition** — a section naming
   several is an unsliced plan, not a slice with many (§1).
6. **A slice's identity is `plan.slug#slice.name`** — the name alone is
   meaningless, and `Counted` appears in 11 plans.
7. **`--loose` is refused where it cannot be verified.**

### Open points

- **What bounds a Wave's size — the agents, or what can land?** A wave is the
  fleet's cohort of slices (§1), and two rules compete: the number of free
  agents is a ceiling, but starting five agents whose branches cannot land
  together is exactly the burst `/plot-merge-queue` was written to predict.
  **The merge constraint is the stronger candidate** — an agent idle is cheap, a
  collision is not — but this is unsettled.
- **Who forms a Wave?** Nothing does today: `plot-dispatch.sh:199` requires a
  plan slug, so no component sees eligible slices across plans and merge
  compatibility at once. The two halves exist (`plot-fleet-scan.sh`,
  `/plot-merge-queue`) and have never been joined.

- **Should an empty slice be a finding?** 11 exist; 9 are prose headings the
  parser should arguably not read as slices at all, and 2 are labelled slices
  that lost their branches.
- **Should ordering be explicit?** Positional ordering is simple and reorders
  the gate when headings move.
- **Should the composite id reach the payload?** The DOM already needs it and
  builds it from two attributes; `rowKey` needs it and has none.
- **Is the 1:1 model enforced or relaxed?** 21 slices disagree and most already
  shipped.
