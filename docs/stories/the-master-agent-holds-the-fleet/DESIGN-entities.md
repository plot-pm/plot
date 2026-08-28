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
| 7 | Issue | tracker | foreign | **best-designed; 3 gaps** |
| 8 | Agent | manifest + pid + tree | local | three competing models |
| 9 | Machine | spawn cost | local | **does not exist** |

**Everything Plot derives from git is clean. Everything else is missing,
partial, or modelled three ways — with exactly one exception.**

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

Designed first among the foreign entities, because it is the one already done
right and the pattern the others should copy.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
> — this entity serves the story's **job 5** (*what do I show the operator?*) by
> being the board's inbox, and its read/write controller split is the worked
> example behind **job 4** (*what is safe to run?*).

### Three kinds, both directions

**Corrected 2026-08-28** against the agentic workflow diagram. An earlier draft
of this section modelled Issue as ONE thing — an inbound signal nobody has
decided about. The workflow has **three**, at three points, flowing in two
directions:

| workflow ticket | phase | kind | typical direction | lifecycle |
|---|---|---|---|---|
| **Customer story** | Discovery | `story` | inbound — the signal | one ticket · one story; enters the inbox |
| **Feature** | Development | (any) | outbound — Plot writes it | one per plan, *"only now, because the cut now holds"* |
| **Epic** | Development → Testing | `epic` | outbound — Plot writes it | one per release; collects every feature ticket; **closes with the release** |

These are the workflow's three *roles*, and the direction column says which way
each **typically** runs — not which way it must. Direction is a property of the
individual issue, not of its kind: a Story with no customer ticket can produce
an outbound story ticket, and a customer can file an epic. See
[direction is a property of the issue](#direction-is-a-property-of-the-issue-not-of-the-kind).

Two of the three roles are **written by Plot**, and that is what the earlier
draft got wrong. Its invariant *"read-only; no operation writes to the tracker"* is a true
statement about the connector **today** and a false one about the workflow this
is designed toward.

#### What survives the correction, and what does not

**Survives — everything about the inbound kind.** The Customer story ticket is
exactly the entity specified below: impoverished, read-only, exiting by being
referenced. *"NOT an `AgentRow`, and the distance is the point"* still holds;
so does carrying no labels, assignee or status.

**Does not survive — the claim that Plot never writes.** It does not write
*today* because the write path does not exist: `issue-create` appears nowhere in
`plot-host.sh`, and neither "feature ticket" nor "epic ticket" appears anywhere
in `skills/` or `docs/` (verified 2026-08-28). The workflow is a **target
state**, and the honest reading is that the read-only rule holds for the inbound
kind and is *unbuilt* for the two outbound ones.

**Does not survive — my sprint→epic answer.** An earlier section argued: derive
the epic from the union of the plans' `Issue:` refs, and never store it. That is
right for an epic Plot *reads* and wrong for one it *creates*. The workflow's
epic is **per release**, and it is Plot's own artefact — so it has an identity
Plot minted, and a derivation cannot invent one. The correction is below.

#### The relations — which Plot artefact an Issue maps to

Settled 2026-08-28. `kind` selects the counterpart, and this is the rule that
makes the field load-bearing rather than decorative:

| `kind` | Plot artefact | mapping |
|---|---|---|
| `story` | **Story** | one ticket · one story |
| `epic` | **Release** | one epic · one release |
| anything else | **Plan** | one ticket · one or more plans |

```
Issue(kind=story)  ─────►  Story  ──┐
                                    ├──►  Plan  ──►  Feature ticket ──┐
Issue(kind=bug|task|…) ─────────────┘                                 │
                                                                      ▼
Issue(kind=epic)  ◄────────────────  Release  ◄─────────────  epic collects
```

##### Direction is a property of the issue, not of the kind

**Corrected 2026-08-28.** An earlier draft of this section fixed direction to
kind — epic outbound, story and plan inbound. That is wrong: **every relation
runs in both directions**, and the two axes are independent.

|  | **inbound** (the tracker minted it) | **outbound** (Plot minted it) |
|---|---|---|
| **story** | a customer story ticket → a Story | a Story with no ticket → Plot files one |
| **plan** | a bug or task → a Plan | a Plan → its **Feature ticket** |
| **epic** | a customer's epic → an inbound signal | a Release → its **epic harbour** |

All six cells are real. The draft denied two of them while this same document
described them elsewhere: the **Feature ticket per plan** is the outbound plan
case, specified one section above; and an inbound epic is the ambiguity named
two sections below. The story case is `story-tracking`'s own — *"no ticket
exists because the customer is not in the loop"* — where the Story is the
umbrella and a ticket may be filed for visibility rather than the reverse.

##### What actually differs: who minted the identity

The distinction the draft was reaching for is real, but it belongs to the
**individual issue**, not to its kind:

| | inbound | outbound |
|---|---|---|
| identity minted by | the tracker | **Plot** |
| Plot's job | *record* the reference | *mint it, and remember having minted it* |
| failure if lost | a broken link | **two artefacts for one thing** |
| Plot may edit it? | **no** — someone else owns it | yes — it is Plot's own |
| lifecycle owner | the tracker | Plot (a feature ticket follows its plan; an epic closes with its release) |

So the asymmetry that matters is **ownership**, and it is per issue: a Feature
ticket Plot created is Plot's to close, while a bug someone filed is not — even
though both map to a Plan.

**How Plot tells them apart: by having recorded the id.** An issue whose key
appears in a Plot artefact — `Issue:` on a plan, the epic id beside `Released:`
— is one Plot knows about; whether Plot *minted* it is the same record read one
step further. This needs no provenance field and fails in the safe direction: an
unrecorded issue is treated as inbound, so Plot declines to edit something that
might not be its own.

**Why this matters more than tidiness.** Direction decides the write policy. An
inbound issue is read-only by the rule that Plot must not edit what a customer
owns; an outbound one is Plot's to close and must never be minted twice. Getting
that per-kind rather than per-issue would either forbid Plot from closing its
own feature tickets, or license it to edit a customer's epic.

##### `story` → Story

*One ticket · one story* — the workflow's own words for the Discovery input.

**The link exists as a naming convention and nothing else.** `story-tracking`
names story directories `{slug}/` **or** `{JIRA-ID}-{slug}/`, so the ticket key
can be part of the path. Verified 2026-08-28: no story in this repo uses the
keyed form, and no STORY file carries a ticket field in its frontmatter.

That is thinner than the plan relation, which has a parsed `Issue:` field. A
`ticket:` frontmatter key would make it symmetric and machine-readable — but the
directory convention already exists and works for a human, so this is a gap to
name rather than a defect to rush.

**The umbrella rule governs whether a Story is created at all**, and it is
`story-tracking`'s, not this entity's: *a well-described ticket stays the
umbrella*, and *"implement this ticket as described" never opens a story*. So
`kind=story` says which **counterpart type** applies; it does not say a Story
must exist.

##### anything else → Plan

The default, and the only relation fully built today. `Issue:` on a plan is
parsed (`#N` and `PROJ-123` alike), and one plan may answer several signals —
*"a plan can answer several"*, which is why the field is a list.

**One ticket may also produce several plans.** The workflow's *Build n plans*
step is exactly this: one approved story fans out into n plans, each citing the
same origin. So the cardinality is many-to-many, and neither side is a key.

This is where gap 3 bites: the reference is recorded on the plan and **never
read back**, so the board can say which tickets are unplanned but not which plan
answers `PROJ-123`.

##### `epic` → Release

The outbound one, and the only relation where Plot mints the identity.

```
epic(2.11.0)  ⟷  Release 2.11.0
```

- **Keyed by the release version** — the key the estate already carries, since
  sprint files declare `Release:` from the day they open.
- **Membership is the feature tickets** of every plan in that release, added at
  creation rather than swept in later.
- **It closes with the release**, which is the lifecycle Plot owns. A customer
  story's state belongs to the tracker; an epic's state belongs to Plot.

**The identity must be recorded where a re-run finds it.** `/plot-release` is
idempotent by design — every step tests the source it would have written — and
minting an epic breaks that unless the epic's key is written down. The existing
pattern is `→ #N` on a branch line: the artefact records what was created, so
the second run finds it rather than repeating the act. The epic's id belongs
beside `Released:` for the same reason.

##### The actions an inbound Issue offers

The mapping is what a reader acts on, so each relation gets an action. Settled
2026-08-28:

| action | offered when | starts | maps to |
|---|---|---|---|
| **Create plan** | **always** | `/plot-idea` | Plan |
| **Create story** | `kind = story` | `/story-tracking` | Story |
| **Create sprint** | `kind = epic` | *(unbuilt)* | Sprint → Release |
| **Open on host** | always | navigation | — |

**Create plan is unconditional**, and stays the default for every kind. An epic
or a story may still deserve a plan directly — the workflow's own *Build n
plans* fans one approved story into several — so nothing gates it. It is also
the fallback where `kind` is `''`, which is the safe direction: offering a plan
for something that deserved a story beats filing it nowhere.

**The other two are gated on a fact, not on a guess** — and this reverses an
earlier position in this document, deliberately. That draft said *"both create
actions are offered unconditionally; the board does not inspect a ticket to
decide whether it is epic-shaped or plan-shaped, and that restraint is the
design."* It was right **while no kind was fetched**: with no type available,
any gating would have been an inference from the title. Now that `kind` is a
fetched fact, gating stops being a guess and becomes a reading.

The restraint was never about refusing to gate. It was about refusing to
*infer* — and the rule is unchanged: **Plot may act on what the tracker stated
and must not act on what it inferred.**

##### `Create sprint` — the unbuilt one

An inbound epic is a customer saying *here is a body of work*. The counterpart
is a Sprint, because a sprint is Plot's unit for a body of work with a release
attached — and the epic is keyed by exactly that.

```
Issue(kind=epic)  ──Create sprint──►  Sprint(Release: <version>)
                                             │
                                             └──►  epic harbour for that release
```

The relation closes on itself, which is the property worth noticing: an inbound
epic creates a sprint, and that sprint's release then has an epic — **the same
one**. So *Create sprint* is where an inbound epic becomes the outbound harbour,
and the two directions meet in one artefact rather than producing two.

**What it needs, none of which exists:**

| piece | status |
|---|---|
| `Sprint command` config key | **absent** — no such key in `plot-config.sh` |
| `POST /api/sprint` route | **absent** — no sprint module in `server/` |
| the sprint's `Release:` value | the epic must carry or imply a version |

**The version is the hard part, and it is a judgement.** A sprint declares
`Release: 2.11.0` from the day it opens, but an epic titled *"Q3 reporting"*
names no version. So *Create sprint* cannot mint the sprint outright the way
*Create plan* mints a draft — it spawns an agent that proposes the sprint and
asks, exactly as `/plot-sprint` does today. That keeps the version a decision a
person makes, which is the same line every other Plot gate draws.

**It follows the two existing spawn actions in every other respect**: brief
written to a file outside the repo and named in the environment, so no part of
an epic's body becomes a shell word; localhost-only, because it writes to this
disk; and refusals named rather than hidden — `no-sprint-command` joins
`no-story-command` as a reason a reader can act on.

##### Actions an outbound Issue offers

**None, on the row.** An outbound issue is Plot's own artefact and its lifecycle
follows the artefact: a feature ticket tracks its plan, an epic closes with its
release. There is nothing for a reader to decide, which is why outbound issues
do not appear in the inbox at all — they are subtracted by the same filter that
removes any referenced issue.

An outbound issue that *does* surface in the inbox is a defect, not a row with
missing actions: it means Plot minted something and lost the record of having
done so.

##### What the mapping must not become

- **Not an importer.** `kind=epic` does not mean *read its children and create
  plans*. The epic Plot writes and the epic a customer might file are different
  things, which is exactly why `kind` alone is not enough — see below.
- **Not a type equivalence.** A `bug` ticket does not force a `Type: bug` plan.
  The plan's type is a decision about the work; the ticket's kind is a fact
  about the signal.
- **Not a requirement.** A plan needs no `Issue:`; a release needs no epic. Both
  relations are optional, and the majority of this repo's plans carry neither.

##### The ambiguity `kind` alone cannot resolve

An epic Plot minted and an epic a customer filed have the **same `kind`** and
opposite meanings — one is Plot's own release harbour, the other is an inbound
signal that might deserve a Story. Distinguishing them needs provenance, not
type: *did Plot create this?*

The cheapest honest answer is that Plot knows its own by **having recorded the
id** — the same record idempotency already requires. An epic whose id appears
beside a `Released:` line is Plot's; any other is inbound. No new field, and it
fails in the safe direction: an unrecorded epic is treated as inbound, which
shows a row rather than hiding one.

#### Why the timing is the design

The workflow says the feature ticket is written *"only now, because the cut now
holds"* — at **Plans approved**, not at Draft.

That is the same discipline as every other Plot record. A ticket written at
Draft would name a plan whose branches may still be re-sliced; the cut holding
is what makes the ticket's scope true. It is the tracker-side twin of
`Approved:` — a record written when the fact becomes true, not when it is
first imagined.

And the epic *"closes with the release"*, which gives the outbound kinds
something the inbound kind explicitly refuses: **a lifecycle Plot owns.** A
customer story's state belongs to the tracker and would age into a lie if
mirrored. A feature ticket's state is Plot's own — the plan's phase *is* the
ticket's truth.

#### What this means for the three collaborators

The split holds and gains a fourth role, unbuilt:

| collaborator | inbound | outbound |
|---|---|---|
| `IssueTracker` | scheme, scope | **project/board to write into** — undeclared |
| `IssueTrackerConnector` | `issue-list`, `issue-view` | **`issue-create`, `issue-close`** — do not exist |
| `IssueTrackerMonitor` | polls the inbox | — |
| **`IssueTrackerWriter`** | — | **unbuilt**: mints feature and epic tickets, closes them |

The writer is the collaborator the workflow implies and the codebase lacks. It
is deliberately a **fourth** rather than an extension of the connector, for the
reason this document keeps finding: reads degrade, writes refuse. A connector
that both polls an inbox and creates tickets would have two failure policies in
one place, and the read policy is *keep the last good answer* — precisely wrong
for a write that must never happen twice.

**Its hardest problem is idempotency, and Plot already has the pattern.** A
feature ticket must be created once per plan, and re-running approval must not
mint a second one. That is what `→ #N` annotation does for PRs: **the plan file
records the identity of what was created**, so the second run finds it rather
than repeating the act. The same field shape (`Issue: PROJ-123`) is already
parsed — today it is only ever written by a human.

#### Sprint → epic, corrected

The release is the unit, not the sprint. `plot-sprint-release.sh` already reads
a sprint's declared `Release:` target, so the mapping runs through it:

```
sprint --Release:--> release --epic ticket--> collects each plan's feature ticket
```

**The epic's key is the release version, and that is the whole model.** An epic
collects the feature tickets of one release, so `2.11.0` names it, finds it, and
closes it. Verified 2026-08-28: `plot-sprint-release.sh` already reports a live
sprint targeting `2.11.0`, so the key exists and is read today — nothing new has
to be invented for the epic to be addressable.

Membership is therefore derived, not maintained:

```
epic(2.11.0)  ⊇  { feature ticket of every plan released in 2.11.0 }
```

- **The epic is per release**, so a sprint with no `Release:` has none — which is
  the majority case and must stay silent.
- **Two sprints may target one release**, which the release gate already handles
  (*"two teams, one train"*). One epic, several sprints: the derivation must not
  assume a single owner.
- **The epic's identity is minted, not derived.** Once `/plot-release` creates
  it, the id must be recorded where a re-run will find it — a `Released:` line's
  neighbour, on the same principle as `→ #N`.

#### The epic is the harbour — it scopes the inbox and receives what Plot mints

Settled 2026-08-28. Once an epic matching the release is found, it becomes the
**one place both directions meet**:

```
                    epic(2.11.0)
                    ╱          ╲
        READ: scope of        WRITE: every feature
        what we look for      ticket Plot mints joins it
                    ╲          ╱
              one harbour, two directions
```

**Reading — the epic replaces the scope heuristic.** Two sections above, the
inbox's stage 2 was flagged as a gap: Jira scopes to `assignee = currentUser()`,
GitHub to every open issue, and I proposed a declared `scope: mine | all` to
reconcile them. **The epic is a better answer and this supersedes it.** Both of
those were guesses at relevance; an epic is a *declaration* that these tickets
belong to this release. So:

```
inbox = children(epic(release)) − referenced(every plan file)
```

Stage 2 stops asking *whose issues* and asks *which epic* — answered by the
release key the estate already carries. Where no epic is found the previous
behaviour stands unchanged, which is what keeps a repo with no epic working.

**Writing — every ticket Plot mints joins the epic.** A feature ticket created
at Plans approved is added to `epic(release)` at creation, not swept in later.
That makes membership an act rather than a reconciliation, and it is what makes
the harbour hold: a feature ticket outside its epic is invisible to the inbox
scope above, so a later run would offer it as an unplanned signal.

**The two halves are the same fact read twice**, which is the property worth
protecting: what Plot writes into the epic is exactly what Plot later looks for
in it. If they can disagree, the harbour has become a mirror to keep in sync —
the failure this entity avoids everywhere else.

##### Without an epic — all open, newest first

Settled 2026-08-28, and it is the majority case: **no epic, no scope
heuristic.** One rule on both arms.

```
inbox = open(tracker) − referenced(every plan file)
  sort   created DESC
  limit  50, and the count says so
```

| arm | query | change |
|---|---|---|
| Jira | `resolution = EMPTY ORDER BY created DESC` | **drops `assignee = currentUser()`** |
| GitHub | `--state open --search "sort:created-desc"` | **adds an explicit sort** |

**This changes Jira's behaviour, deliberately.** Today its arm asks
`assignee = currentUser() AND resolution = EMPTY` — *my* open tickets — so a
team's unassigned backlog never reaches the board at all. That is the wrong
default for a triage inbox, because **an unassigned ticket is the most likely
thing to be worth a plan.** A filter that hides untriaged work defeats the one
question the inbox exists to ask.

`PLOT_JIRA_JQL` still overrides for a team that wants narrower, so nothing is
taken away — only the default moves from *mine* to *everything nobody has
planned*.

**And it fixes a GitHub gap found while specifying this.** The arm passes no
sort at all and relies on `gh`'s default ordering, so *newest first* is
currently an assumption rather than a request. Verified 2026-08-28:
`--search "sort:created-desc"` returns the expected order.

**Why not filter by assignee at all.** Two reasons, and the second is the
decisive one:

1. **It costs an identity Plot does not have.** Jira resolves `currentUser()`
   server-side from the auth token, free. GitHub does not — nothing in the
   adapter resolves a user, and the board has no user concept. Assignee
   filtering would introduce one on one arm to match a convenience on the other.
2. **The inbox's question is triage, and triage is about the unassigned.**
   "Is this worth a plan?" is asked hardest of tickets nobody has picked up.
   Scoping to assigned tickets answers a different question — *what is on my
   plate* — which is what the tracker's own UI already does better.

**The limit must state itself.** 50 is a bound on the fetch, not a claim about
the tracker, so a truncated list renders as *showing 50 of N* (gap 2). With no
epic and no assignee filter this matters more, not less: the inbox is now the
whole open backlog, and 50 of 400 shown as "50" is a materially wrong picture.

**Where an epic exists, it replaces this entirely** — `children(epic(release))`
is a declaration of membership rather than a bound on recency, so neither the
sort nor the limit is doing the same job.

##### The bootstrap, and why it is not circular

The epic is keyed by a release version, and *"is this worth a plan?"* is asked
before any plan exists — so it is worth showing the order does not bite:

| when | what is known | epic |
|---|---|---|
| sprint opened | `Release: 2.11.0` **declared in the sprint file** | may be created here |
| plan approved | the release the plan is heading for | feature ticket joins it |
| `/plot-release` | the version is cut | epic **closes** |

Verified 2026-08-28: sprint files carry `Release:` from the day they open —
`2.6.0`, `2.8.0`, `2.9.0`, and a live `2.11.0` — while `/plot-release` only
*determines* a version at the end. **So the key exists long before the release
does**, and the epic can be found or created at sprint open rather than at
release time.

Where no sprint declares a release — the majority case — there is no epic, no
harbour, and the inbox scopes as it does today. That must stay true: the epic is
an *addition* for teams that run releases through a tracker, never a
prerequisite for the board's inbox.

##### What must not follow from this

- **The epic is not a work queue.** Its children are scoped, not assigned. The
  inbox still asks *is this worth a plan?* and still subtracts what plans
  already reference.
- **Plot does not manage the epic's own state** beyond closing it with the
  release — no reordering, no priority, no assignment.
- **A customer story ticket does not join the epic.** It is inbound and belongs
  to whoever filed it; the epic collects what Plot mints. Conflating them is
  what `kind` prevents.

**Still not an import.** Nothing reads an epic's children to create plans.
`story-tracking`'s rule stands for the *inbound* kind: a well-described customer
ticket stays the umbrella. The outbound epic is a **report Plot publishes about
a release it made**, which is the opposite direction and does not touch that
rule.

#### The `kind` question, now settled

Two sections above, `kind` (epic/story/bug) was deferred for want of a consumer.
It has three:

1. An inbound Customer story and an outbound Feature ticket are **different
   entities that live in the same tracker** — without `kind`, Plot's own feature
   tickets would reappear in its inbox as unplanned signals the moment a plan
   stopped referencing them.
2. The epic→feature relation needs to know which is which.
3. A reader asking *is this worth a plan?* is asking a different question of an
   epic than of a bug.

`kind` is therefore not a mirrored status and does not age into a lie — it is
**structural**, and it is what keeps the three kinds apart.

**And it is what selects an Issue's counterpart**: `story` → Story, `epic` →
Release, anything else → Plan. See
[the relations](#the-relations--which-plot-artefact-an-issue-maps-to). Without
`kind` there is no rule to apply, so the field moves from *deferred for want of
a consumer* to *required by the mapping*.

**It must be fetched, and today it is not.** Neither arm asks for it — GitHub
requests `number,title,url,createdAt`, Jira requests `summary,created`. Both can
supply it free in the call already being made (`--json issueType`, `fields=…,
issuetype`), so this is a field to add rather than a call to add.

**And it needs a value for *cannot tell*.** A tracker with no type concept, an
older payload, or a type Plot does not recognise must render as `''` — the same
absent-is-not-false shape every other field here uses. The mapping then falls to
the default (Plan), which is the safe direction: it offers a plan for something
that might have deserved a story, rather than silently filing it nowhere.

---

### Domain object specification

> Specifies the **inbound Customer story ticket** — the kind that exists today.
> The two outbound kinds are specified by the workflow and unbuilt; their shape
> follows from the writer above and is not settled here.

The normative shape. Everything after this section explains or justifies it;
where the two disagree, this section is the specification.

#### Identity

```
Issue.id : string
```

**Opaque, and a string.** Plot compares issue identities and never orders,
increments or arithmetically manipulates them. GitHub yields `226`; Jira yields
`PROJ-123`; both are identifiers, and only one of them is a number by accident
of the host.

Declaring `string` and normalizing at the adapter boundary closes gap 1 at its
root: the current split — `z.number()` in the row, `Set<number>` in the filter,
`.key` in the Jira arm — is what makes the Jira filter silently always-false.
A rendered identity may add the tracker's own sigil (`#226`), which is a view
concern, not the id.

#### Fields

| field | type | required | source | rule |
|---|---|---|---|---|
| `id` | `string` | yes | tracker | opaque; equality only |
| `title` | `string` | yes | tracker | may be empty; never absent |
| `url` | `string` | yes | tracker, **verbatim** | `''` = no address; never composed |
| `createdAt` | `string \| null` | yes | tracker | ISO-8601; `null` = the host gave none |
| `body` | `string \| null` | no | `issue-view` only | `null` = **not fetched**; `''` = fetched and empty |

Five fields. Every one is a fact the tracker stated; none is computed, formatted,
or relative to now.

**`body` distinguishes not-fetched from empty**, because the list op omits bodies
entirely and only a click fetches one. `null` and `''` are different answers, and
collapsing them would make an issue with no description indistinguishable from
one nobody has opened yet.

#### Fields deliberately excluded

| excluded | why |
|---|---|
| `status`, `state` | tracker state Plot does not own; ages into a lie between refreshes |
| `assignee` | as above, and Plot never assigns |
| `labels`, `priority` | as above |
| `kind` (epic/story/bug) | not fetched today; see Open |
| `ageMinutes` | a *presentation* of `createdAt` — belongs to the view |
| row `kind: 'issue'` | a renderer discriminator — belongs to the view |

The rule behind the first three: **Plot never writes to the tracker, so any
mirrored field is a copy that is wrong between refreshes and wrong forever after
an outage.** The tracker is the authority on tracker state; the model points at
it and carries nothing it would have to keep in sync.

#### Askability — a property of the ANSWER, not of an Issue

```
IssueAnswer : 'answered' | 'unsupported' | 'failed'
```

Carried once per fetch, beside the collection — never on an individual Issue,
which by existing has already been answered for.

| value | means | renders as |
|---|---|---|
| `answered` | the host replied | the list, empty honestly meaning none |
| `unsupported` | this tracker cannot be asked at all | **no section** |
| `failed` | asked, did not come back | last good list, marked stale |

`unsupported` renders nothing rather than an empty list: an empty inbox would
claim an empty tracker.

#### Invariants

1. **`id` is opaque.** Equality only — no ordering, no arithmetic, no sigil.
2. **`url` is verbatim or empty.** Plot composes no tracker address it was not
   given; `''` renders as plain text.
3. **`null` is never `0` and never `''`.** Absent is a distinct answer from
   empty at every field that has both.
4. **No mirrored tracker state.** Adding a field the tracker owns requires a
   reason this rule does not already refuse.
5. **Read-only — for this kind.** No operation writes to a Customer story
   ticket. The outbound kinds (Feature, Epic) are Plot's own artefacts and are
   written; see [Three kinds, both directions](#three-kinds-both-directions).
   The distinction is ownership, not politeness: Plot must not edit a ticket a
   customer owns, and must own the ones it mints.
6. **An Issue leaves by being referenced**, never by being marked — the exit
   condition lives in the plan estate.
7. **Askability is carried apart from the answer**, once per fetch.

#### Derivation to the view

```
toIssueRow(issue: Issue, now: number) -> IssueRow
```

`now` is an **argument**, not a capture, because `ageMinutes` depends on it and
a controller must not silently recompute a display value on every pulse. The
row adds `kind: 'issue'` and `ageMinutes`; it adds nothing else.

#### Not specified here

- **`kind` (epic / story / bug).** Plot fetches no issue type from any tracker
  today. Whether to add one is open: the board deliberately does not branch on
  it (both create actions are offered unconditionally), so the field would need
  a consumer before it earns a place — and a kind, unlike a status, does not age
  into a lie, so the usual exclusion does not settle it.
- **A parent or epic link.** Would mirror tracker hierarchy; refused for now on
  the same ground as `labels`.

---

### The name: Issue, not Ticket

**Settled 2026-08-28: the domain concept is `Issue`.** This document called it
Ticket in its first draft; the codebase had already decided otherwise, and the
counts say so plainly:

| layer | `ticket` | `issue` |
|---|---|---|
| `contract/` | 7 | 29 |
| `server/` | 17 | 215 |
| `app/` | 52 | 184 |
| `skills/` | 72 | 231 |

Every domain-facing name is already Issue: `issue-list`, `issue-view`,
`issueAnswer`, `referencedIssues`, `Issue:` in the plan format, `IssueRowSchema`
itself. `ticket` survives almost entirely in the **view** layer, as a row kind
and a chip style — which is exactly the confusion §1b corrects. So this is less
a rename of a concept than the removal of the last place two words compete for
one meaning.

#### What the change touches

Measured 2026-08-28: 148 occurrences of `ticket`/`Ticket` across 25 files under
`packages/board/src` and `skills/`, in three groups with very different risk.
The count is a case-insensitive text match, so it includes prose and this
document's own quotations — it sizes the sweep, and is not a list of edits.

**1. The wire value — `RowKind` and `IssueRow.kind`.**

```
RowKindSchema:  'ticket' → 'issue'
IssueRowSchema: kind: z.literal('ticket') → z.literal('issue')
```

Renamed outright, no transitional union. Server and client ship from one build
into one artifact; there is no independent deployment and no stored payload, so
the only skew window is a browser tab left open across a rebuild.

**2. The chip style — `what: 'ticket'` — which is TWO things.**

This is the part a blind rename gets wrong, and the code already says so:

> *`what: 'ticket'` is worn by TWO different things — an issue's
> number-and-title, and an AGENT's session id — so a hook keyed on it would
> stamp `data-issue-link` on an agent row.*

`tuple-row.ts:725` and `rows.tsx:2234` both emit `what: 'ticket'` for an
**agent's session id**, where it means *render this like a ticket chip* and has
nothing to do with a tracker. Renaming those to `'issue'` would label a session
id "Issue" — worse than the ambiguity being fixed.

So the value **splits**: `'issue'` for issue links, `'session'` for agent
session ids.

**And that is not cosmetic.** The overload already costs code. `nameHooks` can
answer `what: 'branch'` once for all seven row kinds — *"every `what: 'branch'`
link on every kind is a branch"* — but cannot answer `'ticket'`, because the
function is not told the row kind and the two meanings need different hooks.
The result is that a ticket's hooks are passed in as `nameAttr` from the one
call site that knows better. **Splitting the value makes the general answer
possible**: an unambiguous `'issue'` could be answered in the same place
`'branch'` is.

Stated carefully, because the first draft of this section overstated it:
`nameAttr` is a general escape hatch used by several kinds and does not
disappear. What the split removes is the *reason this particular kind needs
it* — and whether to then move the hooks into `nameHooks` is a judgement for
whoever does the work, not a promise this spec should make on their behalf.

**3. Prose — comments, skill docs, README tables.** ~90 occurrences, no risk.
Worth doing in the same pass so the vocabulary lands whole; worth doing last so
a mechanical sweep never touches code.

#### What does NOT change

- **`story-tracking`'s use of "ticket"** is about a Jira work item as a customer
  or PM speaks of it, not about this entity. Its rule — *a well-described ticket
  stays the umbrella* — is quoted in this document and reads correctly in its
  own vocabulary. Renaming there would be translating a domain that is not ours.
- **`Tracker:`** stays `Tracker:`. It names the SYSTEM (`plot`, `jira`,
  `github-issues`, `linear`), not the item, and `Issue system:` would be worse.
- **`plot-host.sh`'s ops** are already `issue-list` / `issue-view`.

#### Order, and the gate

The rename is only safe with the tests that pin the current vocabulary: 21
assertions across 10 test files, including four browser tests
(`unplanned-issues`, `issue-becomes-a-plan`, `tuple-row`, `one-grid`). Those
assertions are the contract, so they are what says the rename is complete rather
than partially applied.

1. Split `what:` into `'issue'` / `'session'`, and collapse the `nameHooks`
   exception the split makes unnecessary.
2. Rename the wire value in `contract/`, then follow the type errors.
3. Update the 21 test assertions.
4. `pnpm build:board`, then `pnpm run test:board` — the artifact is generated
   and the browser tests load it, so a stale artifact fails reassuringly
   (a rename is exactly the change that produces one).
5. Prose sweep — last, so a mechanical `s/ticket/issue/` never runs over code.

**The gate is the 21 assertions passing, not the sweep being finished.** A
rename is the archetypal change that looks complete while a renderer still
matches on the old string: `tsc` catches the enum, and only the browser tests
catch a `data-` attribute or a label that drifted. Neither alone is sufficient.

---

### What it is

**An Issue is a signal from outside Plot that nobody has decided about yet.**

Not a work item, not a lifecycle stage, not a plan in an earlier phase. The
contract states the boundary in as many words:

> *NOT an `AgentRow`, and the distance is the point. […] Giving it an `AgentRow`
> with six empty fields would make it a plan in an earlier state, and the four
> phases would then have a fifth in everything but name.*

That is the design decision the whole entity turns on. Plot has exactly four
phases — Draft, Approved, Delivered, Released — and an Issue is in **none** of
them. It has not entered the lifecycle. Modelling it as a pre-Draft state would
add a fifth phase by accident and make Plot responsible for a queue it does not
own.

### What it is for

**The board's inbox, and one question only: *is this worth a plan?***

Everything about the entity follows from that single question, including
everything it refuses to carry.

Its lifecycle inside Plot is one transition and one exit:

```
tracker issue, open, no plan references it
        │
        ▼
   appears in the board's inbox
        │
        ├── someone writes a plan citing it  →  Issue LEAVES the board
        └── nobody does                      →  it stays, ageing
```

**Nothing marks an Issue as handled.** It disappears because a *plan* now
references it — `Issue: #226` in the plan file — and the filter is a set
difference recomputed every pass: open issues minus referenced issues. The exit
condition lives in Plot's own artefacts, never in the tracker.

This is why it is the cleanest foreign entity: **Plot never writes to the
tracker, so there is no state to keep in sync and nothing to age into a lie.**

### The two ops, both read-only

| op | cost | when |
|---|---|---|
| `issue-list` | one call, on the PR timer | the inbox; bodies omitted |
| `issue-view <n>` | one call per click | one body, for the row's create actions |

`issue-view` fetches a body **only when a human clicks**, because a body is the
problem statement handed to `/plot-idea` and is worthless until someone acts.
That split — a cheap list on a timer, an expensive detail on demand — is the
same shape Build needs (§6) and the reason Issue is the template.

**There is no `issue-create`, `issue-close`, or `issue-comment`, and there must
not be.** Per CLAUDE.md: *"a plan referencing an issue is Plot's record, not the
tracker's."*

### An Issue leads to a plan OR a story — the reader chooses

The ticket row carries **three** actions, and the design decision is that the
board offers all of them and guesses at none:

| action | what it starts | refuses when |
|---|---|---|
| **Create plan** | `/plot-idea` agent → a Draft plan | the host cannot be asked; the lookup broke |
| **Create story** | `/story-tracking` agent → a story | no `Story command`; several story homes; non-localhost binding; host unreadable |
| **Open on host** | navigation to `issue.url` | never — no guard, no fetch |

**Both create actions are offered unconditionally.** The board does not inspect
a ticket to decide whether it is epic-shaped or plan-shaped, and that restraint
is the design.

> **Revised once `kind` is fetched.** This holds while no type is available —
> gating on an inferred shape would be a guess. With `kind` as a fetched fact,
> *Create story* is offered on `kind = story` and *Create sprint* on
> `kind = epic`, while *Create plan* stays unconditional. See
> [the actions an inbound Issue offers](#the-actions-an-inbound-issue-offers).
> The rule is unchanged: act on what the tracker stated, never on what was
> inferred. It cannot know: an epic's title looks like a story's, a
well-scoped bug looks like a plan, and the same ticket can honestly be either
depending on how much of it the team intends to take on. Guessing wrong costs
either a story nobody wanted or a missing option on the row that needed it.

So the judgement stays with the person who read the ticket — Principle 3 applied
to an action rather than to a report. What the board contributes is **making
both cheap and naming why either is refused.**

This is also the answer to *when a Jira epic and a Plot Story both claim the
umbrella*: nothing resolves it automatically, because `story-tracking` already
rules on it and its rule needs a reader —

> *A well-described **ticket** holds [the umbrella]; the ticket stays the
> umbrella. […] **Negative rule:** "implement this ticket as described" never
> opens a story.*

A rich Jira epic is not duplicated into a local Story. That is the same
discipline as carrying no labels and no assignee: **do not mirror what the
tracker already owns better.** The board offers *Create story*; the skill behind
it declines to create one where the ticket is already the umbrella.

**The menu is always present**, whatever the binding — *Create story* and *Open*
are there even where they refuse, so a ticket row is never menuless. A refusal
that names its cause is more useful than an absent button, and each refusal
sends the reader somewhere different: `no-story-command`, `several-story-homes`,
`tracker-unsupported`, `issue-unreadable`.

**Both actions spawn agents, and that is fenced.** The issue body is written by
whoever can file an issue, and `Story command` is a shell fragment run through
`sh -c` — so the brief is written to a file **outside the repo** and named in the
environment, never interpolated. *"No part of an issue ever becomes a shell
word, whatever it contains."* Outside the repo because `pnpm board` runs under
`node --watch`, so a prompt written inside would restart the server that just
spawned the agent. And neither action is available over a non-localhost binding:
*"the phone that reads the board does not write stories from it."*

### How it is modelled

**Correction, 2026-08-28.** An earlier draft of this section listed
`IssueRowSchema`'s fields as the entity's properties. That was wrong:
**`IssueRow` is a VIEW, not a domain model.** It sits in `RowKindSchema`'s list
of seven — `ticket`, `plan`, `pr`, `build`, `agent`, `branch`, `release`,
`wave` — which is a *rendering* taxonomy, and its `kind: 'ticket'` field exists
so *"one row component can read slot 2 from the data."* A domain object does not
carry a field naming which component draws it.

The domain object is what the tracker was asked about, before anything decided
how to show it.

#### The domain object

Specified normatively above — see [Domain object
specification](#domain-object-specification). Five fields, every one a fact the
tracker stated: `id`, `title`, `url`, `createdAt`, `body`. Nothing computed,
formatted, or relative to now; no labels, assignee, status or priority, because
*"those age into lies the moment the tracker moves"* and Plot never writes them
back.

#### What belongs to the view instead

Two things in the old table were view concerns, and naming them is what the
correction buys:

- **`kind: 'ticket'`** — a row discriminator. The domain object is a ticket by
  being one; it does not need to say so.
- **`ageMinutes`** — a *presentation* of `createdAt`. The adapter returns
  `createdAt`; `refreshIssues` converts it to minutes-since-now, which is
  correct only at the instant of render and must be recomputed every pulse. The
  domain holds the timestamp; the view holds the age.

The rule that produced `ageMinutes: null` rather than `0` is still right and
still belongs to the view: *0 would claim the issue was opened this instant.*
Absent-is-not-false applies at both layers.

#### The layering defect this exposes

`CacheEntry.issues` is typed **`IssueRow[]`** (`fleet.ts:498`). So the
controller — the thing the reactive section calls the fleet control — holds
view rows rather than domain objects. `refreshIssues` fetches from the adapter
and converts to rows *in the same function*, and no domain representation is
ever materialized.

That is why the earlier draft made this mistake so easily: **there was no domain
model to read, only a row.** The consequences are concrete rather than
theoretical:

- `ageMinutes` is recomputed inside the controller on every pulse, so a value
  whose only consumer is a renderer is refreshed by the data layer.
- A second consumer of tickets — a supervisor asking *"what is unplanned?"* from
  the CLI, with no board open — would receive rows shaped for a grid it is not
  drawing.
- The Jira `string | number` defect (gap 1) lives in the row schema, which is
  where it was noticed. Whether the *domain* id is a string or a number is a
  separate question that no type currently asks.

**The fix is not to rename `IssueRow`.** It is a good view type and should stay
one. The gap is that the controller should hold the domain object and the view
should be derived at the boundary — `toIssueRow(ticket, now)`, with `now` an
argument precisely because the age depends on it.

This generalizes past Issue, and it is the reason to record it here: **every
entity in this document is currently defined by its row.** `FleetBranch`,
`AgentEntry`, `Card` and `PrRecord` are all shapes the board renders. Whether
each is also the right domain shape is a question this design has not yet asked
of any of them — and asking it is what the remaining entity sections should do.

### Askability is a separate field from the answer

`IssueAnswer` — the shape this design generalizes to every entity:

| value | means |
|---|---|
| `answered` | the host replied; an empty list honestly means none are unplanned |
| `unsupported` | this host has no issue listing (Bitbucket) — nothing missing, nothing broken |
| `failed` | the question was asked and did not come back |

> *COLLAPSING ANY TWO REBUILDS `an-outage-is-not-an-answer`. An empty list is a
> claim about the tracker; a failed lookup is the absence of one, and a board
> that renders the second as the first tells a reader their inbox is clear using
> data it never received.*

`unsupported` renders **no section at all** rather than an empty one — an empty
inbox on Bitbucket would imply an empty tracker.

### The three collaborators

Settled 2026-08-28. Three roles, named — and **all three exist today, unnamed
and scattered.** Naming them is the design: it says which decision belongs to
which, so a change to one does not silently become a change to another.

```
IssueTracker            what this repo tracks with, and how the inbox is scoped
      │                 (configuration — a declaration, not a connection)
      ▼
IssueTrackerConnector   how that tracker is asked; the ONE place a tracker's
      │                 shape is known; emits one vocabulary whatever answered
      ▼
IssueTrackerMonitor     when it is asked, how often, and what it costs;
                        owns the filter, the failure policy and the gate
```

#### `IssueTracker` — the declaration

What the repo tracks with, and **how much of it is ours**. Today this is
`Tracker:` in `## Plot Config`, read by `tracker_raw` / `tracker_scheme` /
`tracker_base_url`.

| property | today | note |
|---|---|---|
| `scheme` | `plot` \| `jira` \| `github-issues` \| `linear` | `plot` = no inbox at all |
| `baseUrl` | second token of `Tracker:` | `''` for a bare `jira`; never composed |
| `scope` | **per-arm, undeclared** | see below — the one real gap |

**It is independent of `Git host`, and that is load-bearing:** a Bitbucket repo
tracking in Jira is the normal enterprise case, so the connector dispatches on
`scheme`, never on the git host.

**`scheme: plot` means there is no tracker to connect to.** *Plans in this repo
ARE the tracker.* The connector is never built and the monitor never runs — the
default case costs nothing, and every other scheme is the *addition* of an inbox
to a system that works without one.

#### `IssueTrackerConnector` — the one place a tracker's shape is known

`plot-host.sh`'s `issue-list` and `issue-view`, plus the Jira helpers
(`jira_curl`, `jira_check`, `jira_require_config`). Its whole contract:

1. **Two ops, both read-only.** There is no `issue-create`, `issue-close` or
   `issue-comment`, and there must not be.
2. **One vocabulary out, whatever answered.** Both arms emit the same JSON and
   the same exit codes — *"a consumer that already maps 4 to `unsupported` and
   anything else to `failed` must not need a second table."* Nothing above the
   connector learns which tracker replied.
3. **Three outcomes, never collapsed:** answered / cannot-be-asked (exit 4) /
   failed.
4. **It composes no address it was not given.** `''` is a real value.
5. **A scheme with no arm must exit 4, not fall through.** Today `linear` falls
   through to the git-host arm, so a Linear-tracking GitHub repo silently lists
   *GitHub* issues. The connector is the layer that must refuse a scheme it
   cannot serve.

**Where a new tracker is added, and the only place.** Adding one means one arm
here — nothing above it changes, which is the test of whether this boundary is
real.

#### `IssueTrackerMonitor` — when, how often, and what matches

`refreshIssues` plus the shared PR gate. This is the collaborator your question
names, and it owns four decisions the other two must not make:

**1. Cadence, on a shared gate.** It rides `prNextAt` rather than opening a
second timer — *"the issue lookup cannot become a second cadence quietly
spending the host budget the gate exists to ration."* Sequential, not
concurrent, *"because two calls at one instant is what a rate limit counts."*
A rate limit on either pushes the shared gate out, **extend-only**.

**2. Independent failure.** It runs *after* and *outside* `refreshPrs`, because
*"a tracker outage must not blank the PR map, and a PR failure must not retract
the inbox."* Two sources, one gate, separate failure domains.

**3. The filter.** One set difference, recomputed every pass:

```
inbox = open(tracker) − referenced(every plan file)
```

with the completeness gate: **if `referenced` cannot be computed, nothing is
reported at all** — not the unfiltered list (which surfaces planned issues), not
an empty one (which claims the inbox is clear).

**4. Degrade, never refuse.** It is a read controller: a failure keeps the last
good list and marks it stale. The write controllers beside it do the opposite.

##### Which issues reach the board — the whole filter

Four stages, and **only one of them is Plot's own judgement**. Stated together
because they are currently spread across the adapter, the monitor and a
constant, and no single place says what a reader is looking at.

| # | stage | decided by | today |
|---|---|---|---|
| 1 | **open** | the tracker | `--state open` / `resolution = EMPTY` |
| 2 | **scope** — which issues | the epic, or all open | epic children where one exists; else everything |
| 3 | **unplanned** | the plan estate | `− referenced(every plan file)` |
| 4 | **limit** | `ISSUE_LIMIT = 50` | **truncates silently** ← gap 2 |

Stage 3 is the only one Plot decides, and it is a set difference with no
judgement in it. There is deliberately **no ranking, no relevance scoring and no
sorting** beyond the tracker's own order: the single question is *is this worth
a plan?*, and that is a reader's call made from the title. A score here would be
the same mistake `plot-sprint-candidates.sh` refuses to make — *"which plans
serve a stated goal is the semantic judgement"* — and it would rank by whatever
a shell can compute rather than by what matters.

Two of the four stages are unsound as they stand, and both fail the same way:
**a filter the reader cannot see.** Stage 2 differs per tracker without saying
so; stage 4 removes rows without saying so. A filter is honest only when its
result carries what it excluded.

##### What "matching" means — and the asymmetry to fix

The monitor shows *open issues no plan references*. But **what counts as open is
scoped differently per arm**, and that scoping is undeclared:

| arm | query | inbox means |
|---|---|---|
| Jira | `assignee = currentUser() AND resolution = EMPTY` | **my** open tickets |
| GitHub | `gh issue list --state open` | **every** open issue in the repo |

On a small repo these converge. On a busy one they are different inboxes
entirely — and `ISSUE_LIMIT = 50` then truncates *somebody else's* backlog onto
the board, silently (gap 2).

**Measured here 2026-08-28: 1 open issue, 0 assigned to the operator.** So this
repo would show one row under the GitHub arm and **an empty inbox under Jira's
scoping** — the two arms disagreeing about the same estate at the smallest
possible scale, where they were supposed to converge. The asymmetry is not
waiting for a busy repo to appear; it is visible at n=1, and the divergence
grows with backlog rather than beginning there. Only Jira can be re-scoped, via `PLOT_JIRA_JQL`,
and only through an environment variable rather than the config every other
posture is declared in.

**Resolved 2026-08-28, and `scope` is not the answer.** Both cases are now
settled without a new config key:

- **With an epic** — `children(epic(release))` scopes the inbox. A declaration
  of membership, not a guess at relevance. See
  [the epic is the harbour](#the-epic-is-the-harbour--it-scopes-the-inbox-and-receives-what-plot-mints).
- **Without one** — every open ticket, newest first, capped at 50 with the count
  stated. See [without an epic](#without-an-epic--all-open-newest-first).

The asymmetry is removed by making both arms ask the same question, rather than
by declaring which of two answers a repo prefers. `PLOT_JIRA_JQL` remains the
escape for a team that wants narrower. Two properties follow:

- **The monitor never invents a scope.** It asks the connector for what the
  tracker declared; a filter the board applied after the fetch would be a third
  place issues are selected.
- **A truncated list says so.** *Showing 50 of N* is a different claim from
  *there are 50*, and the entity is scrupulous about that distinction
  everywhere else.

#### Setting an `IssueTracker` up

**`/plot-board-setup` already asks**, and its handling is the model this design
should not disturb. Three properties worth keeping:

1. **Propose from evidence, never from a default.** `plot-detect-repo.sh`
   reports a `ticket_prefix`, and a repeated one is proposed *with the count
   shown*: — *"Found `QUACDS-*` in 6 of 80 commit subjects → propose
   `Tracker: jira`."*
2. **Absence is not evidence.** An empty `ticket_prefix` *"is not evidence
   against a tracker"*, so setup **asks** rather than proposing `Tracker: none`.
3. **Unanswered means unwritten.** Under `PLOT_UNATTENDED` it refuses and
   discloses, rather than guessing:

   > `PLOT-UNASKED: which tracker — refused — no Tracker key written; inbox
   > source unverified`

   The reasoning is exactly this entity's: *"a wrong `Tracker: jira` sends
   `issue-list` to the wrong system, which answers with somebody else's
   backlog."*

**What setup does not yet ask is `scope`** — and it is the same class of
question, with the same failure if guessed. It belongs beside the tracker
question, proposed from the same evidence:

| signal | propose |
|---|---|
| a personal or small repo | `scope: all` — every open issue is plausibly yours |
| a shared team tracker (a `ticket_prefix` with many authors) | `scope: mine` |
| no signal | **ask**, and refuse unattended, as the tracker question already does |

Setup should also **prove the connector answers**, the way it already proves the
board serves. A `Tracker:` written but never exercised is the shape
`plot-board-probe.sh` exists to prevent elsewhere: one `issue-list --limit 1`
distinguishes *configured* from *working*, and reports `ok` / `failed` /
`unsupported` — never *assumed*.

#### Mapping a Sprint to an epic

**Derive it; do not store it.** A sprint carries plans, and a plan carries
`Issue:` — so the sprint-to-epic relation already exists as a union over the
sprint's members:

```
sprint  →  its plans  →  their Issue: refs  →  the epic they share
```

Nothing new is written. This is the same shape `plot-sprint-release.sh` uses to
derive a release's contents from plan phases rather than from a stored list, and
the reason is this repo's most repeated lesson: **the copies are what drift.**
An `Epic:` field on the sprint file would be a second source of truth about a
fact the plans already state, and it would go stale the first time a plan joined
or left the sprint.

Verified 2026-08-28: `Issue:` is parsed on **plans only** — no sprint file in
this repo carries a ticket reference, and `plot-plan-meta.sh` has no sprint-level
issue field. So the derivation is the *only* mapping there is, and the question
is whether to surface it rather than whether to build it.

What a reader would get from surfacing it:

- **A sprint's tracker footprint** — *this timebox answers PROJ-100, PROJ-104*
  — computed, always current, and free once `meta.issues` stops being discarded
  (gap 3).
- **The inverse, which is the useful direction under `Tracker: jira`:** *which
  sprint is working on PROJ-100?* That is what a PM asks, and it is the same
  index read the other way.

Two things this must not become:

- **Not a sprint field.** `Sprint: <name>` on a plan and `Issue:` on a plan are
  enough; a third annotation would need maintaining in a file nobody re-reads.
- **Not an epic→sprint import.** Plot does not read a Jira epic's children and
  create plans from them. `story-tracking` already rules that a well-described
  ticket *stays* the umbrella, and the manifesto keeps issues as signals rather
  than commitments. The mapping is a **report about what was decided**, never a
  queue to work through.

**One honest limit.** A plan cites its `Issue:` as a flat list; nothing says
whether `PROJ-100` is an epic or a sibling ticket. Distinguishing *the epic this
sprint serves* from *the tickets it closes* needs the `kind` field this design
has so far deferred — which is the first concrete consumer for it, and the
argument to reconsider.

#### Why three and not one

Each owns a decision the others must not make, and each has a different reason
to change:

| collaborator | changes when | must not decide |
|---|---|---|
| `IssueTracker` | a repo is configured | how to ask, or how often |
| `IssueTrackerConnector` | a tracker is added or its API moves | when to ask, or what is unplanned |
| `IssueTrackerMonitor` | the cost or cadence changes | a tracker's URL shape or auth |

The measured argument for the split is `linear`: a value the **declaration**
accepts and the **connector** cannot serve. With the two collapsed, that
mismatch has nowhere to be caught. With them separate, the connector's exit 4 is
exactly where it belongs.

---

### The controllers

Four, and they divide by what they are for rather than by what they touch.

| controller | kind | cadence | on failure |
|---|---|---|---|
| `refreshIssues` | read | PR timer (60 s × host cost) | keep last good list, mark stale |
| `referencedIssues` (fleet) | read — the filter | per refresh | `null` → the whole answer is `failed` |
| `referencedIssues` (idea) | **write precondition** | per click | `null` → **refuse the write** |
| `handleIdea` / `handleStory` | write | per click | refuse, naming which of four reasons |

#### Read and write controllers fail in opposite directions

`referencedIssues` exists **twice**, and it is not duplication to remove. Same
question, opposite failure direction, and the code argues it:

> *There it filters a list on a timer; here it is a PRECONDITION on a write. […]
> reporting an unfiltered list is a display error that a refresh corrects, while
> spawning an agent on an unchecked precondition writes a plan file nobody asked
> for.*

So a read controller degrades — last good value, marked stale — and a write
controller refuses. That is the general rule for every entity in this document,
and Issue is where it is already implemented.

The write side has a second job the read side does not: a second click on a row
the board has not yet refreshed away would start a second `/plot-idea` for an
issue that already has a plan, and **two plans answering one signal is worse
than the stale row that prompted them.**

#### What must be monitored, and at what price

Four sources, three of which the board already watches:

| source | what it yields | cost | cadence |
|---|---|---|---|
| the tracker (`issue-list`) | open issues | 1 host call | PR timer, shared gate |
| the plan estate (`plot-plan-meta.sh`) | every `Issue:` reference | 1 parser run, 132 ms / 59 plans | per refresh |
| the tracker (`issue-view`) | one body | 1 host call | **per click only** |
| the agent's own output | did the click's agent finish? | local state file | per poll |

Two properties of this set are worth stating because they are choices:

**The plan estate is read WHOLE, not from the pulse.** `referencedIssues` walks
every plan file rather than `pulse.plans`, and the reason is a measured trap:

> *The pulse carries active plans plus a rolling 24 hours of delivered ones […]
> A plan delivered last week is still the decision that was made about its
> issue, and reading the pulse would drop it from this set and put the issue
> back on the board a day later, under a heading that says nobody has decided
> about it.*

**The reference has to outlive the branch.** That is the sharpest illustration
of the entity's whole shape: what removes an Issue from the inbox is a decision,
and decisions do not expire on a 24-hour window.

**The issue poll rides the PR gate rather than opening its own.** Same host,
same budget, one cadence — and a rate limit on either pushes the shared gate
out, extend-only. A second independent timer would spend an exhausted budget to
be refused again.

#### How the issues are filtered

One set difference, recomputed every pass, with a refusal built in:

```
inbox = open(tracker) − referenced(every plan file)
```

- **`open`** is the tracker's own answer. On GitHub it is `gh issue list`, not
  `gh api /issues` — *"on GitHub every PR IS an issue"*, so the REST endpoint
  would deliver every open PR as an unplanned signal. The subcommand filters
  them out, and the code notes the trap *"is invisible while it works."*
- **`referenced`** is every `Issue:` value any plan carries, GitHub `#N` and
  Jira `PROJ-123` alike.
- **If `referenced` cannot be computed, nothing is reported.** Not the
  unfiltered list (which would surface planned issues), not an empty one (which
  would claim the inbox is clear). `issueAnswer: 'failed'` — *neither is known,
  so neither is said.* This is the completeness gate, already built.

No sorting, no ranking, no relevance scoring. The one question is *is this worth
a plan?*, and that is a judgement the reader makes from the title.

#### How different trackers are handled

The adapter is the only place that knows, and it **dispatches on `Tracker:`,
never on the git host**:

| `Tracker:` | how issues are read | note |
|---|---|---|
| `plot` (or absent) | — | *plans in this repo ARE the tracker*; there is no inbox |
| `github-issues` | `gh issue list` / `gh issue view` | ids are numbers |
| `jira` | REST `search/jql` + `issue/<key>` | ids are **keys** (`PROJ-123`) |
| `linear` | **nothing** — see below | config accepts it; no arm exists |
| Bitbucket as git host | — | `bb` has no issue listing → exit 4 → `unsupported` |

**`linear` is declared and unimplemented.** `plot-config.sh` documents
`Tracker: plot | jira | github-issues | linear`, and `plot-host.sh` contains the
string `linear` **zero times** (verified 2026-08-28). `tracker_scheme` returns
`linear`, no arm matches it, and the request falls through to the git-host arm —
so a Linear-tracking GitHub repo would silently list GitHub issues instead, and a
Linear-tracking Bitbucket repo would exit 4 and report `unsupported`. Neither
is an honest answer to *"list my Linear issues"*.

This is the same absent-is-not-false failure the entity is otherwise careful
about, one layer up: **the config advertises a capability the adapter does not
have.** Either the arm is built, or `linear` leaves the documented values, or
`tracker_scheme` refuses a scheme it has no arm for with the exit code that
already means *this cannot be asked*. The third is the cheapest and is probably
right — an explicit `unsupported` is what every other unaskable case returns.

Three things make the implemented arms work, and each is a decision:

**Dispatch on the tracker, not the host.** *"A Bitbucket repo tracking in Jira
is the normal enterprise case, so the git host is irrelevant here."* The two
questions are independent and the config keys are separate (`Git host`,
`Tracker`).

**One vocabulary out, whatever answered.** Both arms emit the same JSON shape
and the same exit codes — *"a consumer that already maps 4 to `unsupported` and
anything else to `failed` must not need a second table."* The board never learns
which tracker replied.

**The URL is composed only where its shape is known.** `Tracker: jira <url>`
carries the base as its second token; `tracker_base_url` returns `""` for a bare
`jira`, and an empty URL renders as plain text. Plot composes no address it was
not given.

**`Tracker: plot` is the case that needs no controller at all.** The default —
*plans in this repo ARE the tracker* — has no external inbox, so the whole
read path is inert and the board shows no issue section. Every other tracker
is the *addition* of an inbox to a system that works without one, which is why
`unsupported` renders nothing rather than an empty list.

#### The gap, restated as a controller

The four controllers above are all **inbox-side**: they answer *what has nobody
decided about?* Nothing answers the inverse — *which plan answers `PROJ-123`?* —
because `meta.issues` is consumed as set membership and discarded (gap 3). That
is not a missing fetch but a missing controller: the same parser run that builds
`referenced` already holds the plan-to-issue mapping and throws away everything
but the keys.

---

### How the read controller behaves

`refreshIssues` in `fleet.ts`, and it already does everything the reactive
section asks of a controller. Worth stating explicitly, because it is the
reference implementation:

- **Rides the PR timer** (`prNextAt`) — *"it asks the same host at the same
  cadence and its cost belongs to the same budget."* One gate, not two.
- **Keeps the last good list on failure.** `entry.issues` is untouched when the
  fetch fails — *"a row vanishing on a fetch error looks like someone planned
  the issue."*
- **Pushes the shared backoff out, extend-only.** A rate limit here moves
  `prNextAt`, so the PR fetch does not immediately re-spend an exhausted budget.
  It never pulls the gate in: a longer backoff another fetch set is a floor the
  host named.
- **Survives a malformed line.** One unparseable row is discarded; the rest
  stand, and the lookup is not called failed.
- **Refuses to answer when the filter cannot be computed.** If the plans cannot
  be read, `referencedIssues` returns null and the whole answer becomes
  `failed` — because the unfiltered list would surface planned issues, and an
  empty one would claim the inbox is clear. *Neither is known*, so neither is
  said.

That last point is the completeness gate from the reactive section, already
implemented, in the one place it was needed first.

### Three genuine gaps

**1. A Jira key is a string; the board types it as a number.**

Verified 2026-08-28. `plot-plan-meta.sh` parses Jira-style `PROJ-123` into
`issues[]` when `Tracker:` names a non-GitHub tracker (#447), and `issue-list`
emits `number: .key` — a string — on the Jira arm. But the board declares:

```ts
IssueRowSchema.number: z.number()
referencedIssues(): Promise<Set<number> | null>
```

So on a Jira repo the filter is `Set<number>.has(string)`, which is **always
false**. Every Jira ticket would stay in the inbox forever, including ones a
plan already cites — and `IssueRowSchema` would reject the row outright.

The adapter and the parser both handle Jira; the board's contract is the layer
that did not follow. The identity type is `string | number`, or a normalized
string throughout.

**Not reachable in this repo** — `Tracker` is unset here, so the GitHub arm runs
and `number` is genuinely a number. It is reachable in any adopting repo that
sets `Tracker: jira` or `linear`, which is a configuration the adapter, the
parser and `plot-config.sh` all document as supported. Untested rather than
broken-in-practice, and worth a test before it is worth a fix.

**2. `ISSUE_LIMIT = 50` truncates silently.**

The list is capped, and a truncated list is presented identically to a complete
one. That is the same absent-is-not-false shape the entity is otherwise
scrupulous about: *"showing 50 of N"* is a different claim from *"there are
50"*. The Jira arm already notes it deliberately does not paginate because the
inbox is small by construction — which is a sound reason to cap and no reason at
all to hide the cap.

**3. The link is one-way: a plan cites a ticket, and nothing links back.**

Verified 2026-08-28. `plot-plan-meta.sh` emits `issues` — every `Issue:`
reference a plan makes — and the board reads it in exactly two places:

```ts
fleet.ts:1680   for (const n of meta.issues ?? []) referenced.add(n);
idea.ts:456     for (const n of meta.issues ?? []) referenced.add(n);
```

Both do the same thing: add the number to a set, use the set to answer *is this
ticket already planned?*, and discard it. **`issues` never reaches
`PlanMetaSchema`, and never reaches `Card`.**

So the relationship exists in one direction only:

| direction | works? | how |
|---|---|---|
| Issue → plan | yes | the ticket VANISHES from the inbox once cited |
| plan → Issue | **no** | nothing on the board says which ticket a plan answers |

The association is modelled purely as a *disappearance*. That is why the entity
reads as clean — the harder direction was never built, so it never went wrong.

**This is where `Tracker: jira` changes the stakes.** Under `Tracker: plot`
(the default — *"plans in this repo ARE the tracker"*) a backlink is a
convenience: the plan is already the record, and the issue number is
provenance. Under `Tracker: jira` the ticket is what the customer, the PM and
the standup all reference — and the board cannot say which plan answers
`PROJ-123`, nor offer a link to it. The plan estate knows; the board drops the
fact one layer before rendering.

Carrying it costs nothing new, and every piece already exists:

- the parser emits `issues`, GitHub `#N` and Jira `PROJ-123` alike (#447)
- both board call sites already parse it, then drop it
- `Tracker: jira https://acme.atlassian.net` carries the base URL as its second
  token, and `tracker_base_url` returns `""` for a bare `jira` — the same
  honest-absence shape `IssueRow.url` uses, where `''` renders as plain text
  rather than a fabricated link
- `IssueRow.url` already proves the board can hold a tracker link honestly

What is missing is `issues` on `PlanMetaSchema` and a link on the plan row —
**no new fetch, and no new URL knowledge.** The link a plan needs is the one
`issue-list` already returned for the same ticket before it left the inbox.

### Invariants

1. **Read-only, at the adapter.** No op writes to the tracker; a plan is Plot's
   record.
2. **An Issue leaves by being referenced**, never by being marked. The exit
   condition lives in the plan estate.
3. **Nothing that mirrors tracker state** joins the model — no labels, assignee,
   status, or priority.
4. **Askability is carried apart from the answer.** Three values, never
   collapsed.
5. **`null` age, never `0`.** Absent is not "just now".
6. **A failed lookup keeps the last good list** and says it is stale.
7. **A tracker link is carried verbatim or not at all.** `''` renders as plain
   text; Plot composes no tracker URL it was not given — the rule
   `AgentRow.pr.url` and `branchUrlBase` already follow.

### Open

- Does an aged, never-planned Issue deserve a signal? `ageMinutes` is carried
  and rendered, but nothing says *this has sat for three weeks*. That is
  arguably the inbox's whole point — and equally arguably the tracker's job.
- Should `issue-view` bodies be cached for the session? One click, one call
  today; a second click on the same ticket asks again.

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

