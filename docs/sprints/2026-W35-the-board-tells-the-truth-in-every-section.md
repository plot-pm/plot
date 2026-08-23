# Sprint: The board tells the truth in every section

> Every section admits only rows that belong in it, and says only true things
> about them. The specification is `docs/board-domain-model.md`, whose rules were
> measured against the estate rather than asserted — success is that they re-run
> green.

## Status

- **Phase:** Active
- **Start:** 2026-08-23
- **End:** 2026-09-02
- **Release:** 2.9.0

## Sprint Goal

**A valid board state, shown honestly, in every section.**

Measured on the live board 2026-08-23, across 106 rows, seven defects:

```
DONE holds 41 RELEASED rows          — shipped work, out of the board's scope
DONE holds 1 DISCOVERY row           — a merged wave on a plan still in draft
DONE holds 1 INCOMPLETE wave         — "merged — wave still open" under a heading that says done
DONE wears an ACTIVITY MARK          — earned by the board's own test fixture in a stale worktree
DONE holds 3 STALE WORKER states     — failed/waiting on branches that landed
1 WAVE renders in TWO SECTIONS       — one merged branch and one open, so both predicates claim it
A DRAFT plan's head claims "work landed — waiting to be merged"
                                     — no PR exists, no ref was pushed, nobody merged anything
```

Each was reported from a screenshot by an operator reading the running board.
None was found by a test, which is the second thing this sprint changes.

### What "valid" means, and it is written down

`docs/board-domain-model.md` states six entities — plan, wave, branch, pr,
worklog, build — their relations, their creation lifecycle, and the constraints
each section places on the statuses it admits. Every rule was executed against
the live payload before being written:

```
nine of twelve PLAN-section rules hold with zero exceptions
three of six   WAVE-section rules hold
```

Every failure is one of the seven defects above, and **no rule needed weakening
to fit the estate** — which is what makes them constraints rather than
descriptions.

**Success is those eighteen rules re-running green**, and a board a reader opens
after the release containing no row its section forbids.

### The order is a dependency, and Plot enforces it

`the-wave-is-a-thing-the-board-can-hold` carries four waves, and its `Consumed`
wave is blocked by Plot itself until the wave model lands:

```
Constrained  →  the section rules become a test, recording today's behaviour
One row      →  a wave renders once, in one section          ← the pivot
Modelled     →  the contract carries a Wave
Consumed     →  DONE filters on it; the split head counts what is elsewhere
```

`Inverted` — one merged branch, one open — is the pivot. Once a wave has one
section, DONE's verdict rule is already satisfied and the split tuple's numerator
becomes well-defined, so both dependent items shrink rather than being written
around a placement about to change.

**Three branches from two other plans moved into that `Consumed` wave** on
2026-08-23, so the ordering is a gate rather than a note. This repo's own
`CLAUDE.md` is the reason: a prose MUST will eventually be violated.

### Why DONE carries the sprint

Five of the seven defects are in DONE, structurally: **it is the only section
whose membership depends on all three levels at once** — the plan's phase, the
wave's verdict, the branch's state. Every other section reads one or two, and
every other section is already exactly what its rule says.

DONE's job is to hold **the release scope** — every plan whose work has landed
and whose version has not shipped, waiting on the endgame test the next release
will be. A section that answers *what needs testing* with rows shipped months ago
cannot serve the release it exists for.

### Must Have

- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *Constrained* — the eighteen section rules become an executable test, written against today's behaviour so the baseline is recorded before anything moves
- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *One row* — a wave renders as exactly one row in exactly one section; a wave with any unmerged branch is where its unfinished work is
- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *Modelled* — the contract carries a `Wave` with identity, branches, verdict, section and completeness, derived once where the verdicts already are
- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *Consumed* — DONE holds the release scope, and the split head counts what is elsewhere without rendering it
- [ ] [done-holds-what-is-still-yours] A finished row reports neither a pulse nor a live worker state — the activity mark and the stale worker are one category error in one file
- [ ] [a-draft-plan-claims-no-approvals] A wave head says what its verdict says — the `default:` that asserts *work landed* about branches that do not exist

### Should Have

- [ ] [a-plan-moves-through-the-sections] Approve on the plan row, the plan reaches NOT STARTED, Start work takes it — one lifecycle path walked end to end
- [ ] [a-startable-wave-says-so] An eligible wave takes the actionable tone — `statusTone` colours what a reader acts on, and starting work is the most actionable thing on the board
- [ ] [an-interrogation-leaves-a-record] The round count reaches the plan file — the board has the field, the parser reads it, and nothing has written it since 2026-08-17
- [ ] [a-split-plan-says-it-is-split] The wave name stays in its cell, and the sweep names a prose wave — a 53-character name currently paints over its neighbours

### Could Have

- [ ] [the-name-track-holds-the-name] The name track holds the name — 80% of plan slugs exceed the visible width while the branch beside them renders in full
- [ ] [a-folded-row-still-says-what-matters] A folded head carries its tally and says what is live
- [ ] [the-blocking-wave-is-found-wherever-it-is] The blocked mark finds its target across sections — and says so when it cannot
- [ ] [the-board-says-which-branch-it-serves] The header names the branch the board is serving from
- [ ] [the-plan-the-board-holds] The row carries the plan's own records rather than re-deriving them
- [ ] [loose-checks-what-it-promises] `--loose` verifies green rather than not-draft

### Deferred

- **Renaming `Endgame`.** It is the one phase named for what follows rather than
  for its own state, which is why *DONE means ready for testing* has to be
  explained rather than read off the column. The rename is not in this sprint;
  the rule it obscures is.
- **`the-budget-is-spent-where-it-is-needed`.** Host-budget work, unrelated to
  board truth. It has its own plan and can run in any timebox.

## Notes

- 2026-08-23: opened from the scope deferred by
  `2026-W34-working-shows-the-agent`, whose own goal — *WORKING shows the agent*
  — was met at 8 of 11 items. That sprint's goal was reframed mid-timebox to this
  one; rather than judge it against a goal set after its work began, the reframed
  scope moved here, where it has a timebox that can hold it.
- Fourteen plans bear on board truth, totalling **30 branches**. The MoSCoW split
  above is by **dependency and blast radius**: Must Have is what changes what a
  section *admits*, Should and Could are what a section *says* once its
  membership is settled.
