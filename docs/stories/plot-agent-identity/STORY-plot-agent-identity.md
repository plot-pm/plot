---
title: An agent is someone, not something running
author: jwloka
status: draft
created: 2026-08-27
updated: 2026-08-27
---

# An agent is someone, not something running

## Objective

Give a Plot agent an identity that exists **before** it is dispatched and
**survives** the branch it worked on — declared in git, not inferred from a
running process. Then let dispatch use that identity: a slice says what kind of
agent it needs, and the fleet's capacity stops being one undifferentiated
number.

Two halves of one mechanism. The second is impossible without the first, which
is why they share a story: a role declaration is simultaneously *who this agent
is* and *what it can be dispatched to*.

## Why Now

A survey of a comparable agent runtime on 2026-08-27 found one asymmetry that
was not a layer confusion. That runtime separates **agent definitions** from
**run state** as a stated policy: a definition is git-tracked project
configuration, alongside the workflows; what a run did is output, kept
elsewhere.

Plot has only the run state. The registry answers *what is running* with real
precision — eight worker states, batched liveness in one fork per pulse, an
honest `unknown` — and cannot answer *who is running*.

Two facts make that concrete rather than philosophical, both measured in this
repo:

- **`.gitignore:45` excludes `.plot/agents/`** while `.plot/briefs/` beside it
  is tracked. Ten agents ran here on 2026-08-27. By the manifesto's own first
  principle — *"If it's not in git, it doesn't exist"* — none of them do. This
  is the one Plot subsystem outside git, and it fails on the criterion Plot
  otherwise wins on: **what survives switching the tool off.**

  > **Updated 2026-08-28.** The exclusion is now a reasoned decision rather
  > than an oversight — `.gitignore` carries the argument (*"a graveyard shared
  > with everyone who clones rather than a register of what is running"*) and
  > `## Plot Config` gained an `Agent registry` key. **This story's claim
  > narrows accordingly:** the defect is not that manifests are untracked, it
  > is that **nothing declares an agent before one runs.** A run record is
  > correctly machine-local; a role declaration is not a run record.
- **`plot-dispatch.sh` reads one global `Worker command`.** Every agent on
  every branch is the same implementer, parameterised only by `PLOT_BRANCH` and
  `PLOT_SESSION_ID`.

  > **Corrected 2026-08-29.** This bullet read *"its ~1,900-character persona is
  > inlined into the command string"* — **that stopped being true on
  > 2026-08-25**, when [#402](https://github.com/plot-pm/plot/pull/402) moved
  > the prompt into `.plot/worker-prompt.sh`, a **tracked** file that
  > `plot-worker-loop.sh:89` reads (*"a file rather than a config key because
  > plot-config.sh strips `(...)` as prose"*). Verified: `git ls-files` lists
  > it, and the persona string appears **zero** times in `plot-dispatch.sh`.
  >
  > **This shrinks the story's first plan considerably, and sharpens it.** A
  > durable, git-tracked, editable agent prompt already exists — separated from
  > the ephemeral parameters exactly as the survey's durable/ephemeral split
  > recommends. What does not exist is **more than one of it, and a name for
  > it.** The remaining gap is not *"extract the persona"*; it is *"the seam is
  > singular and anonymous."*

The window is that the expensive half is already built. `planAutoDispatch`
holds a concurrency budget **across pulses** — the hard property, since
`--max N` bounds one invocation and two pulses each passing N reach 2N live
workers — and refuses at the cap while naming which branches hold the slots.
Typed capacity is a change to what that budget counts, not to how it is held.

## Decisions Taken in Scoping

**Q: Why one story rather than two — specs and capacity are separable asks?**
They are separable as *plans*, not as intent. Differentiated slots require a
declaration of what an agent can do; that declaration is the agent spec. Split
into two stories, the capacity story's content would be mostly a pointer to the
identity story — which story-tracking names as the signal that a story was not
needed. They stay one umbrella and will be several plans.

**Q: Why not fold this into [[plot-board]]?**
That story asks *where does this work stand* and *what is everything waiting
for* — a surfacing question, and 71 plans claim it. This one changes what an
agent **is** and what dispatch **decides**; the board rendering it is a
consequence, not the point. Filing it there would repeat the mistake that story
itself records, where two plans sat with no `Story:` field because the subject
was assumed from the surface they touched.

**Q: Why not [[plot-planning-model]]?**
That story owns the vocabulary for cutting *work* into pieces — story, plan,
slice, sprint, branch. An agent is not a piece of work; it is who does one. If
this story establishes that agents need their own term, that term's
relationship to the existing five is a question for the planning-model story,
and it should be raised there rather than settled here.

**Q: What is deliberately not being built?**
The surveyed runtime's own half — Docker-per-run sandboxing, multi-harness adapters
(`claude`/`codex`/`pi`), the Inspector UI, cron routines. All real and all good,
and rebuilding them puts an in-house tool against an MIT project with npm
distribution. The comparison's own conclusion was that this is a distribution
fight, not a quality one. Also declined: agents-as-employees with emoji and
routines, which quietly discards Plot's claim to coordinate **people and agents
together**.

## Current Plan

No plans yet — the story is `draft` until the first is interrogated.

**It is also blocked, and by something already scheduled.** This story's
subject is an *entity with an identity kind and a state source*, and
[`the-domain-moves-out-of-the-board`](../../plans/2026-08-28-the-domain-moves-out-of-the-board.md)
constructs exactly that in its **Entities** slice — `Agent`, `Machine` and
`Person` among ten. Writing agent identity before that lands would build the
noun twice, which is the duplication
[stage 2 §5](../the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
forbids. Sprint [[2026-W36-the-domain-is-one-implementation]] carries it.

Expected shape, in dependency order:

- ⏸️ **A role is a file in git** — `.plot/roles/<slug>.md` (name, model,
  effort, tools, command, and the system prompt as the body).

  **Smaller than it was when this story was written.** The durable/ephemeral
  split already exists: `.plot/worker-prompt.sh` is tracked, holds the prompt,
  and is read by `plot-worker-loop.sh:89`. That file **becomes the implicit
  `default` role** rather than being replaced, so a repo declaring no roles
  keeps today's behaviour byte for byte. The plan's real content is the
  *lookup* and the *naming*, not the extraction.

- ⏸️ **A slice names the role it needs** — the plan-format half. Carries board
  impact and a Definition-of-Done gate, so it wants proper interrogation. An
  unmatched name falls back to `default` and says so in the manifest (settled
  above), so this plan can land before any role but `default` exists.

- ⏸️ **The cap counts by kind** — `budget` becomes a vector; `startable`
  becomes a match rather than a `Math.min`. Refusals name which *kind* of slot
  is exhausted.

  **The hard half is already built and must not be rebuilt.** `auto-dispatch.ts`
  holds the concurrency budget **across pulses** — the property that matters,
  since `--max N` bounds one invocation while two pulses each passing N reach
  2N live workers. This plan changes what that budget *counts*, never how it is
  *held*.

## Relation to the fleet domain design

**This story's subject now has a specification.**
[DESIGN-agent.md](../the-master-agent-holds-the-fleet/DESIGN-agent.md) models Agent as a domain object, and two
of its findings are this story's thesis stated as measurements:

- **Agent's identity is *minted*, and its failure mode is *nobody minting*** —
  one of [three kinds of identity](../the-master-agent-holds-the-fleet/DESIGN-review.md#1-identity-three-kinds),
  each with its own way of going wrong. Measured: **0 manifests, 13 worktrees**
  — every agent row the board shows is *synthesized* from a worktree, because
  nothing declares an agent.
- **`readAgentRegistry` only reads.** Agents are created by `start_worker`
  inside `plot-dispatch.sh`, at two call sites. **A registry that cannot mint
  is the gap this story is about**, located precisely.

**Read the spec before writing plans under this story**, and reference it rather
than re-deriving the entity — two descriptions of one object is the defect the
[workflows review](../the-master-agent-holds-the-fleet/DESIGN-review-workflows.md#5-the-distinction-that-decides-it)
names: a copy that re-implements a decision, rather than deriving one.

## Open Points

- ✅ ~~Where does a role declaration live?~~ **Settled 2026-08-29 by what is
  already there.** `.plot/` is not machine-local — `.gitignore:20` says so
  outright (*"the rest of `.plot` is project content"*), and git tracks **203
  briefs**, `.plot/templates/plan.md` and `.plot/worker-prompt.sh`. Only
  `.plot/agents/` and `.plot/state/` are excluded, both run records.

  So a role goes in **`.plot/roles/<slug>.md`**, beside the other tracked
  project content, and `worker-prompt.sh` becomes the implicit `default` role
  rather than being replaced. The briefs directory was the alternative and is
  wrong: a brief is **per-branch and consumed once**, a role is **per-repo and
  reused** — filing them together would put a thing that outlives every branch
  into a directory whose contents are all dead on merge.

- ✅ ~~Does a role belong to the **slice** or to the **branch**?~~ **Dissolved
  2026-08-28** by the Slice/Wave rename: a **slice holds exactly one branch by
  definition**, so the two are the same attachment point. A plan section naming
  several branches is an unsliced plan, not a slice with many. See
  [Slice §1](../the-master-agent-holds-the-fleet/DESIGN-slice.md#one-branch-by-definition--not-by-repair).

- ✅ ~~Manifesto Q9 — where is the ceremony line?~~ **Settled 2026-08-29: a repo
  with no roles must behave exactly as today.** The line is not a count of
  files, it is the **default**. `worker-prompt.sh` already supplies one implicit
  role, so *zero* declared roles is the current behaviour and costs nothing;
  ceremony only begins when someone writes the second file, and only that person
  pays it.

  This is the same shape as `## Plot Config` itself: absent keys mean defaults,
  so an adopting project pays for what it declares and nothing else. A per-branch
  role file would be creep — and the settled attachment point above prevents it,
  since a role is per-repo by construction.

- ✅ ~~Does an unmatched slice **block** or **fall back**?~~ **Settled
  2026-08-29: it falls back, and says so.** Blocking is the honest answer to
  *"is this the right agent?"* and the wrong answer to *"should the fleet
  stop?"* — a typo in a role name would deadlock a wave with no ref, no PR and
  no marker, which is the one failure shape the estate cannot see.

  **The measurement is `plot-fleet-scan.sh --next`, which exits 1 for "nothing
  claimable" and is a NORMAL state.** A slice blocked on an unresolvable role
  is indistinguishable from that, so the block would be invisible in exactly
  the tool an operator uses to find out why nothing started.

  So: dispatch with the default role and **name the fallback in the manifest**,
  making it a visible fact rather than a silent substitution. A fleet that keeps
  moving and reports the mismatch beats one that stops and cannot say why.

- ✅ ~~What names the kinds?~~ **Settled 2026-08-29: nothing in Plot does.**
  Free-form slugs, defined per repo, exactly as branch prefixes and phases
  already are. An enum shipped in a project-agnostic skill is the hardcoding
  Manifesto Principle 4 forbids — *"Plot contains zero hardcoded project names,
  paths, or configuration"* — and any enum would be wrong for the second
  adopter.

  **Drift is the accepted cost, and it is bounded by the fallback above:** an
  unrecognised name dispatches the default and reports the mismatch, so a typo
  costs a note rather than a stall. What Plot supplies is the *mechanism* to
  declare and match; which kinds exist is the adopting project's vocabulary,
  and its `## Plot Config` is where it already keeps that.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-27 | Agent specs and typed capacity share one story | Capacity depends on the spec mechanism; separately, the capacity story would be mostly a pointer. Confirmed by Jan Wloka. |
| 2026-08-27 | The surveyed runtime's execution layer is out of scope | Sandbox, harness adapters, a separate inspector UI and cron routines are a distribution fight against a shipping MIT/npm project. |
| 2026-08-27 | Economics gets its own story | Cost and value are a different question with a different failure mode — see [[plot-plan-economics]]. |
| 2026-08-29 | Roles live in `.plot/roles/`, not beside briefs | `.plot/` is tracked project content by its own `.gitignore` comment (203 briefs, the plan template, `worker-prompt.sh`); only run records are excluded. A brief is per-branch and dead on merge, a role is per-repo and reused. |
| 2026-08-29 | An unmatched role falls back to `default` and reports it | A block would be invisible: `--next` exits 1 for "nothing claimable" as a NORMAL state, so a role typo would deadlock a wave indistinguishably from an idle fleet, with no ref, PR or marker to find. |
| 2026-08-29 | Plot ships no vocabulary of agent kinds | An enum in a project-agnostic skill is the hardcoding Manifesto Principle 4 forbids, and would be wrong for the second adopter. Drift is bounded by the fallback: a typo costs a note, not a stall. |
| 2026-08-29 | The story waits on the domain sprint | Agent, Machine and Person are constructed as entities by `the-domain-moves-out-of-the-board`; writing them here first would build the noun twice. |

## Key Findings

### 2026-08-27 — The board's agent row has no agent in it

**Expected:** Plot's registry lacked some fields the comparison had, and the gap
was a matter of degree.

**Discovered:** `AgentRowSchema` identifies a row with `repo`, `branch`,
`plan`, `slice`, `sprint`, `version`, `phase`, `pr` — every identifying field
describes **the work**. The only worker-shaped fields are `worker` (a state)
and `worker_activity` (a CPU cue): adjectives with no noun. The comparison's
`TeamMember` carries `slug`, `name`, `emoji`, `harness`, `model`, `effort`,
`tools`, `workflows`, `knowledge`, `skills`.

Plot's `registry.ts` already *declares* the ambition in its own docstring —
*"a branch is what an agent is working on, never what it is"* — and cannot
deliver it: `synthesizeEntry()` sets `session: ''` for any worktree without a
manifest, and those entries sort last because the registry "knows least about
them".

**Impact:** The gap is ontological, not incremental. Plot models the predicate
with precision and has no subject to attach it to. That reframes the work from
"add fields" to "introduce a noun".

### 2026-08-29 — Half of the first plan already shipped, unnoticed

**Expected:** The durable persona was fused into `Worker command` as a
~1,900-character inline string, and extracting it was the first plan's main
content.

**Discovered:** It was extracted on 2026-08-25 by
[#402](https://github.com/plot-pm/plot/pull/402), for an unrelated reason — a
worker loop needed a prompt too long for `plot-config.sh`, which *"strips
`(...)` as prose"*. `.plot/worker-prompt.sh` is **tracked**, holds the whole
persona, and is read at `plot-worker-loop.sh:89`. The string appears **zero**
times in `plot-dispatch.sh`.

So Plot already has the durable/ephemeral separation the survey named as the
asymmetry — a git-tracked, editable system prompt, distinct from the runtime
parameters. It arrived as a side effect of a shell-quoting constraint.

**Impact:** The first plan shrinks from *"extract the persona"* to *"the seam
is singular and anonymous"* — give the existing file a name, allow a second,
and match slices to it. **And the story needed correcting**, because a claim
that was true when written had become false, and a plan written from it would
have re-extracted something already extracted. This is the second measured case
in this repo of a brief specifying work that had already merged.

### 2026-08-27 — Undifferentiated slots make a known bug worse

**Expected:** Typed capacity would be new machinery.

**Discovered:** `the-board-says-how-many-workers-are-free` already measured the
failure mode: 7 of 12 slots read busy, 3 genuinely were, and the fleet declined
work it had room for — silently, because the number was rendered nowhere. Five
of the seven were `claude` processes outliving merged PRs.

**Impact:** With one integer, a stale slot blocks anything. With typed slots, a
lingering *developer* process blocks a *Jenkins* slice it could never have
performed — the same defect, more expensive. The fix for stale slots shipped;
typing them raises the cost of any future regression, which is an argument for
building the two together.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Docker-per-run sandboxing | Execution concern, and shipped MIT elsewhere | An agent is dispatched somewhere Plot does not control the machine |
| Multi-harness adapters (codex, pi) | Plot is shaped on Claude Code; `Worker command` is already the seam | A project asks to mix runtimes in one fleet |
| Cron routines / scheduled agents | Agents-as-employees; discards the people-and-agents frame | Never, as stated — revisit only with a case that is not staffing |
| In-band question answering | The comparison models a blocked agent as a permission-request event answerable without exiting; Plot's `PLOT-BLOCKED.md` requires the worker to have died | The blocked-worker path is reopened — noted so the option is not forgotten |

## Session Log

### 2026-08-27 — runtime comparison, registry scope

Read a comparable agent runtime's sources — its agent, team, knowledge,
harness, stats and gate modules — against Plot `origin/main`
(`server/registry.ts`, `contract/schema.ts`, `plot-dispatch.sh`,
`plot-worker-state.sh`, `auto-dispatch.ts`) and the ten live manifests in
`.plot/agents/`.

**The comparison itself is kept outside this repository, deliberately.** Its
conclusions are carried here as arguments about Plot; the survey and the
strategic frame that followed it live as internal artifacts and are referenced,
not restated.

**Key outcomes:**

- The registry's gap is a missing subject, not missing fields
- `.plot/agents/` being gitignored is a live inconsistency with manifesto
  principle 1, and the only one
- The comparison's agent-invocation type splits durable (`systemPrompt`, `model`,
  `tools`, `clis`) from ephemeral (`prompt`); Plot's `Worker command` fuses both
- Typed capacity is cheaper than expected — the cross-pulse budget already exists
- Scope confirmed with Jan Wloka: two stories, this one plus
  [[plot-plan-economics]]

---
