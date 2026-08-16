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

All three are frontend-only. Nothing in the pulse contract, the schema, or any
script changes — which is why this plan is reviewed in-session and rides its
work branch rather than opening an idea branch.

### 1. Count down to the next refresh

`FLEET_POLL_MS = 4_000` already governs the fleet poll, so the countdown is
derived, not invented: seconds remaining until the next tick, beside the
existing age.

Keep `scanned Ns ago`. The two answer different questions and the pair is the
point — *how old is this* and *when does it change* — and the existing comment
in `AgentList` makes that argument for git-vs-PR ages already.

The PR age keeps its own reading: `PR_REFRESH_MS` is 60 s with backoff to
120 s, so a single countdown covering both would be wrong for one of them. Show
the countdown for the fleet poll only; PR data keeps `· PR data Ns ago`.

**Stop the countdown when the tab is hidden.** `App.tsx` already stops polling
when the agents tab is not open (*"a background 4 s poll would…"*), so a
counter that keeps ticking would count toward a refresh that is not coming —
the same class of lie this plan is fixing.

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

### 3. Clicking a plan opens the modal, with a way through to the board

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

- **The footer counts down** to the next fleet refresh, alongside the existing
  `scanned Ns ago`, and **stops when the agents tab is not open** — assert the
  hidden-tab case, since a counter running against a stopped poll is the same
  kind of false statement the display is meant to remove.
- **Rows are grouped by plan within each waiting-group**, with plans ordered by
  their most urgent row and rows keeping their age order inside a plan.
- **A waiting-group containing one plan shows no sub-heading.**
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
