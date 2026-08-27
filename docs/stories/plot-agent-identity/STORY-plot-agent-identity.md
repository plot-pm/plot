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
running process. Then let dispatch use that identity: a wave says what kind of
agent it needs, and the fleet's capacity stops being one undifferentiated
number.

Two halves of one mechanism. The second is impossible without the first, which
is why they share a story: a role declaration is simultaneously *who this agent
is* and *what it can be dispatched to*.

## Why Now

Comparing Plot against [kraftwerk](https://github.com/NETNODEAG/kraftwerk)
(0.12.0, MIT, NETNODE AG) on 2026-08-27 found one asymmetry that was not a
layer confusion. Kraftwerk's `inspector/team.ts` states the rule Plot has never
written down:

> Definitions are git-tracked project config (like workflows/), not run state.

Plot has only the run state. The registry answers *what is running* with real
precision — eight worker states, batched liveness in one fork per pulse, an
honest `unknown` — and cannot answer *who is running*.

Two facts make that concrete rather than philosophical, both measured in this
repo:

- **`.gitignore:45` excludes `.plot/agents/`** while `.plot/briefs/` beside it
  is tracked. Ten agents ran here on 2026-08-27. By the manifesto's own first
  principle — *"If it's not in git, it doesn't exist"* — none of them do. This
  is the one Plot subsystem outside git, and it fails on the criterion the
  Plot × Kraftwerk RefCard says Plot **wins**: what survives switching the tool
  off.
- **`plot-dispatch.sh:807` reads one global `Worker command`.** Every agent on
  every branch is the same implementer, parameterised only by `PLOT_BRANCH` and
  `PLOT_SESSION_ID`. Its ~1,900-character persona is inlined into the command
  string and duplicated verbatim across all ten live manifests.

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
wave, sprint, branch. An agent is not a piece of work; it is who does one. If
this story establishes that agents need their own term, that term's
relationship to the existing five is a question for the planning-model story,
and it should be raised there rather than settled here.

**Q: What is deliberately not being built?**
Kraftwerk's runtime half — Docker-per-run sandboxing, multi-harness adapters
(`claude`/`codex`/`pi`), the Inspector UI, cron routines. All real and all good,
and rebuilding them puts an in-house tool against an MIT project with npm
distribution. The RefCard's own conclusion is that this is a distribution
fight, not a quality one. Also declined: agents-as-employees with emoji and
routines, which quietly discards Plot's claim to coordinate **people and agents
together**.

## Current Plan

No plans yet — the story is `draft` until the first is interrogated.

Expected shape, in dependency order:

- ⏸️ **A role is a file in git** — a tracked role declaration (name, model,
  effort, tools, command, and the system prompt as the body). A repo declaring
  none keeps exactly today's behaviour via one implicit `default` role built
  from `Worker command`.
- ⏸️ **A wave names the role it needs** — the plan-format half. Carries board
  impact and a Definition-of-Done gate, so it wants proper interrogation.
- ⏸️ **The cap counts by kind** — `budget` becomes a vector; `startable`
  becomes a match rather than a `Math.min`. Refusals name which *kind* of slot
  is exhausted.

## Open Points

- ⏸️ Where does a role declaration live — `.plot/roles/<slug>.md`, or beside
  the briefs it pairs with? The briefs directory is already tracked and already
  per-branch, which may be an argument or a confusion.
- ⏸️ Does a role belong to the **wave** or to the **branch**? A wave is the
  unit dispatch fans out, but a branch is what a worker holds.
- ⏸️ Manifesto Q9 — ceremony scaled to weight. A role file per branch is
  ceremony creep; a handful per repo is not. Where is the line, and should
  anything enforce it?
- ⏸️ Does an unmatched wave **block** or **fall back** to the default role? A
  block is honest and can deadlock; a fallback always dispatches and can run a
  Jenkins wave through a generalist.
- ⏸️ What names the kinds? Free-form strings drift; an enum in a
  project-agnostic skill is exactly the hardcoding the manifesto forbids.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-27 | Agent specs and typed capacity share one story | Capacity depends on the spec mechanism; separately, the capacity story would be mostly a pointer. Confirmed by Jan Wloka. |
| 2026-08-27 | Kraftwerk's runtime layer is out of scope | Sandbox, harness adapters, Inspector, routines are a distribution fight against an MIT/npm project — the RefCard's stated conclusion. |
| 2026-08-27 | Economics gets its own story | Cost and value are a different question with a different failure mode — see [[plot-plan-economics]]. |

## Key Findings

### 2026-08-27 — The board's agent row has no agent in it

**Expected:** Plot's registry lacked some fields Kraftwerk's had, and the gap
was a matter of degree.

**Discovered:** `AgentRowSchema` identifies a row with `repo`, `branch`,
`plan`, `wave`, `sprint`, `version`, `phase`, `pr` — every identifying field
describes **the work**. The only worker-shaped fields are `worker` (a state)
and `worker_activity` (a CPU cue): adjectives with no noun. Kraftwerk's
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

### 2026-08-27 — Undifferentiated slots make a known bug worse

**Expected:** Typed capacity would be new machinery.

**Discovered:** `the-board-says-how-many-workers-are-free` already measured the
failure mode: 7 of 12 slots read busy, 3 genuinely were, and the fleet declined
work it had room for — silently, because the number was rendered nowhere. Five
of the seven were `claude` processes outliving merged PRs.

**Impact:** With one integer, a stale slot blocks anything. With typed slots, a
lingering *developer* process blocks a *Jenkins* wave it could never have
performed — the same defect, more expensive. The fix for stale slots shipped;
typing them raises the cost of any future regression, which is an argument for
building the two together.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| Docker-per-run sandboxing | Runtime concern; Kraftwerk ships it MIT | An agent is dispatched somewhere Plot does not control the machine |
| Multi-harness adapters (codex, pi) | Plot is shaped on Claude Code; `Worker command` is already the seam | A project asks to mix runtimes in one fleet |
| Cron routines / scheduled agents | Agents-as-employees; discards the people-and-agents frame | Never, as stated — revisit only with a case that is not staffing |
| In-band question answering | Kraftwerk models blocked agents as `permission_request`/`permission_resolved` events, answerable without exiting; Plot's `PLOT-BLOCKED.md` requires the worker to have died | The blocked-worker path is reopened — noted so the option is not forgotten |

## Session Log

### 2026-08-27 — Kraftwerk comparison, registry scope

Read kraftwerk 0.12.0 (`src/agent.ts`, `inspector/team.ts`, `okf.ts`,
`harness.ts`, `stats.ts`, `gates.ts`) against Plot `origin/main`
(`server/registry.ts`, `contract/schema.ts`, `plot-dispatch.sh`,
`plot-worker-state.sh`, `auto-dispatch.ts`) and the ten live manifests in
`.plot/agents/`.

Assessment published as an internal artifact; the RefCard
(`plot-kraftwerk-refcard-de.html`, August 2026) supplied the strategic frame and
its conclusions are referenced, not restated.

**Key outcomes:**

- The registry's gap is a missing subject, not missing fields
- `.plot/agents/` being gitignored is a live inconsistency with manifesto
  principle 1, and the only one
- Kraftwerk's `AgentInvocation` splits durable (`systemPrompt`, `model`,
  `tools`, `clis`) from ephemeral (`prompt`); Plot's `Worker command` fuses both
- Typed capacity is cheaper than expected — the cross-pulse budget already exists
- Scope confirmed with Jan Wloka: two stories, this one plus
  [[plot-plan-economics]]

---
