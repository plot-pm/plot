# A folded plan says what it hides

> A plan head shows its phase and nothing about the branches beneath it, so a
> collapsed group gives the reader no reason to open it — even when a PR under
> it is red.

## Status

- **Phase:** Delivered
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, plan-PR #307 merged
- **Started:** 2026-08-22, Jan Wloka, `feature/a-folded-plan-says-what-it-hides`
- **Started:** 2026-08-22, Jan Wloka, `feature/a-folded-plan-says-what-it-hides`
- **Delivered:** 2026-08-22, jwloka, PRs #319

## Changelog

- The Agents tab's plan rows now say when a branch beneath them needs
  attention: a folded plan carries the worst PR state under it beside its
  phase, so a red branch is visible without opening the group.

<!-- Board impact: board-only. No change to the plan format, the template, the
     helper scripts or the docs/plans layout — the facts are already on the
     wire (`AgentRow.pr.state`), and only the client's projection changes. -->

## Motivation

**Reported from the live board as a question: "Wo ist 304?"**

PR 304 was on the board the whole time — in `waiting-on-you`, under plan
`a-wave-is-a-thing-not-a-label`, wave `Modelled`, with `checks failing`. What
the reader saw was a collapsed row reading `PLAN  a-wave-is-a-thing-… (2)
Discovery  0m`, and nothing in it suggested that opening it would find a red
branch.

The two shapes on one screen say unequal amounts:

| row | shows |
|---|---|
| `the-plan-is-the-wave` (an `idea/` branch) | `305` · `checks failing` · `draft` |
| `a-wave-is-a-thing-…` (a plan with branches) | `Discovery` · `0m` |

The difference is structural rather than accidental. An `idea/` branch is ONE
row, so it carries its own PR facts. A plan with branches is a HEAD over a
group, and `tupleFromPlan` puts the plan's PHASE in slot 5 — deliberately, and
for a good reason recorded in its docstring: 71 branch rows once printed their
plan's phase, *"a fact about the plan on a row about something else"*, and slot
5 on the plan row is where that fact is true.

That reasoning stands. What it does not cover is the fold: the phase is the
only fact the head states, so a reader scanning collapsed rows has no signal
that anything under one is wrong.

**Measured on the live fleet (2026-08-22):**

- 19 plans render as a head over a group
- **15 of those hold at least one PR** whose state is invisible while folded
- 8 plans hold a single row, where the head shows the PR itself

So this is the majority shape on this board, not an edge case.

**The precedent is already here.** A plan head carries a CHANGE MARK when
anything beneath it changed (`rows.some((r) => marked.has(rowKey(r)))`), and a
wave row aggregates its branches' marks for exactly this reason — a folded
reader must still see that something under the fold moved. The principle *"the
head speaks for its group"* is established; CI state is simply the fact that
never got it.

This is the third defect of one shape found in the wave redesign, after the
wave row's missing actions menu and its missing `data-pr-number` hook: a fact
moved when the row it lived on stopped being rendered, and was not given a new
home.

## Design

### Approach

**The head states the worst state under it, BESIDE the phase and never instead
of it.**

Slot 5 keeps the phase — that decision is not revisited, and the measurement
behind it (71 rows printing a fact about something else) still holds. The
aggregate is a second, smaller statement, the way `draft` already rides beside
a PR's state on a single-row plan.

**Worst-case, by an explicit precedence** — a reader scanning a column needs
one word per row, and the word must be the one that changes what they do:

```
conflicts > failing > pending > none/unknown > green
```

`conflicts` outranks `failing` for the reason `rowKind` already gives it
precedence: no PR resolves a conflict, so the errand is a rebase and it is the
reader's. **`pending` is included, rendered dimmer than the two actionable
states** — a running build is not an errand, but *a machine is working here* is
a fact worth a folded reader knowing, and it is the reason WAITING ON A MACHINE
exists as a section at all. Dimmer is the distinction: it says *something is
happening*, not *do something*. A plan whose branches are all green says nothing extra — the phase is
the whole answer there, and a `green` badge on 19 rows is chrome.

**Aggregated INSIDE `PlanRow`, not at its call sites — and that placement is
load-bearing.** `PlanRow` has two call sites and they are asymmetric: the
plan-group path folds `group.rows` for `active` and `marked`; the `planHeads`
path — the plan head drawn over WAVE groups — passes neither. An aggregate
computed at the call site the way `marked` is would appear on one kind of plan
head and not the other, and a folded wave-grouped plan is exactly the case this
plan is about.

The asymmetry is not hypothetical: adding `marked` to one site and not the other
cost a fix on 2026-08-22 that rendered nothing and read as a broken predicate.
`PlanRow` already receives `group`, so it derives the worst state from
`group.rows` itself — one derivation, both sites, and a third call site cannot
forget it.

No new server field and no new fetch: `AgentRow.pr.state` is already on the
wire, which is why this is a client-side projection change and nothing more.

**Symbol AND word**, per the repo's rule: the aggregate renders as a WORD, in
the tone the single-row plan uses for the same state. A colour alone would fail
the same test `StuckCell` records failing.

**Counted, where more than one is affected.** `checks failing (2)` says
something `checks failing` does not: how much of the plan is red. The tally
form already exists on the plan head for its row count, so the shape is
familiar rather than new.

### What this must not do

- **Not replace the phase.** A head that swapped `Discovery` for `checks
  failing` would re-open the defect `tupleFromPlan` closed — the plan's own
  status is what slot 5 is for.
- **Not mark green plans.** Nothing to act on, and a badge on every row is a
  badge nobody reads.
- **Not vanish on expand.** The aggregate STAYS when the group is open. A long
  group scrolls its head off screen either way, so hiding it trades a small
  repetition for a fact that disappears exactly when the reader has scrolled
  past the rows that would have restated it. It also keeps the rule free of
  expand-dependent behaviour, which is how the change mark already works.
- **Not reach past PR state.** Worker state, staleness and stuck-ness are
  separate facts with their own marks; folding them into one word rebuilds the
  one-label-many-states defect the contract names.

### Open Questions

- [x] Does the aggregate stay visible when the group is EXPANDED? **Stays.** A
      long group scrolls its head off screen either way, so hiding it removes
      the fact exactly when the reader has scrolled past the rows that restate
      it — and it keeps the rule free of expand-dependent behaviour.
- [ ] Does a WAVE row need the same treatment? It aggregates marks already, and
      a wave of several branches has the same fold. Probably yes, by the same
      helper — deliberately left open: it is a second branch of work, and the
      helper's shape is easier to judge once this one exists.
- [x] Should `pending` count? **Yes, dimmer.** A running build is not an errand,
      but *a machine is working here* is worth a folded reader knowing — it is
      why WAITING ON A MACHINE exists. Dimmer marks the difference between
      *something is happening* and *do something*.

## Branches

### Aggregated

- `feature/a-folded-plan-says-what-it-hides` — Fold the branches' PR states into
  one worst-case word on the plan head, beside the phase, with a count where
  more than one branch is affected. The fold happens **inside `PlanRow`**, from
  the `group` it already receives, so both call sites get it. Tests: a folded
  plan over a red branch says so, and says it on BOTH plan-head paths — the
  plan-group one and the `planHeads` one over wave groups, which is the
  asymmetry that would otherwise hide it; a folded plan over green branches says
  only its phase; `conflicts` wins over `failing` on a plan carrying both;
  `pending` renders in the dimmer tone rather than the actionable one; the
  aggregate is still shown when the group is expanded; the phase remains in slot
  5 and is never replaced; a count appears only where more than one branch is
  affected; the aggregate is a word and not colour alone. → #319

## Notes

Found while reducing #304's test failures, from the operator's question *"Wo
ist 304?"* — the honest answer being *"one fold away, and the row gave you no
reason to look."*

Deliberately NOT folded into #304. That branch is at 114/115 and its subject is
the wave model; this is a new statement on a row, with its own test and its own
review. Same reasoning that kept the wave-menu fix scoped to sole branches.

**Interrogated 2026-08-22.** The defect is intact and currently invisible, and
both halves of that matter. `tupleFromPlan` still sets `status: facts.phase`
with no PR aggregate, so the mechanism is unchanged — but measured on the live
board this afternoon, **zero** plans hide a bad PR, because PRs #305, #306 and
#307 were rebased green an hour earlier. The condition is transient and the
defect is not; a plan judged by today's estate would have been dropped for
lack of a symptom it will reproduce the next time anything goes red.

The finding was in the render path rather than the design. `PlanRow` has two
call sites and they are **asymmetric**: the plan-group path folds `group.rows`
for `active` and `marked`, the `planHeads` path over wave groups passes
neither. An aggregate added the way `marked` is added would have appeared on
one kind of plan head and not the other — and the folded wave-grouped plan is
precisely the case this plan exists for. The fold moved inside `PlanRow`, which
already receives the group.

That asymmetry is a live defect in its own right: a wave-grouped plan head
today never flashes on change and never pulses on activity, because neither
prop reaches it. Not folded into this plan, which is one projection change, but
it is the same two-call-site shape and worth its own fix.

