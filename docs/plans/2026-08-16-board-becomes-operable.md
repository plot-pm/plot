# The board shows everything and leads nowhere

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:**
- **Started:**
- **Delivered:**

## Problem

Three frictions raised in one session, and they share a question: **what can a
reader do from the board, and where can they get to?**

**Stories are the axis and the dead end.** A plan card names its story as a
badge, the swimlane view uses stories as row headers — and neither leads
anywhere. `StoryCardSchema` carries `slug`, `title`, `status` and **no path**,
and the server has a `/plan/<file>` route but **no `/story/`**. So the one
concept that spans months, the thing plans belong to, is the only artefact the
board cannot open.

**A Draft plan in Discovery offers nothing to do.** Since #130 a plan under PR
review renders as a Discovery card. The obvious next step from looking at it is
approving it, and the card has no affordance for that — the reader has to
remember the slug and switch to a terminal.

**Released grows without bound.** Thirteen delivered plans today, and a column
that only ever grows. Every one of them was worth seeing once; none of them is
worth scrolling past forever.

### Why RELEASED and DONE differ, and why that is right

Raised as a possible bug: the board's `Released` column and the Agents tab's
`Done` group show different things. They should.

| | Unit | Means |
|---|---|---|
| **Released** (Board) | **plans** | phase `Released` — cut into a version |
| **Done** (Agents) | **branches** | git state `merged` — code is on main |

The two tabs run on different clocks, which the fleet contract states outright:
*"A different time axis from the board above: minutes rather than days."* A plan
can be Delivered — every branch merged, every row in `Done` — and still not
Released; that is the state of the five plans delivered today.

So this plan does **not** unify them. It notes that the naming invites the
question: *Done* and *Released* both sound like the end. Renaming is out of
scope here, and recorded as an open point rather than smuggled in.

## Design

### 1. A story is an artefact you can open

`/story/<slug>` renders the story's markdown the way `/plan/<file>` renders a
plan — same sandboxed embed, same `?embed=1` for the modal, same CSP.

**Resolved from the story directory, never from the slug alone.** A story lives
at `docs/stories/<slug>/STORY-<slug>.md`, so the slug is a directory name and a
filename component; both must be checked against the stories the board already
collected rather than joined into a path. `/plan/` learned this the hard way and
its rule carries over: a name resolves against an allowlist, and traversal stays
404.

**Both routes share one hardened resolver, rather than the second copying the
first.** Reading `/plan/` shows it defends against two attacks, not one, and
only the first is obvious. Traversal is handled by the allowlist. The second is
in a comment there: `decodeURIComponent` **throws** on a malformed `%` escape
(`/plan/%E0%A4%A`), and an uncaught throw inside the request listener takes the
process down — so the decode sits *inside* the try and a bad request is a 400,
not a crash. A `/story/` route written from scratch would very plausibly get the
allowlist right and that wrong, and one malformed URL would then kill the board.

The two routes differ only in which allowlist they consult; decode, try/catch,
400-vs-404, CSP and the `?embed=1` handling are identical. So they share a
function. This session has already made that argument once today, when a
duplicated note string became a shared constant — the same reasoning applies
with more at stake.

`StoryCardSchema` gains the resolved path, for the same reason `planFile` exists
on a plan card — the consumer must not reconstruct it, because stripping and
rebuilding a path is where the mistakes live. It carries `slug`, `title` and
`status` today and nothing else, so this is the field that makes the route
reachable at all.

**A story with no file gets an empty path and renders no link** — the rule the
plan rows already follow (`planFile: ''` renders text). The card keeps its title
and status, which are true regardless; hiding the card would lose real
information to avoid a broken link, when not linking suffices.

**The plan modal gains an `Open story` action, beside `Show in board`.** This is
the primary route, and an earlier draft got it wrong by making only the badge a
link. A badge is a label: it says *which* story this plan belongs to, and a
reader has to discover that the text happens to be clickable. A named button in
the header is where people already look for things to do — the modal's own
header is `Show in board`, `Open in new tab`, `Close`, and this joins them.

It appears only when the story resolves to a file; a plan whose story has no
file keeps the badge and shows no button, rather than offering an action that
404s.

**The badge becomes a link as well.** Not instead — the two answer different
questions. The badge is where the story is *named*, on the card, at triage
time; the button is where you *go*, in the modal, once you have stopped
triaging. That split is the same one the worktree path already makes: *"a row
is a triage line and is already full, while a filesystem path is what you want
once you have decided to go look."*

**The overlay's header mirrors the plan modal's exactly** — *Show in board*
(switch to the board tab, filter to that story), *Open in new tab*, *Close*.
Three, not two: an earlier draft miscounted by forgetting `Close`, which is a
poor omission in an argument about symmetry. Symmetry matters more than novelty
here: a reader who has learned the plan modal should not have to learn a second
set of controls.

**The body is the story's own, and that is where the analogy stops.** The plan
modal grew a body section after this plan was first written — the worktree paths
under *"Checked out on this machine"* — and its rationale generalises: the
header answers *where do I go*, the body answers *what now*. A story has no
worktree, so it inherits the header and needs its own body.

What belongs there is the thing the story card cannot say: **which plans make it
up, and what phase each is in.** The board already holds every fact — each plan
card carries `story` and `phase` — and the story card carries only `slug`,
`title` and `status`, which never answers *what is this made of*. The STORY file
has a hand-maintained "Current Plan" section, but hand-maintained is precisely
the problem: four of twelve open points in `plot-board` were stale when swept
this evening, because nothing marks an item resolved when its plan lands. A
derived list cannot drift.

**Opening a story from a plan modal replaces it, and does not stack.** An
overlay above an overlay gives two close buttons and an ambiguous Escape for the
sake of keeping context that the header already names. Replacement is
predictable, and the way back is the same click in reverse.

### 2. Long columns show the recent and offer the rest

A column past a threshold renders its **most recent** cards and a control for
the remainder — not a scrollbar, which hides the count, and not a hard cut,
which hides the work.

**Recency is by the phase's own date**, not by file order: `Released` sorts by
the release date, `Endgame` by delivery. A column that claims to show "the
latest five" and shows five arbitrary ones is worse than showing all thirteen.

**The count is always visible.** `Released (13)` with five shown states plainly
that eight are hidden; five cards with no number reads as *there are five*.

Applies to any column past the threshold, not to `Released` alone. Endgame will
reach it next, and a rule with one hard-coded exception is a rule someone has to
remember.

**The threshold is measured, not decided here.** `Released` holds thirteen
today and `Endgame` is growing; the right number depends on how tall a column
gets before it stops being scannable, which is a question for a browser and not
for a plan file. The implementing branch picks it against real columns and
justifies it in the PR. Writing a number here would be a guess wearing the
authority of a decision — the same mistake this plan's sibling made by naming a
port before checking how one was chosen.

### 3. Approve acts, behind one confirmation

A Draft plan card gains an **Approve** button that runs `/plot-approve <slug>`.

An earlier draft had it merely show and copy the command, on the grounds that
`/plot-approve` under `Review: pr` **merges the plan PR**, rewrites the phase,
writes the `Approved:` record and clears `.plot/hold` — writing to the git host,
undoable only by more git. `Start work`, the board's only other acting control,
creates a worktree and pushes a claim: local, and a wrong click costs a
`git worktree remove`.

That asymmetry is real and it is not the whole picture. The same irreversibility
exists when the command is typed in a terminal, where nothing confirms anything
— and it gets typed *often*: eight plans were approved in a single evening, each
through the identical sequence. A button is not more dangerous than a command
someone runs by rote; it is the same act with less friction. And a
copy-a-command affordance would have introduced a second action vocabulary onto
a surface that has exactly one: two buttons side by side, one acting and one
merely offering text, indistinguishable by looking.

**One confirmation, in the button itself.** The first click turns `Approve` into
`Approve — merges PR #<n>?`; the second runs it; a click elsewhere cancels. No
dialog, no modal above a modal, no new pattern — and the second label names the
*consequence* rather than repeating the verb, which is the part a reader needs
before committing to it. This is the friction a click needs and a typed command
already has.

**It runs through the same door as `Start work`.** `/api/dispatch` spawns
`plot-dispatch.sh` detached and logs it, behind a localhost check, a same-origin
check and slug validation; Approve gets the same treatment for
`plot-approve`. One way for the board to invoke Plot, and the approval rules
stay in the skill rather than being reimplemented beside it.

**A failure shows the script's own words on the card.** `/plot-approve` already
explains itself — *"Plan is still a draft. Mark it ready for review first."*,
a closed PR, a rejected push. Surfacing that text beats replacing it with
"failed": a failure without a reason sends the reader to a terminal, and then
the command could have been typed there in the first place.

Which is also why the button appears on **every** Draft card, including plans
whose PR is not yet marked ready — a state that occurred repeatedly in one
evening. The board would otherwise have to know Approve's preconditions and keep
them in step with the skill, and the same rule would live in two places.

**It appears only on Draft cards.** An approved plan has nothing to approve, and
offering it would invite a second approval whose only effect is a confusing
error.

## Branches

### Navigation

- `feature/board-story-overlay` — `/story/<slug>` route, path on the story card,
  badge becomes a link, overlay with *Show in board* and *Open in new tab*

### Density

- `feature/board-column-overflow` — recent-first truncation with a visible count
  and a control for the rest, by phase date, for any column past the threshold

### Action

- `feature/board-approve-affordance` — Approve on Draft cards, showing and
  copying the command

Three waves, dispatched **one at a time** rather than fanned out. They are
independent in purpose but all reach `PlanCard.tsx` or the contract, and this
repo paid three times in one day for two agents in one file. Navigation goes
first: it is the largest change (route, schema, overlay) and the one the others
point at. Then density. Approve last — it is the only wave that acts, and it
deserves a reviewer looking at it when nothing else is in motion.

## Done when

- **A story opens from an `Open story` button in the plan modal**, and from its
  badge, and *Show in board* lands on the board filtered to that story. Assert
  the button: a badge-only implementation satisfies "a story can be opened" and
  leaves the action invisible to anyone scanning the header for something to do.
- **`Open story` is absent when the story has no file** — no button rather than
  one that 404s, the same rule as the badge.
- **The overlay's header matches the plan modal's**, all three controls. Assert
  by comparison rather than by listing, so the two cannot drift apart.
- **The overlay lists the story's plans with their phases**, derived from the
  board's own cards rather than parsed from the STORY file's prose. Assert
  against a fixture whose hand-written section disagrees with the plan data —
  the derived list must win, since drift is the reason it is derived.
- **Opening a story from an open plan modal replaces it**, leaving exactly one
  overlay and one Close.
- **`/story/<slug>` resolves against the collected stories**, and traversal
  (`../../etc/passwd`, encoded variants) stays 404. Assert the negatives; the
  `/plan/` route has them and this route is the same shape.
- **A story with no file renders no link** rather than a link that 404s — the
  rule the plan rows already follow.
- **A column past the threshold shows the most recent cards and says how many
  are hidden.** Assert the count is present: five cards with no number is the
  failure this is meant to prevent.
- **Recency uses the phase's own date.** Assert against a fixture whose file
  order and date order disagree — otherwise the test passes on a coincidence.
- **Approve appears only on Draft cards**, and on Draft cards whose PR is not
  yet ready. Assert the second case explicitly: it is the state that occurred
  repeatedly in one evening, and an implementation that hides the button there
  has quietly copied Approve's preconditions into the board.
- **The first click does not approve.** Assert that one click makes no request
  and changes the label; a single-click implementation passes every test that
  only checks the end result.
- **The second click posts to the API**, not to the git host directly — the
  approval rules stay in the skill.
- **A failing approval shows the script's own message.** Assert the text
  reaches the card rather than a generic "failed"; the reason is the whole value
  of surfacing it.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.

## Notes

Recorded during a session that had already merged twelve PRs; the three
requests arrived while other work was in flight and are gathered here rather
than built ad hoc.

Open point, not addressed: **`Done` and `Released` both sound like the end**
while meaning different things on different clocks. The distinction is correct;
the names invite the question. Renaming a board column is a bigger change than
this plan, and belongs to
[`plot-board`](../stories/plot-board/STORY-plot-board.md).

Ordering: this plan touches `packages/board/**` only, and so does
[`agent-view-phase`](2026-08-16-agent-view-phase.md) (#131). Both add to
`PlanCard.tsx` and the contract. Whichever is approved first should merge first;
they are not parallel-safe.

**Written 2026-08-16 and lost for four hours** — drafted in a scratch worktree
and never committed, so it existed on exactly one disk, in no ref, invisible to
every view that reports work. Recovered only because the worktree survived and
someone asked whether the plan existed.

That is the precise failure
[`fleet-sees-unpushed-commits`](2026-08-16-fleet-sees-unpushed-commits.md) was
written to surface, and it was committed by the person who wrote that plan while
three agents were being told not to do it. Recorded here rather than quietly
fixed, because it is the strongest argument the fleet work has produced: the
board cannot show what git was never told, and the rule applies to plans as
much as to code.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "The /plan/ route defends against TWO attacks — traversal AND decodeURIComponent throwing on a malformed % escape, which would kill the process. The plan names only traversal.", "a": "Both routes share one hardened resolver. They differ only in which allowlist they consult; a /story/ route written fresh would plausibly get the allowlist right and the decode wrong, and one malformed URL would take the board down", "category": "nonfunctional-security"},
    {"q": "StoryCardSchema has slug/title/status and no path. What about a story with no file?", "a": "Empty path, no link — the rule plan rows already follow. The card keeps title and status, which are true regardless; hiding it would lose real information to avoid a broken link", "category": "ux-edgeCases"},
    {"q": "What threshold for the long-column truncation?", "a": "Measured against real columns by the implementing branch and justified in the PR. Writing a number here would be a guess wearing the authority of a decision", "category": "technical-implementation"},
    {"q": "The plan makes only the story BADGE a link — but the original request was a CTA next to Show in board.", "a": "Both. An Open story button in the modal header is the primary route; the badge stays as a link. The badge NAMES the story at triage time, the button GOES there once you have stopped triaging", "category": "ux-happyPath"},
    {"q": "The plan claims the overlay carries 'the same two actions' — the modal has three, and has grown a body section since.", "a": "Header mirrors exactly, all three. The body is the story's own: which plans make it up and what phase each is in, derived from board cards rather than the STORY file's hand-maintained prose, which was measurably stale", "category": "ux-happyPath"},
    {"q": "StartWorkButton calls itself 'the board's ONE control that changes something'. A copy-a-command Approve would be a second action vocabulary.", "a": "Approve ACTS — overriding the plan's first answer. The irreversibility is real but identical to the typed command, which gets run by rote (eight approvals in one evening). One confirmation lives in the button itself", "category": "tradeoffs"},
    {"q": "What runs the approval, and what does a failure show?", "a": "The same door as Start work — /api/dispatch spawning the script, so the rules stay in the skill. A failure surfaces the script's own message; a reason-less failure sends the reader to a terminal, and then the command could have been typed there", "category": "ux-errors"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": true, "data": false},
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": true, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->

**Its Density wave now overlaps
[`working-rows-show-motion`](2026-08-16-working-rows-show-motion.md)**, written
during the gap. That plan collapses the Agents tab's `quiet` and `done` groups;
this one truncates long *board columns* with a visible count. Different
components, same instinct — long lists should not cost the space that live work
needs. They are compatible, but whoever implements the second should read the
first rather than inventing a second vocabulary for "how many are hidden".
