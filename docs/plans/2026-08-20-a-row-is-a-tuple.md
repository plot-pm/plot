# A row is a tuple

> Every row on this board is one of seven things — a ticket, a plan, a PR, a
> build, an agent, a branch, a release — and each of the seven answers the same
> six questions. Today the row carries **23 fields** through **two competing
> grid definitions**, and which fact reaches which column depends on properties
> of the plan the reader cannot see.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

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
| Release | release | `Release` | `2.7.0` | `changeset-release/main` | `no-checks` | `12m` |

**The kind is stated, not inferred.** It ends the tooltip-as-label defect and the
four-meanings column in one move: the second slot says what the row is, and no
other slot has to imply it.

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

**One status slot, whatever the kind.** `conflicts`, `draft`, `thinking`,
`no-checks` are all "where does this stand". The prose notes that vary per kind
become one value in one place.

**Age is age.** Today a row can show `ageMinutes`, `waitingDays`, or nothing.

### What this replaces

`ROW_TRACKS` and `PLAN_ROW_TRACKS` become one grid. `PlanRow`'s comment already
argues that *"a plan row is not a branch row, so it does not borrow the branch
tracks"* — correct while there were only two kinds, and the reason there are now
two grids for what will be seven kinds.

### What must not change

- **Membership.** Which section a row appears in is a separate decision and this
  changes none of it.
- **No new host calls.** Every one of the six slots is derivable from what the
  pulse already carries; this is a *shaping* change.
- **Actions stay in the `⋯` menu**, per kind, as `the-menu-fits-the-kind` (#280)
  establishes. The tuple says what a row IS; the menu says what can be done to it.

### Open Points

- [ ] **Ticket age is blank in the example.** Is that deliberate — a ticket's age
      being the tracker's business — or an omission? Every other kind carries one.
- [ ] **Is `Release` a kind or a PR with a mark?** Recorded as a kind here,
      matching the operator's list, and it is the one row nobody should merge by
      reflex.
- [ ] Do agents get a stable `@Dev-Agent` identity, or is the name derived from
      the branch it holds? The example implies the former; nothing today records
      an agent's name.

## Branches

### Shaped
- `feature/a-row-is-a-tuple` — the contract carries the six slots and one grid renders them for every kind, with **every named thing linked** — a PR row links its PR, its plan and its branch. Tests: each of the seven kinds renders all six slots; the item name and the artifact name are separate links to separate destinations; a PR row renders three separate links; a branch row renders one and no empty artifact control; a row whose item has no URL renders its name as text; the kind is present without hovering; no host call is added.

### Moved
- `bug/the-row-drops-what-the-tuple-replaced` — the fields the tuple supersedes stop being rendered per kind, and `ROW_TRACKS`/`PLAN_ROW_TRACKS` collapse to one. Tests: a plan row and a branch row use the same grid; no row prints a phase belonging to another object; the sections keep their membership.

## Notes

Proposed by the operator after five separate row defects were reported from
screenshots in one night. The seven kinds and the six slots are theirs, with
worked examples for each.

The diagnosis it supersedes is worth keeping: I had recorded *"one column, four
meanings"* and proposed choosing which meaning the column should hold. That is
the same fix one level too low — the column is ambiguous because the ROW has no
shape, and picking a winner per column would leave the next kind to invent its
own again.
