---
title: Plan — domain object specification
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# Plan — domain object specification

Plot's solution-space artefact, and the entity everything else is derived
around.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Companions:** [The fleet's domain entities](DESIGN-entities.md) ·
> [Issue](DESIGN-issue.md) · [Story](DESIGN-story.md)

## Contents

| § | section | answers |
|---|---|---|
| 1 | [What a Plan is](#1-what-a-plan-is) | solution space; why the file is the truth |
| 2 | [Posture](#2-posture) | what each `Tracker:` makes of a plan |
| 3 | [The domain object](#3-the-domain-object) | **the normative spec** |
| 4 | [Lifecycle](#4-lifecycle) | seven states, five on the path and two terminal |
| 5 | [Relations](#5-relations) | Story · Issue · Sprint · Wave · Branch · PR |
| 6 | [Actions](#6-actions) | idea · approve · implement · deliver · release |
| 7 | [Scope](#7-scope) | which plans are shown, and the rolling window |
| 8 | [The collaborators](#8-the-collaborators) | the parser is the contract |
| 9 | [Fleet control](#9-fleet-control) | the one entity the CLI serves well |
| 10 | [Views](#10-views) | card · row · wave · plan head |
| 11 | [Setup](#11-setup) | what adoption declares |
| 12 | [Gaps](#12-gaps) | |
| 13 | [Invariants and open points](#13-invariants-and-open-points) | |

---

## 1. What a Plan is

**A Plan describes the solution: how *this system* should change, in which
steps, and to what standard.**

The Story spec states the pair; this is its other half:

| | Story — problem space | **Plan — solution space** |
|---|---|---|
| asks | what problem, and how should software help | **how should this system change** |
| carries | the problem · desired qualities · workflow | **the change · the steps to land it · this solution's NFRs** |
| is true | independently of any system | **only of the system it targets** |
| outlives | implementations | **nothing — it ends at its release** |

The template enforces it: `Motivation` is one section, against `Design` plus
`Branches`. A plan has barely anywhere to put a problem, and that is deliberate.

### The file is the truth

**Manifesto Principle 1, and the whole of Plot rests on it.** A plan is a
markdown file on a branch; git is the source of truth. There is no plan
database, no plan API, and no cached plan state — every consumer re-parses the
file.

Two consequences that recur through this document:

- **The parser is the contract** (§8). `plot-plan-meta.sh` is the single
  definition of what a plan file means, and everything else — board, scan,
  gates, sprint tooling — reads plans through it.
- **A record is written when the fact becomes true.** `Approved:`, `Started:`,
  `Delivered:`, `Released:` are transition records, not decorations, and the
  scan reads its rolling window from `Delivered:` rather than from a directory.

### A plan is a unit of *one decision*

The Story spec's umbrella hierarchy places it: a well-described ticket holds
implement-as-described work; a **plan** holds a bounded, clearly-scoped piece;
a story holds what spans plans.

*"In repos where plot is the tracker, an implementation slice is a plan, full
stop."*

---

## 2. Posture

| posture | what a Plan is |
|---|---|
| **`plot`** (default) | **the record.** The plan file is the truth; the tracker, if any, sees a published summary |
| **`jira` leads** | a **projection** — the plan *is* a feature/bug/task ticket, and the MD file is written when the ticket updates |

**Posture 2's publishing act is already specified from the Issue side**: an
approved plan publishes a feature ticket carrying a content summary, at *Plans
approved* — *"only now, because the cut now holds."*

**Posture 3 inverts Principle 1 for the plan estate**, and unlike the Story's
case there is no narrative objection: a plan's content — motivation, design,
branches — maps onto a ticket reasonably well. What it loses is the *estate*:
the reconcile scan, the phase gate, the fleet's whole derivation read plan
files, and a projection means they read a copy whose freshness nothing
guarantees.

That is why posture 3 remains named-but-unbuilt in all three specs: it is not a
configuration, it is a second implementation of everything downstream of the
plan file.

---

## 3. The domain object

The normative shape, as `plot-plan-meta.sh` defines it. **This section describes
an existing contract rather than proposing one** — the parser is authoritative
and this is its reading.

### Identity

```
Plan.file : path
```

The file path, and nothing else. A plan has **no slug field**: the slug is a
convention read out of the filename (`YYYY-MM-DD-<slug>.md`), and consumers
resolve a slug to a file by trying the dated name, then `active/`, then
`delivered/` — the precedence `plot-approve.sh`, `plot-deliver.sh`,
`plot-dispatch.sh` and `plot-fleet-scan.sh` all share.

**The index directories are not identity.** A plan with no symlink is a valid
plan; `/plot-deliver` treats the index move as best-effort for exactly this
reason.

### Fields

| field | type | source | note |
|---|---|---|---|
| `file` | path | — | identity |
| `format` | string | — | which spelling the file uses |
| `phase` | 7 values | `## Status` or front matter | see §4 |
| `phase_raw`, `phase_alt`, `phase_alt_raw` | string | — | **two phases in one file is a real state** |
| `type` | `feature`\|`bug`\|`docs`\|`infra` | | decides whether release applies |
| `title` | string | front matter or first H1 | |
| `sprint`, `story`, `assignee` | string | | placement; `""` when absent or a placeholder |
| `issues[]` | numbers | `Issue:` | the signals this plan answers |
| `branches[]` | strings | `## Branches` **or** `## Waves` | both dialects, one array |
| `waves[]` | objects | `## Waves` | name, verdict, branches |
| `prs[]` | numbers | `→ #N` **or** `PR: #N` | evidence |
| `malformed_prs[]` | strings | | near-misses, **reported not dropped** |
| `changelog[]` | strings | `## Changelog` | **the one field that says what a plan changes** |
| `review`, `impl` | normalized | ceremony answers | how it is approved, where it is built |
| `approved_raw`, `started_raw`, `delivered_raw`, `released_raw`, `design_raw` | string | transition records | **load-bearing** |
| `long_wave_names[]` | strings | | a report, not a refusal |
| `rounds`, `error` | | | |

### Three parser rules worth lifting

These are decisions, not implementation details, and they generalize:

**1. A citation is not a claim.** A backticked branch name outside a list item —
mid-sentence, in a blockquote, on a wrapped line — claims nothing. *"Plans name
each other branches to declare dependencies, and doing so must not claim
them."*

**2. A near-miss is reported, never dropped.** `malformed_prs` carries `→#NNN`
(no space) verbatim, because *"no annotation is a claim the sweep acts on, so a
typo that reads as absence sends a human to add an annotation already
present."*

**3. Absent contributes nothing — not `""`, not `0`.** The rule `Issue:` and
`prs` both follow, and the one this whole design keeps rediscovering.

### Fields deliberately excluded

| excluded | why |
|---|---|
| a slug field | derived from the filename; a second copy would drift |
| plan → story back-reference | the plan declares `Story:`; the story does not list plans |
| branch state | git's, read per pulse — a plan says which branches, never how they are doing |
| progress % | a plan's progress is its waves' verdicts, derived |

---

## 4. Lifecycle

### Seven states, five on the path and two terminal

**Corrected twice, 2026-08-28.** An earlier draft listed the parser's seven
values against CLAUDE.md's four and called the difference a defect. A second
draft split them into "phases" and "terminal outcomes" — two kinds of thing.
**Both were over-modelled: they are simply states.**

A plan is a state machine with seven states. Five have outgoing transitions;
two do not. That is an ordinary property of a state machine, not a type
distinction.

```
draft ──► design ──► approved ──► delivered ──► released
  │          │           │
  ▼          ▼           ▼
rejected  rejected   superseded
```

| state | outgoing transitions | means |
|---|---|---|
| `draft` | approve · reject | written, not yet agreed |
| `design` | approve · reject | a spike still answering whether the approach works |
| `approved` | deliver · supersede | agreed; implementation may start |
| `delivered` | release | every non-deferred branch merged |
| `released` | — | shipped under a version |
| `rejected` | — | **terminal** |
| `superseded` | — | **terminal** — overtaken by another plan |

**"Phase" is the wrong word**, and it is why `superseded` looked anomalous in
the earlier drafts. A *phase* implies ordered progression, so a state off the
main line reads as a violation of it. As **states**, nothing is anomalous —
`superseded` is reachable, terminal, and used.

The field is named `phase` and stays named `phase`: it is the plan format's
established spelling, and renaming a parsed field to fix a conceptual
imprecision would break every plan in every adopting repo. **The word in the
file is `Phase:`; the thing it holds is a state.**

**The board's five columns are not states at all.** They are a display
partition, mapping several states onto one column, and `plot-board-setup` warns
against gating on their names — *"a gate naming those strings would fail on a
healthy board"* — since they have already been renamed once.

### What the estate actually holds

Measured across 158 files 2026-08-28:

| state | count | |
|---|---|---|
| `released` | 113 | |
| `delivered` | 31 | |
| `approved` | 5 | |
| `superseded` | 3 | terminal |
| `draft` | 3 | |
| `design` | **0** | declared, never used |
| `rejected` | **0** | declared, never used |
| *(no `Phase:`)* | 3 | not plans — decision logs, worker reports |

**Two states are reachable in the tooling and unreached in the estate.**
`design` is gated on by `/plot-implement` and parsed as `design_raw`; `rejected`
is a documented terminal state. Neither has ever been used here.

That is worth knowing rather than fixing: a state machine may legitimately
carry states a given estate has not needed. What it does mean is that both are
**untested transitions** — and `delivered → released` was in exactly that
condition until recently, when it turned out that a phase flip without the
`Delivered:` record made a plan invisible to the scan.

**And `superseded` is used but undocumented.** CLAUDE.md names four states, so a
contributor has no vocabulary for a plan that was overtaken — the value is being
applied from the parser rather than from the documentation.

### Two states in one file is a modelled condition

`phase_alt` exists because a file can carry both front-matter `status:` and a
`## Status` `Phase:`. The parser reports both rather than picking — an
ambiguity surfaced, not resolved. A plan in that condition has no single state,
and the parser declines to invent one.

### The transitions are gates

| transition | gate |
|---|---|
| Draft → Approved | a reviewed plan, through its declared `Review:` channel |
| Approved → *started* | staleness preflight; branch claimed by ref push |
| → Delivered | **every non-deferred branch merged** |
| → Released | the sprint gate, then a tag containing the merge commit |

**And one is enforced as a hook rather than prose**: `plot-phase-gate.sh` blocks
implementation commits while the governing plan is Draft — reading the plan from
`origin/<main>`, never the working tree, because *"an approval nobody else can
see is not one."*

---

## 5. Relations

The Plan is the hub: every other entity relates to it, and most relate *through*
it.

| relation | direction | mechanism | state |
|---|---|---|---|
| Plan → **Story** | plan declares | `Story: <slug>` | **built** |
| Plan → **Issue** | plan declares | `Issue: #N` | **built, one-way** (Issue §13 gap 3) |
| Plan → **Sprint** | plan declares | `Sprint: <slug>` | **built** |
| Plan → **Wave** | contains | `## Waves` headings | **built** |
| Wave → **Branch** | contains | `Branch:` in a heading | **built, 1:1 intended** |
| Branch → **PR** | annotation | `→ #N` | **built** |
| Plan → **Release** | record | `Released:` + git tag | **built** |

**Every one of these is declared by the plan and derived by everyone else.**
That is the estate's organizing choice: a sprint does not list its plans, a
story does not list its plans, a release does not list its plans — they are all
recomputed by reading every plan file.

**The cost is a full-estate parse**, and it is measured: 132 ms for 59 plans in
one batched invocation. The benefit is that no copy can drift, which is the
lesson this repo has learned repeatedly and expensively.

**One wave, one branch** is the model settled 2026-08-21 — *plan → \* wave →
1 branch* — and the estate disagrees: 49 waves hold one branch, 8 hold more, 7
of those 8 already complete. `unsliced-wave` is the reported defect.

---

## 6. Actions

The lifecycle *is* the action set, and each is a spoke command:

| action | command | what it writes |
|---|---|---|
| **Create** | `/plot-idea` | the plan file, Draft, with ceremony answers |
| **Challenge** | `challenge-the-plan` | open questions woven into the plan |
| **Approve** | `/plot-approve` → `plot-approve.sh` | phase flip, `Approved:`, holds cleared, PR merged |
| **Implement** | `/plot-implement` | branch claimed, brief written, `Started:` |
| **Dispatch** | `/plot-dispatch` | worktree + worker per eligible branch |
| **Deliver** | `/plot-deliver` → `plot-deliver.sh` | phase flip, `Delivered:`, index moved |
| **Release** | `/plot-release` | tag, `Released:`, sprint gate |
| **Reslice** | `/plot-reslice` | rewrites `## Branches` only, after a person confirms |

**The mechanical halves are scripts; the judgement stays in the skills** —
Principle 3, and the split is explicit: `plot-approve.sh` merges, flips, fills,
clears and pushes, while the skill decides whether a draft is *ready*.

**Two entrances, one implementation.** The board's Approve button and
`/plot-approve` both call `plot-approve.sh`, so a project declaring an
`Approve command` cannot get a second path to the same outcome.

**Idempotency is the pattern.** `plot-approve.sh` and `plot-deliver.sh` both
perform an irreversible write partway through, so *"re-running is the repair"* —
every step tests the source it would have written, never a progress file.

---

## 7. Scope

**Which plans are shown depends on who is asking**, and the two answers differ
deliberately:

| consumer | scope | why |
|---|---|---|
| the board | every plan file | a board shows the estate |
| the fleet scan | active plans **+ a rolling window of delivered ones** | a delivered plan's branches stop being actionable |
| `referencedIssues` | **every plan file, always** | a decision does not expire (Issue §8) |

**The rolling window reads `Delivered:`**, not the directory — which is why a
phase flip without the record makes a plan invisible to the scan. Measured
2026-08-20: zero plans reported for a plan in exactly that state.

**A file with no `Phase:` is not a plan.** `docs/plans/` also holds decision
logs and worker reports; three such files exist here, and every consumer applies
the same rule — *the parser's own answer decides*.

---

## 8. The collaborators

**One, and it is the contract**: `plot-plan-meta.sh`.

Unlike Issue (four collaborators, because it is foreign) and Story (none,
because it is local prose), Plan has exactly one — a parser that every other
component reads plans through.

| what reads plans | through the parser? |
|---|---|
| the board | yes |
| `plot-fleet-scan.sh` | yes |
| `plot-reconcile-scan.sh` | yes |
| `plot-approve.sh` / `plot-deliver.sh` | yes |
| `plot-sprint-release.sh` / `-candidates.sh` | yes |
| `plot-phase-gate.sh` | yes |

**That is the strongest single design decision in the estate.** One definition
of what a plan file means, tested by `pnpm run test:reconcile`, so a format
change is one edit and one test suite rather than a hunt through eight readers.

**No monitor, no connector, no writer** — the file is local and the writes are
the spoke commands'.

---

## 9. Fleet control

**Plan is the one entity the CLI serves better than the board**, which inverts
the pattern Issue and Story both show.

| capability | CLI | board |
|---|---|---|
| parse a plan | `plot-plan-meta.sh` | via the same |
| which plan governs this branch | `plot-context.sh` | — |
| wave/claim state | `plot-fleet-scan.sh` | consumes its pulse |
| drift across the estate | `plot-reconcile-scan.sh` | — |
| merge order + collisions | `plot-merge-queue.sh` | — |
| deliverable plans | `plot-impl-status.sh` | — |
| sprint contents | `plot-sprint-release.sh` | consumes |

**A master agent is well equipped here and poorly equipped for Issue and
Story.** That asymmetry is not arbitrary: plans are what the fleet acts on, so
the tooling grew where the acting happens.

---

## 10. Views

| view | where | shows |
|---|---|---|
| **card** | a board column | title, type, waves, PRs, sprint, story |
| **plan head** | grouped fleet rows | the plan above its waves, with actions |
| **wave row** | fleet | one wave, its verdict, its branches |
| **branch row** | fleet | state, worker, PR, age |
| **plan page** | `/plan/<file>` | the file, rendered |

**The plan appears in more views than any other entity**, because it is what
every section groups by. `PlanActions` opens on `canOpen`, not on `willAct` —
an action that will be refused still renders, so the refusal can name itself.

---

## 11. Setup

Plans are what `/plot-init` exists to establish, and its keys are the
best-covered of any entity:

| key | default |
|---|---|
| `Plan directory` | `docs/plans/` |
| `Active index` / `Delivered index` | `docs/plans/active/`, `delivered/` |
| `Plan template` | the shipped template |
| `Branch prefixes` | `idea/, feature/, bug/, docs/, infra/` |
| `Plan PRs` | `optional` |
| `Hosts plans` | `yes` |
| `Implementation home` | `this repo` |

**Adoption is additive and never rewrites plans.** `/plot-board-setup` reports
which files parse as `format: none` and why — *"report only. Never rewrite the
user's plans."*

---

## 12. Gaps

| # | gap | reachable |
|---|---|---|
| 1 | **Outcomes are undocumented** — `superseded` is used by 3 plans and named nowhere in CLAUDE.md; `design` is a real phase the four-phase list omits | **now** |
| 2 | **Plan → Issue is one-way** — `issues[]` is parsed, consumed as a set membership test, and never surfaced | **now** (Issue §13) |
| 3 | **`unsliced-wave`** — 8 waves hold several branches against a 1:1 model | now, reported |
| 4 | **`docs` type unused** — 0 of 158; either it is dead or docs plans are being mistyped | cosmetic |
| 5 | **`plot-reap.sh` reads `mergedAt` via `gh` directly**, bypassing the host adapter | now |

**Gap 1 is documentation, not code.** The parser and the board are both right;
what is missing is that CLAUDE.md names four phases without naming the two
terminal **outcomes** a plan can end in, or the `design` phase between Draft and
Approved. A contributor has no vocabulary for a plan that was overtaken — and
three plans are in exactly that state.

---

## 13. Invariants and open points

### Invariants

1. **The file is the truth.** Every consumer re-parses; nothing caches plan
   state.
2. **The parser is the contract.** One definition, read by every component.
3. **A citation is not a claim.** A branch named in prose claims nothing.
4. **A near-miss is reported, never dropped.**
5. **Absent contributes nothing** — not `""`, not `0`.
6. **Transition records are load-bearing**, not provenance — the scan's window
   reads `Delivered:`.
7. **A file with no `Phase:` is not a plan.**
8. **The index is convenience**; a plan with no symlink is valid.
9. **Re-running a transition is the repair** — every step tests the source, not
   a progress file.
10. **A plan declares its relations; nothing lists its plans.**

### Open points

- **Should CLAUDE.md name the outcomes and `design`?** Four phases plus two
  terminal outcomes is the honest model; the current text implies the four are
  everything.
- **Is `design` premature?** Declared, gated on by `/plot-implement`, parsed as
  `design_raw`, and used by zero plans.
- **Is `docs` a dead type?** Zero of 158 plans use it.
- **Where do a plan's qualities go?** The template has no NFR section, so they
  land in `Design` or `Done when` by improvisation (Story §1).
- **Does the one-wave-one-branch model get enforced or relaxed?** Eight waves
  disagree with it and seven of those already shipped.
