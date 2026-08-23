# What the board's entities actually carry

An inventory of the properties on **plan**, **wave**, **branch**, **worklog** and
**build**, read off the live `/api/fleet` payload and the contract, 2026-08-23.

Written to answer one question before any model is designed: *what do these
things have?* Everything below is measured, not intended — where a property is
absent from the code, that is stated rather than filled in.

## The shape today

**There is one row type.** `AgentRow` carries **28 fields**, and those fields
belong to five different entities that have no separate existence:

```
AgentRow (28 fields)
├── plan      plan · planFile · phase · brief · version
├── wave      wave · verdict · blockedBy
├── branch    branch · branchUrl · state · repo · kind · deferredReason
├── pr        pr{number, url, draft, state}
├── worklog   worker · processes · localDirty · localLocked · localAhead · changedAgo
├── build     (inside pr.state, and inside stuck.failingChecks/runHistory)
└── derived   group · note · waitingOn · waitingDays · ageMinutes · stuck · repair
```

The last line is the important one: **seven of the 28 fields are derivations**,
computed from the others, and they are what the board actually renders. A wave's
section is one of them.

## Per entity

### Plan

| property | values seen | source |
|---|---|---|
| `plan` | slug | plan filename |
| `planFile` | `YYYY-MM-DD-<slug>.md` | plan directory |
| `phase` | `Discovery` · `Development` · `Endgame` · `Released` · `null` | `Phase:` + transition records |
| `brief` | path or `""` | `.plot/briefs/` |
| `version` | release version | `git tag --contains` |

**Not carried:** approval record, assignee, sprint, story, issue — all exist in
the plan file and none reach the row. `phase` is the only lifecycle fact the
board sees.

**Absent by design, and worth naming:** there is no *partial approval*. A plan is
Draft or Approved; `phase` collapses that plus delivery and release into one
five-valued field.

### Wave

| property | values seen | source |
|---|---|---|
| `wave` | name, or `""` (unnamed) | `### ` heading in `## Branches` |
| `verdict` | `complete` · `eligible` · `blocked` · `null` | `plot-fleet-scan.sh` |
| `blockedBy` | wave name or `null` | the scan |

**This is the whole of it — three fields, all on the branch row.** A wave has no
identity, no branch list, no section, no completeness. Its identity is the pair
`(plan, wave)`, which several call sites reconstruct because wave names repeat
across plans.

**What a wave is asked for but does not have:** which section it belongs to, how
many branches it holds, whether all of them are merged, and whether its branches
disagree. Every one of those is re-derived per call site — the gap
`the-wave-is-a-thing-the-board-can-hold` describes.

### Branch

| property | values seen | source |
|---|---|---|
| `branch` | ref name | git |
| `branchUrl` | host URL or `""` | composed from `git remote` |
| `state` | `open` · `wip` · `merged` · `deferred` | the scan |
| `repo` | constant today | config |
| `kind` | `branch` · `pr` · `release` · `wave` | derived from the row's shape |
| `deferredReason` | prose or `""` | `<!-- deferred: -->` annotation |

`state` is the branch's own answer and is frequently confused with `verdict`,
which is the **wave's**. That confusion is the direct cause of a merged branch of
an open wave appearing in DONE.

**Note `kind` is a rendering concept, not a domain one** — a row is a `wave` kind
when it heads a group, a `branch` kind otherwise. It describes what the row *is
drawn as*.

### PR

| property | values |
|---|---|
| `pr.number` | int |
| `pr.url` | string |
| `pr.draft` | bool |
| `pr.state` | `green` · `pending` · `failing` · `none` · `conflicts` · `unknown` · `closed` |

`pr.state` **conflates the PR's standing with its build result** — `conflicts`
and `closed` are about the PR, `green`/`pending`/`failing` are about CI. PR #332
(open) adds `pr.states` as an ordered set precisely because one enum cannot hold
both.

**Absent:** review state travels in `pr-list --rich` (`reviewDecision`) but does
not reach the row.

### Worklog — the agent

| property | values seen | source |
|---|---|---|
| `worker` | `elsewhere` · `failed` · `finished` · `waiting` (of 8 defined) | `plot-worker-state.sh` |
| `processes` | list, empty on this board | the registry |
| `localDirty` | bool | `git status` in the worktree |
| `localLocked` | bool | lock file |
| `localAhead` | int | unpushed commits |
| `changedAgo` | int or `null` | mtime |

**Eight worker states are defined and four appear.** `plot-worker-state.sh`
answers six about the PROCESS plus `waiting` and `stalled` about the TASK —
because every worker exits 0, so the exit code cannot say whether work is done.

**`localDirty` is a fact about a worktree, not about work**, which is why a
merged branch whose stale worktree holds a rewritten test fixture reports
activity. See `done-holds-what-is-still-yours`.

### Build

**Build has no entity.** It appears in two places:

- `pr.state` — one word for the whole rollup
- `stuck.failingChecks` / `stuck.runHistory` — names and history, only when a row
  is stuck

So a green build and an unasked build are both reachable, but there is no
per-branch build record between them. `plot-host.sh runs` fetches history and
only the stuck path consumes it.

### `stuck` — a sixth thing, undeclared

```json
{"state": "unsliced-wave", "changedPaths": [], "failingChecks": [],
 "runHistory": [], "claimedBy": [], "waveSiblings": [...], "conflicts": [],
 "localAhead": 0}
```

`stuck` carries **wave-level facts** (`waveSiblings`, `claimedBy`) on a branch
row. It is where wave properties went when there was nowhere else to put them —
evidence for the missing abstraction rather than a counter-example to it.

## Five statuses, five owners

The recurring confusion has one shape: **each entity has its own status, and the
board reads one owner's status to answer another owner's question.**

| owner | field | values | answers |
|---|---|---|---|
| **plan** | `phase` | Discovery · Development · Endgame · Released | *is this committed to, and how far has it gone* |
| **wave** | `verdict` | complete · eligible · blocked | *may this slice be started, is it finished* |
| **branch** | `state` | open · wip · merged · deferred | *what happened to this ref* |
| **PR** | `pr.state` | green · pending · failing · conflicts · closed · none · unknown | *what does the host say about this proposal* |
| **worker** | `worker` | 8 defined, 4 seen | *is an agent alive, waiting, stalled* |
| *(derived)* | `group` | waiting-on-you · working · not-started · quiet · done | *which section a row renders in* |

**`group` is the only one that is not a property of anything** — it is the
function of the other five, and it is where every defect has surfaced.

### The confusions this names

Each of today's five defects is one row of this table being read for another
row's question:

- a **merged branch** (`state`) put a row in DONE while its **wave** was still
  `eligible` — branch status answering a wave question
- **DONE** admitted a `Discovery` **plan** — no plan status consulted at all
- a **draft plan**'s wave head claimed *work landed* — a note defaulted rather
  than derived from any status
- the **activity mark** fired on `localDirty`, a **worktree** fact, for a
  **branch** whose work was finished
- **`phase`** was asked *has work started*, which is a **plan record**
  (`started_raw`) and not a phase at all

### The rule

**A question is answered by the status of the entity it is about.** Where an
answer needs several — and `group` genuinely does — the combination happens in
exactly one place, `classify`, and nowhere else.

That is what makes `group` safe to derive and unsafe to re-derive: five inputs,
one function, one output. Every second derivation is a place for two of these
five to be read in the wrong order.

### What is NOT a status

- **`## Status`** in a plan file is a *section*, holding Phase, Type, Sprint,
  Review, Impl. Not a field.
- **`status: z.string()`** (schema.ts:339) is a **story** lifecycle status, from
  story-tracking front matter. A different entity again.
- **`tuple.status`** is the row's slot-5 *word* — a rendering of whichever status
  the row's kind makes relevant, coloured by `statusTone`.

Three existing meanings of the word, which is why adding a plan-level `status`
would make a fourth. The front-matter fixture that `phase_alt` guards is exactly
a plan carrying `status:` and `phase:` that disagree.

## What this says about the constraint model

**The section a wave shows up in is a function of at least:** `state` (4) ×
`verdict` (4) × `phase` (5) × `worker` (8, four seen) × `pr.state` (7) ×
`localDirty` × `localLocked` × `stuck` presence.

That is the cross-product `feature/the-classifier-is-total` proposes to
enumerate. The inventory adds two findings the enumeration must respect:

1. **`state` and `verdict` answer different questions** (branch vs wave) and must
   never be treated as one axis.
2. **Seven derived fields are what the board renders**, so asserting on the
   inputs is not enough — the enumeration has to assert on `group`, `note` and
   `waitingOn`, which is where the defects have actually been.

## Where the properties do NOT exist

Recorded because a model should not invent them:

- a wave's **section**, **branch count**, **completeness**
- a plan's **approval record**, **assignee**, **sprint**, **story**
- a branch's **build** as its own record
- an agent's **identity across branches** (the registry has it; the row does not)

Every one is currently either re-derived, carried on `stuck`, or unavailable.
