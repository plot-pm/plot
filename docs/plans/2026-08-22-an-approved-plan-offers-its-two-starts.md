# An approved plan offers its two starts

> A plan that is approved and unstarted can be begun two ways — a person
> implements it, or a fleet dispatches it — and the board names both on the row
> where the plan lives.

## Status

- **Phase:** Draft
- **Type:** feature
- **Sprint:** working-shows-the-agent
- **Story:** plot-planning-model
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A plan that is approved and not yet started offers **Implement** and
  **Dispatch** on its plan row, beside the Approve that got it there.
- **Implement** runs `/plot-implement`: the staleness preflight, the branch, the
  hand-off brief, the `Started:` record — the preparation a person does before
  writing code.
- **Dispatch** runs `/plot-dispatch`: a worktree and a detached worker per
  eligible branch, the whole plan at once rather than one wave per click.
- Both are offered while the plan has work that could start now — so a
  multi-wave plan offers them again for each wave, and a plan with nothing
  eligible offers neither.

<!-- Board impact: no plan-format, template or docs/plans change. Two controls
     on the plan row, one new route, and one optional `## Plot Config` key for
     the Implement runner — the same key shape `Idea command` already uses. -->

## Motivation

**Approval makes a plan ready, and the board then says nothing about how to
begin.** `/plot-approve`'s own summary states the gap: *"it's now Ready.
Nothing starts until you (or anyone picking it up, today or next week) run
`/plot-implement <slug>`"*. The board shows that plan, shows it is approved,
and offers no way to do the thing its approval was for.

**There are exactly two ways to begin, and they are not the same act.**

`/plot-implement` prepares: it re-checks the plan against what moved since
approval, creates and claims one branch, writes a hand-off brief, and records
`Started:`. It ends by handing that brief to whatever writes the code — a
person, or a session they open. Nothing is running when it finishes.

`/plot-dispatch` fans out: one worktree and one detached worker per eligible
branch, each claimed by ref push. Agents are running when it finishes.

A board offering only one of them would make the other invisible, and the
choice between them is the operator's — *am I picking this up, or is the fleet
taking it?* That question has no default the board can compute.

**The row already knows when to ask it.** A plan is Ready when it is approved
and carries no `Started:` record, and both facts are on the wire already:
`PlanMeta.started_raw` from the parser and `Card.started` on the card. The
board even documents the state — *"an approved-but-unstarted plan is work
waiting for an agent"* — and then offers nothing beside it.

**Start work is not this.** It exists, and it is dispatch of exactly one
branch: `StartWorkButton` posts to `/api/dispatch` with `--max 1`, on an
eligible wave row. It stays. What is missing is the plan-level pair — *prepare
this plan*, and *dispatch all of it* — on the row that names the plan.

## Design

### Approach

**Both controls live on the plan row, for the reason Approve does.** They act on
a plan and take no branch: `plot-dispatch.sh` takes a slug, `/plot-implement`
takes a slug, and `plot-approve.sh` takes a slug. `PlanActions` is already the
home for plan-level acts and already carries Approve, so this is a third and
fourth item in an existing menu rather than a new surface. A branch row must
not offer either, by the rule its sibling plan settles: no gate makes a
plan-level act correct on a branch row.

**Dispatch is wiring, not machinery.** `/api/dispatch` already spawns
`plot-dispatch.sh --max <n> <slug>` detached, with the localhost binding,
same-origin check and slug validation this plan reuses rather than restates.
What differs from Start work is the cap: `MAX_PER_CLICK = '1'` is right for a
control on one wave row and wrong for a control on the plan, which means *all
of it*. The plan-level call passes no `--max`, which is `plot-dispatch.sh`'s
own default of *every eligible branch*.

**Implement has no script, and that is the design question this plan answers.**
Every other board action wraps one: Approve spawns `plot-approve.sh`, dispatch
spawns `plot-dispatch.sh`. `/plot-implement` is skill-only, and deliberately —
its steps are judgement (is the plan stale? which wave is next? what belongs in
the brief?), which is exactly what a script must not decide.

So Implement spawns an **agent**, following `/api/idea`, which does the same
thing for the same reason: a configured command runs the skill, and the board
refuses the action when no command is configured rather than inventing a
fallback. That gives a new optional `## Plot Config` key — `Implement command`
— read the way `Idea command` and `Worker command` already are, with the
control rendered *present but refused*, carrying the reason, where it is
absent. A disabled control that says why is the shape the board already uses
for an unavailable dispatch.

**The gate is unstarted WORK, not an unstarted plan.** An earlier draft gated
on `Card.started` alone — approved and never started — and that is too narrow by
exactly the case multi-wave plans live in: when wave 1 merges, wave 2 needs
`/plot-implement` again, and a plan carrying one `Started:` record would offer
nothing for the rest of its life.

The card already carries the field for it. `waveSummary.eligible` counts the
branches that could be started right now, and it is on the wire today:

    opus5-longhorizon-hardening    waves 2  branches 7  eligible 0
    every-section-has-one-subject  waves 3  branches 3  eligible 1

So the gate is **approved AND `waveSummary.eligible > 0`**. `Card.started` stops
being the test and becomes what it was always for — the Ready/In-progress split
in the phase column.

That also answers the stale-plan worry below without a special case: a plan
whose every wave is blocked has `eligible: 0` and offers nothing, which is the
honest answer rather than a control that starts nothing.

**Implement is the entrance with a preflight; Dispatch is not, and the plan
says so.** `/plot-implement` step 2 measures the plan's age, the commits that
have landed on the paths it touches, and whether the symbols it names still
exist — then stops on drift. `plot-dispatch.sh` has no such step: it checks the
phase from `origin/<main>` and fans out. Measured on the live board, the single
card that qualifies today is `opus5-longhorizon-hardening` — approved, 1273
commits behind, 7 branches with no PRs — and the two controls answer it very
differently. No confirmation is added to Dispatch: the preflight belongs to
Implement by design, and duplicating a weaker version of it on the other control
would put the same judgement in two places.

**`/plot-implement` must declare what it does with nobody there, and this plan
carries that fix.** The board spawning it *is* the unattended case, and the
skill is the least prepared of the spokes for it: one `PLOT-UNASKED` line
against two or three in `/plot-idea`, `/plot-approve` and `/plot-deliver` — and
that one covers *no slug given*, which a board click never produces. Step 2 ends
*"The user decides"* with no `PLOT_UNATTENDED` clause at all, so an agent that
finds drift has no defined behaviour and must ask someone who is not there.

It stops and reports, by the rule the other spokes already follow:
`PLOT_UNATTENDED` answers *may I ask?* and never *may I proceed?*. The board
surfaces the stop; a person decides what to do about the drift.

**Nothing here is irreversible in the way Approve is.** Approve merges a PR;
these two create a branch and a worktree, or a brief. Both are cheap to undo,
so neither takes the two-click arming Approve carries. They do take the same
spinner-and-refusal treatment every acting control has, because a detached
spawn cannot report its result in the response.

### Open Questions

- [x] Should Dispatch be offered on a plan whose eligible waves are all
      blocked? **No, and no client-side computation is needed** — the widened
      gate reads `waveSummary.eligible`, so a plan with nothing eligible offers
      nothing. The board still computes no eligibility of its own; it reads a
      field the server already sends.
- [x] Should Implement remain offered after it succeeds? **Yes** — a multi-wave
      plan needs it again for each wave. This is what widened the gate from
      `!started` to `eligible > 0`.

## Branches

### Offered

- `feature/a-ready-plan-names-its-two-starts` — the two controls, their gating
  and their refusals; no new server behaviour. `PlanActions` gains Implement
  and Dispatch, gated on **approved and `waveSummary.eligible > 0`**, with
  Dispatch posting to the existing `/api/dispatch` without a `--max`. Implement
  renders present-but-refused until its route exists. Tests: both appear on an
  approved plan with an eligible wave; **both are absent** where
  `eligible === 0`, which is the blocked-plan case and needs no separate rule;
  both are still offered on a plan that has already started a wave and has
  another eligible, which is the multi-wave case the earlier gate excluded;
  **neither appears** on a Draft plan, a delivered plan, or on any branch or
  wave row; Start work on an eligible wave row is untouched; Dispatch posts the
  slug and no cap; each shows its refusal reason when its binding is
  unavailable; both are keyboard reachable and announce their state.

### Run

- `feature/implement-runs-from-the-board` — the route behind Implement, and the
  unattended clause the skill is missing. `/api/implement` spawns the
  `Implement command` detached, mirroring `/api/idea`'s guards, log path and
  202, and refuses with a reason when the key is absent. `/plot-implement`
  step 2 gains its `PLOT_UNATTENDED` shape: on drift it **stops and reports**,
  with a `PLOT-UNASKED` line naming what moved, rather than asking a reader who
  is not there. Tests: a configured command spawns with the slug and returns
  202; an absent key refuses with the reason and spawns nothing; the route
  refuses a cross-origin write and a malformed slug exactly as `/api/dispatch`
  does; the log path is per-plan and readable back; **the skill's unattended
  shape is declared and carries a `PLOT-UNASKED` line**, which
  `test/reconcile/unattended.test.mjs` already checks for every skill that
  declares one.

## Notes

Asked for 2026-08-22, immediately after the plan that makes Approve reachable:
the same row should carry what comes next, and *what comes next* is two acts
rather than one.

**Depends on `a-plan-moves-through-the-sections`.** That plan establishes the
plan row as the home for plan-level acts and threads `commission` to its call
site; this one adds the third and fourth items to the same menu. Landing them
in the other order would put two controls on a row whose first control is still
unreachable.

**Interrogated 2026-08-22**, and it changed the gate. Measured on the live
board, the earlier `!started` rule left exactly **one** card qualifying — and it
was `opus5-longhorizon-hardening`, approved, 1273 commits behind, seven branches
with no PRs. A control debuting on the estate's most stale plan is a finding
about the rule, not about that plan: gating on *the plan has never started*
excludes every multi-wave plan the moment its first wave begins, which is most
of them. `waveSummary.eligible` was already on the wire and says the right
thing, so the blocked-plan question and the second-wave question closed
together.

The other finding was in a skill, not the board: `/plot-implement` carries one
`PLOT-UNASKED` line to the other spokes' two or three, and that one covers a
case the board cannot produce. Its drift verdict ends *"The user decides"* with
no unattended clause — so the very act this plan automates had no defined
behaviour when nobody is there to decide. Wave 2 carries the fix.

The measurements behind the design decisions: `StartWorkButton` posts to
`/api/dispatch`, so Start work is already dispatch — capped at
`MAX_PER_CLICK = '1'`. `plot-implement` has no entry in `skills/plot/scripts/`,
unlike approve and dispatch, which is what forces the agent-spawn shape.
`Card.started` and `PlanMeta.started_raw` both exist, and `waveSummary.eligible`
turned out to be the field the gate actually wanted — so no new field is needed,
only a different one.
