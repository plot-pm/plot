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

### The Must Have test, and it is checkable

**A plan is Must Have only if one of the eighteen executed section rules still
fails once everything else has landed.** Not *important*, not *related* — the
rules are the release's success condition, so the test is whether they can go
green without it.

Applied honestly, that promotes one item nobody had scoped and demotes one that
sounds mandatory:

| plan | does a rule fail without it? | tier |
|---|---|---|
| `the-wave-is-a-thing-the-board-can-hold` | yes — *every wave has exactly one section* fails 81/82 | **Must** |
| `done-holds-what-is-still-yours` | yes — three DONE rules fail 60/61, 19/61, 58/61 | **Must** |
| `done-means-delivered` | **yes** — 16 fully-merged plans still read `Approved`, so *DONE ⇒ phase Development or Endgame* is measured against a wrong phase | **Must** |
| `a-wave-is-one-branch` | **yes** — an unsliced wave has no single verdict, so *a wave has one section* is undefined over it | **Must** |
| `a-draft-plan-claims-no-approvals` | **no** — the head's sentence is not a membership rule | Should |
| `a-mock-row-shows-what-the-tuple-still-gets-wrong` | **no** — it makes the rules *easier to test*, not able to pass | Should |

**Two of those deserve their reasoning stated, because both readings are
defensible.**

`done-means-delivered` was not scoped at all until this review, and it is the
most load-bearing item in the sprint. Sixteen plans have every branch merged and
still read `Approved`. DONE's membership rule reads the plan's phase — so the
filter can be implemented perfectly and still show the wrong rows, because the
phase it reads was never advanced. **A rule measured against a wrong input cannot
go green.**

`a-mock-row-shows-what-the-tuple-still-gets-wrong` is the one demotion, and it
was named mandatory in review. Under the stated test it is Should: a deterministic
mock makes the eighteen rules far easier to assert, and round 2 concluded the
fixtures must otherwise be hand-built — but hand-built fixtures *work*. The rules
can go green without it. **It is the strongest Should Have in the sprint and
should be taken first among them**; if the hand-built fixtures prove unworkable
in practice, promote it rather than letting the rules go untested.

### Must Have

- [x] [done-means-delivered] Sixteen fully-merged plans still read `Approved` — DONE's membership reads the phase, so the filter is measured against a wrong input until this lands <!-- status: delivered, pr: #345, branches: 4/4 -->
- [x] [a-wave-is-one-branch] An unsliced wave — five branches under one wave, blocked 26 days — has no single verdict, so *a wave has one section* is undefined over it <!-- status: delivered, branches: 3/3 -->
- [x] [the-wave-is-a-thing-the-board-can-hold] Wave *Constrained* — the eighteen section rules become an executable test, written against today's behaviour so the baseline is recorded before anything moves <!-- status: delivered, pr: #334, branches: 1/1 -->
- [x] [the-wave-is-a-thing-the-board-can-hold] Wave *One row* — a wave renders as exactly one row in exactly one section; a wave with any unmerged branch is where its unfinished work is <!-- status: delivered, pr: #339, branches: 1/1 -->
- [x] [the-wave-is-a-thing-the-board-can-hold] Wave *Modelled* — the contract carries a `Wave` with identity, branches, verdict, section and completeness, derived once where the verdicts already are <!-- status: delivered, pr: #349, branches: 1/1 -->
- [x] [the-wave-is-a-thing-the-board-can-hold] Wave *Consumed* — DONE holds the release scope, and the split head counts what is elsewhere without rendering it <!-- status: delivered, pr: #353, branches: 4/4 -->
- [x] [done-holds-what-is-still-yours] A finished row reports neither a pulse nor a live worker state — the activity mark and the stale worker are one category error in one file <!-- status: delivered, branches: 1/1 -->
- [x] [a-marker-is-a-file-not-a-mention] A marker is a file, not a mention — `plot_worker_blocked` greps file CONTENTS, so 28 documenting files on main make every clean worker read `waiting` and the board offer a question lifted from a brief <!-- status: delivered, branches: 1/1 -->

### Should Have

- [x] [a-mock-row-shows-what-the-tuple-still-gets-wrong] `PLOT_BOARD_MOCK` renders one row per kind — the deterministic fixture the eighteen rules assert against. **Take this first**: without it every rule test hand-builds its own pulse <!-- status: delivered, pr: #346, branches: 2/2 -->
- [x] [a-draft-plan-claims-no-approvals] A wave head says what its verdict says — the `default:` that asserts *work landed* about branches that do not exist <!-- status: delivered, branches: 1/1 -->
- [x] [a-plan-moves-through-the-sections] Approve on the plan row, the plan reaches NOT STARTED, Start work takes it — one lifecycle path walked end to end <!-- status: delivered, branches: 2/2 -->
- [x] [a-startable-wave-says-so] An eligible wave takes the actionable tone — `statusTone` colours what a reader acts on <!-- status: delivered, branches: 1/1 -->
- [x] [an-interrogation-leaves-a-record] The round count reaches the plan file — the board has the field, the parser reads it, nothing has written it since 2026-08-17 <!-- status: delivered, pr: #323, branches: 2/2 -->
- [x] [a-split-plan-says-it-is-split] The wave name stays in its cell, and the sweep names a prose wave — a 53-character name currently paints over its neighbours <!-- status: delivered, pr: #347, branches: 2/2 -->
- [x] [the-registry-names-a-live-agent] The registry names a live agent — a dead pid displayed beside `running`, nine agents skipped by a gate on a value the classifier never reads, and six worktrees with no entry at all <!-- status: delivered, branches: 1/1 -->

- [x] [a-plan-has-a-phase-and-a-status] A plan carries a phase AND a status — the board derives seven statuses the plan format cannot state, so `Approved` covers everything from nothing-started to every-wave-merged <!-- status: delivered, pr: #374, branches: 1/1 -->
- [x] [the-row-says-whether-you-can-start-it] The row says whether you can start it — a reader cannot tell an eligible branch from a blocked one without opening the plan
<!-- MOVED FROM COULD TO SHOULD 2026-08-25, after the v2.9.0 endgame walk.
     Stop 4 measures it directly — 'M matches the agents you can actually
     see running, not the registry's size' — and it reads 16 working over
     4 live processes. A Could neither blocks a release nor prompts about
     one; a Should prompts, which is the treatment a checklist item that
     FAILED deserves. -->
- [x] [working-lists-the-workers-that-are-working] WORKING lists the agents actually working — the header reads `16 working` over 16 rows while 4 processes are alive; 12 are `stalled` or `unknown`. Found walking the v2.9.0 endgame, Stop 4

### Could Have

- [x] [the-name-track-holds-the-name] The name track holds the name — 80% of plan slugs exceed the visible width while the branch beside them renders in full <!-- status: delivered, branches: 1/1 -->
- [ ] [a-folded-row-still-says-what-matters] A folded head carries its tally and says what is live
- [x] [the-blocking-wave-is-found-wherever-it-is] The blocked mark finds its target across sections — and says so when it cannot
- [x] [the-board-says-which-branch-it-serves] The header names the branch the board is serving from <!-- status: delivered, branches: 1/1 -->
- [ ] [the-plan-the-board-holds] The row carries the plan's own records rather than re-deriving them
- [ ] [the-page-is-as-tall-as-the-screen] Every board scrolls by 13px whatever it contains
- [ ] [loose-checks-what-it-promises] `--loose` verifies green rather than not-draft

<!-- ADDED 2026-08-25, mid-sprint. These six plans were WRITTEN during the
     sprint, each in response to a defect found while working on it — reported
     from screenshots of the running board, not from CI. They serve the sprint's
     goal directly ("a valid board state, shown honestly, in every section") and
     were never added to this file, so the board filtered them out of every
     section under `Sprint only` while their work was landing. -->
- [x] [a-wave-row-is-a-wave-row-everywhere] A wave renders as a wave row in every section — the same wave read as a wave in NOT STARTED and as a branch in WORKING <!-- status: delivered, pr: #392, branches: 2/2 -->
- [x] [one-wave-row-two-contents] One wave row, two contents — the row's slots disagreed between sections <!-- status: delivered, branches: 2/2 -->
- [x] [the-board-says-how-many-workers-are-free] The control says how many workers are free, and counts only the busy ones <!-- status: delivered, pr: #375, branches: 1/1 -->
- [x] [the-sprint-filter-says-what-it-filters] The Agents tab filters on sprint MEMBERSHIP — the old predicate admitted 53 plan rows with empty sprint fields beside the 2 genuine plan-less ones <!-- status: delivered, pr: #401, branches: 5/5 -->
- [x] [a-worker-asks-for-the-next-wave] A worker asks for the next wave rather than stopping at its own <!-- status: delivered, pr: #404, branches: 4/4 -->
- [x] [the-working-section-shows-every-worker] WORKING renders one row per registry entry — 23 registry entries against 0 rows rendered, 6 agents whose branch the pulse never produced <!-- status: delivered, pr: #407, branches: 5/5 -->
- [x] [the-agents-tab-filters-to-the-sprint] The Agents tab gains the sprint filter and states the sprint's progress and target release — the control this sprint's filtering work builds on <!-- status: delivered, branches: 6/6 -->
- [x] [the-derivations-leave-the-component] The row derivations leave `AgentList.tsx` for modules grouped by subject, so two branches on unrelated section rules stop editing one file <!-- status: delivered, branches: 2/2 -->
- [x] [the-scan-asks-once-per-pulse-not-once-per-branch] An idle board stops exhausting the host's hourly budget — branch PR state resolves from the one repo-wide list the scan already fetches <!-- status: delivered, branches: 1/1 -->
- [x] [a-count-answers-to-its-section] A count answers to the section beneath it — DONE reads `33` in its header over 13 visible rows; the two count different units. Found walking the v2.9.0 endgame
- [x] [the-board-shows-where-the-thinking-happens] The Agents tab names the branch the master agent works on, and the header's unlabelled branch chip — which named the SERVER's checkout and was twice read as the operator's — is removed

### Out of scope, and why — 27 open plans, 20 not in this sprint

Reviewed on 2026-08-23 against the release goal. **Scoped by plan, not by
story**: `plot-board` holds six open plans and only three serve this goal, while
`plot-planning-model` holds four of which one does. A story spans releases by
design — pulling one in wholesale would bring the page height and the ticket
router along with the wave model, and neither is a section rule.

Notable exclusions, each with a reason rather than an omission:

- **`opus5-longhorizon-hardening`** (6 branches, story `plot-gates`) — the
  largest open plan and the oldest. Its PR #57 is carried in below as a decision,
  not as work. Nothing in it bears on section truth.
- **`a-dispatch-hands-over-a-brief`** (3 branches) — dispatch ergonomics. Real,
  and orthogonal.
- **`a-ticket-becomes-a-plan-or-a-story`** (1) — a router for tickets. Adjacent to
  the board and not about what a section admits.
- **`the-plan-is-the-wave`**, **`waves-name-themselves`**,
  **`an-approved-plan-offers-its-two-starts`**, **`approval-hands-the-work-to-agents`**,
  **`every-section-has-one-subject`** — all Approved, all in flight or adjacent.
  `every-section-has-one-subject` in particular owns `Inverted`, the wave this
  sprint's pivot is about — but the fix lives in the wave model, not in that plan.
- **`the-budget-is-spent-where-it-is-needed`** — host budget, unrelated.

**One plan was superseded during this review**: `a-wave-is-a-thing-not-a-label`
said *the scan reports a wave as an object and the board flattens it* — the same
defect as `the-wave-is-a-thing-the-board-can-hold`, written earlier and found
later. The newer plan survives because it carries the measurements, the domain
model and the enforced wave dependency; the older one is marked Superseded with
that record rather than deleted.

### Deferred

- **Renaming `Endgame`.** It is the one phase named for what follows rather than
  for its own state, which is why *DONE means ready for testing* has to be
  explained rather than read off the column. The rename is not in this sprint;
  the rule it obscures is.
- **`the-budget-is-spent-where-it-is-needed`.** Host-budget work, unrelated to
  board truth. It has its own plan and can run in any timebox.

## Notes

### Scope Changes

- 2026-08-23: added `a-plan-has-a-phase-and-a-status` and
  `the-row-says-whether-you-can-start-it` as Should Haves. Both were
  interrogated during the sprint (rounds 4 and 1) and both bear directly on
  what a section may admit: the first is the phase/status distinction that
  `done-means-delivered` had to work around, the second is whether a row
  states its own startability. Neither is dispatched yet, so they are
  Should rather than Must.
- 2026-08-23: Added [a-marker-is-a-file-not-a-mention] to Must — `plot_worker_blocked` greps file CONTENTS, so 28 documenting files on main make every clean worker read `waiting`; WORKING showed 16 rows against 2 live agents, 13 of them this false positive. Dispatched.
- 2026-08-23: Added [the-registry-names-a-live-agent] to Should — a dead pid displayed beside `running`, nine agents skipped by a gate on a value the classifier never reads. Dispatched.

- 2026-08-23: opened from the scope deferred by
  `2026-W34-working-shows-the-agent`, whose own goal — *WORKING shows the agent*
  — was met at 8 of 11 items. That sprint's goal was reframed mid-timebox to this
  one; rather than judge it against a goal set after its work began, the reframed
  scope moved here, where it has a timebox that can hold it.
- Fourteen plans bear on board truth, totalling **30 branches**. The MoSCoW split
  above is by **dependency and blast radius**: Must Have is what changes what a
  section *admits*, Should and Could are what a section *says* once its
  membership is settled.
