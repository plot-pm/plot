# A row is a tuple

> Every row on this board is one of seven things — a ticket, a plan, a PR, a
> build, an agent, a branch, a release — and each of the seven answers the same
> six questions. Today the row carries **23 fields** through **two competing
> grid definitions**, and which fact reaches which column depends on properties
> of the plan the reader cannot see.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — interrogated 2026-08-20; five decisions recorded — one component for all kinds, kind is a server-set field, seven kinds with four empty, age is since-last-change with the agent labelled, collapse goes last
- **Started:** 2026-08-20, Jan Wloka, `feature/a-row-is-a-tuple`
- **Started:** 2026-08-20, Jan Wloka, `feature/the-wave-and-the-phase-find-their-owners`
- **Started:** 2026-08-20, Jan Wloka, `bug/one-component-renders-every-row`

## Problem

Measured on the live pulse 2026-08-20: an agent row carries

    repo, plan, planFile, wave, state, phase, group, ageMinutes, note, branch,
    branchUrl, pr, waitingDays, localDirty, localLocked, localAhead, waitingOn,
    blockedBy, verdict, worker, stuck, repair, processes

— 23 fields, rendered through `ROW_TRACKS` (seven columns) or
`PLAN_ROW_TRACKS` (four), chosen by whether the row is a plan.

The consequences were all reported from screenshots rather than derived here:

- **One column, four meanings.** The phase cell reads a wave name, a plan phase,
  nothing, or a plan phase on a ticket — depending on the plan's wave count.
- **A plan phase on a branch row** describes the plan, not the branch. 36 rows
  read `Development`, 26 `Endgame`, 9 `Design`: 71 rows carrying a word about
  something else.
- **A tooltip does a label's job** — `Branch … on the git host` is hover-only
  text stating what kind of thing the row is.
- **Two of three rows had no `⋯` menu**, because actions were attached per kind
  ad hoc rather than per row uniformly.

Each was fixed or planned separately. They share one cause: **there is no shape
that every row is**, so each kind grew its own rendering and its own exceptions.

## Design

### The two things a row must get right

Everything below serves two requirements, and they are the test for any variation
of this design:

1. **The item is recognisable.** A reader knows what kind of thing the row is
   without hovering, without inferring it from a badge, and without knowing the
   plan's wave count. This is what the icon and the kind slot are for, and what
   the four-meanings phase column failed at.
2. **The artifact links are associated.** Each linked name is visibly attached to
   the item it belongs to, so a reader knows what they are about to open before
   they click. A PR row carries three — the PR, its plan, its branch — and the
   association is what stops them reading as a row of interchangeable words.

The slot list is one way to satisfy both. Where it is inconvenient — a PR needing
more link slots than a branch — **the requirements win and the slot count
bends**, which is why the artifact slot is zero-or-more rather than one.

### Six slots, one shape

    [item-icon, item-kind, item-name, artifact-name-link*, item-status, item-age]

where `artifact-name-link*` is **zero or more** linked names, not one — a branch
carries none, a PR carries its plan and its branch.

| Kind | icon | kind | name | artifact link | status | age |
|---|---|---|---|---|---|---|
| Ticket | ticket | `Story` | `228: Fleet scan asks the host once per branch` | `fleet-scan-asks-the-host` | `open` | — |
| Plan | plan | `Plan` | `fleet-scan-asks-the-host` | `idea/my-branch` | `draft` | `1d` |
| PR | pr | `PR` | `57` | `fleet-scan-asks-the-host`, `feature/opus5-longhorizon-hardening` | `conflicts` | `25d` |
| Build | build | `Build` | `CI:1860` | `PR 283` | `CI is running for PR #283` | `10m` |
| Agent | agent | `Agent` | `@Dev-Agent` | `feature/opus5-longhorizon-hardening` | `thinking` | `13m` |
| Branch | branch | `Branch` | `feature/opus5-longhorizon-hardening` | — | `conflicts` | `25d` |
| Release | release | `Release` | `2.7.0` | `240`, `changeset-release/main` | `no-checks` | `12m` |

### The artifact links follow a rule, not a list

Settled 2026-08-20: an item links **what it came from and what it travels on.**
Two kinds make the pattern visible because they are the same shape:

| kind | came from | travels on | artifact links |
|---|---|---|---|
| **PR** | a plan | a branch | **plan, branch** |
| **Release** | a PR | a branch | **PR, branch** |
| Build | — | a PR | PR |
| Ticket | — | — | the plan it became |
| Plan | — | an idea branch | that branch |
| Agent | — | a branch | that branch |
| Branch | — | **itself** | none |

So a release carries **two** links exactly as a PR does, and the count is a
consequence rather than a per-kind decision. This is why the artifact slot is
zero-or-more: a branch is its own vehicle and links nothing, a PR and a release
each name two.

**Nothing linked belongs in the status column.** Measured on the mock, a release
rendered `⑂240` in its status because no second artifact slot was provided for
it — so the link went where there was room. The status column says where the item
stands and holds no destinations at all.

**And both take their status from the same place.** A release's status is its
PR's status — `conflicts`, `no checks`, a red build, green — exactly as a PR's is.
Measured, the code already does this with one derivation and no per-kind branch
(`tuple-row.ts:303`):

    const status = row.pr ? prStatus(row.pr) : stateStatus(row);

So the symmetry is complete, and it is worth stating because it means the release
row needed **no** special handling and got some anyway. PR and release are the
same shape throughout:

| | PR | Release |
|---|---|---|
| name | the PR number | **the version** |
| artifact links | plan, branch | **PR, branch** |
| status | from its PR | **from its PR** |
| age | since last change | since last change |

The only real difference is the name, and it is the one thing that does not work:
`releaseVersion()` reads `row.plan`, a release row has none, and the version lives
in a PR title the contract does not carry. Everything else about a release was
already right by construction — which is why the two visible defects were an
extra link and a wrong name, not a missing status.

**The kind is stated, not inferred — and it is a FIELD, not a derivation.**
There is no `kind` on the contract today; a row's kind is implied by which
component happened to render it. Slot 2 reads a new `kind` field that the server
sets where the row is created, because the server is the only place that knows
why the row exists.

The alternative — deriving it in the renderer from `row.pr`, `row.issue`,
`row.planFile` — is declined, and the reason is the defect this plan exists to
fix. A derivation is a guess with a rule attached, and the rule breaks first
where two kinds share fields: **a release is a PR** whose branch happens to be
named `changeset-release/main`, so any derivation must either hardcode that name
or misclassify the one row nobody should merge by reflex. The four-meanings column
was also a derivation — from the plan's wave count — and it produced four answers
in one column.

It ends the tooltip-as-label defect and the four-meanings column in one move: the
second slot says what the row is, and no other slot has to imply it.

**Name and artifact are different slots**, which settles *subject versus
vehicle*. A PR's name is `57` and its vehicle is the branch; a branch's name IS
the branch and the artifact slot is empty. The row leads with what the reader is
deciding about, and the vehicle follows in a slot that may be blank — the rule
this estate reached from the other direction.

**Every named thing in a row is a link, and there can be more than two.** A PR
row names three: the **PR** `57`, its **plan**, and its **branch** — three
destinations, three different places. `57` opens the pull request,
`feature/opus5-longhorizon-hardening` opens the branch on the host, and the plan
name opens the plan.

So `artifact-name-link` is **not one slot but the general case**: a row carries
as many linked names as it has related things, and the six-slot tuple is the
*minimum* rather than the shape. The alternative — a fixed second slot that a PR
overflows — would force a choice between the plan and the branch, and the reader
would lose whichever lost.

All three facts are already on the row: measured on the live pulse, a PR row
carries `plan`, `planFile`, `branch`, `branchUrl` and `pr`. Nothing new is
fetched; what is missing is that only some of them are rendered, and only one of
those is a link.

This is what makes the artifact slot's varying target harmless. The examples
point at three sorts of thing — a Plan and a PR name a **branch**, a Build names
a **PR**, a Ticket names the **plan that came from it** — and a reader never has
to infer which, because the slot they are looking at is the one they clicked.
The Ticket case even points *forward* along the chain where the Build points
back; with both slots linked, direction is a property of the pair rather than a
rule the reader must hold.

It also repairs the defect measured on the live pulse: branch rows carried
`branch, path` and **zero of seven** carried any URL, so a plan name was a link
and the branch beside it was inert text. Two links per row is the general form of
the fix `a-branch-row-carries-its-link` (#260) made for one case.

Where a slot has no destination — a branch's empty artifact slot — it renders as
nothing rather than as a dead control. The rule this board already applies to a
PR cell with no PR.

### Seven kinds in the contract, three with data

Measured 2026-08-20: only **three** of the seven have a row today.

| kind | today | data exists |
|---|---|---|
| ticket | `IssueRowView` | yes |
| plan | `PlanRow` | yes |
| branch | `Row` | yes |
| **pr** | a **cell** inside a branch row, not a row | yes — **and 67 of 80 rows carry one** |
| **release** | an unmarked branch row | yes, undistinguished |
| **build** | none | check data on the row; no row of its own |
| **agent** | none | **no** — the registry is not merged |

**`branch` and `pr` overlap on 84% of rows**, measured: 67 of 80 live rows carry
both, 13 a branch alone. They are not two kinds of thing — they are two roles one
row can be in, and `kind` picks the one the reader is deciding about. See the
resolved open point below; it is the least obvious consequence of this design and
the one that nearly broke it.

**The contract carries all seven anyway, and four render nothing.** The slot list
is a shape, and a shape that admits only what exists today would have to be
reopened for each kind that arrives — which is precisely how three components and
two grids happened. A kind with no data renders no row; it does not render an
empty one.

**The risk is named rather than discovered later.** The agent kind is designed
against a registry that does not exist yet, and the plan's own example says
`@Dev-Agent` — an invented name. Measured the same day, agents already have a real
identity: the **session id** the runtime writes as its transcript filename, which
is what `2026-08-17-working-shows-the-agent.md` keys its manifest on *because it
survives the branch*. So slot 3 for an agent is the session id, shortened for
display, and `@Dev-Agent` is dropped as a placeholder that was never a fact.

`build` and `release` are cheaper: both derive from data already on the row, and
`release` is a mark rather than a new source.

**One status slot, whatever the kind.** `conflicts`, `draft`, `thinking`,
`no-checks` are all "where does this stand". The prose notes that vary per kind
become one value in one place.

### Age is one clock, and it is *since last change*

Settled 2026-08-20: **every kind is aged from its last change** — one rule, one
clock, no label needed. The exception is the agent, and it is the only one.

The schema had already reached half of this and written down the reason. The
comment on `waitingDays` (`schema.ts:1466`) argues:

> *"Overloading one field with two meanings is precisely the ambiguity that makes
> `22d` (no commits for three weeks) unreadable beside `22d` (never begun) — so
> **the row labels it rather than merging it**."*

And `ageMinutes` is documented as *"minutes since the branch tip"* — which
already **is** since-last-change. So this rule is not new; it is the
generalisation of what one field already means, applied to all seven kinds
instead of one.

What changes is that the row must now *show* which clock it used. Today it
carries two fields and renders whichever applies, leaving the reader to infer
from the number's magnitude which question was answered — the very inference the
`waitingDays` comment says the row should label. It says *the row labels it*; the
row does not.

| Kind | aged from |
|---|---|
| ticket, plan, pr, build, branch, release | **last change** — unlabelled, because it is the rule |
| **agent** | **session age** and **idle**, both labelled, because neither is a change to the agent |

**Why the agent is the exception rather than an inconsistency.** An agent does not
change; it *acts*. There is no "last change to this agent" to measure, so the
single rule has nothing to read. What a reader wants instead is two different
things — *how long has this run been going* and *how long has it been silent* —
and the second is the one that says whether it is stuck. Both are already
derivable from what the registry records: `startedAt` from the manifest,
`lastActivity` from the transcript.

    ⬡ agent  f30b27a3   feature/x   thinking   27m · idle 4m

So the label appears exactly where the rule does not apply, and nowhere else.
That is the opposite of the four-meanings column, which was unlabelled *because*
its meaning varied.

### Three components, two grids — and a ticket already wears a branch's

Measured 2026-08-20, and it is the sharpest evidence for this design rather than
an objection to it:

| component | grid it uses | size |
|---|---|---|
| `Row` (branch, and PR as a cell) | `ROW_TRACKS` | **555 lines** |
| `PlanRow` | `PLAN_ROW_TRACKS` | **149 lines** |
| `IssueRowView` (ticket) | **`ROW_TRACKS`** | 2 lines — a wrapper |

So it is not two grids for two kinds. It is **two grids for three components**,
and the third — a ticket — is already rendered through the tracks of a *branch*.
A ticket has no wave, no worker and no branch; it wears the columns of something
it is not because there was no third grid to give it. That is the same defect as
the four-meanings column, at a second site, and it was there before anyone
noticed.

**One component renders every kind.** `Row`, `PlanRow` and `IssueRowView` are
replaced by a single tuple row rather than sharing a grid between three fillers.
Three fill sites is exactly how the two grids drifted apart, and a shared grid
with three fillers keeps that possibility while adding a contract.

The cost is stated because it decides the wave order: **~700 lines of component**
in a file of 5,664 that took **11 commits on 2026-08-20 alone** and conflicted on
nearly every merge that day. Which is why the collapse is the LAST wave and not
the first — see *Branches*.

### What this replaces

`ROW_TRACKS` and `PLAN_ROW_TRACKS` become one grid. `PlanRow`'s comment already
argues that *"a plan row is not a branch row, so it does not borrow the branch
tracks"* — correct while there were only two kinds, and the reason there are now
two grids for what will be seven kinds.

**It also replaces three branches of another plan.** `waiting-on-you-says-what-
kind-of-waiting` was approved on 2026-08-20 and reached the same file from the
other direction: it asked *which* of a row's facts should lead, and answered per
kind. The tuple asks what slots a row has at all, and answers once. Three of that
plan's branches are the same work stated as a special case, and they move here:

| Moved from `waiting-on-you` | Because |
|---|---|
| `feature/the-row-leads-with-its-subject` | "which fact leads" is **slot 3** — the item name. A PR row leads with the PR because the PR is the item; the branch is an artifact link. The rule falls out of the slot list instead of being a table of cases. |
| `bug/one-column-one-kind-of-fact` | The four-meaning column becomes **slot 2** — the kind. Always the same sort of word. |
| `bug/the-kind-is-labelled-not-hovered` | Slot 2 is a visible label by construction; there is no tooltip left to promote. |

The measurements those branches carry are kept, because they are what justify
the slots. Chief among them: **71 rows print their plan's phase**, a fact about
the plan and not about the row it sits on — 36 `Development`, 26 `Endgame`, 9
`Design`. Slot 2 ends that by holding the kind; the wave moves beside the branch
name where `a-branch-row-names-its-wave` (#275) put it, and the phase moves to
the plan heading where `PlanRow` already states it once.

The reverse reading — keep the wave in the column and move only the phase — is
recorded and declined. It leaves a branch row labelled `Says`, which is a fact
about the *wave*, and the reader still has to know the plan's wave count to tell
whether the word is a wave or something else. Slot 2 removes the question rather
than narrowing it.

### What must not change

- **Membership.** Which section a row appears in is a separate decision and this
  changes none of it.
- **No new host calls.** Every one of the six slots is derivable from what the
  pulse already carries; this is a *shaping* change.
- **Actions stay in the `⋯` menu**, per kind, as `the-menu-fits-the-kind` (#280)
  establishes. The tuple says what a row IS; the menu says what can be done to it.

### Open Points

- [x] **Ticket age is blank in the example** — an **omission**, settled
      2026-08-20. Measured: the board already renders `1d` for issues #227 and
      #228, so the age exists and reaches the row today. A ticket open for three
      weeks is exactly what WAITING ON YOU orders by, and dropping it would make
      the section's own sort key invisible on one of its four kinds.
- [x] **Is `Release` a kind or a PR with a mark?** A kind, and it carries
      **only a mark — never an action.** Settled 2026-08-20. The mark exists to
      stop a reflex merge; a menu entry offering to release would put an
      outward-facing act on a board, and this repo cuts a release only on an
      explicit request. Its menu holds *Open on host* and nothing else. Even
      *show what this would ship* is declined: it reads harmless, but it makes
      the board the place where release decisions are prepared, and that is the
      first step toward being the place they are taken.
- [ ] Do agents get a stable `@Dev-Agent` identity, or is the name derived from
      the branch it holds? The example implies the former; nothing today records
      an agent's name.

## Branches

> The three absorbed branch names below are written **without backticks on
> purpose**: `plot-plan-meta.sh` collects every backticked name in this section
> as a branch of this plan, so quoting them here would declare six branches
> instead of three — and `plot-dispatch` would fan out three branches that
> belong to another plan. Measured when it did exactly that.

The order is **shape, then relocate, then remove**. The slots come first because
every other branch here needs them to exist. The two facts slot 2 displaces —
the wave and the plan phase — are relocated before the old column is deleted, so
no pulse renders a row that has lost a fact and not yet gained its replacement.

### Shaped
- `feature/a-row-is-a-tuple` — the contract carries the six slots and a `kind` field for all seven kinds, and ONE tuple row renders them, with **every named thing linked** — a PR row links its PR, its plan and its branch. The three existing row components keep working: this adds the row and the field, it deletes nothing. Tests: `kind` is set by the server for every row it emits and is never derived in the renderer; each of the seven kinds renders all six slots; a kind with no data renders no row rather than an empty one; the item name and the artifact name are separate links to separate destinations; a PR row renders three separate links; a branch row renders one and no empty artifact control; a row whose item has no URL renders its name as text; the kind is present without hovering; a ticket carries its age; **a release is its own kind and its menu offers no release action**; an agent's name is its session id, never an invented handle; no host call is added. (#293)

### Relocated
- `feature/the-wave-and-the-phase-find-their-owners` — the two facts slot 2 displaces move to the objects they describe: the wave beside the branch name, extending `a-branch-row-names-its-wave` (#275); the plan phase into the plan heading, where `PlanRow` already states it. Absorbs bug/one-column-one-kind-of-fact and bug/the-kind-is-labelled-not-hovered from `waiting-on-you-says-what-kind-of-waiting`. Tests: a branch row prints no plan phase; a multi-wave plan's branches and a single-wave plan's branches read the same kind of word in slot 2; a PR row and a build row are not given a phase they do not have; a ticket is not labelled with a plan phase; the kind is readable without hovering, and no tooltip is the only place a kind is stated; the wave is still reachable for every branch that has one. (#299)

### Collapsed
- `bug/one-component-renders-every-row` — `Row`, `PlanRow` and `IssueRowView` are replaced by the tuple row; `ROW_TRACKS` and `PLAN_ROW_TRACKS` collapse to one grid. Absorbs feature/the-row-leads-with-its-subject: with slot 3 holding the item name, "which fact leads" is answered by construction, and what remains is deleting the per-kind leading logic. **Last on purpose** — it rewrites ~700 lines of the file that took 11 commits on 2026-08-20 and conflicted on nearly every merge, so it goes when no sibling branch is open against it. Tests: one grid renders a plan row, a branch row and a ticket row; no row prints a phase belonging to another object; **a PR row's dominant slot holds the PR and its branch is an artifact link**; **a merge conflict is still readable on the branch it belongs to**; a ticket no longer wears the branch tracks; the sections keep their membership; every assertion the three deleted components carried still has an owner. (#301)

## Open Points

- [x] **Does the age slot need to name its clock?** Yes, but only where the rule
      does not hold. Settled 2026-08-20: **everything is aged from its last
      change**, unlabelled, because that is the rule — and the agent alone shows
      **session age and idle**, both labelled, because an agent does not change,
      it acts. See *Age is one clock* above. The label marks the exception rather
      than decorating the rule, which is the inverse of the four-meanings column.
- [x] **`kind` is what the row is ABOUT, not what object it came from.**
      Settled 2026-08-20 by measurement: of 80 live rows, **67 carry both a
      branch and a PR** and only 13 are a branch alone. So the both-case is the
      normal case, not an edge, and `branch` and `pr` are not two kinds of row —
      they are two **roles one row can be in**.

      `kind` therefore answers *what is being decided here*, which is the
      requirement at the top of this design (**the item must be recognisable**),
      and the rule that picks it is the one `the-row-leads-with-its-subject`
      already settled: a **merge conflict** makes it `branch`, because no PR
      resolves it and the reader goes to the branch; anything else with an open
      PR makes it `pr`, because the fix updates the PR.

      This costs the design a simplification and the loss is worth stating:
      `kind` is not a property of a thing, it is a judgement about a row. The
      server makes it, once, where it has both facts — which is exactly why it
      must not be derived in the renderer, where only some of them arrive.

## Notes

Proposed by the operator after five separate row defects were reported from
screenshots in one night. The seven kinds and the six slots are theirs, with
worked examples for each.

The diagnosis it supersedes is worth keeping: I had recorded *"one column, four
meanings"* and proposed choosing which meaning the column should hold. That is
the same fix one level too low — the column is ambiguous because the ROW has no
shape, and picking a winner per column would leave the next kind to invent its
own again.
