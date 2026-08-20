# WAITING ON YOU says what kind of waiting

> One screenshot, three rows, three different nouns: a **branch** with merge
> conflicts, a **PR** with no checks, and a **PR** with a failing build — sitting
> in one list with one row shape, above a note saying the **tickets** that belong
> here could not be read at all. The section answers *something needs you*, and
> stops before the question the reader actually has: **needs me to do what?**

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

`WAITING ON YOU` holds four kinds of thing. Each wants different actions, and
the row renders all four identically — a monospace name, a badge, an age.

| Kind | What it is | What the reader does |
|---|---|---|
| **Ticket** | an open issue with no plan | read it, then create a **plan** or a **story** |
| **Plan** | drafted, awaiting a decision | read it, then **approve** — or first commission a **spec**, a **spike**, or a **tracer bullet** |
| **PR** | open, wants a decision | **review and merge** — or fix a failing build |
| **Branch** | pushed, not mergeable | **fix** the conflict or the build, or **open** it |

Observed 2026-08-20, all three visible rows:

    feature/opus5-longhorizon-hardening   #57 conflicts     25d
      conflict  the host reports this branch does not merge
    changeset-release/main                #240 no checks     4m
    a-held-branch-says-who-...            #266 checks failing  2m
      CI failed  step: validate

Three rows, three different required actions, one shape.

### The consequences are visible in the same screenshot

- **The `...` menu is on one row of three.** Only `#266` shows it. Whatever the
  other two offer, the reader cannot find out from the row.
- **A tooltip is doing a label's job.** *"Branch feature/a-worktree-holds-its-branch
  on the git host"* is hover-only text explaining what kind of thing the row is —
  which is the one fact the row should state without being asked.
- **Detail is dumped, not shaped.** `#266` carries a wrapped list of six changed
  files and a raw timestamp (`2026-08-20T03:55:23Z`). It is the only row with
  detail, and the detail is a paragraph rather than a structure.
- **A ticket cannot appear at all right now**, and the note saying so is a
  footer below the rows it qualifies — recorded separately in
  `a-rate-limit-is-not-an-outage`.

### What the section gets right, and must keep

Membership is honest: everything here genuinely wants a person. The
`WaitingGroupSchema` comment records the reasoning — a section whose membership
is *true* beats a rule that is checkable at a glance. This plan changes what a
row **says**, never who is in the section.

## Design

### The row states its kind, and the kind decides its shape

A `kind` on the row — `ticket | plan | pr | branch` — derived from what the row
already carries rather than added as a fifth state: a row with an issue number
and no branch is a ticket, a row with a PR number is a PR, a row that is a plan
card is a plan, a bare ref is a branch. The board already distinguishes these to
render them; nothing new is measured.

**The kind is stated, not implied by a tooltip.** A short leading label, in the
column where `Development` and `Design` already sit, so the eye finds the noun
before the name.

### The actions follow the kind, and live in the menu

`every-action-is-in-the-menu` (on `a-held-branch-says-who-holds-it`) establishes
that a row's affordances belong in `...`. This says what belongs there per kind:

| Kind | Menu |
|---|---|
| Ticket | **Create plan**, **Create story**, Open on host |
| Plan | **Open**, **Approve**, **Commission design** (spec / spike / tracer bullet) |
| PR | **Open**, **Review**, and where checks fail: **Show failure** |
| Branch | **Open**, and per cause: **Resolve conflict** / **Show failure** |

Two rules from tonight's findings carry over. An action that cannot act must
refuse **with its reason on the control** rather than accept and disappoint —
the row action menu's existing rule. And every action lives in the menu, so a
reader learns one grammar rather than one per kind.

### Failure detail is structured, not prose

`#266`'s six changed files and its raw timestamp are the right facts in the
wrong form. A failing check has three parts — **which step**, **when**, **what it
touched** — and the row should show the first two and put the third behind the
menu, where a reader who wants it can get it without every other reader
scrolling past it.

### What must not change

- **Membership.** Nothing enters or leaves the section; see the schema comment.
- **The refusal rule.** A control that cannot act says why, on itself.
- **No new host calls.** The kind is derived from data already on the row. This
  plan must not reintroduce per-row lookups — the scan's cost went from 279 s to
  20 s across #262 and #264.

### Open Points

- [ ] Does **Commission design** create a plan in the new `Design` phase
      (#259), or open `/plot-idea` with a design-shaped template? The phase
      exists; the flow that fills it does not.
- [ ] Should the four kinds be **sub-grouped** under headings, or stay one list
      with per-row labels? Sub-grouping reads better at four rows and worse at
      forty, and the section is usually small — but it was 11 rows earlier
      tonight.
- [ ] Is `changeset-release/main` a **PR** or its own kind? It is a PR by
      mechanism and a release by meaning, and it is the one row a reader must
      never merge by reflex.

## Branches

### Named
- `feature/a-row-says-what-kind-it-is` — the row carries `kind` (`ticket | plan | pr | branch`), derived from what it already holds, and states it as a label rather than a tooltip. Tests: each kind is derived from a row that carries only its own evidence; the label renders in the leading column; no host call is added; a row whose kind cannot be determined says so rather than guessing.

### Offered
- `feature/the-menu-fits-the-kind` — each kind offers its own actions in the `...` menu, and every row has one. Tests: a ticket offers Create plan and Create story; a plan offers Approve and Commission design; a PR with failing checks offers Show failure; an action that cannot act refuses with its reason on the control; every row in the section has a menu.
- `bug/a-failure-is-shown-not-dumped` — a failing check shows step and time on the row, with the changed-file list behind the menu. Tests: the row names the step; the timestamp renders as an age, not an ISO string; the file list is not in the row; a row with no failure shows neither.

## Notes

Reported by the operator reading the section: *"shows 4 different things — Plan,
PR, Ticket or branch to review or act upon."* The four kinds and their actions in
the table above are theirs, not derived here.

The tooltip is the detail worth keeping in mind. *"Branch feature/… on the git
host"* exists because someone already knew the row's kind was unclear — and
answered it with hover text, which is invisible until you suspect there is
something to hover. The fix is to say the thing the tooltip says, in the row,
always.
