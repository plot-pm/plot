# WAITING ON YOU says what kind of waiting

> One screenshot, three rows, and the widest column of each holds a **branch
> name** — `feature/opus5-longhorizon-hardening`, `changeset-release/main`,
> `a-held-branch-says-who-…`. Two of the three are there because a **PR** wants
> a decision. The branch is the vehicle; the PR is the subject. The row leads
> with the vehicle.

## Status

- **Phase:** Approved
- **Type:** feature
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — interrogated; ten decisions recorded, menu lands first
- **Started:** 2026-08-20, Jan Wloka, `feature/the-menu-fits-the-kind`

## Problem

`WAITING ON YOU` holds four kinds of thing, each wanting different actions:

| Kind | What it is | What the reader does |
|---|---|---|
| **Ticket** | an open issue with no plan | read it, then create a **plan** or a **story** |
| **Plan** | drafted, awaiting a decision | read it, then **approve** — or first commission a **spec**, a **spike**, or a **tracer bullet** |
| **PR** | open, wants a decision | **review and merge** — or fix a failing build |
| **Branch** | pushed, not mergeable | **fix** the conflict or the build, or **open** it |
| **Release** | `changeset-release/main` | read what it would ship, then release deliberately |

### Three of the four already have their own shape — and that is not the defect

Measured before writing this, because the first draft of this plan claimed all
four shared one row shape and proposed a new `kind` field to separate them. They
do not:

| Kind | Rendered by |
|---|---|
| Ticket | `IssueRow` + `IssueRowView` — its own type and component |
| Plan | `PlanRow` + `PLAN_ROW_TRACKS` — its own component and grid |
| PR / Branch | `Row` + `ROW_TRACKS`, with `PrCell` as a **cell** |

So there is no missing distinction to add. `PlanRow`'s own comment already
states the principle this plan extends: **"A PLAN ROW IS NOT A BRANCH ROW, so it
does not borrow the branch tracks."**

### The defect is which fact leads the row

`ROW_TRACKS` is `1rem 5rem 10rem 1fr 14rem 2.5rem 1.25rem`. The `1fr` — the
widest, therefore dominant, track — holds the **branch name**. The PR is a
`14rem` cell to its right.

Verified against the live pulse for the three rows in the screenshot:

    feature/opus5-longhorizon-hardening   state=wip   pr=#57
    changeset-release/main                state=wip   pr=#240
    bug/the-order-holds-still             state=wip   pr=#267

All three are `state=wip` with an open PR. **There is no separate "PR row" and
"branch row"** — there is one row that leads with the branch whether or not the
branch is the point.

And for a PR it is not the point. The reader is deciding about `#240`; the
branch it happens to live on is how the change travels, not what they are
judging. Same for a plan: the plan is the subject, its branches are vehicles —
which is exactly why `PlanRow` stopped borrowing the branch tracks.

### What the screenshot shows on top of that

- **The `...` menu is on one row of three.** Only `#266` has one.
- **A tooltip does a label's job.** *"Branch feature/a-worktree-holds-its-branch
  on the git host"* is hover-only text stating the row's kind — the one fact a
  row should state without being asked.
- **Detail is dumped, not shaped.** `#266` carries a wrapped list of six changed
  files and a raw `2026-08-20T03:55:23Z`, as prose.

### What the section gets right, and must keep

Membership is honest: everything here genuinely wants a person. The
`WaitingGroupSchema` comment records the reasoning — a section whose membership
is *true* beats a rule that is checkable at a glance. This plan changes what a
row **says**, never who is in the section.

## Design

### The subject leads, the vehicle follows

Not a new field — the kinds are already distinguished. What changes is which of
a row's existing facts occupies the dominant track:

| Situation | Leads with | Because |
|---|---|---|
| PR awaiting review or merge | `#240` and its title | the decision is about the PR |
| PR with a failing build | `#266` and the failing step | the build ran **for the PR**; fixing it is PR work |
| **Merge conflict** | the **branch** | a conflict is a property of the branch against its base — no PR can resolve it |
| **Branch with no PR** | the **branch** | there is nothing else it could be |
| Plan | the plan name (already true) | its branches are vehicles |
| Ticket | the issue (already true) | — |

The rule is the one `PlanRow` already applies — **the row leads with what the
reader is deciding about** — and the discriminator is *where the problem lives*,
not whether a PR exists.

**A merge conflict is branch work even with an open PR.** `#57` shows
`conflicts` on `feature/opus5-longhorizon-hardening`: nothing about the PR
resolves it. The reader checks out the branch, rebases, pushes. So the branch
leads.

**A failing build is PR work even though the build ran on a branch.** The check
belongs to the PR, the fix is a commit that updates the PR, and the reader acts
through it. So the PR leads.

The two look alike on the board today — both are red badges next to a branch
name — and they call for different work in different places.

**Where both are true, the conflict wins and the branch leads.** A conflict
blocks the merge outright, so a red build on an unmergeable PR is moot until the
rebase happens — fixing the build first can even be wasted work if the rebase
changes what fails. The build failure still appears, as a second line:

    feature/opus5…hardening   ⑂57 conflicts        25d
      conflict  does not merge — resolve on the branch
      also: CI failed (step: validate)

**The contract cannot express that today.** `pr.state` is a single enum, so a PR
reads `conflicts` OR `ci-failing` and never both — verified against the live
pulse. The row loses the fact before it reaches the UI.

**It becomes a set: `pr.states: ['conflicts', 'ci-failing']`.** A PR really can
be both, and a single value forces the pulse to drop one — the shape of defect
this estate keeps finding, where one observable has two causes and the code keeps
the wrong one.

The cost is real and is the reason this is stated rather than assumed.
`pr.state` **helps decide the group** — `fleet.ts:2198` routes a conflicting PR
into `waiting-on-you` from it, and four separate comments record the dependency.
A set does not remove that decision, it **forces it into the open**: grouping
must pick a winner explicitly rather than inherit one from a field that could
only hold one thing.

That explicit winner is the conflict, for the reason above — and now the same
rule serves both the section and the row, instead of the section depending on a
value that happened to be singular.

Every consumer switching on a single value has to be revisited. That is the work
`the-row-leads-with-its-subject` carries, and the tests below pin the grouping
against the change rather than trusting it.

**Age is the only urgency signal, and it is enough.** `bug/the-order-holds-still`
read `conflicts` minutes after it was opened, because main moved underneath it;
`#57` has read the same for 25 days. Both lead with the branch and the clock
column already separates them. No freshness rule, no threshold: a threshold
would have to be guessed, and the reader can see `2m` next to `25d` without
being told which matters.

**A release is its own kind, not an ordinary PR.** `changeset-release/main` is a
PR by mechanism and a release by meaning, and it is the one row nobody should
merge by reflex — every changeset merged since it opened changes what it would
ship, so the version in its title stops being the version it cuts. Leading with
`#240` would make it look *more* like an ordinary PR, so it gets a fifth kind
and a mark of its own.

That is a UI restatement of a rule this repo already holds: a release is
outward-facing and only ever cut on an explicit request.

**One list, not sub-groups.** Four short lists per kind read faster in isolation
and cost the thing the section is for: a **global age order**. Sub-headings would
put a 25-day conflict below a ticket opened this morning, because each heading
restarts the clock. The per-row label carries the kind; the single ordering
carries the urgency.

**The tooltip's sentence becomes the label.** *"Branch … on the git host"* exists
because someone already knew the kind was unclear, and answered it with hover
text — invisible until you suspect there is something to hover.

### The actions follow the kind, and live in the menu

`every-action-is-in-the-menu` (on `a-held-branch-says-who-holds-it`) establishes
that a row's affordances belong in `...`. This says what belongs there per kind:

| Kind | Menu |
|---|---|
| Ticket | **Create plan**, **Create story**, Open on host |
| Plan | **Open**, **Approve**, **Commission design** — creates a plan in phase `Design` with an empty spec section |
| PR | **Open**, **Review**, and where checks fail: **Show failure** |
| Branch | **Open**, and per cause: **Resolve conflict** / **Show failure** |

**Commission design ships minimally rather than as a refusal.** The `Design`
phase landed in #259 and nothing fills it; a menu entry that only explains why it
cannot act would leave the phase unreachable for longer. So the entry creates a
plan in phase `Design` with an empty spec section — enough for the phase to be
entered from the board, with the spec/spike/tracer distinction left to the plan
itself.

Two rules from tonight's findings carry over. An action that cannot act must
refuse **with its reason on the control** rather than accept and disappoint —
the row action menu's existing rule. And every action lives in the menu, so a
reader learns one grammar rather than one per kind.

### Grouping by plan fires for one plan in nine

`showPlanHeading` returns true only when a plan holds **more than one row** in a
section (`AgentList.tsx:686`). Measured on the live board, WORKING held **10 rows
across 9 plans — 8 of them with exactly one row.** So one plan got a heading with
`(2)` and eight rows repeated their plan name inline, in a column of truncated
duplicates.

The threshold is deliberate, and its comment records the case that set it: *"two
plans, one row each turns out to be a case where headings are not wanted"* — a
heading per row is noise when the section is small. That reasoning holds at two
rows and inverts at ten: the section becomes a list where the *grouping* is the
exception and the reader cannot tell at a glance which rows share a plan.

It is the same shape as the sub-grouping question settled above, one level down,
and it resolves the same way: **the row carries the plan, the section carries one
order.** What changes is that a heading should not appear for one plan while
eight others are inline — either every plan in the section gets a heading, or
none does and the row states it. A mixed rendering teaches the reader that a
heading means something it does not.

WORKING is not the section this plan is about, so the finding is recorded here
and the fix belongs with whichever branch touches `showPlanHeading` — it applies
to every section that groups.

### The order holds still here too

`AgentList.tsx:602` sorts this section by `Math.max(...ageMinutes)` alone — the
identical shape #267 just fixed for NOT STARTED, where a coarse key ties, sort's
ES2019 stability preserves the arrival order, and the arrival order is rebuilt
from a fresh scan every pulse.

The remedy is written and merged: a plan-name tiebreak. Not applying it here
would be knowingly shipping a proven flicker into a second section — and this
section is the one a reader is *acting* on, where a row that moves under the
cursor is worse than one that merely reads oddly.

### Failure detail is structured, not prose

`#266`'s six changed files and its raw timestamp are the right facts in the
wrong form. A failing check has three parts — **which step**, **when**, **what it
touched** — and the row should show the first two and put the third behind the
menu, where a reader who wants it can get it without every other reader
scrolling past it.

### What must not change

- **Membership.** Nothing enters or leaves the section; see the schema comment.
- **The refusal rule.** A control that cannot act says why, on itself.
- **No new host calls, and no fetch on click either.** The kind is derived from
  data already on the row, and the menu shows only what the pulse already
  carries: the scan reports `ci-failing` with its checks list, and `changed_paths`
  and the failing check names are already on the row. Where a detail is not in
  the pulse, the menu **links out to the host** rather than fetching it. The
  scan's cost went from 279 s to 20 s across #262 and #264, and a per-click
  fetch would put a second cost on the same data path for one reader's
  convenience.

### Open Points

- [ ] Does the `release` kind need its own **actions**, or only its own mark? The
      mark stops a reflex merge; whether the menu should offer *show what this
      would ship* is a release-workflow question rather than a UI one.

## Branches

The order is **menu, then subject, then label, then failure detail**. The menu
goes first because it is the most visible gap and the least dependent: two rows
of three have no `...` at all, so today the reader has no route to any action
whatever the row leads with. The structural change follows, and the label and
failure shaping settle on top of it.

### Offered first
- `feature/the-menu-fits-the-kind` — each kind offers its own actions in the `...` menu, and every row has one. Tests: a ticket offers Create plan and Create story; a plan offers Approve and Commission design, and Commission design creates a plan in phase `Design`; a PR with failing checks offers Show failure; an action that cannot act refuses with its reason on the control; every row in the section has a menu. (PR #280)

### Leads
- `feature/the-row-leads-with-its-subject` — the dominant track holds what the reader must act on: the PR where the work is PR work, the branch where it is branch work. Replaces `pr.state` with `pr.states`, a set, so a PR can report a conflict and a failing build together; grouping picks the winner explicitly rather than inheriting it from a singular field. Tests: an open PR awaiting review leads with the PR; a PR with a failing check leads with the PR, since the fix updates the PR; a **merge conflict leads with the branch even when a PR is open**, since no PR resolves it; **a PR with both leads with the branch and names the build failure on a second line**; a branch with no PR leads with the branch; **a conflicting PR still lands in `waiting-on-you` after the set change** — the grouping at `fleet.ts:2198` is pinned by a test, not by the field's old shape; a release row is marked as its own kind rather than as an ordinary PR; **plans of equal age order by name**, the fix #267 landed for NOT STARTED; `PlanRow` and `IssueRowView` are untouched; no host call is added.
- `bug/the-kind-is-labelled-not-hovered` — the sentence in the tooltip becomes a visible label in the leading column. Tests: the label renders without hover; it names the same kind the tooltip did; a row whose kind cannot be determined says so rather than guessing.

### Shaped
- `bug/a-failure-is-shown-not-dumped` — a failing check shows step and time on the row, with the changed-file list behind the menu. Tests: the row names the step; the timestamp renders as an age, not an ISO string; the file list is not in the row; a row with no failure shows neither.

## Notes

Reported by the operator reading the section: *"shows 4 different things — Plan,
PR, Ticket or branch to review or act upon."* The four kinds and their actions in
the table above are theirs, not derived here.

**The first draft of this plan was wrong and the correction is the finding.** It
claimed four kinds shared one row shape and proposed a `kind` field to separate
them. Measurement showed three of the four already have their own type and
renderer. The operator's reframing is what located the real defect: *"Bei Plan
und PR ist branch das Vehicle nicht der Fokus"*, then sharpened twice — a
failing build is PR work, a merge conflict is branch work. The discriminator is
**where the problem lives**, not whether a PR exists. Both render as a red badge
beside a branch name today, and they send the reader to different places.

`PlanRow` had already reached that conclusion for plans, in a comment that says
so outright. This extends it one kind further.

The interrogation moved four things: a PR that both conflicts and fails CI leads
with the branch and needs `pr.states` as a set rather than an enum; the menu
lands first because two rows of three have no actions at all; a release is a
fifth kind; and the age-only sort here is the same defect #267 fixed one section
over.

That last one is worth noticing on its own. The flicker was found, diagnosed,
fixed and merged in NOT STARTED — and the identical line sat four hundred lines
away in the same file, unexamined, because nobody had watched *this* section
reshuffle. A fix is not finished when the reported instance stops.

The tooltip is the detail worth keeping in mind. *"Branch feature/… on the git
host"* exists because someone already knew the row's kind was unclear — and
answered it with hover text, which is invisible until you suspect there is
something to hover. The fix is to say the thing the tooltip says, in the row,
always.
