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

### Six slots, one shape

    [item-icon, item-kind, item-name, artifact-name-link?, item-status, item-age]

| Kind | icon | kind | name | artifact link | status | age |
|---|---|---|---|---|---|---|
| Ticket | ticket | `Story` | `228: Fleet scan asks the host once per branch` | `fleet-scan-asks-the-host` | `open` | — |
| Plan | plan | `Plan` | `fleet-scan-asks-the-host` | `idea/my-branch` | `draft` | `1d` |
| PR | pr | `PR` | `57` | `feature/opus5-longhorizon-hardening` | `conflicts` | `25d` |
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
- [ ] **Build names itself `CI:1860` and points at `PR 283`**, while a PR points
      at a branch. So the artifact slot is *"the thing one level down"* rather
      than always a branch. Worth stating explicitly, or the slot drifts back
      into meaning several things.
- [ ] **Is `Release` a kind or a PR with a mark?** Recorded as a kind here,
      matching the operator's list, and it is the one row nobody should merge by
      reflex.
- [ ] Do agents get a stable `@Dev-Agent` identity, or is the name derived from
      the branch it holds? The example implies the former; nothing today records
      an agent's name.

## Branches

### Shaped
- `feature/a-row-is-a-tuple` — the contract carries the six slots and one grid renders them for every kind. Tests: each of the seven kinds renders all six slots; a blank artifact slot renders as blank rather than borrowing another fact; the kind is present without hovering; no host call is added.

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
