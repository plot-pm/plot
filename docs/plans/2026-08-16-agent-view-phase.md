# The tab that says when, but never what

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

The Agents tab groups rows by *what they wait for* — `waiting-on-you`,
`working`, `quiet`, `not-started`, `done` — and every one of those is decided
by **time**. `classify()` asks whether a commit landed inside the quiet window
and nothing else. That is the right answer for *is anything moving* and it
cannot answer *moving on what*.

Two consequences, raised as separate requests and sharing one cause:

**WORKING cannot distinguish a human drafting from an agent building.**
`board-ui-polish` is the case that makes this concrete rather than theoretical:
its plan was written, interrogated over several rounds, and approved **on the
branch an agent then built on** (`Impl: same branch`). One row, one branch, two
phases in sequence — and the tab shows the same thing for both. "Someone is
working" covers *a human is still deciding what this should be* and *an agent
is writing code*.

**NOT STARTED cannot say what kind of not-started.** It should mean
*discovered, planned, ready for an agent to pick up* — the hand-off point. It
currently means only "no branch tip we can date".

### The data exists and stops one layer short

Verified, not assumed. `plot-fleet-scan.sh` already calls
`plot-plan-meta.sh` once per plan (line ~366) and that call returns:

```
phase          delivered
type           bug
story          plot-board
started_raw    ['2026-08-16, jwloka, `bug/board-shows-discovery`']
approved_raw   2026-08-16, jwloka, plan-PR #127 merged
```

The pulse keeps the filename, the waves and the branches, and **discards the
rest**. `AgentRow` carries `branch`, `plan`, `wave`, `state`, `group` and no
phase. Nothing needs to be computed that is not already read.

## Design

### Phase per row, derived from BOTH sources — never the plan file alone

The obvious implementation is to carry the plan's phase onto its rows and map
it with `toBoardPhase`. **That produces rows that contradict themselves**, and
this repo has an example sitting in it today:

```
2026-07-25-opus5-longhorizon-hardening.md    Phase: Approved, 0 Started: records
  → board says Design ("approved, nobody has begun")
  → pulse says `in progress` for six of its seven branches
```

Both are correct about their own source: the board reads the plan file, the
pulse reads git. The work began without anyone writing a `Started:` record —
the plan predates #124, which taught dispatch to book one. A row labelled
*Design* beside a note reading *"no commit for 22 days"* is two statements
about the same branch that cannot both be true, and that is the exact defect
class this board has hit three times (`merged` vs deleted ref, `claimed` vs
resumed, `open` vs merged-and-deleted).

So the phase is derived from the pair:

| Plan phase | Branch git state | Row reads |
|---|---|---|
| draft | (any) | **Discovery** |
| approved | no branch / claim only | **Design** |
| approved | real commits, or merged | **Development** |
| delivered | (any) | **Endgame** |
| released | (any) | **Released** |

**git wins where they disagree**, because a commit is evidence and a missing
`Started:` line is only an absence — the same principle that made
`fleet-sees-merged-branches` read merge commits rather than plan annotations.
The `opus5` rows then read *Development*, matching what their commits say,
while the board card keeps saying Design until someone records the start. That
divergence is *itself information*: it means the plan's bookkeeping is behind,
which is worth seeing rather than smoothing over.

`toBoardPhase` stays the single definition of the mapping and gains no second
implementation. The row-level derivation composes it with the branch state
rather than reimplementing it.

### `deferred` sends the row back a phase, with a badge saying why

A `<!-- deferred: -->` annotation is not "paused, resuming later". The
vocabulary is explicit about what it means: *"branch isn't needed"* and
*"worker gave the branch up deliberately"* (`parallel-agent-fleet`), and
`plot-deliver` **skips deferred branches** in its completeness gate — a plan
delivers without them.

So the work was handed back, and the row returns to where it is decided whether
the branch is wanted at all:

| Plan phase | Deferred row reads |
|---|---|
| draft | **Discovery** |
| approved | **Design** |
| delivered / released | unchanged — the plan is past deciding |

Plus a **`deferred` badge**, which carries the part the phase cannot: *this did
not fall back because nobody started it, but because someone gave it up.*
Without the badge, a deferred branch is indistinguishable from one that was
never begun; without the phase change, a branch with month-old commits keeps
reading **Development** while no one is working on it and the question is back
on the table.

An earlier draft of this section kept the phase and added only the badge. That
was too conservative: it treated `deferred` as a pause, and the vocabulary
says it is a return.

**It can never read WORKING**, and this is the one place intent outranks git.
WORKING means *an agent is working on this right now*, which is false for work
someone gave up even if the last commit is minutes old. The exclusion is about
the claim the group makes, not the age of the commit.

Today's code gets half of this right and half wrong, which is why it is worth
stating. `plot-fleet-scan.sh` line 407 replaces the git state outright
(`st="deferred"`), and `classify()` then returns
`{ group: 'not-started', note: 'deferred' }` **unconditionally**. So a branch
that was started and then shelved reads as *never begun*, and the note
`deferred` displaces whatever else the row had to say. The badge fixes both:
`deferred` becomes an annotation carried **beside** the state rather than
instead of it.

The same shape as the `no story` badge on plan cards — mark the thing, do not
bend the state to encode it.

### Where the phase sits

**After the repo column** — the repo stays where it is, constant today but
present so the list needs no rebuilding when a second repo appears.

Its own column, not `w-16` like the repo: "Development" is 11 characters and
would truncate at that width, and a phase reading "Developm…" is worse than
none.

**Where it sits relative to plan and branch is deliberately left open.**
`board-ui-polish` has just moved the plan *before* the branch, so same-plan rows
form a column; a sketch of `repo → branch → phase → PR → plan` would move it
back. Both readings are defensible — *what is this a slice of* versus *what is
this branch, and how far along* — and the honest way to choose is to look at a
row that actually has a phase in it. Ship the phase after the repo, then
decide.

Note for whoever revisits it: the PR marker is **not** a separate cell today.
It is rendered inside `note`, which is linkified where the text contains
`PR #<n>`. Moving it into its own column is a change to how the note is
composed, not a reordering of existing cells.

**The phase is spelled out.** Ship the full word first and look at the result
before compressing it — a shortened form is worth choosing against a real row,
not against an imagined one.

Two constraints for whoever revisits it, both measured rather than assumed:

- **Initials do not work.** Discovery, Design and Development all begin with
  **D**, and two letters are no better (`DE` covers Design and Development).
  Three is the shortest unambiguous form: `DIS DES DEV END REL`.
- **The existing phase icons cannot carry it either.** `PHASE_LEADERSHIP` maps
  👤 to Discovery, Design *and* Endgame, because it encodes *who leads*, not
  *which phase* — an icon-only column would collapse exactly the three that
  matter most here.

Whatever replaces the word later must keep what the contract already requires
of the board's labels: *"Carried as a symbol AND a word, never as colour
alone: roughly one man in twelve distinguishes red from green poorly, and the
same page shows up in greyscale screenshots."*

The waiting-group headings are a different case and already right: ⚠️ 🤖 ⏳
💤 📋 ✅ are one symbol per group, each unique, each already paired with its
label.

### An age for NOT STARTED, on its own clock

A `not-started` row has no branch, so no tip to date, and renders `—`. But it
has an age that matters more than a commit's: **how long it has been waiting to
be picked up.** `plot-sprint-support` was approved in **February** and is
listed today as "eligible — nobody has taken it"; the row cannot say so.

`approved_raw` carries the date and is already parsed.

**It must not reuse `ageMinutes`.** Everywhere else that field means *since the
branch tip moved* and is read in minutes; here it would mean *since the plan
was approved* and be read in months. Overloading one field with two clocks is
how `22d` (no commits for 22 days) becomes indistinguishable from `22d` (never
started, waiting 22 days) — the same ambiguity, one field lower, that this plan
exists to remove. Its own field, and the row labels which clock it is showing.

**No date, no age.** An approved plan with no `Approved:` record shows nothing
rather than zero or "just now", following the same rule as the PR countdown in
[`board-ui-polish`](2026-08-16-board-ui-polish.md).

### A Start button in NOT STARTED

`StartWorkButton` already exists, already dispatches, and already handles the
outstanding-click state — it sits on `PlanCard` only. Nothing new is built.

The obstacle is the same one `board-ui-polish` met with the plan modal: the
button takes a `Card`, and a fleet row is not one. The card is looked up from
the board payload by `planFile`, and **a row whose plan has no card gets no
button** rather than a broken one.

**The button belongs on the row, not on the group.** A `not-started` group can
hold branches from several plans, and dispatch is per plan and wave — a group
level button would have to guess which. Per row, the answer is already decided
by the row.

**It appears only on `not-started` rows.** A row in `working` or `quiet`
already has a branch and a claim; offering to start it would invite the exact
double-dispatch that `fleet-sees-merged-branches` was written to prevent.

## Branches

### Data

- `feature/fleet-row-phase` — the pulse carries plan phase and the approval
  date onto each row; `AgentRow` gains the derived phase and a waiting-age
  field; row-level derivation composes `toBoardPhase` with the branch state

### Display

- `feature/agent-view-phase-ui` — rows show their phase; `not-started` rows
  show their waiting age; `StartWorkButton` on `not-started` rows

Two waves, and this one is a genuine dependency rather than a habit: the
display wave asserts against fields the data wave introduces, and a UI test
written first would assert against a shape that does not exist yet.

## Done when

- **A row shows its phase**, and a `same branch` plan's row moves from
  Discovery to Design to Development as its plan does. Demonstrate against
  `board-ui-polish`, whose history contains all three.
- **git wins over a stale plan file.** Assert the `opus5` shape directly: phase
  `Approved`, zero `Started:` records, real commits on the branch → the row
  reads **Development**, not Design. This is the assertion that fails silently
  if someone later simplifies the derivation to read the plan file alone.
- **`not-started` rows show a waiting age** from `Approved:`, in its own field
  and visibly a different clock from a commit age. Assert that a 22-day commit
  gap and a 22-day wait do not render identically.
- **A plan with no `Approved:` record shows no waiting age** — not zero, not
  "just now".
- **A deferred branch falls back a phase and shows why.** A branch with real
  commits under an approved plan reads **Design** with a `deferred` badge — not
  Development (nobody is working on it) and not bare Design (that would be
  indistinguishable from never-started). Assert both halves; each alone is the
  wrong answer.
- **The note is not replaced by the word `deferred`.** Today `classify()`
  returns `{ group: 'not-started', note: 'deferred' }` unconditionally, so
  whatever the row had to say is displaced. The badge carries that fact; the
  note keeps its own.
- **A deferred branch never reads WORKING**, even with a commit inside the
  quiet window. This is the one place intent outranks git, so it needs the test
  that a fresh commit does not pull it in.
- **The phase follows the repo column**, in its own column wide enough for
  "Development" — assert the longest phase name is not truncated.
- **The phase is spelled out.** Assert the full word appears in the row's text,
  so an icon-only or initial-only rendering cannot pass: three phases begin
  with D, and `PHASE_LEADERSHIP` maps 👤 to three of the five.
- **The Start button appears only on `not-started` rows**, and a row whose plan
  has no board card gets no button rather than a broken one.
- **`toBoardPhase` has exactly one implementation.** Assert that the row
  derivation calls it rather than restating the mapping; a second copy is how
  the two views drift apart.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.

## Notes

**Ordering: `board-ui-polish` must merge first.** It is mid-implementation in
`AgentList.tsx`, `schema.ts` and `App.tsx`, and it is adding fields to
`AgentRowSchema` right now (`branchUrl`, the PR refresh interval). This plan
adds another to the same object. Three parallel branches stayed collision-free
today only because nobody widened a scope after the fan-out began; this plan
waits for the same reason.

The two plans are also complementary rather than overlapping:
`board-ui-polish` makes each row's *links and timing* honest, this one makes
its *phase* legible.

Recorded first as an open point in
[`plot-board`](../stories/plot-board/STORY-plot-board.md) on 2026-08-16, from
two requests that looked separate and shared one missing field.
