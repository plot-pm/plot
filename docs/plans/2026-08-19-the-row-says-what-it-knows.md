# The row says what it knows

> A row reads *eligible — nobody has taken it*, which invites the reader to
> take it. Nine such rows are on the board and not one can be started: every one
> is missing the brief a worker is told to read first. A plan reads *3 waves,
> first eligible* above nothing at all, because it is folded and the control
> that says so is five pixels wide. Both are the same defect — a row stating a
> fact and withholding its consequence.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Sprint:**
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

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

**Measured 2026-08-19: nine eligible branches on the board, zero briefs.**

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

The second is the common case today — nine of nine — so it is not an edge to
tuck away.

**No new measurement.** Both fields are on the row already; this wave renders
what the server sends. That is the whole change on the read side, and it is why
this is a bug rather than a feature.

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

- `bug/a-section-break-reads-as-one` — the space between two section groups grows enough that a heading reads as introducing the block below it rather than as trailing the one above. Row spacing is untouched. Tests: the gap above a heading exceeds the gap between two rows in the same group by a stated factor; row height is unchanged; below `CARD_BELOW_PX` nothing regresses.

- `bug/a-plan-group-has-an-edge` — a plan and its branches sit in one bordered block, and the next thing in the section starts outside it. Completes the fourth Done-when criterion of `a-plan-row-is-not-a-branch-row`, whose row proportions landed without its border. Tests: a plan group renders a visible boundary after its last branch; rows following it in the same section — issue rows among them — sit outside that boundary; the count beside a plan name matches the rows inside its block; branch-to-branch dividers inside a group stay suppressed.

- `bug/a-plan-row-can-be-approved` — the plan row hosts the one action that belongs to a plan. `ApproveButton` and its server-side `approve` availability already exist; what is missing is a place on the row to put them, removed when the row gained its own proportions. Tests: a Draft plan row offers approval; a plan past Draft does not; the control is absent when the server reports `approve.available: false`, with its reason; branch rows are unchanged.

- `bug/a-deferred-row-says-why` — the deferral reason travels from the plan file to the row. `plot-plan-meta.sh` captures the text after `deferred:` alongside the boolean, the schema carries it, and a deferred row states it instead of leaving `deferred` and `no commits` as two unexplained facts. Tests: a branch annotated with a reason renders it; one annotated bare (`<!-- deferred -->`) still reads as deferred with no reason rather than as an error; the wave arithmetic is unchanged — a deferred branch still does not block its wave; `moved:` keeps its own meaning, which `plot-reconcile-scan.sh` already distinguishes.

- `bug/a-control-can-be-seen-and-hit` — every pointer target in a row reaches at least 24 × 24 px of hit area, by padding rather than by growing the mark, and the fold toggle grows enough that `▸` and `▾` are distinguishable at a glance. The display glyphs stop matching the size of the controls beside them. Tests: each of `data-wave-toggle`, `data-row-actions`, `data-pr-link` and `data-issue-link` measures ≥24px in both directions; row height is unchanged at the default width; the fold state is distinguishable from a screenshot; below `CARD_BELOW_PX` nothing regresses.

### Saying it

- `bug/eligible-says-whether-it-can-start` — a NOT STARTED row distinguishes *ready* from *needs a brief*. `fleet.ts` collects `briefExists` per branch (one `existsSync`, measured at 0.2 ms per pulse for 60 branches) and the row renders it. Tests: a branch with a brief reads as ready; one without names the gap and does not invite a dispatch; the phrasing never claims a person is missing when a file is; an unreadable `.plot/briefs` directory reads as unknown rather than as "no brief".


## Notes

Found by an operator reading the board, not by a test — the same route as most
of this repo's display defects. The distance between *the server knows* and
*the row says* is where they live.
