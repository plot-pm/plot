# The tab that says when, but never what

## Status

- **Phase:** Released
- **Type:** feature
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-16, jwloka, plan-PR #131 merged
- **Started:** 2026-08-16, Jan Wloka, `feature/agent-view-phase-ui`
- **Delivered:** 2026-08-16
- **Released:** 2026-08-18, v2.5.0
- **Started:** 2026-08-16, Jan Wloka, `feature/fleet-row-phase`

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

**"git wins" is not symmetric, and the delivered row is where that shows.** A
commit landing on a branch under a plan already marked `delivered` does not
pull the row back to Development. The table above already says so —
`delivered | (any) | Endgame` — but only by omission, and the rule as stated
invites the opposite reading.

The asymmetry is right because the two cases are not mirror images. The
`opus5` case is an **absence**: a missing `Started:` record is nobody having
written something down, and a commit is evidence that outranks it. A commit
after delivery is a **contradiction of a recorded decision** — a human wrote
`Delivered:`, and a follow-up fix does not repeal it. Treating every late
commit as a phase reversal would send a plan visibly backwards for a typo fix,
which teaches readers to distrust the column. The commit is not hidden: the
row's age still shows something moved, which is the honest report — *this plan
is delivered, and something touched it recently* — without restating it as a
phase the plan is not in.

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

### A draft PR's red CI is invisible

Found while checking this plan's own PR, which is the case: `#131` reports
`checks: failing` from the host adapter and the board renders only
`PR #131, draft`.

The cause is an ordering, not an omission. `fleet.ts` line 768 asks `pr.draft`
**before** anything asks about checks:

```ts
const { group, note } = pr.draft
  ? { group: 'waiting-on-you' as const, note: `PR #${pr.number}, draft` }
  : classify('wip', 'eligible', ageMinutes, quietMinutes, pr);
```

Both halves were argued and both are right about their own question. `classify`
declines to claim a *green* draft — "a draft is still the author's, not yours" —
and the shortcut is right that a draft belongs in `waiting-on-you` regardless,
since the author is the reader. What neither noticed is that the shortcut
answers for **every** draft, so a green draft and a red one produce the
identical row. The group happens to be correct; the note loses the only fact
that changes what the author should do next.

The fix keeps the draft framing and lets the checks speak inside it —
`PR #131, draft, checks failing`. Group unchanged: a failing draft is still
waiting on its author, and moving it would claim a review nobody asked for.

It sits in this plan because it is the same function, the same file and the same
defect class the plan already treats: a row that states a time and withholds the
state. It is also a regression introduced hours ago in `board-ui-polish`, so it
is small and its blast radius is one ternary.

### Where the phase sits

**It takes the repo column's place**, rather than adding a seventh cell to a
row that already carries plan, branch, note, PR and age — and wraps when a
branch is called `feature/opus5-hardening-challenge-budget`.

The repo is the right thing to give up. It is constant in a one-repo board (its
own comment says so: *"Constant today, and visually quiet"*), it is rendered
**nowhere else** in the app, and a column that shows the same word on every row
is the definition of chrome that never varies — the argument this plan's
sibling used to drop a plan heading. The board's cards keep repo context if a
second repo ever appears; the agents list is about what is moving, not about
where it lives.

Wider than the repo's `w-16`, which fits 8–9 characters at `text-xs`:
"Development" is 11 and would render "Developm…", worse than nothing.

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

**The word travels alone, and the contract's symbol rule does not bind here.**
Worth stating, because reading that rule loosely would argue the opposite. It
is the doc comment on `PHASE_LEADERSHIP` — *"Carried as a symbol AND a word,
never as colour alone"* — and it exists to stop **colour** from being the only
carrier, for the reader who cannot separate red from green and for the
greyscale screenshot. A word is already that non-colour channel. The rule also
sits on the one map this plan has ruled out: 👤 covers Discovery, Design and
Endgame, so borrowing its icons would collapse the distinction the column
exists to draw. Board and swimlanes pair icon with word because they render
`PHASE_LEADERSHIP`; this column does not, and inventing a second five-icon
vocabulary would put two meanings on every phase — *which phase* and *who
leads* — for decoration.

**A screen reader needs the label the layout implies.** The list is a `<li>`
of `<span>`s — a visual table with no semantics, so column position conveys
nothing and each row is heard as a run of words. Today that survives on luck:
`plot` reads as a repo name because it looks like one. `Development` does not
announce itself as a phase. So the cell carries an `sr-only` label before the
word. `title` is what the neighbouring cells use (branch at line 243, waiting
age at 266) and it is the weaker instrument — never shown on touch, read
inconsistently across screen readers — so it may accompany the label but not
replace it. The deeper fix is to make the fake table a real one, which is
larger than this plan and belongs to
[`plot-board`](../stories/plot-board/STORY-plot-board.md).

The waiting-group headings are a different case and already right: ⚠️ 🤖 ⏳
💤 📋 ✅ are one symbol per group, each unique, each already paired with its
label.

### An age for NOT STARTED, on its own clock — shipped early

**Delivered ahead of this plan, in `board-ui-polish`**, because it was asked for
directly while that branch was open. The reasoning below is kept as the record
of *why* the field is separate rather than as work outstanding; the code is on
`main` and the assertions are in its suite.

One thing changed in the building. The design below argues for a distinct field,
and that still holds — but it first rendered as a distinct *badge* beside an age
column reading `—`, which put two answers to "how old is this" in one row, one
of them empty. The field stayed; the second position did not. The waiting age
now takes the age column when there is no commit age, with colour and title
carrying the distinction.

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

**It appears only on `not-started` rows that are `eligible`.** Two things live
in that group: `eligible — nobody has taken it` and `blocked by an earlier
wave`. A button on the second would offer to skip the ordering waves exist to
express — and `plot-dispatch` refuses that branch for the same reason, so the
board would be inviting an action the tool declines.

No greyed-out control on blocked rows either: a button whose usual state is
"you cannot" teaches people to ignore buttons. The note already says *blocked by
an earlier wave*, which is the whole explanation.

And never on `working` or `quiet` rows, which already have a branch and a
claim; offering to start one invites the exact double-dispatch that
`fleet-sees-merged-branches` was written to prevent.

### DONE loses the work at the moment it finishes

Raised while looking at the tab: five plans were delivered today, together
naming eight branches, and `DONE` showed **one**.

Measured rather than guessed — `plot-fleet-scan.sh` reads
`docs/plans/active/` only, and delivering a plan moves its symlink to
`delivered/`. The plan leaves the pulse in that instant, taking every branch
with it. The pulse now sees two plans where the repo has sixteen.

The intent is defensible: a delivered plan is not being worked on, so it does
not belong in a view of work in flight. The effect is not. Merge and delivery
are minutes apart in practice, so **work disappears at the moment it becomes
finished** — and `DONE` is left showing whichever branch happens to sit in the
gap. A group that is full by accident is worse than one that is empty by rule.

So the pulse also reads recently delivered plans, **bounded by time rather than
by count**. "What finished today" empties itself as the day passes; "the last
five" shows five whether the newest is an hour old or six months. The board's
own `Released` column has the same problem waiting for it, and the same answer
applies there.

**A rolling 24 hours, not the calendar day.** Literally "delivered today" is
easier to explain and wrong at exactly the wrong moment: a plan delivered at
23:50 vanishes ten minutes later, mid-session, while the branches it names are
still on screen. The window is also the one number this repo already uses for a
freshness bound — `Claim stale after: 24` — so it is one unit to learn rather
than two.

**The window filters before the parse, not after.** Measured: 18 plan files
cost 1.03 s through `plot-plan-meta.sh`, ~57 ms each, against a scan that
already runs 500–1050 ms. Parsing all 14 delivered plans to then discard 13 of
them would roughly double the pulse — and that cost grows with the archive,
which only ever gets larger, while the answer it produces stays the size of a
day's work. So the cheap signal comes first (the delivered symlink's own
mtime), and only the candidates it admits are parsed. The `Delivered:` record in
the file remains the decider; mtime is a pre-filter that may over-admit and must
never exclude — a checkout can freshen an old file, so the parse still has the
last word, but nothing that mtime rules out could have been delivered today.

On a fresh clone or a CI worktree every file carries the same checkout
timestamp, so the pre-filter admits **all** of them. That is the acceptable
direction, and worth naming here rather than discovering later: the result
stays correct and only the saving is lost, on a run that happens once. Reaching
for `git log` per plan to avoid it would spend a git call to save a parse —
plausibly the whole optimisation, to fix a case that costs nothing when it is
wrong.

**A delivered plan with no `Delivered:` date does not appear.** Not
hypothetical: `docs/plans/delivered/reconcile-scan-accuracy.md` is in the
delivered index today with an empty record. No date means no membership in any
window, following the rule this plan already states for the waiting age — *no
date, no age*. The alternative, showing it always, creates the one row that can
never age out of DONE. The missing record is a bookkeeping fault that
`plot-reconcile-scan.sh` is built to report; a view that quietly compensates
for it makes the fault harder to see, which is the opposite of what this tab is
for.

This is the same distinction that surfaced twice today in other clothes — a
merged branch with no plan vanishes when its ref is deleted, and `Released` and
`Done` differ because plans and branches run on different clocks. Each time the
question is whether this tab is a **state** or a **journal**. It is a state,
and a state view still has to hold the last few minutes of it.

## Slices


### Data (Branch: feature/fleet-row-phase, PR: #140)
- → #140 — the pulse carries plan phase onto each row and
  also reads recently delivered plans (rolling 24 h, mtime-prefiltered, no date
  no row); `AgentRow` gains the derived phase; row-level derivation composes
  `toBoardPhase` with the branch state; a draft PR's note carries its check
  state (the waiting-age field shipped early in `board-ui-polish`)


### Display (Branch: feature/agent-view-phase-ui, PR: #147)
- → #147 — the phase replaces the repo cell;
  `deferred` badge; `StartWorkButton` on eligible rows

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
- **The phase REPLACES the repo column**, wide enough for "Development" —
  assert the longest phase name is not truncated, and that the repo no longer
  renders in an agent row.
- **A recently delivered plan still appears in DONE**, and an old one does not.
  Assert both halves against a fixture whose delivery dates straddle the window:
  a test that only checks "delivered plans appear" passes with no bound at all.
- **The window is rolling, not the calendar day.** Assert a plan delivered 23
  hours ago is present and one delivered 25 hours ago is not — a day-boundary
  implementation passes a "delivered today" test and fails this one.
- **A delivered plan with an empty `Delivered:` record does not appear.**
  `reconcile-scan-accuracy.md` is the live example; assert the absence, because
  the failure mode is a row that is never old enough to leave.
- **The mtime pre-filter never excludes a plan the parse would admit.** Assert a
  plan whose file mtime is stale but whose `Delivered:` record is inside the
  window still appears — the pre-filter is allowed to over-admit and pay a
  parse, never to drop a real answer. Without this the optimisation silently
  becomes the rule.
- **A draft PR with failing checks says so.** Assert the note carries the check
  state alongside `draft`, and that the group stays `waiting-on-you` — asserting
  only the group passes against today's code, which is the bug.
- **The phase is spelled out.** Assert the full word appears in the row's text,
  so an icon-only or initial-only rendering cannot pass: three phases begin
  with D, and `PHASE_LEADERSHIP` maps 👤 to three of the five.
- **The phase cell carries an `sr-only` label.** Assert the accessible name
  says *phase*, not just `Development` — a bare word in a `<span>` row conveys
  its meaning by column position, which a screen reader does not have.
- **A delivered plan with a fresh commit still reads Endgame.** Assert it does
  not fall back to Development: "git wins" is about absent records, not about
  overruling a recorded delivery, and the symmetric implementation passes every
  other test in this list.
- **A fresh clone still answers correctly.** Assert that when every plan file
  shares one mtime the delivered window is still respected — the pre-filter may
  admit everything, but the `Delivered:` record must still exclude the old.
- **The Start button appears only on `eligible` rows.** Assert it is absent on
  a `blocked by an earlier wave` row — that is the case where the board would
  otherwise offer an action `plot-dispatch` refuses. And a row whose plan has no
  board card gets no button rather than a broken one.
- **`toBoardPhase` has exactly one implementation.** Assert that the row
  derivation calls it rather than restating the mapping; a second copy is how
  the two views drift apart.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.
- macOS ships bash 3.2: no `declare -A`, no bash-4-only constructs.

## Notes

**Approved but NOT dispatched, deliberately — 2026-08-16.**
`fleet-sees-local-work` is mid-implementation on `bug/fleet-sees-local-work`
and holds four of the files this plan's data wave opens, not the two the note
below predicted: `fleet.ts`, `plot-fleet-scan.sh`, `schema.ts` and
`test/unit/fleet.test.ts`. `schema.ts` is the sharp one — both plans widen
`AgentRowSchema`, that plan with `localWorktree`/`localDirty` and this one with
`phase`.

The hold cannot be lifted by a merge-queue check, because it has no ref to
check: that branch has **no PR**, one unpushed commit and eight uncommitted
files. The collision is real and invisible to git — which is, exactly, the
blindness that plan exists to fix. Dispatch this one once its PR merges.

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

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {"q": "Part of this plan shipped early in board-ui-polish — how to handle?", "a": "Mark as delivered, keep the reasoning as the record of why the field is separate", "category": "technical-implementation"},
    {"q": "not-started holds eligible AND blocked rows — where does the Start button go?", "a": "Eligible only; a button on a blocked row would offer to skip the ordering waves express, and plot-dispatch refuses it anyway", "category": "domain-workflows"},
    {"q": "Which plan first — this one or board-becomes-operable?", "a": "This one: the phase is the field other features reference (Approve only on Draft cards)", "category": "tradeoffs-ordering"},
    {"q": "Where does the phase go in an already-full row?", "a": "It REPLACES the repo cell — repo is constant, rendered nowhere else, and a row with seven cells wraps on long branch names", "category": "ux-layout"},
    {"q": "DONE showed one branch where five delivered plans named eight — why?", "a": "The pulse reads active/ only, so delivery removes a plan instantly. Read recently delivered plans too, bounded by TIME rather than count", "category": "domain-data"},
    {"q": "Reading 14 delivered plans costs ~800ms on a 500-1050ms scan — where does the window filter?", "a": "Before the parse: mtime pre-filter admits candidates, the Delivered: record decides. Cost scales with a day's work, not with the archive", "category": "nonfunctional-performance"},
    {"q": "reconcile-scan-accuracy.md is in delivered/ with an EMPTY Delivered: field — what does the row do?", "a": "Does not appear. No date, no window — same rule as the waiting age. Showing it creates a row that can never age out, and hides a bookkeeping fault reconcile-scan exists to report", "category": "ux-edgecases"},
    {"q": "Calendar day or rolling window?", "a": "Rolling 24h: a 23:50 delivery must not vanish at 00:00 mid-session, and 24 is the number the repo already uses (Claim stale after)", "category": "ux-edgecases"},
    {"q": "A draft PR's failing CI renders as just 'draft' — where does the fix go?", "a": "Into this plan's data wave: same file, same function, same defect class (a row stating time and withholding state). fleet.ts:768 asks pr.draft BEFORE checks, collapsing green and red drafts into one note", "category": "ux-errors"},
    {"q": "The plan cites the contract's 'symbol AND word' rule, but that rule sits on PHASE_LEADERSHIP — the map this plan rules out. Contradiction?", "a": "Word only, and say why: the rule targets COLOUR as sole carrier, and a word is already the non-colour channel. A second five-icon vocabulary would put two meanings on every phase", "category": "ux-accessibility"},
    {"q": "The list is <li>+<span> — no table semantics. 'plot' reads as a repo by luck; 'Development' does not announce itself as a phase.", "a": "sr-only label on the cell. title is what neighbouring cells use but is weaker (absent on touch, inconsistent across readers) — it may accompany, not replace. Real table semantics belong to the story", "category": "ux-accessibility"},
    {"q": "'git wins' — so does a fresh commit under a DELIVERED plan pull the row back to Development?", "a": "No. The asymmetry is the point: opus5 is an ABSENCE (no Started: record) which evidence outranks; a late commit contradicts a RECORDED decision. Endgame stays, the age shows the commit", "category": "domain-rules"},
    {"q": "On a fresh clone every file shares one mtime, so the pre-filter admits everything. Acceptable?", "a": "Yes — the safe direction. Result stays correct, only the saving is lost, once. git log per plan would spend a git call to save a parse", "category": "nonfunctional-scalability"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": true, "data": true},
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": true},
    "nonFunctional": {"security": false, "performance": true, "scalability": true},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
