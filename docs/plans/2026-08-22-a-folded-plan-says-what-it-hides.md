# A folded plan says what it hides

> A plan head shows its phase and nothing about the branches beneath it, so a
> collapsed group gives the reader no reason to open it — even when a PR under
> it is red.

## Status

- **Phase:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

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
reader's. A plan whose branches are all green says nothing extra — the phase is
the whole answer there, and a `green` badge on 19 rows is chrome.

**Aggregated from the rows the head already has.** `PlanRow` receives
`group.rows`; the state is `Math.min`-style folding over `row.pr?.state`, the
same shape as `marked` and `active` beside it. No new server field, no new
fetch — `AgentRow.pr.state` is already on the wire, which is why this is a
client-side projection change and nothing more.

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
- **Not double-state an expanded group.** When the group is open the branch
  rows say it themselves; the head's aggregate is for the FOLDED reader. Decide
  whether it hides on expand or stays — see Open Questions.
- **Not reach past PR state.** Worker state, staleness and stuck-ness are
  separate facts with their own marks; folding them into one word rebuilds the
  one-label-many-states defect the contract names.

### Open Questions

- [ ] Does the aggregate stay visible when the group is EXPANDED, or hide once
      the branch rows state it themselves? Staying is simpler and matches the
      change mark; hiding is less repetitive. Lean: stay, because a long group
      scrolls its head off screen either way.
- [ ] Does a WAVE row need the same treatment? It aggregates marks already, and
      a wave of several branches has the same fold. Probably yes, and by the
      same helper — but it is a second branch of work, not this one.
- [ ] Should `pending` count at all, or only the two states a reader can act
      on? A running build is not an errand. Lean: include it, dimmer — *"a
      machine is working here"* is why WAITING ON A MACHINE exists as a section.

## Branches

### Aggregated

- `feature/a-folded-plan-says-what-it-hides` — Fold the branches' PR states into
  one worst-case word on the plan head, beside the phase, with a count where
  more than one branch is affected. Browser test: a folded plan over a red
  branch says so; a folded plan over green branches says only its phase.

## Notes

Found while reducing #304's test failures, from the operator's question *"Wo
ist 304?"* — the honest answer being *"one fold away, and the row gave you no
reason to look."*

Deliberately NOT folded into #304. That branch is at 114/115 and its subject is
the wave model; this is a new statement on a row, with its own test and its own
review. Same reasoning that kept the wave-menu fix scoped to sole branches.
