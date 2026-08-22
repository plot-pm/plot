# Approval hands the work to agents

> NOT STARTED gets a switch, WORKING gets a number: with the switch on, the
> eligible waves of approved plans dispatch themselves up to N agents at once,
> and a person changes either in flight without killing anything.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** working-shows-the-agent
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, in-session

## Approval

- **Assignee:** jwloka

## Changelog

- NOT STARTED carries an **auto-dispatch** switch: while it is on, the eligible
  waves of approved plans start by themselves.
- WORKING carries a **parallel-agents** stepper bounding how many agents run at
  once. Default 3.
- The switch is a shared setting, not a per-browser one: everyone reading the
  board sees the same answer to *are agents taking work right now*.
- Turning it off stops further dispatches immediately and never kills a worker
  already running.

<!-- Board impact: this is the first board control that ACTS without a click,
     and the first setting the board must persist. The plan format, the plan
     template and docs/plans layout are untouched; `## Plot Config` gains an
     optional key for the default and the cap. -->

## Motivation

**The column model already says approval is the handover.** `schema.ts` defines
the board's columns by *who leads* — Discovery and Design are 👤 human-led,
Development is 🤖 agent-led — and puts `Approved` in Development *"whether or
not a branch has started"*, because an approved-but-unstarted plan is
*"work waiting for an agent"*. NOT STARTED says the same in its own hint:
*approved — nobody has taken it*, filtered so that **every row in it is one an
agent may actually take**.

Every mechanical piece exists. `plot-dispatch.sh` fans out one worktree and one
detached worker per **eligible** branch, refuses a branch whose worktree holds
unlanded work, and caps itself at 8 in-flight branches and 6 shared files. The
scan already computes `eligible` per wave. `/api/dispatch` already spawns the
script. A running worker already lands in WORKING.

What is missing is the sentence connecting them: **nothing ever calls dispatch
unless a person clicks.** So a plan approved at 18:00 with four eligible
branches sits untouched until somebody presses Start work four times, and a
wave that becomes eligible at 03:00 — when its predecessor's PR merges — waits
for morning. The board describes a fleet and operates a queue of buttons.

**The per-wave button stays.** This plan adds a mode, not a replacement: a
person who wants to start one wave still starts one wave.

## Design

### Approach

**Each control sits on the section it describes.** Auto-dispatch is a property
of *how the operator is working right now*, not of a plan. Baking it into a plan's
Status at approval time would make it a decision taken once, in a file, about
future machine conditions nobody can see from there — and it would need editing
a plan to pause the fleet. A checkbox on NOT STARTED is the honest shape: the
section is the agent's queue, and the switch says whether the queue is being
served.

**The number goes on WORKING, because that is the section it is about.** NOT
STARTED holds work nobody has taken; WORKING holds the running agents, and
*how many agents may run at once* is a statement about that section's contents
rather than about the queue feeding it. It also gives WORKING its one
legitimate control: the section's hint reads *nothing to do — just look*, and
the single thing an operator can decide about a fleet they are watching is how
wide it may get. Read the two together and the sentence is the model — NOT
STARTED says *serve the queue*, WORKING says *this many at a time*.

The number binds whatever started the agents, not only auto-dispatch. A person
clicking Start work four times with the cap at 3 is making the same machine
too busy, and a cap that only counted automatic dispatches would be a cap in
name.

**Turning it off is a promise about the future only.** It stops further
dispatches and never signals a running worker. Stopping work already has a
place — the agent panel, per worker, where the operator can see what would die.
A switch that silently killed eight agents would be a different control wearing
this one's label.

**It is a SHARED setting, and this is the plan's one real departure.** The
board's convention is that view state lives in the URL and per-viewer
convenience lives in `localStorage` — the collapse state's own comment draws
that line: *"a URL is shareable, and collapse state should not be… Collapse is
convenience, not subject matter."* Auto-dispatch fails that test in the
opposite direction. It spawns agents that write code and open PRs, so it is
subject matter of the sharpest kind, and a per-browser copy would let two
people read the same board and disagree about whether the fleet is running.

That forces something the board has never done: **persist a setting.** Today
the server reads `## Plot Config` through `plot-config.sh` and writes nothing.
Rather than teach the board to edit `CLAUDE.md` — which would make a
human-authored file machine-written, and put a checkbox in a commit — the state
lives in `.plot/state/` beside the pulse the scan already writes there, with
`## Plot Config` supplying only the DEFAULT at startup and the cap.

**The cap is the guard, and the operator holds it.** No undo window, no dry
run, no confirmation: those defend against the wrong failure. The risk here is
not one unintended dispatch — that is a worktree and a branch, both cheap and
both reversible — it is *many*, quietly, until the machine is saturated and
every agent is slow. So the guard is a number on WORKING, with `−` and
`+`, defaulting to **3**: low enough that a machine stays usable, high enough
to be worth automating, and changeable the moment the operator sees otherwise.

**That number is a concurrency cap, which Plot does not yet have.**
`plot-dispatch.sh --max N` bounds ONE fan-out, not the agents alive at the
time: running it twice with `--max 3` yields six workers. A cap on *how many
agents exist* has to be computed at dispatch time — count the workers reporting
`running`, which `plot-worker-state.sh` already answers via `kill -0`, and
dispatch at most the difference. Lowering the number never kills anything: it
stops the next dispatch until enough workers have finished, the same promise
the switch itself makes.

(`IN_FLIGHT_MAX_FILES` and `IN_FLIGHT_MAX_BRANCHES` in `plot-dispatch.sh` are
not this. They truncate a *report* — "…and N more branches" — and touch no
dispatch decision. An earlier draft of this plan cited them as the existing
cap; they are not one, and nothing here should honour them.)

### Open Questions

- [ ] What happens when auto-dispatch is on and a dispatch FAILS — a taken
      claim, a refused worktree, a script error? Retrying forever is a loop;
      never retrying makes the switch silently untrue. Likely: surface the
      refusal on the row and do not retry that branch until something about it
      changes.
- [ ] Does the switch survive a board restart? Persisting it in `.plot/state/`
      says yes; that also means a machine can start dispatching moments after
      `pnpm board`, before anyone has looked at it.
- [ ] Should the cap count workers this board started, or every worker on the
      machine? Counting all of them respects a machine shared with a hand-run
      `/plot-dispatch`; counting only its own makes the number mean *what this
      board is doing*, which is what the operator set it to.

## Branches

### Switched

- `feature/the-sections-carry-the-fleet-controls` — the two controls and their
  shared state, dispatching nothing yet. A checkbox in the NOT STARTED header
  and a `− N +` stepper in the WORKING header, both read from `.plot/state/`,
  defaulted from `## Plot Config` (switch off, agents 3), written through a new
  endpoint. Tests: the switch renders in NOT STARTED only and the stepper in
  WORKING only; toggling and stepping persist across a reload; a second board
  process reads the same values; the stepper refuses to go below 1 and
  announces its value; both are keyboard reachable with state announced, and
  the stepper is a real `spinbutton` rather than two buttons beside a label;
  the endpoint refuses a cross-origin write exactly as `/api/dispatch` does.

### Served

- `feature/an-eligible-wave-starts-itself` — while the switch is on, eligible
  waves of approved plans dispatch, honouring `plot-dispatch.sh`'s existing
  caps. Tests: an eligible wave of an approved plan dispatches with no click;
  a **blocked** wave does not; a **draft** plan's wave does not; a branch
  already claimed is not dispatched twice; **the number of workers reporting
  `running` never exceeds the stepper's value**, across repeated pulses and not
  merely within one fan-out; lowering the number mid-flight stops the next
  dispatch and leaves every running worker alive; turning the switch off does
  the same; a wave that becomes eligible when its predecessor merges is picked
  up on a later pulse.

## Notes

Raised 2026-08-22: *"eligible waves should be started automatically by the
agents"*, and the switch shape — a checkbox on the section, decided in flight —
was the operator's own correction to three alternatives that all attached the
setting to a plan.

**Depends on `a-plan-moves-through-the-sections`.** That plan repairs the path
this one automates: today NOT STARTED admits Draft plans through the deferred
allowlist, so a switch built now would dispatch branches of plans nobody has
approved — the handover happening without the decision, which is precisely what
the column model forbids. The dependency is real and not merely tidy: the guard
that makes auto-dispatch safe is *the section contains only approved work*.
