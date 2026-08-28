---
title: The fleet's domain entities
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# The fleet's domain entities

Companion to [the story](STORY-the-master-agent-holds-the-fleet.md). The story
says what a supervising agent needs to answer; this says **what the things it
reasons about are** — one entity at a time: its source of truth, its states, its
invariants, and what a reader may conclude from each.

An entity here is a **derivation with a name**, never a record. Manifesto
Principle 1 stands: nothing is stored that is not re-derived from git, the host,
or the process table on every pulse. Designing one means naming where it is read
from and what its values are permitted to mean — not deciding where to keep it.

## The organizing finding

Nine entities, sorted by where their truth lives:

| # | Entity | Source of truth | Domain | State today |
|---|--------|-----------------|--------|-------------|
| 1 | Plan | the file's `Phase:` | git | solid |
| 2 | Wave | plan's `## Waves` + branch states | git | solid |
| 3 | Branch | `origin/<branch>` ref | git | solid |
| 4 | Worktree | `git worktree list` | local | thin |
| 5 | PR | host API | foreign | rich, conflated with Branch |
| 6 | Build | host checks + runs | foreign | partial by construction |
| 7 | Ticket | tracker | foreign | **exemplary** |
| 8 | Agent | manifest + pid + tree | local | three competing models |
| 9 | Machine | spawn cost | local | **does not exist** |

**Everything Plot derives from git is clean. Everything else is missing,
partial, or modelled three ways — with exactly one exception.**

That exception is Ticket, and it is the exception that names the rule. Ticket is
the only non-git entity that was designed *as* a foreign entity: deliberately
impoverished (number, title, url, age — no labels, no status, because *"those
age into lies the moment the tracker moves"*), read-only at the adapter, and
carrying a three-valued answer about whether its source could be asked at all
(`answered` / `unsupported` / `failed`).

It is also the non-git entity with no reported defects.

So the discipline exists; it is simply not applied uniformly. Plot has a mature
idiom for git-derived state and one worked example of a foreign one. The four
troubled entities — PR, Build, Agent, Machine — are troubled in proportion to
how far they sit from that example.

### The rule the whole set follows

**Absent is not false.** Stated in the manifesto, restated in a dozen contract
comments, and violated at least once per troubled entity:

- a merged PR reports `state: CLOSED`, so `mergedAt` is the truth
- a conflicting PR reports `checks: 'none'`, indistinguishable from a bot PR
  awaiting approval
- a Build nobody asked about reports the same thing as a Build that passed
- a worker killed by `exit 124` reports the same thing as one that failed
- a machine under load reports nothing at all

Every entity below therefore carries, explicitly, **whether its source could be
asked** — separately from what the source said. Ticket's `IssueAnswer` is the
model; the others adopt its shape rather than inventing one each.

---

## 1. Agent

The most-referenced entity and the most broken: three models disagree about its
states, and its identity is optional in practice.

### What it is

**An Agent is a participant in the fleet: something with an identity that
outlives the branch it is working on.** `registry.ts` already states the crucial
half of this — *"a branch is what an agent is working on, never what it is"* —
and that is why `branch` is optional and empty is a real value.

Settled 2026-08-28: **Agent and Worker are one entity, not two.** The manifest
is its identity card; the pid is its liveness; the worktree is its place; the
tree and PR are its progress. A "worker" is not a separate thing an Agent has —
it is the Agent, observed through the process table.

### Source of truth — four readings, one entity

| aspect | read from | note |
|--------|-----------|------|
| identity | `.plot/agents/<session>.json` | the manifest; `Agent registry` config key |
| place | `worktree`, `branch` | branch may be `''` — between waves is a real state |
| liveness | `pid`, `.plot-worker.exit` | `kill -0`; exit code is recorded, not inferred |
| progress | working tree, PR, `PLOT-BLOCKED` marker | what the exit code cannot say |

### The three competing models

| model | where | states |
|-------|-------|--------|
| `plot-worker-state.sh` | shell, sourced | 6 process + 2 task = 8 |
| `WorkerStateSchema` | contract | 8 (matches the shell) |
| `AgentState` | `registry.ts` | 5 — keeps 4, collapses the rest to `unknown` |

The registry documents the collapse honestly: `none`, `ended`, `failed` and
`elsewhere` are *"not a state the registry claims to understand"*. That is a
defensible reading of absent-is-not-false — but it discards the one distinction
the story says cost the most.

**`failed` and `finished` are opposite actions — restart versus review.** The
contract says so in as many words. Collapsing `failed` into `unknown` means the
board cannot tell a worker that needs restarting from one whose state could not
be read, and `plot-dispatch.sh --restart` had to grow a PR check to compensate:
five of five `failed` worktrees measured held a PR, so a gate on the state word
alone would have destroyed work.

### Proposed states — eight, with a ninth for identity

Adopt the shell's eight unchanged. The registry stops collapsing.

| state | means | what a reader may do |
|-------|-------|----------------------|
| `running` | pid answers | leave it alone |
| `waiting` | exited, `PLOT-BLOCKED` in tree | **a person owes it an answer** |
| `stalled` | exited 0, uncommitted/unpushed work, no PR | rescue the tree, then review |
| `finished` | exited 0, nothing left behind | review the PR |
| `failed` | recorded non-zero exit | restart — **but ask the PR first** |
| `ended` | exited, no record of how | investigate |
| `none` | worktree exists, no worker ever ran | dispatchable |
| `elsewhere` | no worktree on this machine | **not answerable here** |

`running` carries the `worker_activity` cue (`working` / `idle` / `''`) — an
attribute of one state, never a ninth state. The distinction is already made
correctly and is kept.

### The identity defect

A worktree with no manifest is **synthesized** into an entry
(`synthesizedCount`). Measured this session: *0 manifests, 11 synthesized*.

A synthesized entry is not a kind of Agent — it is **an Agent whose identity was
never written**, and the board should say so in those words. The registry
already reports the count; what is missing is that the row itself does not
distinguish *I know who this is* from *I inferred that someone is here*.

Proposed: an `identity` field beside `state`.

| value | means |
|-------|-------|
| `manifest` | a manifest was read; session id is real |
| `synthesized` | a worktree with no manifest; session id is a placeholder |

This is Ticket's `IssueAnswer` shape applied to identity: *could the source be
asked*, kept apart from *what it said*. Two hardening PRs (#488, #422) fixed
where manifests are written; neither made an absent manifest legible as a
defect at the row level.

### Invariants

1. **A pid alone never means `running`.** `state` is what says the process still
   answers. Already stated in the contract; kept.
2. **A branch is not an identity.** An Agent between branches is running.
3. **`failed` never means restartable on its own.** Ask the PR first —
   five of five measured `failed` worktrees held one.
4. **Liveness is read in one batch per pulse**, not per entry. The scan is on a
   5 s timer and a fork per agent puts the scan's cost back.
5. **A synthesized entry is a defect, not a category.**

### Open

- Does `elsewhere` belong to Agent or to Worktree? It is a statement about the
  worktree list, not about anything inside a worktree — see §4.
- Should `relaunches` / `previousPid` (already on the manifest) become a visible
  history? The story's job 3 wants a delta, and this is the only entity that
  already records its own past.

---

## 2. Machine

The entity that does not exist, and whose absence caused four of the session's
six wrong diagnoses.

### Why it must exist

Every other entity competes for one resource, and nothing models it. So the
resource's symptoms have to land on whatever entity *is* modelled:

| what happened | what it was blamed on | what it was |
|---|---|---|
| 7 workers died `exit 124` | a Plot defect, four times | machine starvation |
| the board went dark, 3× | a test leak, worker count | competing load |
| spawn cost 3.6 ms → 286 ms | Homebrew git's signature | starvation, symptom not cause |
| `episodic-memory sync-cli` at 12.3/16 cores | the driver | a finite indexing burst |

`exit 124` is `timeout`'s signal. It means *the clock ran out* — and with no
Machine entity, the only available reading is *the worker stopped*. Those are
opposite conclusions: one says restart on a quieter machine, the other says the
work is broken.

**This is the same defect as `state: CLOSED` on a merged PR** — a value that is
honest about its own source and misleading about the question actually being
asked. The fix is the same: model the thing the value is really about.

### Source of truth

**Process spawn cost**, measured directly:

```sh
time (for i in $(seq 1 100); do git rev-parse HEAD; done)
```

~0.4 s on a healthy machine. It separated every good state from every bad one
observed this session: under ~10 ms/spawn the fleet ran; in the hundreds it did
not, **regardless of worker count**.

Load average was tried and misled — five workers ran fine at load 10 on one
occasion and starved the machine at load 8 on another, because the variable was
*what else was spawning*, not how many workers existed.

### Proposed states

| headroom | spawn cost | means |
|----------|-----------|-------|
| `clear` | < ~10 ms | dispatch freely |
| `tight` | ~10–50 ms | finish what is running; do not add |
| `starved` | > ~50 ms | **the operator's board is already suffering** |
| `unmeasured` | — | not asked, or the measurement failed |

The thresholds are **provisional and must be re-measured** — see Open below.
`unmeasured` is Ticket's `IssueAnswer` shape again: *could this be asked* kept
apart from *what it said*.

### What it is not

- **Not a cap on workers.** The estate has run 23 rows in WORKING healthily. A
  number would be wrong in both directions, and the operator has already refuted
  a worker-count theory once with a screenshot.
- **Not load average.** Kept as context in the payload, explicitly not the
  verdict.
- **Not a gate that refuses.** It informs a supervisor and an operator. A
  dispatch on a starved machine is a decision a person may still make.

### What it enables

1. **A death that names its cause.** An Agent that died at `exit 124` while the
   machine read `starved` carries `machine_at_death: starved` — *the machine,
   not the worker*. This is the single field that would have prevented four
   corrections.
2. **An honest answer to "can I start work?"** (story job 1) — one ~0.4 s
   reading rather than an inference from load.
3. **Cost-aware operations** (story job 4). A supervisor can say *this spawns
   ~46 servers, and the machine is tight — shall I?* before starting, rather
   than after the board goes dark.
4. **Telling a starved board from a dead one.** Restarting a starved board is
   wrong; restarting a dead one is the only move. This session inverted that
   diagnosis once. A dead board refuses a connection in 0.2 ms; a starved one
   answers slowly — and only a Machine reading makes the second legible as
   *slow* rather than *broken*.

### Invariants

1. **Measured, never inferred.** Load average and worker count are context; the
   verdict comes from spawn cost or the state is `unmeasured`.
2. **A reading has a timestamp and goes stale.** Machine state at 09:00 says
   nothing about 09:05. This is the one entity whose value is a *moment*.
3. **The measurement must not be the load.** ~0.4 s of trivial forks on a 5 s
   pulse is affordable; anything heavier makes the observer the problem — which
   is the story's own central complaint.
4. **It never refuses.** It reports; a person or a gate decides.

### Open

- **Are the thresholds right?** They come from one session — one sample. They
  should be re-measured across machines before they are written into a
  refusal-adjacent surface.
- **Is spawn cost the right signal or a proxy?** It separated every observed
  good and bad state, which is evidence, not proof. It may be standing in for
  something better (I/O wait, memory pressure, `syspolicyd` queue depth).
- **Who measures it — the scan, the board, or a helper?** The board polls every
  5 s and would carry it free; but a supervisor needs it *before* starting work,
  when the board may be closed.

---

## Property dictionary

Every entity's full shape. Marked **`+`** where the property does not exist
today and this design proposes it; unmarked properties are already carried
somewhere in the codebase, named as they are named there.

Whether a property is re-derived each pulse or retained between them is
deliberately **not** settled here — see [Memory](#memory-is-a-separate-question)
at the end. What follows is the shape, not the storage.

### Agent

Identity, place, liveness, progress — the four readings of one entity.

| property | type | source | meaning |
|---|---|---|---|
| `session` | string | manifest | the identity; also the transcript's name |
| `identity` **`+`** | `manifest` \| `synthesized` | manifest presence | whether this Agent's identity was read or inferred |
| `branch` | string | manifest / worktree | what it works on; `''` between waves is real |
| `worktree` | path | manifest / `git worktree list` | where it sits |
| `command` | string | manifest | the `Worker command` as launched, verbatim |
| `startedAt` | ISO-8601 | manifest | launch moment |
| `pid` | string | manifest | launch fact; **never alone means running** |
| `previousPid` | string | manifest | the pid this run displaced, `''` on first dispatch |
| `relaunches` | number | manifest | how often this worktree's worker was relaunched |
| `state` | 8 values | pid + exit + tree | see §1; the registry must stop collapsing to 5 |
| `activity` | `working`\|`idle`\|`''` | descendant CPU | cue on `running` only, never a state |
| `exitCode` | number \| null | `.plot-worker.exit` | recorded, never inferred |
| `machineAtDeath` **`+`** | headroom \| `unmeasured` | Machine at exit | **the field that stops `exit 124` reading as worker failure** |
| `dirtyPaths` | string[] | worktree | what `stalled` left on the floor |
| `blockedMarker` | bool | `PLOT-BLOCKED*` in tree | what makes `waiting` distinguishable |
| `model` | string? | transcript | absent when unreadable — never guessed |
| `contextTokens` | number? | transcript | as above |
| `lastActivity` | ISO-8601? | transcript | as above |

### Machine

The one entity whose value is a moment.

| property | type | source | meaning |
|---|---|---|---|
| `spawnCostMs` **`+`** | number \| null | 100× `git rev-parse` | the signal; null when unmeasured |
| `headroom` **`+`** | `clear`\|`tight`\|`starved`\|`unmeasured` | derived from above | the verdict a reader acts on |
| `measuredAt` **`+`** | ISO-8601 | clock | **required** — a reading without one cannot be judged stale |
| `loadAverage` **`+`** | [1m, 5m, 15m] | `uptime` | context only, explicitly **not** the verdict |
| `sampleMs` **`+`** | number | clock | what the measurement itself cost — the observer must price itself |

### Branch

Solid today. Listed for completeness; the properties are `FleetBranchSchema`'s.

| property | type | meaning |
|---|---|---|
| `branch` | string | the name; the identity |
| `state` | `open`\|`wip`\|`merged`\|`claimed`\|`deferred` | the verdict |
| `deferred`, `deferred_reason` | bool, string | why, as the plan recorded it |
| `claimed` | string | claim note from the plan — a *reflection*; git wins |
| `held`, `ref_held` | bool | the claim itself: the ref's existence |
| `local_dirty` | bool | uncommitted work here; **one-directional** (may only lift out of quiet) |
| `changed_ago_seconds`, `changed_at` | number, ISO | makes a write an *event* rather than a switch |
| `local_locked`, `local_worktree` | bool, path | a worktree holds it |
| `local_ahead` | number | commits not in the default branch |
| `conflicts`, `conflicts_known` | string[], bool | **two fields**: what collides, and whether it was asked |
| `changed_paths` | string[] | scope, for collision prediction |
| `worker*` | — | Agent fields projected onto the branch row — see Open |

### PR

Five orthogonal axes, not one. Conflating any two rebuilds a measured defect.

| property | type | meaning |
|---|---|---|
| `number` | number | identity |
| `head` | string | the Branch it belongs to |
| `state` | `OPEN`\|`MERGED`\|`CLOSED` | **lies on squash-merge — see invariants** |
| `mergedAt` **`+`** | ISO-8601 \| null | **the truth about landing** — see note |
| `draft` | bool | is it asking for review |
| `mergeable` | `mergeable`\|`conflicting`\|`unknown` | *can* it land — disambiguates `checks` |
| `review` | `APPROVED`\|`CHANGES_REQUESTED`\|… | informational only |
| `url` | string | verbatim from the host; `''` renders as no link, never a guess |

**`mergedAt` is the PR entity's missing keystone.** `state` lies: a squash-merged
PR reports `CLOSED`, and squash-merge also leaves the branch permanently "ahead
of main", so ancestry cannot fill the gap either — measured, ancestry cleared
1 of 29 finished worktrees and the host cleared the other 28.

`plot-reap.sh` already knows this and reads `mergedAt` — but it does so by
calling `gh pr list --json mergedAt` **directly**, bypassing `plot-host.sh`,
which CLAUDE.md names as *"the ONE place that talks to the host CLI."* So the
field is not on `PrRecord`, is not in the adapter's `pr-state` output, and is
unavailable to the board at all.

That is one entity's truth living outside the entity, reachable only by the one
script that needed it badly enough to break the rule. Adding `mergedAt` to the
adapter and to `PrRecord` would let `plot-reap.sh` stop reaching past it.

### Build

Its own entity, on every PR. Split by price — see the note below the table.

| property | type | price | meaning |
|---|---|---|---|
| `conclusion` | `green`\|`pending`\|`failing`\|`none`\|`unknown` | **free** | from the bundled `pr-list --rich` |
| `failingChecks` | string[] | **free** | *which* checks — names only, nothing interprets them |
| `asked` **`+`** | `answered`\|`not-asked`\|`failed`\|`unsupported` | — | Ticket's `IssueAnswer` shape, applied to run history |
| `runs` | `{workflow, conclusion, startedAt, url}[]` | **metered** | one REST call per branch |

**The split is the design.** Today `checks` and `runs` are both metered, because
the code treats "fetch Build" as one act. They are two fetches at two prices:
`conclusion` and `failingChecks` already arrive for every PR in one bundled
call, while `runs` costs one REST request per branch — and `plot-host.sh` warns
that *"a caller that asked for every branch would spend a budget the board has
already exhausted once."*

So **Build exists as an entity on every PR** from the free data, and only its
run history is asked for selectively — with `not-asked` stated rather than
collapsed into `none`. That preserves the intent (Build is a first-class entity
everywhere) without the cost. **This reading should be confirmed in review.**

### Ticket

Deliberately impoverished. Adding to this table is almost always wrong.

| property | type | meaning |
|---|---|---|
| `kind` | `'ticket'` | stated, never assumed from the call site |
| `number` | number | identity |
| `title` | string | enough to answer *is this worth a plan?* |
| `url` | string | `''` renders as plain text — a fabricated URL 404s identically |
| `ageMinutes` | number \| null | null where the host gave no date |
| *(fleet-level)* `issueAnswer` | `answered`\|`unsupported`\|`failed` | **whether the tracker could be asked at all** |

No labels, no assignee, no status — *"those age into lies the moment the tracker
moves"*, and Plot never writes them back.

### Plan

| property | type | meaning |
|---|---|---|
| `file` | path | identity |
| `phase` | `draft`\|`approved`\|`delivered`\|`released` | the lifecycle |
| `type` | `feature`\|`bug`\|`docs`\|`infra` | decides whether release applies |
| `title`, `sprint`, `story`, `assignee` | string | placement |
| `branches`, `waves`, `prs` | list | what it governs |
| `review`, `impl` | ceremony answers | how it is approved and where it is built |
| `approved_raw`, `started_raw`, `delivered_raw`, `released_raw` | string | the transition records — **load-bearing, not provenance** |
| `status` | `PlanStatus` | derived aggregate |
| `error` | string | why parsing failed — a file with no phase is not a plan |

### Wave

| property | type | meaning |
|---|---|---|
| `name` | string | `''` for the default wave |
| `verdict` | `complete`\|`eligible`\|`blocked`\|`unapproved` | `eligible` is the only one promising a dispatch agrees |
| `branches` | Branch[] | **should be exactly one** — see `unsliced-wave` |

### Worktree

Thin today: `path`, `branch`, `isMain`. Proposed additions in §4 (below).

| property | type | meaning |
|---|---|---|
| `path` | path | identity |
| `branch` | string | what is checked out |
| `isMain` | bool | the main checkout is never reapable |
| `clean` | bool | no uncommitted changes **and** no unpushed commits |
| `occupant` **`+`** | session \| null | which Agent sits here, if any |
| `reapable` **`+`** | bool + reason | five measurements, never a judgement (`plot-reap.sh`) |

### Where the properties live

Settled 2026-08-28: **the properties live on in-memory domain objects held by a
controller — the fleet control — hydrated asynchronously, with actions deferred
until the data an action needs has arrived.**

Nothing is persisted. The objects are materialized per process and die with it,
so this is not the fleet database Principle 1 forbids; it is the shape the board
already reaches for, made explicit and applied to every entity rather than to
one.

#### It is already half-built

`CacheEntry` in `fleet.ts` **is** this controller. It holds the pulse, the
terminal-answer map, branch ages, approval dates, PR records, run histories and
worker questions — each hydrated on its own timer, each with its own cost. Its
own comment states the rule this design generalizes:

> *IN MEMORY AND NOWHERE ELSE. Never written to disk, never to `.plot/` — a
> restart re-derives everything. […] it is the SCAN, not this field, that
> decides an entry is still valid: git is re-consulted on every pass and the
> entry is discarded the moment it disagrees.*

So the controller exists and is already Principle-1 compliant. What it lacks is
the two things that make deferred action possible.

#### 1. Each entity carries its own load state

Different sources answer at different speeds and prices: git every 5 s, the host
every 60 s (metered), the process table per pulse, the tracker on its own timer.
An entity assembled from several of them is **partially loaded** for most of its
life, and today that state has no name — so a consumer cannot tell *the answer
is no* from *the answer has not arrived*.

The vocabulary already exists and is the one Ticket uses. Every entity adopts
it, per source:

| load state | means |
|---|---|
| `answered` | the source replied; the value is what it said |
| `not-asked` | deliberately skipped — metered, out of budget, or filtered |
| `failed` | asked, and it did not come back |
| `unsupported` | this host cannot answer at all (Bitbucket has no issue listing) |

**Collapsing any two rebuilds `an-outage-is-not-an-answer`**, the defect the
contract already names: *"a board that renders the second as the first tells a
reader their inbox is clear using data it never received."*

#### 2. The controller gates actions on completeness

An action fires only when the entities it reads are loaded enough to decide.
This is not hypothetical — it is a bug already fixed once in exactly this shape.

`auto-deliver.ts` carries a `complete` flag through `planAutoDeliver` and
`allWavesMerged`, and `allWavesMerged` returns **three** values —
`merged` / `not-merged` / `unknown` — precisely so an incomplete pulse cannot
be read as *not merged* and suppress a delivery, nor as *merged* and fire one
on data that never arrived.

The precedent for the whole idea is the scan's own `--stream`:

> *A consumer that has seen plan lines and no pulse line holds a PARTIAL answer
> […] The terminal line is what says the scan finished; a closed pipe does not,
> because a killed scan closes it too.*

That is this design in miniature — asynchronous hydration, an explicit
completeness signal, and the refusal to treat absence of data as data. The
generalization is that **every** entity gets it, and the controller — not each
call site — is what holds it.

#### The rule that keeps it a derivation

A materialized object may be held across pulses **only where its source is
re-consulted and the object discarded the moment they disagree.** That is the
`PLOT_TERMINAL_CACHE` rule, and it is what separates a cache from a record.

Two properties cannot satisfy it, and they are the design's honest exceptions:

- **`Machine.measuredAt`** — spawn cost describes a moment. It cannot be
  re-derived, only re-measured, which produces a *different* fact. Its
  staleness is therefore a first-class property rather than a cache concern.
- **The delta** (story job 3) — *what changed since I last looked* needs a
  previous state to diff against, and a stateless scan has none by
  construction.

Both are legitimate here for the same reason: they live in a process that dies,
and they are re-established from scratch on restart. Neither becomes a file.

#### What this buys the story's jobs

| job | what the controller gives it |
|---|---|
| 1 — can I start work? | Machine hydrated beside the pulse; *"not measured yet"* is a real answer |
| 2 — working or just alive? | Agent's four readings assembled into one object; `machineAtDeath` attaches at exit |
| 3 — what changed? | the previous materialization is the diff's other operand |
| 4 — what is safe to run? | operations priced against a Machine reading the controller already holds |
| 5 — what do I show? | the supervisor asks the controller, not a competing scan |

#### Open

- **Where does the controller live for a supervisor with no board open?** The
  board process holds it today, and the board is closed exactly when a
  supervisor most needs job 1. A short-lived CLI materialization answering from
  the same code is the obvious candidate, and is not designed here.
- **What is the completeness granularity?** Per entity, per source, or per
  action? `auto-deliver`'s single `complete` flag is per pulse, which is coarse
  but has held.
- **Does the delta belong to the controller or to a consumer?** It is the only
  property whose value is a *comparison*, and the story's own Open Points leave
  it unsettled.

---
## The control is async, so it follows the Reactive Manifesto

The controller hydrates from four sources at four cadences and prices. That
makes it a reactive system whether or not it is designed as one, and the four
tenets each land on a defect this session actually produced.

Three map directly. **One inverts, and the inversion is load-bearing.**

### Responsive — reply quickly and consistently; surface errors fast

The board polls a scan that takes **18.3 s** against a **5 s** cadence. A
consumer that renders nothing for 18 s does not look slow; it looks broken —
which is why `--stream` exists, emitting each plan the moment it resolves and a
terminal `pulse` line to say the scan finished.

**What this design adds:** the same discipline for every entity, not just the
scan. A partially-hydrated entity renders *what it has*, labelled with what it
is still waiting for — never a blank that reads as an answer.

**And errors surface as errors.** `CacheEntry` already keeps `error` (a scan
that failed and was discarded) apart from `shrink` (a scan that succeeded and
lost rows). Consistency here means a reader can always tell *slow* from
*broken* — the exact distinction the supervisor inverted when it diagnosed a
dead board as a starved one.

### Resilient — stay working when parts break; isolate failures

Failures here are ordinary, not exceptional: a metered host refuses, a worker
dies, a tracker times out, `gh` hits a secondary limit. The rule already
practised in `refreshRuns` and `refreshPrs` is the right one and generalizes:

> *A row losing a line it carried a minute ago reads as the branch changing
> rather than as a fetch failing.*

So a failed fetch **keeps the last good value and says it is stale** — it never
degrades to empty. Isolation is per entity and per source: the tracker being
unreachable must not blank the branches, and a host outage must not blank git.

**This is why the load state is per source rather than per object.** One
collapsed flag would let one broken source take the whole object down, which is
the failure spreading rather than being contained.

### Elastic — stay fast as load changes… by shedding, not scaling

**This tenet inverts here, and the inversion is the point.**

The manifesto assumes elasticity means acquiring resources under load. The fleet
cannot: it runs on one laptop with fixed capacity, shared with the operator's
own board. Measured this session — the supervisor's work took the operator's
view away **three times**, and seven workers died at `exit 124` from starvation
the supervisor itself caused.

So elasticity here means **shedding work as headroom falls**:

| headroom | the controller's behaviour |
|---|---|
| `clear` | full cadence; metered fetches allowed |
| `tight` | stretch cadences; skip metered fetches (`not-asked`, said out loud) |
| `starved` | pulse only; **the operator's board has priority over the supervisor** |

The mechanism is already there and already elastic in exactly this way —
`prRefreshMsFor` stretches the PR cadence by the host's cost multiplier, and the
terminal cache skips host round trips for 26 of 54 branches. What is missing is
that **none of it responds to the machine**, because no entity reports the
machine. Elasticity needs a signal to be elastic against; §2 is that signal.

**The observer must price itself.** `Machine.sampleMs` exists for this: a
headroom measurement that itself costs meaningfully under load makes the
observer part of the problem — which is the story's central complaint,
restated as a constraint on its own fix.

### Message-Driven — asynchronous, non-blocking, loosely coupled

Already the shape, and worth stating so it is not lost: the scan is spawned per
pulse and cannot span two, so it takes the terminal map in **through the
environment** and reports the next map **on stderr**. Two processes, no shared
memory, no blocking call — a message.

The rules that keep it loosely coupled, and that this design keeps:

- **The whole map, never a delta** — *"so there is no merge rule here to get
  wrong."*
- **The receiver validates and may reject.** The scan re-consults git every pass
  and discards any entry that disagrees. The message is a proposal, not a
  command.
- **A terminal message ends a stream.** Absence of further messages is not a
  message; a killed scan closes the pipe exactly as a finished one does.

**Where this design pushes back:** `plot-reap.sh` calls `gh` directly rather
than through `plot-host.sh`, bypassing the one adapter that owns host
conversation. That is the coupling this tenet forbids — a component reaching
past the boundary because the message it needed (`mergedAt`) was not in the
protocol. The fix is to put it in the protocol.

### What the four tenets add to the entity design

| tenet | consequence for the entities |
|---|---|
| Responsive | partial renders labelled; slow distinguishable from broken |
| Resilient | last-good-value on failure, marked stale; load state **per source** |
| Elastic | Machine is not optional — it is the signal cadence responds to |
| Message-Driven | whole-map messages, receiver-side validation, terminal signals |

