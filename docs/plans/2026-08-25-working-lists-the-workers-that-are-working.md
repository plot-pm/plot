# WORKING lists the workers that are working

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->
- **Started:** 2026-08-25, Jan Wloka, `bug/working-lists-the-live-agents`
- **Started:** 2026-08-25, Jan Wloka, `bug/a-stalled-worker-needs-a-person`
- **Started:** 2026-08-25, Jan Wloka, `feature/an-agent-row-can-be-dropped`
- **Started:** 2026-08-25, Jan Wloka, `bug/working-lists-the-live-agents`

## Changelog

WORKING lists the agents that are actually working, and its count says how many
those are. A registry entry for a session that has ended is not a worker.

## Motivation

### The measurement

Found walking the v2.9.0 endgame checklist, Stop 4, 2026-08-25. The item's own
wording is the assertion that fails:

> **Working carries a parallel-agents stepper**, reading `N parallel agents · M
> working`. Check **M matches the agents you can actually see running** — not
> the registry's size.

From `/api/fleet` on a complete pulse, with the board restarted on current
`main` and the artifact rebuilt:

```
header:            10 parallel agents · 16 working
registry entries:  16
running:            4
```

`working` **is** the registry's size — the exact thing the item says it must not
be. Twelve of the sixteen rows are sessions that have ended:

| state | count |
|---|---|
| running | **4** |
| unknown | 7 |
| stalled | 5 |

Verified against the machine: four processes were alive.

### What the rendered section looks like

Screenshotted 2026-08-25, the same pulse as the numbers above:

```
WORKING (16)   (−) 10 (+) parallel agents (cap)  ·  16 working

  AGENT  1d4fa4ff   …bug/the-registry-drops-a-settled-worker   someone is on it   SESSION 1h
  AGENT  a942b78e   …bug/a-ready-pr-asks-for-you               someone is on it   SESSION 1h
  AGENT  5f854840   …feature/a-busy-worker-names-its-wave      someone is on it   SESSION 2h
  AGENT  1cfd6add   …feature/the-registry-follows-a-hopping…   someone is on it   SESSION 3h
  AGENT  f2d2ec2a   …feature/the-filter-shows-what-it-excludes unknown            SESSION 3h
  AGENT  b414ba01   …feature/a-sprint-counts-every-member      unknown            SESSION 12h
  AGENT  228ca03b   …feature/the-sprint-control-names-its-state unknown           SESSION 12h
  AGENT  68727e2a   …bug/the-working-section-renders-the-registry stalled         SESSION 15h
  AGENT  5bba987a   …feature/the-board-filter-reads-the-sprint-file unknown       SESSION 19h
  AGENT  bug/a-wave-renders-as-a-wave-in-every-section …        stalled
  AGENT  test/a-row-moves-between-sections …                    unknown
  AGENT  bug/done-holds-finished-plans-only …                   stalled
  … 4 more
```

**The status column is already right.** Each row names its own state —
`someone is on it` for the four live ones, `unknown` and `stalled` for the
twelve that are not. Nothing here is lying about an individual row.

**It is the SECTION and its COUNT that are wrong.** A reader is told sixteen
agents are working, in a section whose subject is *who is working*, and must
then read twelve status cells to discover that only four are. The per-row
honesty makes the header's claim worse, not better: the board contradicts
itself within one screen.

Sessions up to **19h old** are listed as working.

### A second finding: seven rows have no session id

Of the sixteen entries, **nine carry a session id and seven do not**. A row with
no session renders its BRANCH in the identity slot, so the section splits
visually into two shapes — `AGENT 1d4fa4ff` above, `AGENT bug/done-holds-
finished-plans-only` below — and the second shape has no `SESSION` age either.

Every one of the seven is `stalled` or `unknown`. That is not a coincidence: an
entry loses its session when the process it named is gone. So *no session id* is
close to a synonym for *not a live worker*, and filtering to `LIVE_STATES`
removes all seven as a side effect.

It is recorded because the two shapes are the visible symptom a reader notices
first, and a fix that produced a uniform section without fixing the count would
look like it had worked.

### Why this is not a regression in #403

`the-working-count-is-the-rows` (#403) changed `working` from
`liveAgentCount(...)` to `entry.agents.length` (`fleet.ts:5279`), and it was
right to: the count and the rendered rows were two derivations that could
disagree, and now they cannot. `WORKING (16)` over sixteen rows is internally
honest.

**The rows are what is wrong, and the count faithfully reports them.** #403
answered *does the number match the section?* — it does. This plan answers the
question underneath: *should the section contain those rows at all?*

### The definition already exists, and is being contradicted

`auto-dispatch.ts:82` states which registry states mean a live worker:

```ts
const LIVE_STATES = new Set<AgentEntry['state']>(['running', 'waiting']);
```

That is the dispatcher's own rule — the one deciding whether a slot is free.
`AgentStateSchema` has five states: `running`, `waiting`, `finished`,
`stalled`, `unknown`. Three of them are not live, and the section lists all
five.

So the board disagrees with the dispatcher about what a worker is, in the one
place a reader goes to ask.

### Why `stalled` and `unknown` are not merely stale bookkeeping

**`unknown` is the honest answer to a question that could not be asked** — the
pid is gone and no exit code was recorded, so the session's fate is unknown. It
is emphatically not *running*.

**`stalled` says the opposite of working**: a worker that stopped with
uncommitted work on the floor. It needs a person, which makes it real and worth
seeing — but WAITING ON YOU is the section for *needs a person*, and calling it
`working` tells a reader the machine has it in hand.

Neither is noise to be deleted. Both are facts that belong somewhere other than
a list of who is working right now.

### What `the-registry-drops-a-settled-worker` already fixed, and did not

#407 drained the registry from 41 entries to 16 — every `finished` entry and 15
of 22 `unknown`. That is the reconciliation working.

The twelve that remain are held by **one tracked test fixture**,
`packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`, which
every board suite rewrites. #407's scratch filter names `.playwright-mcp`,
`.plot/agents` and `.omc/state` but not this path, so a worker that did nothing
but run its tests keeps a permanently dirty worktree and is never dropped.
Reported on the PR (#407 comment) rather than blocking its merge.

**Re-measured 2026-08-25 against the sixteen entries the board actually holds,
and the first number was the wrong population.** Counting *dirty worktrees in
the repo* gave 8 of 15; counting *registry entries that fail to reconcile* gives
a different and more useful split:

| why the entry stays | count |
|---|---|
| worktree clean, but state is not provably ended | **13** |
| worktree dirty with the fixture alone | 4 |

So the fixture blocks four, not eight — and the larger cause is something else
entirely. `dropSettledWorkers` keeps an entry unless the session has **ended**,
and `unknown` is precisely *not provably ended*: the pid is gone, no exit code
was recorded, and inventing "finished" from that is the guess the function
refuses to make. Thirteen clean worktrees sit behind that refusal.

That refusal is right, and it is the strongest argument for Wave `Live`: the
registry cannot become clean by reasoning alone, so the SECTION must not depend
on it being clean.

**Draining faster is not the fix, though — it is a second fix.** Even a
perfectly reconciled registry answers *which sessions exist*, and WORKING asks
*which are working*. A section must not depend on a cleanup job having run
recently to be true.

### Filtering alone moves the heap, it does not clear it

Asked while walking the endgame: *how does a user clean this up?*

They cannot. There is no agent action anywhere — `menus.tsx` has `BranchMenu`,
`RowActions`, `WaveActions`, `ResliceMenu`, `PlanActions` and
`IssueRowActions`, none for an agent — and no drop route on the server. The `⋯`
on a WORKING row belongs to the BRANCH half of that row.

The only cleanup path is `git worktree remove` at a terminal, after which
`dropSettledWorkers` reconciles on the next pulse. Measured 2026-08-25: **16 of
17 worktrees still exist**, which is exactly why the reconciliation keeps their
entries and is right to.

So Wave `Live` makes WORKING honest and sends thirteen entries to WAITING ON
YOU — the section a reader opens first, where each row is a problem report they
are then unable to close. **A section that names work nobody can act on is the
same defect one section over.**

## Design

### WORKING renders what is working; the rest is a problem report

`every-section-has-one-subject` already wrote the rule this plan implements, and
reading it settles two things the first draft guessed at:

| section | subject | an agent appears |
|---|---|---|
| **WORKING** | the **agent** | **only here while it works** |
| **WAITING ON YOU** | anything needing a person | **only when broken** — crashed, abandoned, out of context |

> *an agent in WAITING ON YOU is by construction a problem report*

So the split is not *live vs. dead* but **working vs. broken**, and every
registry state answers to one of the two:

| state | means (`plot-worker-state.sh:44-48`) | section |
|---|---|---|
| `running` | process alive | WORKING |
| `waiting` | a person owes it an answer | WORKING — it is mid-task |
| `stalled` | **work on the floor, no PR** | WAITING ON YOU — abandoned |
| `unknown` | **the board cannot tell** | WAITING ON YOU — see below |
| `finished` | the work reached review | neither; the PR carries it |

**`unknown` goes to WAITING ON YOU, and that is the decision this round turned
on.** It is not *broken* in the way `stalled` is — the pid is gone and no exit
code was recorded, so nothing is provable either way. The first draft would have
hidden it as *not live*.

The operator's rule is better: **if the board does not know what happened, a
person has to look.** That is precisely *out of context* in the table above, and
it makes the row a problem report about the board's own blind spot rather than a
claim about the worker. Seven of today's twelve non-live entries are `unknown`,
and hiding them would be the board deciding it need not admit what it cannot see.

`workingAgentRows` therefore filters on a rule imported from
`auto-dispatch.ts`'s `LIVE_STATES` rather than restated, so the board and the
dispatcher cannot drift on the definition of a worker.

The count follows the rows, exactly as #403 established: `working` is the length
of what WORKING renders. That property is preserved, not undone.

### A non-live entry is not lost

- **`stalled`** — a stopped worker with work on the floor — belongs in
  **WAITING ON YOU**. It is the definition of needing a person.
- **`unknown`** and **`finished`** carry no outstanding claim on anyone and need
  no row of their own; they drain through the reconciliation #407 added.

This is the same move `every-section-has-one-subject` made for an agent in
WAITING ON A MACHINE: the row was not deleted, it was put where its subject
belongs.

### An unrecognised state is shown, not hidden

Done-when #1 pins the size of `AgentStateSchema` so a sixth state cannot appear
unnoticed. But a pinned enum is a build-time gate, and it says nothing about an
OLDER server reading a NEWER registry file — the same widening-tolerant
asymmetry `MachineProcessOriginSchema` already keeps for its wire contract.

**So the filter is a denylist, not an allowlist**: WORKING excludes the states
known to be finished, stalled or unknown, and anything it does not recognise is
rendered with its state as the status word. A worker nobody can see is the worse
failure — the one this plan exists to fix — and reproducing it for a future
state would be the same defect with a newer name.

The cost is stated plainly: `LIVE_STATES` then stops being the section's source
of truth and becomes the complement it is derived from. That is a weaker
guarantee than an allowlist, taken deliberately, because it fails toward
visibility.

### The row says why it stays, and offers to end it

**A reason, not just a state.** `unknown` says the board could not tell; it does
not say what to do. The row names the obstacle it can see — *worktree still
present*, *uncommitted work* — the same fact `dropSettledWorkers` weighed when
it declined to drop the entry. One derivation, shown rather than kept.

**`Drop this agent`** for an entry whose session has ended. It removes the
registry entry and nothing else: no worktree deleted, no branch touched, no
process signalled. A registry entry is bookkeeping, and dropping it is a
bookkeeping act — which is what makes it safe behind a button at all.

**The loopback boundary is the whole permission**, the same one every write
route rests on: *whoever reaches this address is sitting at the machine that
owns the worktrees, and that IS the permission* (`write-gate.ts`). No second
check, and deliberately so — the gate is enforced ONCE in the router precisely
because a per-handler shape is the kind this repo calls a rule, correct today
and correct tomorrow only if every future route remembers. `/api/dispatch`
starts agents and `/api/approve` merges pull requests behind that same
sentence; dropping a bookkeeping row is the smaller act of the three.

**A failed drop leaves the row standing and says why.** `drop failed: EACCES
/…/.plot/agents/…` on the row, the same language a refused Approve or Deliver
already speaks. Not optimistic removal: a row that vanishes and returns on the
next pulse reads as a bug in the board rather than as a failure of the drop,
and this plan exists because the board said things that were not so.

It refuses a `running` entry. Not a nicety: the entry is how auto-dispatch
counts its slots, and dropping a live one lets the fleet start work over its cap.

### Not chosen: a *Remove worktree* button

The obvious one-click answer, rejected. `git worktree remove` deletes a
directory that may hold uncommitted work — this session rescued 192 lines from
exactly such a worktree — and a destructive filesystem act does not belong
beside a bookkeeping one. The row NAMES the worktree so a person can decide with
the path in front of them.

### Not chosen: filter the count, keep the rows

Sixteen rows under a header reading `4 working` reintroduces exactly the
disagreement #403 removed. The count is not the thing to change.

### Not chosen: rely on the registry being drained

Tempting, since #407 already drains it and a fixture-filter fix would drain more.
But then WORKING is true only as long as reconciliation has run recently, and a
section whose correctness depends on a cleanup job's timing is one that will be
wrong again. `LIVE_STATES` is true at the moment of render.

### Also: the fixture belongs in the scratch filter

Independent of the above, `PLOT_TOOL_SCRATCH` should name the tiny-garden pulse
file. It is the one tracked path the tests themselves mutate, and excusing it
does not weaken the gate — any *other* dirty path still keeps the entry.

## Waves

### Live (Branch: bug/working-lists-the-live-agents, PR: #411)

WORKING renders only `LIVE_STATES` entries, importing the set from
`auto-dispatch.ts` rather than restating it, and its count follows those rows.

### Stalled (Branch: bug/a-stalled-worker-needs-a-person, PR: #412)

A `stalled` or `unknown` entry reaches WAITING ON YOU as a problem report —
abandoned work in the first case, an unanswerable question in the second. Five
and seven entries respectively today, against ten rows that section shows under
`Sprint only`.

### Dropped (Branch: feature/an-agent-row-can-be-dropped, PR: #416)

A row states why its entry survives reconciliation, and offers `Drop this
agent` where the session has ended — the registry entry only, refusing a
`running` one, and leaving the row standing with the reason when the drop
fails.

Kept in this plan rather than split off: `Live` sends thirteen entries to a
section where a reader cannot close them, and a plan that ends there has moved
the heap rather than cleared it. The plan is the largest open one in the sprint
because the defect has four parts, not because it grew.

### Scratch (Branch: bug/the-scratch-filter-knows-the-fixture)

`PLOT_TOOL_SCRATCH` names the tiny-garden pulse fixture, so a worker that only
ran the test suite reconciles like any other. Four entries here, not the eight
an earlier count claimed — see the re-measurement above. Kept as its own wave
because those four are genuinely stuck on a filter gap, and because the fix is
one line in a place the other two waves do not touch.

## Done when

0. A `stalled` entry appears in **WAITING ON YOU** — confirmed as the
   destination during interrogation, over QUIET and over a new `STALLED`
   section. The reasoning: WAITING ON YOU means *you cannot proceed without a
   person*, which is exactly what a worker stopped with uncommitted work is.
   QUIET asks *still thinking, or dead?* — a question this entry has already
   answered. A seventh section would grow the domain model to name a state the
   existing six already have a home for. The cost accepted: WAITING ON YOU then
   holds PRs and agents together, which is a mixture of row kinds rather than a
   mixture of subjects — the subject stays *needs you*.
1. With a registry holding entries in all five states, WORKING renders exactly
   the `running` and `waiting` ones, and the header equals that number.
   Asserted over the whole `AgentStateSchema` enum, with its size pinned — a
   sixth state must not be able to appear without this failing.
2. **`working` still equals the number of rows WORKING renders**, in every
   fixture. This is #403's property, and re-asserting it is what stops this fix
   from reintroducing the mismatch it replaced.
3. `liveAgentCount` is unchanged and still feeds `auto-dispatch.ts`. The board
   consumes `LIVE_STATES`; it does not get its own copy.
4. A `stalled` entry appears in WAITING ON YOU — and **nowhere else**. The
   assertion a naive implementation passes without: filtering WORKING while
   forgetting the destination silently deletes the row that most needs a person.
5. A worktree dirty *only* with the tiny-garden pulse fixture reconciles as
   clean; a worktree dirty with anything else does not.
6. **A failed drop leaves the row and names the failure.** Asserted with the
   registry made unwritable: the row survives, the reason is on it, and nothing
   was removed optimistically.
7. **`Drop this agent` removes the registry entry and NOTHING else.** Asserted
   on the filesystem: the worktree still exists, the branch still exists, no
   signal was sent.
8. **It refuses a `running` entry**, and names why. The assertion a naive
   implementation fails: that entry is how auto-dispatch counts its slots, so
   dropping a live one lets the fleet start work over its cap.
9. **`/api/registry/drop` is in `write-gate.test.ts`'s `WRITE_ROUTES`**, and
   the loopback gate is its ONLY authorisation — no second check in the handler. That
   file says of itself why this is not a formality: a route added as a list
   entry once *"merged cleanly, typechecked, and was the one ungated write
   endpoint"*.
10. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by walking the checklist, not by running it

Stop 4's item is precise — *"not the registry's size"* — and it named this
before any test could. The board's own tests assert the count matches the rows,
which it does; nothing asserted that the rows are workers.

That is the third instance tonight of one rule: **a section's contents must
answer the section's question, and its count must answer to its contents.**
`every-section-has-one-subject` said it for an agent in WAITING ON A MACHINE,
`a-count-answers-to-its-section` says it for the header numbers, and this says
it for WORKING itself.

### The endgame checklist earned its keep here

Seven of this sprint's defects came from someone looking at a running board. This
one came from someone reading the checklist *against* a running board, which is a
cheaper way to find the same class of thing — and an argument for walking it
before the release rather than after.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 3,
  "questionHistory": [
    {
      "q": "WORKING filters to LIVE_STATES \u2014 where does a `stalled` worker go?",
      "a": "WAITING ON YOU. It means *you cannot proceed without a person*, which is what a worker stopped with uncommitted work is. QUIET asks 'still thinking, or dead?' \u2014 already answered. A seventh section would grow the domain model for a state the existing six can hold. Cost accepted: the section then mixes PRs and agents \u2014 a mixture of row KINDS, not of subjects",
      "category": "domain"
    },
    {
      "q": "Stop 6 also failed \u2014 241 GraphQL calls in 10 clean minutes (~1446/h) against a 'low hundreds' target. Plan it, or measure first?",
      "a": "Measure first. Result: ~20 calls per refresh cycle, not one. refreshRuns is already capped to `failing`, so the fan-out is in pr-list --rich or refreshIssues. No plan until the source is named",
      "category": "nonFunctional"
    },
    {
      "q": "13 of 16 entries have a CLEAN worktree and still are not dropped \u2014 does that change the Scratch wave?",
      "a": "Keep it, correct the reasoning. The fixture blocks four, not eight; '8 of 15' counted worktrees in the repo, not registry entries. The larger cause is `unknown` not being provably ended, which dropSettledWorkers refuses to guess from \u2014 correctly, and that refusal is the strongest argument for Wave Live",
      "category": "technical"
    },
    {
      "q": "The 14 endgame items only a person can check \u2014 how?",
      "a": "Prepare each one: name the concrete row or plan on the board where it is checkable, so the walk is not a hunt",
      "category": "ux"
    },
    {
      "q": "What should the section DO with an unrecognised sixth state \u2014 an old server reading a new registry?",
      "a": "Show it and name it. A worker nobody can see is the worse failure. Consequence recorded: the filter becomes a DENYLIST, and LIVE_STATES stops being the source of truth and becomes the complement it derives from \u2014 a weaker guarantee, taken deliberately because it fails toward visibility",
      "category": "errors"
    },
    {
      "q": "Should stalled agents stay in WORKING, with WAITING ON YOU reserved for plan/wave/pr/branch/ticket?",
      "a": "No \u2014 but the question found the real rule. every-section-has-one-subject already says WORKING is 'the agent, only here WHILE IT WORKS' and an agent reaches WAITING ON YOU 'only when broken \u2014 crashed, abandoned, out of context', where it is 'by construction a problem report'. plot-worker-state.sh:47 defines stalled as 'work on the floor, no PR', which is abandoned. So the split is working vs. broken, not live vs. dead",
      "category": "domain"
    },
    {
      "q": "Is `unknown` also broken? Seven of twelve non-live entries are unknown \u2014 neither provably working nor provably dead",
      "a": "Yes, to WAITING ON YOU: if the board does not know what happened, a person has to look. That is 'out of context' in the existing table, and the row is a problem report about the BOARD's blind spot rather than a claim about the worker. Hiding it would be the board deciding it need not admit what it cannot see",
      "category": "domain"
    },
    {
      "q": "Does the sprint filter empty WORKING? (the first draft assumed so)",
      "a": "No \u2014 refuted by reading AgentList.tsx:356: WORKING is built from fleet.agents UNFILTERED, with the comment 'a WORKER is a fact about the fleet, and hiding it because its plan is off-focus is the empty-section defect wearing a filter'. All four running workers are on sprint plans anyway. The question was withdrawn",
      "category": "edgeCases"
    },
    {
      "q": "Is the loopback boundary enough for a route that deletes a registry entry?",
      "a": "Yes \u2014 the same boundary every write route rests on, enforced ONCE in the router. /api/dispatch starts agents and /api/approve merges PRs behind it; dropping a bookkeeping row is the smaller act. A per-handler second check is the shape this repo calls a rule",
      "category": "security"
    },
    {
      "q": "What happens when the drop fails \u2014 a locked registry file, missing permissions?",
      "a": "The row stays and names the failure, the language a refused Approve already speaks. Not optimistic removal: a row that vanishes and returns reads as a board bug, and this plan exists because the board said things that were not so",
      "category": "errors"
    },
    {
      "q": "Does Wave Dropped belong in this plan at all, or in its own?",
      "a": "In this plan. Wave Live sends thirteen entries to a section where a reader cannot close them; a plan that ends there has moved the heap rather than cleared it. Four waves because the defect has four parts",
      "category": "tradeOffs"
    },
    {
      "q": "Dispatch now, or after 2.9.0?",
      "a": "Now. Two endgame failures depend on it (Stop 1.1 and 4.2), and the fleet delivered waves in 20-40 minutes tonight",
      "category": "domain"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {
      "stack": false,
      "architecture": true,
      "implementation": true
    },
    "domain": true,
    "ux": {
      "happyPath": true,
      "edgeCases": true,
      "errors": true,
      "accessibility": false
    },
    "nonFunctional": {
      "security": true,
      "performance": true,
      "scalability": false
    },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
