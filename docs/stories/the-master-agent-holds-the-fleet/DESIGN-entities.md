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

## What these specs are for

**These documents are the foundation for building Plot's domain layer**, not a
description of the board. Each entity spec — [Issue](DESIGN-issue.md),
[Story](DESIGN-story.md), [Plan](DESIGN-plan.md), and the entities below —
defines one object: its source of truth, its fields, its states, its
transitions, its relations, and the questions it can answer.

**The acceptance criterion is that every one of them can be tested with no
external dependency.** No temp directory, no subprocess, no git, no host, no
filesystem. A domain object is constructed in memory and asked a question.

### Where that stands today

Measured 2026-08-28 across the board's 77 unit tests:

| | count | of 77 |
|---|---|---|
| touch disk **or** spawn a process | **41** | **53%** |
| create a temp directory (`mkdtemp`) | 28 | 36% |
| spawn a subprocess | 25 | 32% |

**A test of the deliver rule needs a filesystem today.** `deliver-route.test.ts`
creates a temp dir, writes a `docs/plans/` tree, writes markdown plan files, and
runs `plot-plan-meta.sh` as a subprocess to parse them back — all to ask *is
every non-deferred branch merged?*

Everything before the assertion is **reconstructing a Plan object the long way
round**, because there is no way to construct one directly.

### What the specs must therefore define

For each entity, enough that a test can build one **without its source**:

| the spec defines | so a test can |
|---|---|
| the fields and their types (§3 of each) | construct a valid object literally |
| what absent means per field | build the honest edge cases |
| the states and legal transitions | assert a transition, not a file write |
| the capabilities and their refusals | assert *why* a gate refused |
| what is derived vs. stated | know what the fixture may not invent |

**That last row is the one this session kept re-learning.** A fixture that
computes a wave's `verdict` itself is asserting against its own arithmetic —
the drift measured earlier. If the spec says a verdict is derived from branch
states, the object derives it and the fixture supplies only the branch states.

### What stays integration-tested, deliberately

**Reading and writing.** Parsing a plan file *is* filesystem work, and
`plot-plan-meta.sh` is the contract that does it — tested where it lives, by
`pnpm run test:reconcile`, against real files.

The split is clean and it is the point:

| layer | tested with | example |
|---|---|---|
| **domain** | **nothing external** | *may this plan be delivered?* |
| **parsing** | real files | *does this markdown produce that object?* |
| **effects** | real git, stubbed hosts | *does approving merge the PR?* |
| **rendering** | a browser, mock payloads | *does the row show the refusal?* |

**Today those four are entangled**, which is why 53% of unit tests reach
outside. A domain layer that can be constructed in memory is what separates
them — and it makes the first layer, where every guardrail lives, the cheapest
one to test rather than the most expensive.

---

## The organizing finding

Ten entities, sorted by where their truth lives. The first nine are things the
fleet acts on; the tenth is shared by all of them:

| # | Entity | Source of truth | Domain | State today |
|---|--------|-----------------|--------|-------------|
| 1 | Plan | the file's `Phase:` | git | solid |
| 2 | Wave | plan's `## Waves` + branch states | git | solid |
| 3 | Branch | `origin/<branch>` ref | git | solid |
| 4 | Worktree | `git worktree list` | local | thin |
| 5 | PR | host API | foreign | rich, conflated with Branch |
| 6 | Build | host checks + runs | foreign | partial by construction |
| 7 | Issue | tracker | foreign | **best-designed; 3 gaps** |
| 8 | Agent | manifest + pid + tree | local | three competing models |
| 9 | Machine | spawn cost | local | **does not exist** |
| 10 | **Person** | every artefact that names one | **cross-cutting** | **does not exist** |

**Everything Plot derives from git is clean. Everything else is missing,
partial, or modelled three ways — with exactly one exception.**

*(Person is the tenth and sits outside that split: it is not derived from
anywhere, because nothing in the estate resolves one human's two spellings to
one identity — see §1c.)*

That exception is Issue, and it is the exception that names the rule. Issue is
the only non-git entity that was designed *as* a foreign entity: deliberately
impoverished (number, title, url, age — no labels, no status, because *"those
age into lies the moment the tracker moves"*), read-only at the adapter, and
carrying a three-valued answer about whether its source could be asked at all
(`answered` / `unsupported` / `failed`).

It is also the non-git entity whose defects are the fewest and the shallowest.
Three are recorded in §1b, and it is worth being exact about them rather than
calling the entity clean: one is unreachable without a Jira tracker, one is a
silent truncation at 50, and the third — no link back from a plan to the issue
it answers — exists because **the association was only ever modelled as a
disappearance**. None of the three is a wrong ANSWER; all three are answers
never asked for. That is a different and better failure mode than the other
foreign entities have.

So the discipline exists; it is simply not applied uniformly. Plot has a mature
idiom for git-derived state and one worked example of a foreign one. The four
troubled entities — PR, Build, Agent, Machine — are troubled in proportion to
how far they sit from that example.

### What a domain object is

Settled 2026-08-28, and it applies to every entity below.

**A domain object is what a persisted source becomes in memory — and once the
file is read, it is the sole source of truth for that entity.** Views, actions,
the fleet control and every other consumer read the object, never the file and
never the parser's JSON.

Three consequences that decide field membership:

**1. A field the source states plainly belongs on the object.** A plan's file
says `Phase: Approved`; the Plan object carries it. A story's front matter says
`status: active`; the Story object carries it. A consumer that had to reopen the
file for either would mean the object was not the source of truth after all.

**2. A field the source never states does not.** An Issue's source is the
tracker's reply, which contains no *inbox*/*mapped* notion — that is a relation
to the plan estate, which the tracker has never heard of. Putting it on the
object would make the object assert something its source never said (Issue §3).

**3. A presentation of a field is not a field.** `ageMinutes` is `createdAt`
relative to now; the object carries the timestamp and the view computes the age,
with `now` passed in rather than captured.

**So the test is not "is it derived?" but "does this object's own source state
it?"** — which is why `FleetBranch.state` is correctly a field (its source is
the pair of refs it derives from) while `Issue.state` is not.

**And re-reading is how it stays true.** The object is rebuilt from the file on
every pulse, so it cannot drift from its source: there is no update path, only
re-creation. That is Principle 1 expressed as an object lifecycle rather than as
a prohibition.

### The objects carry the semantics, not just the fields

The three rules above all point at the same missing thing: **the domain objects
are data, and the meaning of that data lives elsewhere.**

Measured 2026-08-28: **32 comparisons against a plan's phase** across the
codebase — 5 of them inside `PlanCard.tsx`, a *render* component. Each is a
call site that decided for itself what `approved` permits.

So the rule *"an approved plan whose waves are eligible may be dispatched"*
exists as `p.phase === 'approved' && p.waves.some(w => w.verdict === 'eligible')`
at one call site, and something like it at thirty-one others.

#### What belongs on the object

**Not more fields — answers.** The object should be able to say what its state
*means*, so no consumer has to re-derive it:

| kind | example | replaces |
|---|---|---|
| **predicates** | `plan.isApproved`, `plan.isTerminal` | `phase === 'approved'` at 32 sites |
| **capabilities** | `plan.canDeliver`, `plan.canDispatch` | the gate re-implemented per caller |
| **transitions** | `plan.approve(who, channel)` | a phase flip plus a record, done together |
| **derived relations** | `story.plans(estate)`, `plan.wave(branch)` | `cards.filter(...)` in two components |

**Capabilities are the important ones**, because they are the guardrails.
*Can this plan be delivered?* is one question with one answer — *every
non-deferred branch is merged* — and it is currently answered by
`plot-deliver.sh`, by `planAutoDeliver`, by the board's action menu and by
`/plot-deliver`'s prose. Four implementations of one rule.

**A capability answers, and refuses with a reason.** `PlanActions` already wants
this: it *"opens on `canOpen`, not `willAct`"* — an action that will be refused
still renders, so the refusal can name itself. That pattern needs the object to
carry both the verdict and the because.

#### Transitions are where the pairs live

**A state change is never one write.** Every one of Plot's transitions is a
phase flip *plus* a record, and the estate has been bitten twice by them coming
apart — a plan flipped to `Delivered` with no `Delivered:` record is invisible to
the scan's rolling window.

`plan.deliver(date)` writing both is the difference between a rule and a
structure: **the pairing stops being something four call sites must remember.**

That is the same reason `plot-approve.sh` and `plot-deliver.sh` exist as scripts
rather than prose — the mechanical half was extracted so it could not be
half-done. This puts the same extraction one layer up, where the board and the
CLI both reach it.

#### What must not move onto the object

- **Nothing that needs the world.** `plan.canDeliver` reads its own waves;
  it does not call a host. Where a decision needs a PR's merge status, the fact
  is passed in — the object stays pure and testable, which is the whole point of
  the rule above it.
- **No persistence.** The object does not write files. A transition returns
  *what should be written*; the script or route performs it, so there remains one
  writer per artefact.
- **No rendering.** `plan.isApproved` is a fact; *"show it in Development"* is
  the board's mapping (§4), and the object should not know about columns.

#### The three rules, completed

| | |
|---|---|
| views | **reference** domain objects |
| the cache | **holds** domain objects |
| workflow | is **expressed, tested and gated on** domain objects |
| **and the objects** | **carry the semantics those three depend on** |

Without the fourth, the first three are unreachable: a view cannot reference an
object that cannot answer questions, and a test cannot assert a rule that lives
in its callers.

### Domain logic can only be tested on domain objects

A workflow rule is a statement about entities, so it can only be **stated,
tested and enforced** in terms of entities. Today several are expressed against
view payloads, and the cost is visible in the tests.

**The worked example is the deliver gate.** `planAutoDeliver` decides whether a
plan may transition — pure domain logic, and one of Plot's four guardrails. Its
rule is one sentence: *every non-deferred wave has merged.*

To test that sentence, the fixture must build a **`FleetPulse`**:

```ts
FleetPulseSchema.parse({
  main: 'main',
  head: 'abc1234',
  plans: [...],
  summary: { plans, waves, branches, claimed, eligible, blocked, deferred },
})
```

— plus, per branch, `ref_held` and `claimed`, which are **git-derived view
fields**, and per wave a `verdict` the fixture computes itself.

**None of that is the decision.** A head SHA, seven summary counts and a
ref-held flag are what the *wire* needs; the rule needs plans, waves and merge
status. The test constructs a transport to ask a domain question.

#### The cost is not verbosity — it is drift

**Measured in this session:** the `wave()` helper hard-coded
`verdict: 'complete'` for every wave it built, including ones holding open
branches. So a test asserting *the gate refuses while a wave is unmerged* was
passing because the fixture said `complete`, not because the gate refused.

That is the failure mode of testing logic through a view: **the fixture
re-implements the derivation, and the copy drifts from the original.** The
verdict belongs to the domain; a fixture that computes its own is asserting
against itself.

#### What changes

| | today | with domain objects |
|---|---|---|
| the fixture | a `FleetPulse` with head, summary, ref flags | **a Plan with waves** |
| the verdict | computed in the fixture | **read from the object** |
| what can drift | fixture vs. real derivation | **nothing — one derivation** |
| what the test reads like | transport assembly | **the rule** |

**And the same applies to actions, not only tests.** `plot-phase-gate.sh`
already gets this right for the same reason: it reads the plan from
`origin/<main>` — the **source** — rather than from anything downstream, because
*"an approval nobody else can see is not one."* A gate that consulted a rendered
row would be enforcing a rule against a copy.

**So the rule is symmetric with the two above.** Views reference domain objects;
the cache holds domain objects; **and domain workflow is expressed, tested and
gated on domain objects.** Each of the three fails the same way when broken — a
second representation that can disagree with the first.

### The cache is at the wrong layer

**The board caches views and re-reads sources.** That is the inversion your
consolidation rule fixes, and it is measurable.

`CacheEntry` holds **31 fields** and **not one of them is a plan**:

| what it caches | what it is |
|---|---|
| `ages`, `approvedAt`, `ideaPlans`, `versions`, `unmerged` | **slices of plan data**, one per consumer |
| `pulse`, `issues` | **assembled rows** |
| `prs`, `runs`, `terminal`, `registry`, `agents` | foreign and process facts |

So five fields cache *fragments extracted from plan files*, two cache *rendered
views*, and the plan files themselves are re-parsed behind all of them.

**The expensive thing is repeated and the cheap thing is stored.** Parsing all
158 plans costs **140 ms**, batched, measured three times. A filter over already
-parsed objects costs microseconds. The cache holds the filters.

**And the parse happens everywhere.** `plot-plan-meta.sh` is invoked from **26
call sites across 9 server modules** — `board.ts` 7, `fleet.ts` 4, `deliver.ts`
3, `index.ts` 3, `reslice.ts` 3, `commission.ts` 2, `transition.ts` 2,
`auto-deliver.ts` 1, `idea.ts` 1. Each is a subprocess, and several run per
pulse.

#### What should be cached instead

**The domain objects.** Read the plan and story files once, build Plan and Story
objects, and let every consumer — views, actions, the fleet control, the
derivations — read those.

| layer | cached today | should be |
|---|---|---|
| **domain objects** | **nothing** | **the cache** |
| derivations (`ages`, `approvedAt`, `versions`, `unmerged`) | cached | computed from objects, cheaply |
| views (`pulse`, `issues`) | cached | rebuilt per render |

**This does not weaken Principle 1 — it strengthens it.** The objects are
rebuilt from the files, and the invalidation rule is the same one
`PLOT_TERMINAL_CACHE` already follows: *"git is re-consulted on every pass and
the entry is discarded the moment it disagrees."* A file's mtime is a cheaper
version of that check than re-parsing it.

**What makes today's arrangement fragile** is that the cached fragments have
*no* such rule. `approvedAt` and `versions` are recomputed on a timer, not
invalidated by their source, so a plan edited between ticks is stale in five
caches at once with nothing detecting it.

#### The two rules are one rule

Caching domain objects and having views reference them are the same change seen
from two sides:

- **if views copy domain data**, the copies must be cached — and each copy needs
  its own invalidation, which is where drift enters
- **if views reference domain objects**, there is one thing to cache and one
  place to invalidate

The current design has neither: views copy *and* the copies are cached *and*
the sources are re-read anyway.

### Views reference the domain object; they do not copy it

Settled 2026-08-28, and it follows directly from the object being the sole
source of truth.

**A view carries what a renderer needs *for presentation* and references the
domain object for everything else.** Today the opposite is true, and it is
measurable:

| view type | fields |
|---|---|
| `AgentRowSchema` | **32** |
| `FleetBranchSchema` | 21 |
| `CardSchema` | 18 |
| `IssueRowSchema` | 5 |
| `StoryCardSchema` | 4 |

**80 fields across five view types**, and the duplication is direct:

- **8 of `Card`'s 18 fields are plan domain data** — `phase`, `type`, `title`,
  `sprint`, `story`, `assignee`, `prs`, `rounds`. Each is copied out of the
  plan file onto a row.
- **`AgentRow` and `FleetBranch` share 4 fields** describing the same branch —
  `branch`, `state`, `worker`, `worker_activity`.

**Every copy is a place two representations can disagree**, and this repo has
paid for it: an `AgentRow` field defaulting client-side where a `FleetBranch`
did not, a `state` refined in one and not the other, a row synthesized with
fields the domain never had.

#### What a view keeps

Only what is **about the rendering**, and it is a short list:

| keeps | example | why |
|---|---|---|
| a reference | `slug`, `file` | how to reach the domain object |
| presentation of a domain value | `ageMinutes` from `createdAt` | correct only at render, needs `now` |
| row identity | `kind`, `rowKey` | which component draws it, and its React key |
| view-only state | expanded, filtered, selected | never persisted, never derived |

Everything else — phase, type, title, sprint, story, PRs, branch state — is
**read through the reference**.

#### Why this is not merely tidier

**One writer per fact.** A domain object is rebuilt from its file every pulse,
so it cannot drift from its source. A copy on a view has no such guarantee: it
drifts the moment one call site defaults, normalizes or refines differently
from another — which is the exact shape of several bugs this estate has fixed
one at a time.

**The wire stops carrying the estate twice.** The pulse currently ships plan
facts inside branch rows *and* inside cards; referencing would ship each
entity once and let the client join.

**And the client stops parsing.** A recurring defect here is the client casting
a payload rather than parsing it, so schema defaults never apply and a new
field reads `undefined` in the renderer. Fewer fields on the wire is fewer
places that can happen.

#### What it costs

**A join.** A row that references a plan needs the plan available to the
renderer — so the payload carries entities plus rows, and the client resolves
`row.planFile → plans[planFile]`. That is more indirection in exchange for one
copy of each fact.

**And it must not become lazy loading.** The join is over data already in the
payload; a view that fetched its domain object on demand would put a round trip
behind a render, which is the opposite of what the pulse exists to avoid.

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
asked** — separately from what the source said. Issue's `IssueAnswer` is the
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

This is Issue's `IssueAnswer` shape applied to identity: *could the source be
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

## 1b. Issue

**Specified in full in [DESIGN-issue.md](DESIGN-issue.md)** — the board's inbox
and Plot's tracker-facing entity. It outgrew this document: posture, domain
object, kinds, relations, actions, scope, collaborators, fleet control, setup
and gaps run to more lines than the other eight entities combined.

The summary that belongs here:

- **An Issue is a signal from outside Plot that nobody has decided about yet** —
  in none of the four phases, deliberately.
- **Two config keys, not one.** `Tracker:` says who owns the truth (`plot` |
  `jira`); `Issue tracker:` says which service is spoken to. Both default to
  what already happens.
- **Three kinds, both directions.** `story` → Story, `epic` → Release, anything
  else → Plan; inbound where the tracker minted the id, outbound where Plot did.
- **The pattern the other foreign entities should copy** — deliberately
  impoverished, askability carried apart from the answer, read controllers that
  degrade beside write controllers that refuse.
- **Four verified gaps**, of which the sharpest is that the plan → Issue link
  does not exist: the association is modelled only as a disappearance.

---

## 1c. Person

The smallest entity here, and the only one shared by every other. Not a
participant in the fleet — that is Agent — but the **human a record names**.

### What it is

**An identity, not an actor.** A Person exists because an artefact names them:
a plan approved, a story authored, a commit made. There is no roster, no
membership, no lifecycle — the entity exists to make two spellings of one human
resolve to one value.

### The measurement that motivates it

Across this estate, 2026-08-28:

| artefact | field | value | count |
|---|---|---|---|
| story front matter | `author:` | `jwloka` | **9 / 9** |
| git commits | author | `Jan Wloka` | **200 / 200** |
| plan | `assignee:` | `Jan Wloka` / `jwloka` | **30 / 16** |
| plan | `approved:` who | `Jan Wloka` / `jwloka` | **84 / 43** |

**Story is internally consistent; git is internally consistent; Plan is where
they collide.** And the reason is structural: story front matter and git
metadata are written by tooling, while a plan's `Assignee:` and `Approved:`
lines are typed by a human into prose.

So this is not a plan-format defect. **It is a missing shared identity, visible
only where a human writes the value.**

**A fifth case is worse than inconsistent.** Four `Approved:` records name a
prose clause rather than a person — *"do not fall back to a second budget"* —
because the record is comma-separated free text and one of its fields may itself
contain commas. There is nothing to parse (Plan §3).

### Source of truth

**Every naming artefact, and no canonical list.** A Person is the union of what
the estate calls them, which means the entity's job is *resolution* rather than
storage:

| source | yields |
|---|---|
| git config / commit author | display name, email |
| story `author:` | a handle |
| plan `assignee:`, `approved:` | either spelling |
| the host (`gh`/`bb`) | the account handle |

### The domain object

| property | type | note |
|---|---|---|
| `handle` | string | **the identity** — stable, lowercase, what records should carry |
| `displayName` | string | what a record may render; `''` when unknown |

**Two fields, and only the first is identity.** `displayName` is presentation —
the same relationship `ageMinutes` has to `createdAt`, one level up.

**No email, no avatar, no role.** An email is a git artefact and a privacy
surface; a role is a permission Plot does not model (below).

### What it answers

```ts
Person.resolve(raw)      // "Jan Wloka" | "jwloka" → the same Person
person.equals(other)     // the question 84-vs-43 cannot answer today
```

**Resolution needs a rule, and the honest one is repo-local.** Handles and
display names correspond by convention, not by derivation — `Jan Wloka` and
`jwloka` are the same person here and would not be in general. So the mapping is
a small declared fact (a config key, or git's own `user.name` / `user.email`
pairing), never an inference from string similarity.

**Where it cannot resolve, it must not guess.** An unrecognised spelling is a
Person with that raw value as its handle and an empty display name — absent is
not false, applied to identity.

### What it is not

- **Not an Agent.** An Agent is a process with a session id; a Person is a
  human. They meet only in a transition record's `who`, and an agent acting on a
  person's behalf records the person.
- **Not permissions.** Plot does not decide who *may* approve — the review
  channel does: a PR's own approval, a person in the session, a ballot tally.
  Person answers *who did*, never *who may*.
- **Not a roster.** Nothing enumerates the people of a repo, and nothing should:
  a Person exists because a record names them, so an estate's people are
  derived from its artefacts.
- **Not cross-repo.** A handle is meaningful in the repo that uses it.

### Where it lands

**Every transition record, and two fields beside them.** The Plan spec argues
the record itself should be structured (`{date, by, channel, detail}`), and
`by` is a Person. `assignee` and a story's `author` are the same type.

**That is the entity's whole value: one type, five fields, one resolution
rule** — instead of four fields that each hold whichever spelling their author
happened to type.

### Open

- **Where does the handle↔name mapping live?** A config key is explicit; git's
  `user.name`/`user.email` pairing is free but only covers committers.
- **Should the lint flag an unresolvable `who`?** It would catch the four prose
  clauses, and it is exactly the kind of structural check
  `plot-story-lint.sh` already makes.

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
`unmeasured` is Issue's `IssueAnswer` shape again: *could this be asked* kept
apart from *what it said*.

### What it is not

- **Not a cap on workers, and not the dial itself.** The cap already exists and
  belongs to the operator: `fleetControls.parallelAgents`, default 3. Machine
  does not set it, lower it, or refuse at it. It reports the RANGE the dial
  moves in — today that range has a floor of 1 and no ceiling at all.
  A number derived from headroom alone would be wrong in both directions: the
  estate has run 23 rows in WORKING healthily, and the operator has already
  refuted a worker-count theory once with a screenshot.
- **Not load average.** Kept as context in the payload, explicitly not the
  verdict.
- **Not a gate that refuses.** It informs a supervisor and an operator. A
  dispatch on a starved machine is a decision a person may still make, and the
  reading must not prevent it — see Elastic. Plot's gates refuse on a
  MEASUREMENT of harm already done (a live pid, an unmerged branch); this is a
  prediction about capacity, which is a different kind of claim.

### What it enables

1. **A death that names its cause.** An Agent that died at `exit 124` while the
   machine read `starved` carries `machine_at_death: starved` — *the machine,
   not the worker*. This is the single field that would have prevented four
   corrections.
2. **A ceiling on the dial** (story job 1). `parallelAgents` has a floor of 1
   and no maximum, so the stepper climbs forever with nothing saying where the
   machine's range ends. One ~0.4 s reading turns an unbounded control into a
   bounded one — without taking it away from the operator.
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

Whether a property is re-derived each pulse or retained between them is settled
separately — see [Where the properties live](#where-the-properties-live). What
follows is the shape, not the storage.

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
| `asked` **`+`** | `answered`\|`not-asked`\|`failed`\|`unsupported` | — | Issue's `IssueAnswer` shape, applied to run history |
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

### Issue

Deliberately impoverished. Adding to this table is almost always wrong.

**Domain object** — what the tracker stated, before anything decided how to
show it:

| property | type | meaning |
|---|---|---|
| `id` | string \| number | `#N` (GitHub) or `PROJ-123` (Jira) |
| `title` | string | enough to answer *is this worth a plan?* |
| `url` | string | verbatim; `''` where the host gave none |
| `createdAt` | ISO-8601 \| null | when it was opened |
| `body` | string | **only after `issue-view`** — absent from the list |
| *(fleet-level)* `issueAnswer` | `answered`\|`unsupported`\|`failed` | **whether the tracker could be asked at all** |

No labels, no assignee, no status — *"those age into lies the moment the tracker
moves"*, and Plot never writes them back.

**View row** (`IssueRow`) — derived at the boundary, not stored: adds
`kind: 'ticket'` (a row discriminator) and `ageMinutes` (a presentation of
`createdAt`, correct only at render). See §1b's layering note: today
`CacheEntry.issues` holds the ROW, and no domain representation exists.

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

The vocabulary already exists and is the one Issue uses. Every entity adopts
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

### Elastic — the user scales within what the machine can take

**Elastic here means the operator scales the fleet, bounded by measured
capacity — not the controller shedding work on its own.** Corrected
2026-08-28; an earlier draft of this section had the controller drop to
"pulse only" at `starved`, which is a judgement it may not make.

The manifesto's usual reading — acquire resources under load — does not apply:
the fleet runs on one laptop with fixed capacity, shared with the operator's own
board. But the conclusion is not that the system decides for itself. It is that
**the range is real and measurable, and the choice inside it is the
operator's.** A controller that refuses at `starved` cannot know the operator is
willing to trade board responsiveness for throughput this once. That is Principle
3 again: the controller collects and reports; a person decides.

#### The dial already exists

`fleetControls` ships it, and its default is exactly the baseline:

```
FLEET_CONTROLS_DEFAULT = { autoDispatch: false, parallelAgents: 3 }
```

- **Start at 3.** Already the shipped default.
- **The budget is a subtraction:** `parallelAgents − (liveAgentCount + inFlight)`,
  clamped at zero.
- **A live agent always occupies a slot**, even once its branch has merged —
  *"every live agent consumes a machine regardless of what its branch did."*
  Measured: eleven workers whose branches had merged sat at zero CPU for up to
  ten hours; excluding them let the fleet grow unbounded.
- **The control governs STARTING, not stopping.** Lowering the dial never kills a
  running agent. So raising it is reversible only for future dispatches, which is
  the right asymmetry — nothing in flight is ever destroyed by a slider.
- **A refusal names the branches holding the slots**, not just the count.
- It is shared through `.plot/state/fleet-controls.json`, not `localStorage`,
  *"because they spawn agents that write code, so two people reading one board
  must not disagree about whether the fleet is running."*

#### What is missing is the ceiling

`MIN_PARALLEL_AGENTS = 1`. **There is no maximum.** The stepper goes up
forever, and nothing tells the operator where the machine's range ends — so the
dial is elastic in name and unbounded in fact.

That is the whole gap this design closes, and it needs exactly one thing:
**Machine.**

| what the operator sees | source |
|---|---|
| the dial, at 3 | `fleetControls.parallelAgents` — exists |
| how many slots are taken | `liveAgentCount` — exists |
| **what the machine can currently take** | **Machine — does not exist** |

With a headroom reading beside the stepper, the same control becomes honest:

| headroom | what the stepper says | what it does |
|---|---|---|
| `clear` | *room for more* | raising is unremarkable |
| `tight` | *at the edge* | raising is allowed, and marked as a stretch |
| `starved` | *the board is suffering* | raising warns first — and still obeys |
| `unmeasured` | *capacity unknown* | no claim either way |

**It still obeys.** The reading informs the operator; it never overrides them.
That keeps the manifesto's gates-over-rules discipline intact in the right
direction: a gate refuses on a MEASUREMENT of harm already done (an unmerged
branch, a live pid), never on a prediction about capacity.

#### Where automatic response is still legitimate

The controller may adapt **its own** cost without asking, because that spends
nothing the operator owns:

- stretch its own fetch cadences (`prRefreshMsFor` already stretches 1× on
  GitHub, 4× on Bitbucket)
- skip metered fetches and say `not-asked` out loud
- decline to run its own test suites and scans while headroom is low

The line is ownership: **the controller may throttle itself; only the operator
resizes the fleet.** An earlier draft of this section crossed that line, and the
crossing is what this rewrite removes.

**The observer must price itself.** `Machine.sampleMs` exists for this — a
headroom measurement that costs meaningfully under load makes the observer part
of the problem, which is the story's own complaint restated as a constraint on
its fix.

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
| Elastic | Machine bounds the operator's dial; the controller throttles only itself |
| Message-Driven | whole-map messages, receiver-side validation, terminal signals |

