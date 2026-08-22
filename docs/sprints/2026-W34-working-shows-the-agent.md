# Sprint: WORKING shows the agent

> A first working version of the running-agent section: an operator glances at
> WORKING and sees agents — what each is doing, when it last did anything, and
> what it is waiting on — without opening a terminal.

## Status

- **Phase:** Active
- **Start:** 2026-08-19
- **End:** 2026-08-26
- **Release:** 2.8.0

## Sprint Goal

WORKING lists branches. An operator running five agents needs it to list
**agents**, and today it cannot: an agent that stopped to ask a question was
filed under WAITING ON YOU as *worker finished — review it*, which is the one
reading that invites a restart into the same unanswered question.

The scope was drawn **read-only — see the agents, do not act on them** — and
it held until the three read-only waves had all merged. On 2026-08-19 one
crossing was made deliberately: **answering a waiting agent from the board**
came in, because a board that shows a question and cannot take its answer sends
the reader to a terminal for the one action the whole sprint made visible.

Listing an agent that holds no branch and the `.plot/agents/` registry stay
out. The plan itself argues the registry belongs last, because the read-only
waves each answer a question an operator has today while the registry answers
one nobody can ask until agents can be listed without work.

Success is one glance: three rows, each naming a running agent, its freshness,
and — where it applies — the question it is waiting on, with the answer
enterable where the question is shown.

### Must Have

- [x] [working-shows-the-agent] Wave *Asking* — a `waiting` worker keeps its place in WORKING with what it waits on, instead of being filed as finished
- [x] [working-shows-the-agent] Wave *Log* — the board serves a worker's log from its deterministic path; a WORKING row offers it
- [x] [the-pulse-measures-progress-not-elapsed-time] `changed_ago_seconds` — a row says when work last changed, so a long job and a dead one stop reading alike
- [ ] [a-startable-wave-says-so] An eligible wave takes the actionable tone — statusTone colours what a reader acts on, and starting work is the most actionable thing on the board
- [ ] [an-interrogation-leaves-a-record] The round count reaches the plan file — the board has the field, the parser reads it, and nothing has written it since 2026-08-17
- [ ] [a-plan-moves-through-the-sections] Approve and Commission design on the plan row, the plan appears in NOT STARTED, Start work takes it — one lifecycle path, two waves

### Should Have

- [x] [working-shows-the-agent] Wave *Panel* — pid, uptime, command, branch and the live log in one view, opened from the row
- [x] [the-board-answers-agents] Wave *Ask* — `/api/attention` carries the same verdicts to consumers that cannot run the scan (dispatched 2026-08-19)
- [x] [an-issue-is-a-signal-the-board-can-see] Wave 1 — the board sees unplanned issues (dispatched 2026-08-19)
- [x] [plot-board-setup] Wave *Skill* — the adoption spoke (dispatched 2026-08-19)
- [x] [working-shows-the-agent] Wave *Answer* — a continuation run in the same worktree, prompted with the brief and the answer (pulled from Deferred 2026-08-19)

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
