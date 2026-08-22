# A dispatch hands over a brief

> The `Worker command`'s first instruction is *"Read `.plot/briefs/${PLOT_BRANCH##*/}.md`
> first — it is the specification."* Measured 2026-08-20: a board **Start work**
> writes no brief, so the agent reads a file that does not exist and then
> improvises — which is the one thing the brief exists to prevent. An agent ran
> **2:12 against a 700-line wave** with no specification before being stopped.
>
> `plot-dispatch.sh` already **knows**: its footer reads
> `dispatched=2 … brief=missing worker=unconfigured`. It detects the gap and
> starts the worker anyway.

## Status

- **Phase:** Draft
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Changelog

- A dispatched worker is handed its brief before it starts: the board asks
  `/plot-implement` for one and waits, instead of launching an agent to read a
  file that does not exist.
- `plot-dispatch.sh` refuses to start a worker for a branch with no brief —
  preparing the worktree and pushing the claim, but not launching — with
  `--no-brief` as the named escape for a person at a terminal.

## Problem

### Three ways to start a worker, one writes a brief

| path | how | brief |
|---|---|---|
| `/plot-dispatch` (the **skill**) | invokes `/plot-implement` per branch | **written** |
| `plot-dispatch.sh` (the **script**) | claims, worktrees, launches | **none** |
| the board's **Start work** | calls the script | **none** |

The script cannot write one, and this is not a defect in it. `/plot-implement`
step 4 composes the brief from the plan: it selects what applies to *this* branch,
states the scope guards, and names what was already settled. That is judgement,
and `/api/idea` already has the sentence for it — *"creating a plan runs the
/plot-idea **SKILL**, which no script can do."*

### What briefless dispatch leaves behind

Re-measured 2026-08-22, across the eight live worktree branches:

    with a brief     4
    without          4

Three of the four briefless ones — `bug/one-column-one-kind-of-fact`,
`bug/the-kind-is-labelled-not-hovered` and
`feature/the-row-leads-with-its-subject` — hold **uncommitted work that was
never pushed**: 190, 131 and ~315 lines respectively, against a file since
rewritten twice. The fourth is a plan branch with no worker. Every branch that
*did* have a brief either landed or is in flight.

Eight branches is a correlation and not a proof, and the plan claims it as no
more than that. But it is precisely the outcome the thesis predicts: an agent
handed no specification improvises, and improvised work is the kind nobody
finishes or lands. The 2:12 run above is the mechanism caught live; this is
what the estate looks like afterwards.

### The board already has the mechanism

`/api/idea` (*Create plan*) solves exactly this shape and works: configured today
via an `Idea command` key, it spawns the **skill** and passes the issue by writing
it to a file. Measured after configuring it: `/api/board` reports
`idea.available=true` where it previously refused.

`/api/dispatch` (*Start work*) calls the script instead, and its own comment says
why that was right for what it does: *"It runs `plot-dispatch.sh`, and DECIDES
NOTHING itself."* The brief is the one part of a dispatch that **is** a decision.

### The instruction to read it is a rule, not a gate

`CLAUDE.md`: *"Can you answer 'Did I complete this?' without actually doing the
work? If yes, it's a rule."* An agent told to read a brief can rationalise past a
missing one, and on 2026-08-20 one did — silently, for 2:12.

`plot-dispatch.sh` reports `brief=missing` and launches regardless. **The
detection exists; only the consequence is absent.**

## Design

### 1. The board asks the skill for the brief — using a key it already has

**`Implement command` and `/api/implement` are `an-approved-plan-offers-its-two-starts`'s
to build** (PR #313, wave *Run*), where they back its Implement button. That
plan and this one were written four days apart and arrived at the same
mechanism from different directions — a button that prepares a plan, and a
dispatch that must prepare one before it starts a worker. One key, one route,
one place to configure.

So this plan **consumes** them and contributes what #313 does not: the
**sequencing** and the **gate**. It depends on #313 landing first.

    - **Implement command:** PLOT_UNATTENDED=1 claude -p --permission-mode bypassPermissions

`/api/dispatch` becomes **two steps in order**:

1. Spawn `Implement command` with one appended argument naming a file the board
   wrote — the same file-not-argument safety `/api/idea` documents — asking it to
   run `/plot-implement <slug>`. The skill writes `.plot/briefs/<suffix>.md` and
   commits it where the plan lives.
2. **Then** run `plot-dispatch.sh`.

**The order is load-bearing, and it is a sequence rather than a race.**
`/plot-implement` commits the brief to the **default branch**, so the worker's
worktree only sees it after a fetch. Starting both at once means the worker reads
a file that will exist in thirty seconds — the failure this plan is about, with a
smaller window.

**`<slug>`, not `<branch>`.** `/plot-implement` takes a slug and chooses the
branch itself via `plot-fleet-scan.sh --next <slug>` — the board has the slug and
should not pre-empt that choice.

**Absent key = the button refuses and names it**, the `Idea command` rule. Not
*accepts the click and starts an agent without a brief*, which is today's
behaviour and the whole complaint. That refusal is #313's to implement on the
route; what this plan adds is that `/api/dispatch` must not proceed past a
failed or absent implement step.

### 2. A missing brief is a gate, not a note

`plot-dispatch.sh` already computes `brief=missing`. It gains a refusal: **a
branch with no brief is not launched.** The worktree is still prepared and the
claim still pushed — those are mechanical and reversible — and the branch is
reported as prepared-not-started with the brief named as the missing piece, the
same shape as the existing `worker=unconfigured` outcome.

**`--no-brief` is the named escape**, for the case that must stay possible: a
human at a terminal who has read the plan and wants a worker now. Explicit, in
the log, and impossible to reach by clicking.

**A gate rather than a warning, by this repo's own rule.** CLAUDE.md's *Gates
Over Rules* asks whether you can answer *did I complete this?* without doing the
work — and `plot-dispatch.sh` today computes `brief=missing` and launches
anyway, which is the definition of a rule nobody enforces. The gate binds the
CLI too, not only the board: on 2026-08-22 a dispatch was prepared by hand and
the brief written manually before starting the worker, which is exactly the
sequence the gate makes mandatory rather than remembered.

Two properties this must keep:
- **Fails closed.** A brief that cannot be read is treated as missing. The plan
  gate above it reads `origin/<main>` and fails closed for the same reason.
- **Says what it wants.** *"no brief at `.plot/briefs/x.md` — run
  `/plot-implement <slug>` or pass `--no-brief`"*, not *"refused"*.

### What must not change

- **`/plot-implement` itself.** It writes the brief correctly and this plan only
  gives the board a way to call it.
- **`/api/idea`.** *Create plan* already spawns the skill and already passes the
  ticket: it writes number, title and body into `.plot/idea-issue-<n>.md` and
  exports `PLOT_IDEA_PROMPT` plus `PLOT_ISSUE`. Nothing about it needs this plan.
- **`Create story` stays a refusal.** `storyRefusal()` is the design, not a gap —
  *"a story is a decision you make — where it lives, whether it is wanted yet"*,
  and its comment states outright that this *"is not an oversight to be filled by
  a later wave."* The distinction is real: a **brief** is judgement about a plan
  that already exists and was interrogated, so the decisions are settled and only
  selection remains. A **story** is judgement about whether the thing should exist
  at all. An unattended agent can do the first and must not do the second.
- **The dispatch's own decisions.** The script still chooses nothing; the board
  still decides nothing. One more spawn, in one order.

### Open Points

- [ ] Should `--no-brief` also be reachable through `/api/dispatch` for a user
      who wants it? Argued no: a click cannot carry *"I have read the plan"*, and
      the escape exists precisely for the person who can say that. But it means a
      board user with no `Implement command` has no path at all, which may be
      worse than an explicit override.
- [ ] Does `/plot-implement` need to be told **which** branch when a plan's next
      eligible one is not the one the button was clicked on? The board offers
      *Start work* per row, so the row knows its branch while the skill picks its
      own. They agree today because `--next` returns the same branch; they need
      not always.

## Branches

### Gated
- `bug/a-dispatch-without-a-brief-refuses` — `plot-dispatch.sh` refuses to launch a worker for a branch with no brief, with `--no-brief` as the named escape. Tests: a branch with no brief is prepared and **not started**, and the message names the file and the two ways forward; a branch **with** a brief starts as before; `--no-brief` starts it and says so in the log; an unreadable brief is treated as missing, not as present; the footer still reports `brief=` and now agrees with what happened; the plan gate and the held-branch refusal are unchanged.

### Handed over
- `feature/the-board-asks-for-a-brief` — `/api/dispatch` calls `/api/implement`
  and waits for the brief before running the script; with no `Implement command`
  configured the button refuses and names it. **Depends on
  `an-approved-plan-offers-its-two-starts` WAVE 2**
  (`feature/implement-runs-from-the-board`) — on the wave landing, not on its
  plan PR merging. #313 merged 2026-08-22 and built nothing: `implement.ts` does
  not exist and no route is registered. A merged plan PR is a decision, not a
  route, and this branch adds the ordering rather than either. Tests: the brief exists before the worker starts; the two spawns are ordered, never concurrent; the slug is passed and the branch is not; a missing `Implement command` refuses with the key named, rather than starting a briefless agent; a failing `/plot-implement` does not start a worker; nothing about `/api/idea` changes.

## Notes

Found by the operator asking *"Start work does not create a brief?"* — a question,
not a bug report, and the answer was no.

The shape is one worth naming because this repo produced two instances of it in
one day: **a mechanism that detects a condition and does not act on it.**
`plot-dispatch.sh` computes `brief=missing` and launches; the scan's timeout
report measured worktrees and blamed them for a cost they did not carry. Detection
without consequence reads as coverage.

The refusal for `Create story` is the counter-example worth keeping in view: there
the absence of a route **is** the answer, argued and documented on the control
itself. Not every unwired action is a gap.

**Interrogated 2026-08-22.** The defect is confirmed and its cost is now
visible in the estate. `plot-dispatch.sh` hardcodes `brief=missing` at both
exit points and launches regardless — it does not compute the field, it asserts
it — and four of the eight live worktree branches have no brief, three of them
holding uncommitted work nobody landed.

The finding was an overlap, the third of the day. This plan introduces an
`Implement command` key and a spawn to run `/plot-implement` from the board;
`an-approved-plan-offers-its-two-starts` (PR #313, written four days later)
introduces the same key and an `/api/implement` route for its Implement button.
Two plans reaching one mechanism from opposite directions — a button that
prepares a plan, and a dispatch that must prepare one before it starts a
worker. #313 owns the key and the route; this plan consumes them and
contributes the **sequencing** and the **gate**, which is what it was always
about.

The gate stands as written, and the repo's own rule is why: `brief=missing` is
computed today and acted on by nobody, which is a rule rather than a gate. It
binds the CLI as well as the board — the manual dispatch performed on
2026-08-22 wrote its brief first, and the gate makes that sequence mandatory
rather than remembered.

**Interrogated again 2026-08-22**, after the day's dispatching produced evidence
the first round could not have.

**Four briefs were written by hand in this session** — 98, 102, 110 and 136
lines — because nothing writes them. Of the four dispatches they fed, **three
produced PRs and two are merged**; the briefless worktrees on the same estate
produced three abandoned branches. Small numbers and a correlation, claimed as
no more than that, but it points the same way as the 2:12 run.

**A brief is necessary and not sufficient.** The fourth dispatch stalled with a
136-line brief in its worktree: correct work, 513 tests passing, one commit
short of a PR. The brief closes the *specification* gap; it says nothing about
the *completion* gap, which is what the registry-liveness wave of
`approval-hands-the-work-to-agents` is for. This plan should not be read as
fixing both.

**The size is a design constraint, not an accident.** Each brief carried the
settled decisions with their measurements, the assertions a naive implementation
would pass without, and the other branches in flight by name. Whatever
`/plot-implement` generates has to reach that bar — an automated brief thinner
than the manual one would satisfy the gate while re-opening the defect the gate
exists to close.

**And the dependency was overstated.** Round one wrote *"the route that PR #313
builds"*; #313 merged that morning and built nothing — it carried a plan.
Corrected to name the wave.

