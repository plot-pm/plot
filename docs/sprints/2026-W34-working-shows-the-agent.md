# Sprint: The board tells the truth in every section

> Every section admits only rows that belong in it, and says only true things
> about them. WORKING shows agents — that half is done; what remains is a board
> whose sections can be trusted, and a DONE that holds the release scope 2.8.0
> is about to be tested against.

## Status

- **Phase:** Active
- **Start:** 2026-08-19
- **End:** 2026-08-26
- **Release:** 2.8.0

## Sprint Goal

**Every section of the board tells the truth about what is in it.**

The sprint opened as *WORKING shows the agent*, and that goal is met: an operator
glances at WORKING and sees agents, their freshness, and the question a waiting
one is stuck on, with the answer enterable where it is shown. Eight of its
eleven items are done.

What the remaining work turned out to be about is different, and the three open
Must Haves were already it before this was written: **a section that admits rows
which do not belong there, or says things about them that are not so.** Measured
against the live board on 2026-08-23, across 106 rows:

```
DONE holds 41 RELEASED rows          — shipped work, out of the board's scope
DONE holds 1 DISCOVERY row           — a merged wave on a plan still in draft
DONE holds 1 INCOMPLETE wave         — "merged — wave still open" under a heading that says done
DONE wears an ACTIVITY MARK          — earned by the board's own test fixture in a stale worktree
DONE holds 3 STALE WORKER states     — failed/waiting on branches that landed
1 WAVE renders in TWO SECTIONS       — one merged branch and one open, so both predicates claim it
A DRAFT plan's head says "work landed — waiting to be merged"
                                     — no PR exists, no ref was pushed, nobody merged anything
```

So the release goal for **2.8.0** is a board whose every section is true: **a
valid board state, shown honestly, in every section.**

### What "valid" means, and it is now written down

The sprint has a specification rather than a sentiment. `docs/board-domain-model.md`
states six entities, their relations, their creation lifecycle, and the
constraints each section places on the statuses it admits — every rule measured
against the estate rather than asserted.

Eighteen of those rules were executed against the live payload. **Nine of twelve
plan-section rules hold with zero exceptions; three of six wave rules do.** Every
failure is one of the defects listed above, and no rule needed weakening to fit
the estate — which is what makes them constraints rather than descriptions.

**Success is that those same rules re-run green**, and that the board a reader
opens after the release contains no row that its section forbids.

### The scope, and what is deliberately left out

Fourteen plans now bear on board truth, totalling **30 branches**. That is more
than this sprint can land, so the cut is by **dependency and blast radius**
rather than by preference:

**In** — the membership rules, because they are what makes a section true, and
they are ordered by a real dependency Plot now enforces: a wave gets one section,
then DONE filters on it, then the split head counts what is elsewhere.

**Out** — the read-and-render work: the folded head's tally, the name track, the
blocked-by lookup, the plan's unread records. Each is a real defect with a
written plan, none changes what a section *admits*, and all of them are better
done against a board whose membership is already settled.

**Also out, and named because its absence is a decision:** `Endgame` is the one
phase named for what follows rather than for its own state, which is why *DONE
means ready for testing* had to be explained rather than read off the column. A
rename is not in this sprint; the rule it obscures is.

### Why DONE carries the sprint

Five of the seven measured defects are in DONE, and the reason is structural: it
is the only section whose membership depends on all three levels at once — the
plan's phase, the wave's verdict, and the branch's state. Every other section
reads one or two, and every other section is already exactly what its rule says.

DONE is also the section this release most needs correct. **Its job is to hold
the release scope** — every plan whose work has landed and whose version has not
shipped, waiting on the endgame test that 2.8.0 itself will be. A section that
answers *what needs testing* with 41 rows shipped months ago cannot be used for
the release it is meant to serve.

### Must Have

- [x] [working-shows-the-agent] Wave *Asking* — a `waiting` worker keeps its place in WORKING with what it waits on, instead of being filed as finished
- [x] [working-shows-the-agent] Wave *Log* — the board serves a worker's log from its deterministic path; a WORKING row offers it
- [x] [the-pulse-measures-progress-not-elapsed-time] `changed_ago_seconds` — a row says when work last changed, so a long job and a dead one stop reading alike
- [ ] [a-startable-wave-says-so] An eligible wave takes the actionable tone — statusTone colours what a reader acts on, and starting work is the most actionable thing on the board
- [ ] [an-interrogation-leaves-a-record] The round count reaches the plan file — the board has the field, the parser reads it, and nothing has written it since 2026-08-17
- [ ] [a-plan-moves-through-the-sections] Approve and Commission design on the plan row, the plan appears in NOT STARTED, Start work takes it — one lifecycle path, two waves
- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *One row* — a wave renders as exactly one row in exactly one section; the wave that renders in two is the pivot every other membership rule waits on
- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *Consumed* — DONE holds the release scope and the split head counts what is elsewhere; both blocked until the wave has one section, and Plot enforces it
- [ ] [done-holds-what-is-still-yours] A finished row reports neither a pulse nor a live worker state — the activity mark and the stale worker are one category error in one file
- [ ] [a-draft-plan-claims-no-approvals] A wave head says what its verdict says — the `default:` that asserts *work landed* about branches that do not exist

### Should Have

- [x] [working-shows-the-agent] Wave *Panel* — pid, uptime, command, branch and the live log in one view, opened from the row
- [x] [the-board-answers-agents] Wave *Ask* — `/api/attention` carries the same verdicts to consumers that cannot run the scan (dispatched 2026-08-19)
- [x] [an-issue-is-a-signal-the-board-can-see] Wave 1 — the board sees unplanned issues (dispatched 2026-08-19)
- [x] [plot-board-setup] Wave *Skill* — the adoption spoke (dispatched 2026-08-19)
- [x] [working-shows-the-agent] Wave *Answer* — a continuation run in the same worktree, prompted with the brief and the answer (pulled from Deferred 2026-08-19)

- [ ] [the-wave-is-a-thing-the-board-can-hold] Wave *Constrained* — the section rules become an executable test rather than a document, recording today's behaviour before anything moves

### Could Have

- [x] [a-blocked-wave-is-not-eligible] `bug/a-blocked-branch-says-it-is-blocked` — a blocked row links its blocker
- [x] [the-scan-asks-once-not-once-per-branch] Waves *Cadence* — the pulse aims at 5 s and sits near 14 s; a section refreshed this often is worth the cost

### Deferred

<!-- Items moved here during the sprint when they will not make the timebox -->

- [ ] [working-shows-the-agent] Waves *Machine*, *Registry* — WAITING ON A MACHINE from local processes, and agent identity that outlives a branch. Out by the goal, not by capacity.

> *Answer* was here too until 2026-08-19, when the three read-only waves had all
> merged and it was pulled into Should Have by an explicit decision. The sprint
> is therefore no longer purely read-only, and that is worth naming rather than
> quietly amending: the boundary held for as long as it was useful, and was
> crossed once, deliberately, for the wave that closes the loop the other three
> opened. *Machine* and *Registry* stay out.

## Retrospective

<!-- Filled during /plot-sprint close. The question this sprint exists to
     answer, beyond its items: after a week of watching agents rather than
     branches, which restart did the section prevent — and did any row still
     leave the operator opening a terminal to find out what was happening? -->

## Notes

Runs concurrently with `2026-W34-the-board-tells-the-truth`, which shares three
Should Haves with it — the branches dispatched 2026-08-19 belong to both
timeboxes. That overlap is deliberate and is itself worth measuring: Plot's
sprint tooling reports every active sprint on the stated grounds that two teams
may share one train, and this is the first time the repo has tested that claim
against itself rather than in prose.

The test found a limit on its first run. A plan's `Sprint:` field holds ONE
value, so a plan in two timeboxes can only name one of them — the shared plans
keep their W34 assignment and appear here by reference. `plot-sprint-release.sh`
still reports each sprint's items correctly, because it reads the item lines
rather than the plans' fields; what it cannot do is answer "which sprints is
this plan in" from the plan alone. Worth a plan of its own if the overlap
recurs, and not worth pre-empting from one occurrence.

The goal was chosen over two larger readings of "a working agent section" —
answering an agent from the board, and a `.plot/agents/` registry giving each
agent an identity that outlives its branch. Both were rejected for this timebox
on the plan's own argument about wave order, not on effort.
