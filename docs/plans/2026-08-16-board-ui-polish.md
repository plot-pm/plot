# Three things the agent view makes you work out for yourself

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Review:** in-session
- **Impl:** same branch
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Three small frictions in the Agents tab, all of the same kind: the view has the
information and makes the reader reconstruct it.

**The footer counts up, not down.** It reads `scanned 2s ago · PR data 74s ago`
— honest about staleness, silent about what matters when you are watching a
fan-out: *when does this change next?* The number rises until it resets, so
telling "about to refresh" from "just refreshed" means watching it for a
while.

**Rows are grouped only by waiting-state.** With fifteen branches across seven
plans, `QUIET (6)` lists six `opus5-hardening` branches that are six slices of
**one** plan, while three rows of `reconcile-scan-accuracy` sit apart in
`DONE`. The plan name is on every row, so the grouping exists in the data and
is left for the eye to do.

**Clicking a plan leaves the board.** `AgentList` links plan names to
`/plan/<file>`, which navigates away to the rendered markdown. The board
already has a modal for exactly this (`PlanModal`, opened from a card), so the
agent view sends you out of the app while the board keeps you in it.

## Design

Mostly display, with **two additive fields** the display cannot honestly do
without: the PR refresh interval (§1) and the repo's branch URL (§3). Both are
optional, both degrade to showing less rather than to guessing, and neither
changes an existing field's meaning — so the pulse's shape holds and older
payloads still validate.

Named here rather than discovered during implementation, because "frontend
only" was the reason this plan takes the lightest ceremony, and that claim has
to survive contact with what it actually needs. It still does: no script logic
moves, and the two fields are values the server already knows.

One thing is deliberately **out**: a link on `green` to the CI run. That needs
a checks URL carried through `plot-host.sh` and the pulse — a different kind of
change, and the point at which this stops being a display plan. Recorded in
§3 as a follow-up.

### 1. Count down to the next refresh — both counters

Every age in the footer counts **up**, and both get a companion counting down:

```
scanned 1s ago · next in 3s   ·   PR data 74s ago · next in 46s
```

Keep the ages. The two readings answer different questions and the pair is the
point — *how old is this* and *when does it change* — the same argument
`AgentList` already makes for keeping git and PR ages apart.

**The git countdown is derived from `FLEET_POLL_MS = 4_000`**, which the client
owns. One nuance worth writing down rather than discovering later: that poll
reads a **server-side cache** which the server rescans on its own 5 s timer
(*"/api/fleet reads a cache the server refreshes on its own timer; it never
runs a scan per request"*). So the countdown answers *when can this display
change*, not *when does git get re-read*. That is the right question for a
reader watching a fan-out, and it is the only one the client can answer
honestly.

**The PR countdown needs a new field, and must not guess without it.**
`PR_REFRESH_MS` is 60 s with backoff to 120 s when the host reports a rate
limit, and the fleet payload carries `prAgeSeconds` but **no interval** — so a
client assuming 60 s would count to zero and sit there while the server waited
out a 120 s backoff. That is exactly the failure this plan exists to remove: a
display that renders *"I don't know"* as *"any moment now"*.

So `FleetSchema` gains one optional field — the seconds until the next PR
refresh, as the server currently intends it, backoff included. Additive, and
the server already knows the number. **When it is absent, show no PR countdown
at all** (an older server, or a board built before this change): the age alone
is still true, and omitting is the honest degradation.

**Stop both countdowns when the tab is hidden.** `App.tsx` already stops
polling when the agents tab is not open, so a counter that kept ticking would
count toward a refresh that is not coming.

### 2. Group rows by plan, inside each waiting-group

**By plan, not by story.** The row carries `plan` and `planFile` already; story
is not on a fleet row at all, so grouping by it would need a new field through
the pulse and schema. But the reason is not cost: the waiting-groups answer
*what needs me next*, and within that the useful unit is the plan — the thing
whose waves are being worked. A story spans weeks and several plans; it is the
board's axis, not this view's.

Waiting-group stays the outer grouping. It is the question the tab exists to
answer, and demoting it to a sub-heading would turn a triage view into an
inventory.

Within a group, rows are already ordered by age (`sortRows` by `ageMinutes`
descending). Grouping must keep that order *inside* each plan, and order the
plans by their most urgent row — otherwise a plan with one stale branch would
outrank one with a branch that just moved.

**A group with one plan gets no sub-heading.** Chrome that never varies is
noise; the heading earns its place only when it separates something.

**Every waiting-group is grouped the same way, `DONE` included.** It is the
group that grows fastest over a working day — seven rows from three plans by
this evening — so it is the first to become a list one scrolls past. A rule
with an exception for the group nobody reads is a rule someone has to remember;
one rule for all of them is simply how the view works.

### 3. Every link goes where its text says

Today one row offers one link, and it is on the wrong word:

```tsx
<a href={row.pr.url} title={`PR #${row.pr.number}`}>{row.branch}</a>
```

The **branch name** opens the PR, while `PR #130 green` beside it is plain
text. Both halves are surprising: you look for the PR link where the number is,
and a branch name implies the branch.

Three links, each landing where its text points:

| Text | Goes to |
|---|---|
| `bug/board-shows-discovery` | the branch on the git host |
| `PR #130` | the pull request |
| `green` | the CI run — **not in this plan**, see below |

**The branch link needs a repo URL, which the board does not have.** Deriving
it from the PR URL (`…/pull/130` → `…/tree/<branch>`) was rejected: it only
works for rows that *have* a PR, and the rows without one — `not-started`,
`quiet`, fresh claims — are exactly where "go look at the branch" is most
useful. So the URL comes from `git remote get-url origin`, once per board read,
not per row, with the host's branch form (`/tree/<branch>` on GitHub,
`/branch/<branch>` on Bitbucket) chosen by the same gh/bb distinction the rest
of the board already makes.

**A merged branch gets no link.** Its remote page is gone — since today, that
is every row in `DONE` — and the existing rule in this file is explicit that a
missing address means plain text rather than an invented one. The `merged`
state already says where the work went.

**`green` stays plain text, and that is a deliberate stop.** The fleet row
carries `{number, url}` and **no checks URL**; adding one means a new field
through `plot-host.sh`, the pulse, and the schema — a different kind of change
from the rest of this plan, which touches display only. Recorded as a follow-up
rather than smuggled in.

### 4. Clicking a plan opens the modal, with a way through to the board

`PlanModal` renders the plan's markdown in a sandboxed iframe — it is a plan
*viewer*, not the card. So the click should open it in place (no navigation),
and the modal needs one addition:

**a "Show in board" button** that closes the modal, switches to the board tab,
and filters to that plan's story — landing on the card in its column, among its
neighbours.

This is why the button is needed rather than optional: the modal answers *what
does this plan say*, and the board answers *where does it sit*. Without the
button the second question still costs a manual tab switch and filter, which is
the friction this plan set out to remove.

Everything needed is already wired in `App.tsx`: `setTab`, `setStorySel`,
`setOpenPlan`, and the URL sync that follows them. The button composes them; it
introduces no new state.

`PlanModal` takes a `Card`, and a fleet row is not one — the row carries
`planFile`, and the card must be looked up from the board data by that file.
**When the board has no matching card, the plan name stays a plain link to
`/plan/<file>`** rather than opening an empty modal. That is not hypothetical:
a Draft plan on an idea branch is on the board only since #130, and a plan
outside the walked directories would have a row and no card.

## Branches

- `feature/board-ui-polish` — all three changes; the plan rides this branch and
  one PR carries plan and code

## Done when

- **Both footer ages gain a countdown**, beside the existing `scanned Ns ago`
  and `PR data Ns ago`, and **both stop when the agents tab is not open** —
  assert the hidden-tab case, since a counter running against a stopped poll is
  the same kind of false statement the display exists to remove.
- **No PR countdown is shown when the server does not report its interval.**
  Assert the absent-field case explicitly: a client that assumed 60 s would
  count to zero and sit there through a 120 s backoff, rendering "I don't know"
  as "any moment now".
- **Rows are grouped by plan within each waiting-group**, with plans ordered by
  their most urgent row and rows keeping their age order inside a plan.
- **A waiting-group containing one plan shows no sub-heading**, and `DONE` is
  grouped like every other group.
- **The branch name links to the branch on the host**, for rows with and
  without a PR alike — assert a `not-started` row, since that is the class the
  rejected PR-URL derivation would have left unlinked.
- **A merged branch's name is plain text**, no link. Its remote page is gone.
- **`PR #<n>` is the link to the pull request.** Assert that the branch link
  and the PR link have different targets — today they are the same one on the
  wrong word, which a test asserting "a link exists" would not catch.
- **The repo URL is read once per board read, not per row**, and a repo whose
  origin is unrecognised (no gh/bb form) renders every branch as plain text
  rather than guessing a URL shape.
- **Clicking a plan opens `PlanModal` in place** — no navigation — and the
  modal's "Show in board" button lands on the board tab filtered to that plan's
  story.
- **A row whose plan has no board card keeps the plain `/plan/<file>` link**
  and does not open an empty modal. Assert it; this is the case that appears
  only in repos unlike this one.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.

## Notes

Ceremony: `Review: in-session` + `Impl: same branch` — the lightest allowed
path, per the manifesto's rule that *more* ceremony needs the justification.
Three display changes in one package, no contract touched.

Ordering: **#130 must merge first.** It changes `AgentList.tsx`, `schema.ts`
and the built artifact, which is the one file parallel branches reliably
collide in — three merges collided there earlier today. This branch starts from
the merged result rather than racing it.
