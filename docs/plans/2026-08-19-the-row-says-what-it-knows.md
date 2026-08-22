# The row says what it knows

> A row reads *eligible — nobody has taken it*, which invites the reader to
> take it. Nine such rows are on the board and not one can be started: every one
> is missing the brief a worker is told to read first. A plan reads *3 waves,
> first eligible* above nothing at all, because it is folded and the control
> that says so is five pixels wide. Both are the same defect — a row stating a
> fact and withholding its consequence.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — six display findings measured on the live board
- **Delivered:** 2026-08-22, jwloka, PRs #290, #297

## Problem

Reported from the board on 2026-08-19: *"Warum steht 'eligible — nobody has
taken it' wenn es echte Abhängigkeiten gibt? Können wir diese nicht benennen?"*

The note is not wrong. It is **incomplete in a direction that costs work**: it
names a state and implies an action, and the action does not work.

### What `eligible` actually claims

`plot-fleet-scan.sh` calls a wave eligible when every non-deferred branch in
every prior wave is merged. That arithmetic is right, and the two branches that
prompted the question are genuinely eligible by it:

| Branch | Waited on | State |
|---|---|---|
| `feature/the-worker-command-says-nobody-is-watching` | `skills-know-when-nobody-is-there` | merged |
| `feature/api-claim-and-transition` | `api-attention-says-what-needs-you` | merged |

So the dependency the operator sensed was real, and is **satisfied**. The row
is telling the truth about waves.

### The fact it omits, which the server already has

A worker cannot start without a **brief**. The `Worker command` in `CLAUDE.md`
opens with *"Read `.plot/briefs/${PLOT_BRANCH##*/}.md` first — it is the
specification"*, and `plot-dispatch.sh` reports `brief=missing` unconditionally
because it cannot write one and never will: a brief is interpretation, and
`/plot-implement` owns it.

**Measured 2026-08-19: nine eligible branches on the board, zero briefs** — and
re-measured the same evening, after four plans had been delivered: 8 of 14. The
count is not stable and does not need to be; what holds is that a brief is
missing more often than not.

The measurement exists, but not where the row can reach it. `briefPath` and
`briefExists` are fields of **`ClaimableSchema`** (`schema.ts:1858`) — the shape
`/api/attention` returns — and `fleet.ts` does not mention `briefExists` once.
So an agent asking the API is told and a person reading the row is not, and the
reason is that the two answers are built by different code from the same repo.

That makes this slightly more than a rendering change, and the cost is worth
stating because it is the objection a reviewer will raise: the fleet build
would gain one `existsSync` per branch per pulse. Measured 2026-08-19 on this
repo — 60 branches, 100 iterations — **0.2 ms per pulse**, against a scan that
takes 14 s. The check is free; the plumbing is the work.

An alternative that avoids the plumbing entirely: have the row read the same
`/api/attention` payload the agents read. Rejected on a shape mismatch rather
than on cost — `attention` answers *what should I do next* over a filtered set,
while the row needs a per-branch fact for every row it draws, including the
ones attention deliberately omits.

### Why the wording makes it worse rather than merely quieter

*"nobody has taken it"* reads as an invitation with a missing actor — the row
supplies the reason nobody has taken it as if it were an accident. The honest
reading is that the next action is not *take this branch* but *write its
brief*, and those are different jobs done by different things: a worker takes a
branch, `/plot-implement` writes a brief.

An operator following the row's suggestion runs `/plot-dispatch`, which starts
a worker that reads a file that is not there.

### The same row, read a second way

Measured on the board 2026-08-19: seven plans in NOT STARTED, five of them
showing *"1 wave, first eligible"* or *"3 waves, first eligible"* with **no
branch rows beneath them at all**. The operator's question was the obvious one:
*what is `first` when no first is shown?*

The data is right — those plans do have branches, and `the-index-is-derived`
has three. All five are **folded**: `aria-expanded="false"`, and the only sign
of it is a 6px `▸` before the name. The two plans that do show branches have no
toggle at all.

So the summary describes contents the reader cannot see, and the phrase that
does the describing — *first eligible* — is a superlative over an invisible
list. It is the same defect as the brief one: **a row stating a fact whose
consequence it withholds.** Whether the fix is the summary naming the fold
(*3 waves, first eligible — 3 branches hidden*), the fold being more visible,
or folded plans not claiming a *first* at all, is a design question this plan
records rather than settles.

### A deferred row says `deferred` and `no commits`, and never says why

Reported from the board 2026-08-19: two rows under
`the-repair-exists-but-nothing-calls-it` read `deferred` beside `no commits`,
and the operator asked what to do with that. The honest answer is *nothing* —
and the row does not say so.

`deferred` means the branch will not be built, and the reason is recorded where
a person can read it:

```
<!-- deferred: verified already implemented 2026-08-17 —
     startRepair() at fleet.ts:806, covered by conflicts.test.mjs -->
```

**That sentence never leaves the plan file.** `plot-plan-meta.sh:445` tests
whether the annotation is *present* and emits `"true"`; the text after the colon
is not captured. `BranchSchema` matches with `deferred: z.boolean()`
(`schema.ts:42`). So the row gets a flag and the explanation stays behind.

The consequence is that `deferred` and `no commits` sit side by side as two
unrelated facts, when the first is the reason for the second. A reader with no
access to the plan file sees a branch nobody started and no statement that
nobody should.

**This is the same shape as the other two, one layer deeper.** The brief case is
a fact the server has and the row omits; the fold case is a fact the row states
about something invisible; this is a fact **the plan file has and the pipeline
discards** — the row could not say it even if it wanted to.

Three deferred rows exist today, across two plans, and one of them has been on a
`Released` plan since April: *"never created — the work landed directly on
main"*. They are not clutter to be swept: **the annotation is the reason a
branch is missing**, and deleting it leaves a plan naming three branches where
git has one. What is missing is not the cleanup, it is the sentence.

### The plan row lost the one action that belongs to it

Found on the board 2026-08-19, hours after `a-plan-row-is-not-a-branch-row`
landed — and it is a regression that change introduced.

A Draft plan needs approving, and approving is the one action that belongs to
the **plan** rather than to any branch of it. `ApproveButton` exists, the server
reports `approve: {available: true}`, and the card reads `phase: Discovery`.
Every precondition holds. The button renders inside the `⋯` menu — which lives
on a **branch** row, and a Draft branch has nothing to start, so the menu is
absent and its four rows read `—`.

The plan row has no menu at all. That was deliberate and the reasoning is in the
commit: *dispatch is per branch and wave, so a control there would have to guess
which wave it meant, and an empty track to hold nothing is what this row just
stopped doing.*

**True of dispatch, false of approve.** The argument was made about the action
that needs a branch and applied to the cell that also held the one that does
not. So a plan whose whole state is *waiting for a person to approve it* offers
that person nothing to click, and the row says *plan not approved yet — still in
review* as if review were happening somewhere else.

This is the fourth face of the same defect and the sharpest, because the row is
not merely withholding a consequence — it names an action and then declines to
host it.

### A round nobody counted

`rounds` exists (`schema.ts:79`), `roundsBadgeText()` renders it
(`PlanCard.tsx:122`), and the Agents tab does not: zero references in
`AgentList.tsx`. For this plan the field would be empty anyway — `plot-plan-meta.sh`
reports no `rounds` because the file carries no `CHALLENGE-THE-PLAN-METADATA`
block.

It has been interrogated three times today. The title changed, a false claim
about `AgentRowSchema` was corrected, and two findings were added. None of it
counted, because the block is written by the structured question tool and this
interrogation ran as a conversation.

So the badge measures *how often one tool ran*, not *how thoroughly the plan was
questioned* — and a reader using it to judge interrogation depth reads a number
that is silent about most of the work. Whether the fix is counting differently,
naming the badge for what it measures, or leaving it to the Board tab alone is
a design question, not one this plan settles.

### A plan group has no edge, so it absorbs what follows it

Reported from the board 2026-08-19: two issue rows (#227, #228) render beneath
the heading `the-row-says-what-it-knows (5)` and belong to no plan at all.

They are not misfiled. Measured against `/api/fleet`: WAITING ON YOU returns
seven rows, five carrying `plan: the-row-says-what-it-knows` and two carrying
none — and the issue rows are not in `rows` at all. They arrive in the separate
`issues` field that #236 added, and render after the plan's branches. Nothing
claims they belong to the plan; the layout simply offers no place where the
plan's group ends.

**And that is a gap I left this afternoon.** `a-plan-row-is-not-a-branch-row`
asked for two things, and I built one:

> *So a plan and its branches sit in one bordered group, and the next plan
> starts a new one.* — the plan's Design, and its fourth Done-when criterion

The row proportions landed; the border did not. `AgentList.tsx:3512` shows the
half that did: a row inside a plan group gets `''` where a standalone row gets
`border-b`. So the group **suppresses** the dividers between its own rows and
draws no edge of its own — the one arrangement that makes a group look like it
continues past its last member.

The consequence is not cosmetic. A plan heading with five branches under it and
two unrelated rows after it reads as a plan with seven, and the count beside the
name says `(5)` — the reader has to arbitrate between the number and the layout.

### The phase sits on the branch, and it is a statement about the wave

A plan has waves; a wave has branches. The board draws two of those three
levels, so the middle one has to be inferred from a name nobody shows — and the
phase column is where that omission becomes visible.

`toBoardPhase(planPhase, started)` (`schema.ts:432`) branches in exactly one
place:

```
draft     → Discovery                          always
approved  → started ? Development : Design     the only fork
delivered → Endgame                            always
released  → Released                           always
```

So a branch row's phase differs from its plan's in **one** of four phases. In
the other three every branch of a plan repeats the plan's own word, column after
column, for as many branches as the plan has.

**And in the one case where it does differ, the difference belongs to the
wave.** `started` asks *has anyone begun?* — which is what makes a wave
eligible, in progress, or blocked. The branches of a wave share that answer by
construction: they are dispatched together, they block together, and
`plot-fleet-scan.sh` computes eligibility per wave and never per branch. Putting
that answer on each branch spreads one fact across N rows and leaves the level
it describes unnamed.

`deferred` is the exception that confirms it: `rowPhase` ignores the branch's
own commits there and returns the plan's phase, because someone decided this
work stops. The comment calls it *"the one place intent outranks git"* — a
decision about scope, which is again not a property of a commit.

**The fix is not to move the phase to the plan row.** That was the first
reading and it is wrong: a three-branch plan with one branch built is in
Development *as a plan* while its untouched branches are not, and collapsing
that would put `Development` beside *eligible — nobody has taken it*. The fix is
to give the wave the row it already has data for, and let the phase sit there.

**Which is why this finding does not become a branch here.**
`a-wave-says-what-it-waits-for` (approved 2026-08-19) owns the wave row already:
*"NOT STARTED renders a wave row between the plan and its branches, reading
`row.wave` for the first time"*. What this plan contributes is the reason it
must not stay confined to NOT STARTED — WAITING ON YOU, WORKING and WAITING ON A
MACHINE draw the same two-level shape and inherit the same repetition, and the
phase column has nowhere honest to live until the middle level is drawn in all
of them.

### The controls are too small to read, and too small to hit

Measured on the running board 2026-08-19, at 1480px wide:

| Element | Size | Kind |
|---|---|---|
| `data-wave-toggle` (`▸`/`▾`) | **5 × 10 px**, `font-size: 10px` | click target |
| `data-row-actions` (`⋯`) | **12 × 12 px** | click target |
| `data-pr-link`, `data-issue-link` | 35 × 16 px | click target |
| status glyphs (`svg.h-3.w-3`) | 12 × 12 px | display only |

**37 elements measure under 24px in one direction.** WCAG 2.2 asks 24 × 24 for
a pointer target; Apple asks 44 and Google 48. The toggle is a fifth of the
smallest of those, and it is the control that answers *is there more here?*

That is why this belongs in the same plan as the brief note rather than in a
separate one about aesthetics. The reason a reader cannot tell a folded plan
from an empty one is not that the summary is worded badly — it is that the
**only** thing distinguishing `▸` from `▾` is five pixels of glyph, and the two
shapes differ in a way that survives neither a glance nor a small screen.

**Bigger hit area, not necessarily bigger glyph.** A target grows by padding
without the mark growing with it, which is what keeps the row's density: rows
measure 35-36px today and a 24px target fits inside one without changing it.
The glyph itself should still grow enough to distinguish the two states, and
`10px` is below every other size on the board (12px is used 82 times, 13px 24
times, 14px 33 times) — it is the outlier rather than the convention.

**The display glyphs are a smaller question with a different answer.** A 12 ×
12 status mark is not a target and does not owe 24px, but it sits at the same
size as the `⋯` that is one, and that is its own confusion: two marks of equal
size where one is pressable and one is not.

### A section heading sits closer to the group above it than to its own

Measured on the same board: **16 px** between the bottom of one section's block
and the top of the next section's heading, against **4 px** between that
heading and the block it introduces.

A heading four pixels from its own rows and sixteen from the group above reads
as belonging almost equally to both. The gap that separates two *sections* is
barely larger than the gap that separates two *rows*, so the strongest
structural break on the page is drawn with the page's weakest signal.

The rows themselves are fine and stay as they are — 35-36 px with `py-2`, which
is the density an operator watching a fleet wants. This is only about the space
**between groups**: a section break should read as a bigger break than a row
break, and today it does not.

(One gap measures 90 px, between WAITING ON YOU and WAITING ON A MACHINE. That
is not a counter-example: the empty WORKING box sits between them and supplies
the space. It disappears the moment an agent starts, which is exactly when the
board is most crowded.)

## Design

### Say which of the two it is

A row in NOT STARTED is in one of two states, and they have different next
actions:

| Condition | Row says | Next action |
|---|---|---|
| eligible, brief exists | *ready — nobody has taken it* | dispatch it |
| eligible, no brief | *needs a brief before it can start* | `/plot-implement` |

The second is the common case rather than an edge to tuck away. Measured
2026-08-19 and re-measured after four plans were delivered: **8 of 14 open
branches on Approved plans have no brief.** The ratio moved with the day's work
and the shape did not — closing plans consumes briefs, and the branches left
over are the ones nobody has interpreted yet.

**The collection is small, the plumbing is the work.** `briefExists` is not on
the board row today; it belongs to `ClaimableSchema`, and the fleet build must
learn to answer it. One `existsSync` per branch per pulse, measured at 0.2 ms
for 60 branches against a 14 s scan. That is why this is still a bug rather
than a feature: the fact is knowable from a path convention Plot itself writes,
and nothing has to be invented to know it.

### Naming the dependency is a second question, and deliberately separate

The operator asked two things and only one is settled here. *Which wave did
this branch wait for* is a real question the row could answer, and
`a-wave-says-what-it-waits-for` (approved 2026-08-19) already owns it — that
plan gives a wave its own row and names what it waits on.

This plan does **not** touch that. A satisfied dependency is history; a missing
brief is a live obstacle, and conflating them would delay the cheap fix behind
the interesting one.

### Open Points

- [ ] Should the row OFFER the brief-writing action, or only name the gap?
      Offering it means the board runs `/plot-implement`, which writes a file
      and is a real write — the sprint that just ended drew its line at exactly
      one acting endpoint. Naming the gap is read-only and honest; offering the
      action is the thing an operator will ask for the day after.
- [ ] Does `plot-fleet-scan.sh`'s own text want the same split? The scan prints
      `eligible` in prose too, and a human reading the terminal has the same
      gap. The board is where it was reported, so the board is where this
      starts.

## Branches

### Seeing it

- `bug/the-row-shows-what-it-withholds` — the five display findings above, in one branch: a section break reads as a bigger break than a row break; a plan group draws an edge so it stops absorbing what follows it; the plan row hosts the approval that belongs to a plan; a deferred row states the reason recorded in its annotation; and every pointer target reaches 24 x 24 px of hit area with the fold toggle distinguishable at a glance. → #290

  **One branch rather than five, and the reason is measured rather than tidy.** All five edit `AgentList.tsx`, and that file conflicted on *every* merge today — four times, each costing an artifact rebase. Five branches would mean four rebases and five CI rounds, against a CI that hung eleven times today on the Playwright step alone (10 to 57 minutes each). The findings are also one kind of change: none adds a data source, none touches the server, and a reviewer reading them together sees the pattern the plan is named for. Plot's convention is a branch per finding, and it is broken here deliberately — the convention exists to keep a branch reviewable, and five small display fixes in one file are more reviewable together than four rebases apart.

  Tests, per finding: the gap above a section heading exceeds the gap between two rows in the same group; a plan group renders a boundary after its last branch and rows following it in the section — issue rows among them — sit outside it, with the count beside the plan name matching the rows inside; a Draft plan row offers approval and a plan past Draft does not, absent with its reason when the server reports `approve.available: false`; a branch annotated with a deferral reason renders it while a bare `<!-- deferred -->` still reads as deferred without one; each pointer target measures at least 24 px in both directions and the fold state is distinguishable from a screenshot. Throughout: branch rows stay aligned column-for-column across every section, row height is unchanged at the default width, and below `CARD_BELOW_PX` nothing regresses.

### Saying it

- `bug/eligible-says-whether-it-can-start` — a NOT STARTED row distinguishes *ready* from *needs a brief*. `fleet.ts` collects `briefExists` per branch — one `existsSync`, measured at 0.2 ms per pulse for 60 branches — and the row renders it. Second wave rather than beside the first, because this one crosses the server: it is the only finding here that adds a field to the board row, and keeping it apart means the display work can land while the contract change is reviewed on its own terms. Tests: a branch with a brief reads as ready; one without names the gap and does not invite a dispatch; the phrasing never claims a person is missing when a file is; an unreadable `.plot/briefs` directory reads as unknown rather than as "no brief". PR #297.

## Notes

Found by an operator reading the board, not by a test — the same route as most
of this repo's display defects. The distance between *the server knows* and
*the row says* is where they live.
