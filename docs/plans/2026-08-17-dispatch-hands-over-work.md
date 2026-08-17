# Dispatch prepares a desk and calls it starting work

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-17, jwloka, plan-PR #152 merged (two interrogation rounds)
- **Started:** 2026-08-17, Jan Wloka, `feature/dispatch-writes-brief`
- **Delivered:**
- **Started:** 2026-08-17, Jan Wloka, `feature/fleet-sees-unstarted-claims`
- **Started:** 2026-08-17, Jan Wloka, `feature/dispatch-reports-no-worker`

## Problem

`plot-dispatch` creates a worktree, pushes a claim and books a `Started:`
record. Then it stops. Two steps of the hand-off are missing, and a human has
been supplying both by hand all evening:

| Step | Who does it |
|---|---|
| Worktree, claim, `Started:` | `plot-dispatch` |
| **Write the brief** | a person |
| **Start the agent** | a person |

Measured: `plot-dispatch.sh` contains **zero** occurrences of "brief", and this
repo has no `Worker command` configured — so even a run without `--no-start`
only prints *"worktree ready — no 'Worker command' configured, so start it
yourself"*.

The board's `Start work` button inherits the gap exactly. It calls
`plot-dispatch --max 1`, so it delivers a **prepared desk**, not work. On
2026-08-17 three rows sat in WORKING for minutes with a pulsing green dot while
nobody was working on any of them — the claim was real, the worker was never
started. The row was not lying about the claim; the pipeline was incomplete
behind it.

### The brief is not a summary of the plan

This is the part that decides the design, and it is measurable.
`plot-implement`'s brief template is **8 lines**. The briefs actually written
this session run **111–127 lines**, and the difference is not padding:

> *"`merge-tree` cannot answer this — `plot-dispatch` creates the candidate
> branch, so the comparison reports clean for every candidate, forever."*
>
> *"Do NOT route this through `worktree_rows()`. A local branch with no worktree
> still holds commits nobody can see."*
>
> *"Do not read that diff. Take either side, then rebuild — which side you take
> cannot matter."*

Every one of those is a **rejected alternative**: the obvious approach, and the
measurement that killed it. A plan records the decision; the brief records what
an implementer would otherwise re-derive. Without it, three agents this session
would have rebuilt mechanisms already disproved — the plan text alone does not
stop someone reaching for `merge-tree`, because the plan's *reasoning* reads as
background rather than as a warning aimed at them.

So the brief is **interpretation**, not extraction. That rules out generating it
in the dispatcher: Manifesto Principle 3 splits this cleanly — *skills interpret
and adapt; scripts collect and report*. A script filling an 8-line template
would produce something worse than the plan it summarises.

## Design

### `plot-implement` owns the brief; the dispatch SKILL invokes it

`plot-implement` already defines the brief, already reads the plan's recorded
`Impl:` answer, and already runs the staleness preflight. It is the step that
gets skipped when someone dispatches directly — so dispatch calls it rather
than reimplementing a thinner version beside it.

**The caller is the skill, not the script**, and the first draft of this plan
got that backwards. Checked: **no script in this repo invokes a skill**, and
that is the Manifesto's direction rather than an omission — *skills interpret
and adapt; scripts collect and report*. A bash script cannot reach a skill at
all; skills exist inside an agent session.

`skills/plot-dispatch/SKILL.md` is that session-level layer, and it already
drives `plot-dispatch.sh` through its phases. The brief step belongs there,
where interpretation is allowed and another skill is reachable. The script keeps
doing what it does today.

**A direct `plot-dispatch.sh` call cannot write a brief, but it can say one is
missing.** That matters, because direct calls are legitimate — `--dry-run` and
`--status` are the normal way to look before leaping, and this session used the
bare script five times. Refusing to run without a brief would be a gate in the
wrong place; reporting the gap costs nothing.

So the summary gains the fact alongside the worker count: *worktree prepared, no
brief, no worker started*. That single line is exactly what was missing five
times this evening, when a prepared branch sat claimed with nobody working on it
and nothing said so.

**One definition of what an implementer needs to know.** A second one in the
dispatcher would drift from the first the way every duplicated rule in this repo
has: the eligible-note string became a shared constant this session for exactly
this reason, and the artifact merge strategy exists because two copies of a
generated file cannot be reconciled.

The brief lands where the briefs already live — `.plot/briefs/<branch>.md`,
committed to the default branch, so a resumed or replaced agent can read it
without the dispatching session.

**The template grows to match what briefs actually contain.** The 8-line version
describes a shape nobody has used; the real ones carry a *what to build*
narrative, the settled decisions with their measurements, the assertions that a
naive test would pass without, a bookkeeping duty and a scope guard naming the
branches in flight. That is the shape to write down — not as a form to fill, but
as the sections a brief is incomplete without.

### The worker starts, and says so when it cannot

`Worker command` already exists and is deliberately unset by default: Plot
hardcodes no agent tooling (Principle 5). What is missing is that **nothing
tells the operator they are one config line away** from an automatic fan-out.
The message appears only after a dispatch has already happened, buried in
per-branch output.

So something **asks** how this project runs an agent headless, and writes the
answer. It does not suggest one — a suggestion becomes a template, and then Plot
has effectively hardcoded a tool it is not supposed to know. The asking is the
whole fix: the problem was never *which command*, but that nobody learns the
option exists.

**The asking belongs to the first dispatch, not to `/plot-init`.** Adoption runs
long before anyone fans out work — often before the repo has a second branch —
and a question about headless agents at that moment is a question about a need
the answerer does not have yet. It gets a shrug, the key is written empty, and
nobody revisits it: an answered-and-wrong config is harder to fix than a missing
one, because nothing later notices it was never really decided.

At the first dispatch the need is concrete and the consequence is immediate —
*these three branches are about to be prepared and nobody will start them*. That
is the moment the answer is worth giving, and the moment an empty answer is a
real choice rather than a deferral:

```
3 branches eligible.
No `Worker command` configured — worktrees will be prepared
but no agent started.

How does this project run an agent headless?
(leave empty to keep starting them yourself)
```

Empty stays a first-class answer. Hand-starting is what this session did all
evening and it works; the config exists to remove a step, not to declare the
manual path wrong. What must not happen is the current silence — where the
consequence appears only in per-branch output after the dispatch already
happened.

And `plot-dispatch` reports the consequence up front rather than per branch —
*"3 worktrees prepared, 0 workers started, no Worker command configured"* in the
summary, where a caller reading only the last line sees it.

**`--no-start` keeps meaning what it says.** It is the right default for a human
who wants to inspect before letting an agent loose, and this session used it
deliberately every time. The defect was never that dispatch failed to start
workers when told not to; it was that nothing downstream noticed the result.

### The board's button completes the same pipeline

`Start work` keeps its name — it will be true once the pipeline is whole rather
than renamed to describe a gap. It calls the same path, so it inherits the brief
and the worker start without its own logic.

**A prepared-but-unstarted branch must be visible as such.** With no
`Worker command`, the button still cannot start an agent, and the row would
again claim work nobody is doing.

The evidence is `.plot-worker.pid`, which `plot-dispatch` writes only where it
started a worker itself. **Its absence means *unknown*, not *nobody*** — and
that distinction is the whole design of this branch. A worker started by hand
leaves no pid, and hand-starting is the normal case for as long as
`Worker command` is unset: five agents were started that way this session.
Reading a missing pid as "nobody is working" would report every one of them as
dead.

So the row says *claimed, no known worker* rather than *waiting to be started* —
absent is not false, the rule this repo applies to every other missing signal.
It is weaker than the misreport it replaces and it is true, which is the trade
this whole story keeps making.

**The states already exist; nothing reads them.** `worker_state()` in
`plot-dispatch.sh:95` has distinguished five outcomes since it was written —
`running <pid>`, `finished <pid>`, `failed <pid> (exit N)`,
`ended <pid> (status unknown)` and `no worker` — and it already handles the
traps: a pid of `0` would signal the whole process group and read as running
forever, so it is rejected explicitly. Measured against the board: `grep` for
`plot-worker.pid` across `packages/board/src` returns **nothing**. The
information is richer than this plan first assumed and reaches no screen.

All five travel, because collapsing them re-creates the defect this plan exists
to fix. **`failed (exit 1)` and `finished` are opposite actions** — a crashed
worker needs restarting, a finished one needs reviewing — and a row that says
"ended" for both leaves the reader to open a log to find out which. That is the
same one-label-two-states shape as `no commits yet` covering both an idle branch
and a finished-but-unpushed one.

A failed worker is also not a *working* row. It goes where its action is:
`waiting-on-you`, because a person has to decide whether to restart it.

**A branch with no worktree here is a third state, not a second.** The pid lives
in the worktree (`$wt/.plot-worker.pid`), so a branch claimed and started on
another machine has no path to look at — this machine cannot answer the
question at all, which is different from looking and finding nothing:

| claim | worktree | pid | row says |
|---|---|---|---|
| ✓ | ✓ | ✓ | `worker running (pid N)` — or the finished/failed variant |
| ✓ | ✓ | — | `claimed, no known worker` |
| ✓ | — | n/a | `claimed elsewhere` |

The actions differ, which is what earns the third string: *look in this
checkout* versus *ask the machine that took it*. It is the same split
`fleet-sees-unpushed-commits` made between `local_dirty` and `local_ahead` —
two questions answered from the sources that actually hold the answers, rather
than one signal stretched across both.

`worktree_rows()` in `plot-fleet-scan.sh:253` already visits every worktree and
already knows which branch each holds, so the pid read costs one file check at a
stop the scan makes anyway. No new traversal, and the no-worktree case falls out
of the existing structure rather than needing a guard.

## Branches

### Hand-off and Visibility

- `feature/dispatch-writes-brief` — the dispatch skill invokes `/plot-implement`
  for the brief instead of leaving it to the caller; the brief template in
  `plot-implement/SKILL.md` grows to the shape briefs actually take → #158
- `feature/fleet-sees-unstarted-claims` — the pulse carries `worker_state()`'s
  five outcomes plus the no-worktree case; a claimed branch with no known worker
  says so, and a failed one lands in `waiting-on-you` → #159

### Start

- `feature/dispatch-reports-no-worker` — the summary reports prepared-vs-started
  counts; the first dispatch asks how this project runs an agent headless → #167

**Two waves, and the first holds two branches deliberately.** An earlier draft
had three waves — one branch each — with prose explaining that the first and
third could run in parallel. That prose was unenforceable: `plot-fleet-scan.sh`
reads waves as strictly sequential and reported `Visibility — blocked` while
Hand-off was open, and `plot-dispatch.sh` refuses a blocked branch for the same
reason. A plan whose ordering lives in a paragraph the tooling cannot read has
recorded an intention, not a decision. **Branches that may run together belong
in one wave**; the wave boundary is the only ordering the fleet enforces.

They share a wave because they are independent by *file*, and this session paid
three times for assuming two agents in one file would be fine, so the split was
measured rather than guessed:

| Branch | Touches |
|---|---|
| `dispatch-writes-brief` | `skills/plot-dispatch/SKILL.md`, `skills/plot-implement/SKILL.md` |
| `fleet-sees-unstarted-claims` | `plot-fleet-scan.sh`, `packages/board/src/server/fleet.ts` |
| `dispatch-reports-no-worker` | `plot-dispatch.sh`, the first-dispatch prompt |

The brief branch is skill prose; the visibility branch is the scan and the
classifier — disjoint, so they fan out together. Start touches
`plot-dispatch.sh`, which the visibility branch reads (for `worker_state()`'s
output shape) and the brief branch drives, so it goes last and rebases onto
both. That is a real dependency, and a wave boundary is the right way to say so.

Visibility is what makes the other two *visible*, so running it in the first
wave means the next dispatch shows its own state while Start is still being
built. `board-server.mjs` will conflict between the two first-wave branches as
it does for every board pair — that is what `.gitattributes` is for, and it has
been exercised twice today.

## Done when

- **A dispatch produces a brief at `.plot/briefs/<branch>.md`**, committed to
  the default branch. Assert the file exists and names the plan, the branch and
  the scope guard — the three things a replacement agent cannot work without.
- **The brief comes from `plot-implement`, not from the dispatcher.** Assert
  there is one definition: a template string in `plot-dispatch.sh` fails this
  even if its output looks right.
- **The script never invokes a skill.** Assert `plot-dispatch.sh` contains no
  such call — the first draft of this plan proposed exactly that, and it would
  invert the Manifesto's direction as well as being impossible in bash.
- **A direct script call reports the missing brief** rather than refusing.
  Assert `--dry-run` and `--status` still work untouched: a gate that blocks
  looking-before-leaping is a gate in the wrong place.
- **The `Worker command` question is asked at the first dispatch, not at
  `/plot-init`.** Assert adoption never raises it: asked at adoption it gets a
  shrug, and an empty-because-shrugged key is harder to fix than a missing one,
  because nothing later notices it was never decided.
- **It asks rather than suggests.** Assert no example command appears in the
  prompt — an example becomes a template, and then Plot has hardcoded agent
  tooling it is not supposed to know.
- **An empty answer is accepted and not re-asked every run.** Hand-starting is a
  legitimate workflow; a prompt that returns every dispatch is a nag, and nags
  get answered with whatever silences them.
- **A missing `.plot-worker.pid` reads as unknown, not as nobody.** Assert a
  hand-started worker is not reported dead: that is the normal case while
  `Worker command` is unset, and it was every agent this session.
- **All five `worker_state()` outcomes survive to the row.** Assert `failed`
  renders differently from `finished`: collapsing them re-creates this story's
  own defect — one label over two states whose actions are opposite (restart
  versus review).
- **A failed worker is not a `working` row.** Assert it lands in
  `waiting-on-you`: a crashed worker with a pulsing dot is the exact misreport
  this plan exists to remove.
- **A pid of `0` never reads as running.** `kill -0 0` signals the whole process
  group and succeeds, so a naive liveness check reports it alive forever.
  `worker_state()` already rejects it; assert the value survives the trip to the
  board rather than being re-derived there.
- **A claimed branch with NO worktree here says `claimed elsewhere`**, not
  `no known worker`. Assert the two strings differ: this machine cannot answer
  the question at all, which calls for asking another machine rather than
  looking again in this checkout.
- **A dispatch with no `Worker command` says so in the summary**, with counts.
  Assert the summary line, not per-branch output: a caller reading only the last
  line is the case this exists for.
- **`--no-start` still starts nothing**, and still writes the brief. The two are
  independent, and conflating them would remove the inspect-first workflow this
  session relied on.
- **A claimed branch with no running worker does not read as working.** Assert
  against the live shape from 2026-08-17: claim pushed, no `.plot-worker.pid`,
  no commits — three such rows sat in WORKING with a pulsing dot.
- **A claimed branch WITH a running worker still reads as working.** The
  regression that matters: a check that reads every claim as unstarted is
  indistinguishable from a broken fleet.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
  `pnpm run validate` all pass.
- A changeset is present.
- macOS bash 3.2: no `declare -A`.

## Notes

Asked on 2026-08-17 — *should `Start work` not release the work, or how should
the process look?* — after three rows sat in WORKING with nobody working on
them.

The honest answer was that the button is accurately named for what it does and
wrongly named for what it promises, and that the gap it exposes is not the
board's: `plot-dispatch` has always stopped one step short, and every dispatch
this session was completed by hand without anyone noticing the pattern.

Deliberately out of scope: making the board start agents itself. The button
calls `plot-dispatch`, and that is the right shape — a board that steers a
session is a different architecture from a fleet of detached workers, and this
plan closes the existing pipeline rather than opening a second one.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "questionHistory": [
    {"q": "The plan says plot-dispatch invokes /plot-implement, but NO script in this repo invokes a skill — skills call scripts, not the reverse, and bash cannot reach a skill at all.", "a": "The caller is skills/plot-dispatch/SKILL.md, the session-level layer that already drives the script through its phases. The script keeps doing what it does; the plan's wording was backwards", "category": "technical-architecture"},
    {"q": "What happens when someone calls plot-dispatch.sh directly, as this session did five times?", "a": "The script cannot write a brief but can say one is missing, in the same summary as the worker count. Refusing would be a gate in the wrong place — --dry-run and --status are legitimate direct calls", "category": "domain-workflows"},
    {"q": "What should /plot-init suggest for Worker command, given Plot hardcodes no agent tooling?", "a": "Ask, do not suggest. A suggestion becomes a template and then Plot has effectively hardcoded a tool. The problem was never WHICH command but that nobody learns the option exists", "category": "domain-rules"},
    {"q": "How does a row tell a claimed branch with a running worker from one without? plot-dispatch writes .plot-worker.pid only when it starts the worker itself.", "a": "Absence means UNKNOWN, not nobody. A hand-started worker leaves no pid, and hand-starting is the normal case while Worker command is unset — five agents this session. The row says 'claimed, no known worker'", "category": "ux-edgeCases"}
    {"q": "worker_state() already distinguishes FIVE outcomes (running/finished/failed exit N/ended/no worker) and the board reads none of them — grep for plot-worker.pid in packages/board/src returns nothing. How many reach the row?", "a": "All five. failed and finished are opposite actions — restart versus review — and one label over both re-creates this story's own defect. A failed worker is not a working row; it goes to waiting-on-you, where its action is", "category": "domain-data"},
    {"q": "The pid lives in the worktree, so a branch claimed and started on ANOTHER machine has no path to check. What does the row say?", "a": "'claimed elsewhere' — a third state. Looking and finding nothing differs from having nowhere to look, and the actions differ: look in this checkout versus ask the machine that took it. Same split as local_dirty vs local_ahead", "category": "ux-errors"},
    {"q": "/plot-init runs at ADOPTION, long before anyone runs a fleet. Is that the right moment to ask for Worker command?", "a": "No — ask at the first dispatch. At adoption it is a question about a need the answerer does not have; it gets a shrug, and an empty-because-shrugged key is harder to fix than a missing one. At first dispatch the consequence is concrete: three branches about to be prepared with nobody to start them", "category": "ux-happyPath"},
    {"q": "The three waves are planned sequential, but wave 1 is pure SKILL.md and wave 3 is scan+fleet.ts. Does the ordering earn its cost?", "a": "Hand-off and Visibility are disjoint by file — measured, not assumed — so they fan out together. Start touches plot-dispatch.sh, which both others read or drive, so it goes last and rebases onto both", "category": "tradeOffs"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": {"rules": true, "workflows": true, "data": true},
    "ux": {"happyPath": true, "edgeCases": true, "errors": true, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
