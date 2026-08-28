---
title: The Plot domain — review, stage 2: the workflows
story: the-master-agent-holds-the-fleet
author: jwloka
status: draft
created: 2026-08-28
updated: 2026-08-28
---

# The Plot domain — review (stage 2: the workflows)

Stage 1 asked what the entities *are*. This asks what the estate *does* with
them — and where the doing has to be cut for the domain to separate from git,
the filesystem and the host **entirely**.

> **Story:** [The master agent holds the fleet](STORY-the-master-agent-holds-the-fleet.md)
>
> **Stage 1:** [The domain model](DESIGN-review.md)

## Contents

**Stage 2 of three: the workflows.**

| § | section |
|---|---|
| 1 | [The one cut, stated once](#1-the-one-cut-stated-once) |
| 2 | [The estate found this rule twice by itself](#2-the-estate-found-this-rule-twice-by-itself) |
| 3 | [The split, per workflow](#3-the-split-per-workflow) |
| 4 | [Where the same rule lives twice](#4-where-the-same-rule-lives-twice) |
| 5 | [The distinction that decides it](#5-the-distinction-that-decides-it) |
| 6 | [Transitions become methods](#6-transitions-become-methods) |
| 7 | [The new workflows fit the same shape](#7-the-new-workflows-fit-the-same-shape) |
| 8 | [What this costs and what it buys](#8-what-this-costs-and-what-it-buys) |
| 9 | [What is unresolved](#9-what-is-unresolved)  |

---

## 1. The one cut, stated once

**The domain holds what a workflow DECIDES. The adapter holds what it TOUCHES.**

That is the whole rule, and stage 1 already gave it its enforcement clause:
**an adapter may not decide.** Stage 2's job is to apply it to nine workflows
and see where it does not fit.

**It fits almost everywhere**, which is the finding — the estate is much closer
to this shape than a 14,133-line shell tree and a 19,110-line board suggest.
What it lacks is the *name*, and a rule with no name gets rediscovered rather
than applied.

---

## 2. The estate found this rule twice by itself

**Two board modules independently arrived at the split and argued for it in
their own prose, without either citing the other or naming it.**

`approve.ts`, on why the board spawns the script rather than reimplementing it:

> *"A second copy of a security decision is a second place for it to be
> weakened."*

`auto-deliver.ts`, on why the board never writes a phase:

> *"Grep this package for a phase write and find nothing. That absence is the
> design."*

**That second one is a gate, not a rule** — in exactly the sense CLAUDE.md
means. The question *did I avoid writing a phase here?* is answered by a grep
over the package, not by an author's recollection. **Verified 2026-08-28:
`grep -rn "Phase: Delivered\|Phase: Approved" packages/board/src/server/*.ts`
returns 0 outside comments.** The invariant holds.

**Two modules reaching the same conclusion separately is the argument for
naming it once.** Both got it right; neither could have gotten it right by
reading the other, because neither says it is a general rule.

---

## 3. The split, per workflow

**Nine workflows. The left column is already pure; the right column is already
a script.**

| workflow | the domain DECIDES | the adapter PERFORMS |
|---|---|---|
| **approve** | phase is Draft/Design · channel is satisfiable · which records to write | merge the PR · write the file · push |
| **implement** | is the plan stale · which branch is next · what the brief must say | create the branch · push the claim |
| **dispatch** | which slices are eligible · which branches are free · the four refusals | `worktree add` · spawn a worker |
| **deliver** | every non-deferred branch merged · phase is Approved | flip the file · move the symlink · push |
| **release** | the sprint gate's three tiers · version from `--contains` | tag · changesets · push |
| **reap** | do the five refusals pass | `worktree remove` |
| **reslice** | the argued slice order | rewrite `## Branches` |
| **merge-queue** | the order and the collisions | `git merge-tree` |
| **fleet pulse** | slice verdicts · claim state | 115 git processes |

**Every decision in the left column is a predicate over facts.** None needs a
subprocess to *decide* — only to *learn*. That is what makes the separation
tractable rather than a rewrite.

### The refusals are the domain, and they are already isolated

**`plot-reap.sh` refuses on five measurements; `plot-dispatch.sh` on four.**
Both scripts say so in their own comments — *"THE REFUSALS ARE THE FEATURE"*,
*"refuses on five MEASUREMENTS rather than a judgement"*.

**A refusal over a measurement is a pure function of facts.** `is there a live
pid`, `is the tree dirty`, `is there a marker`, `is there a merged PR` — four
booleans and a verdict. **That is a domain rule that happens to be written in
shell**, and moving it costs nothing semantically.

---

## 4. Where the same rule lives twice

**One workflow breaks the pattern, and it is the one the estate depends on
most.**

### The deliver rule has two implementations

| | shell | board |
|---|---|---|
| **where** | `plot-deliver.sh:120–215` | `board.ts:707 allWavesMerged` |
| **size** | ~95 lines | 27 lines |
| **asks** | **each PR's state** via `plot-impl-status.sh` | **each slice's verdict** from the pulse |
| **parses the plan** | itself, with `sed` + `grep` + a prefix regex | not at all — reads the pulse |
| **values** | merged / not-merged | merged / not-merged / **`unknown`** |
| **call sites** | 1 | **3** (`auto-deliver` ×2, `planStatus`, `deliver`) |
| **tested by** | e2e sandbox: `mkdtemp` + bare `git init` + working repo + stubbed host | a fixture object |

**They are not two spellings of one rule. They are two different rules that
usually agree.**

- The shell asks **per PR**; the board asks **per slice verdict** — and
  `allWavesMerged` says so explicitly: *"THE SCAN'S VERDICT, not a second
  reading of the branch states under it."*
- The board has a third value the shell cannot express. **`unknown` exists
  because of a measured defect** (#491): a plan missing from a timed-out
  pulse's `plans` array was read as a claim about its branches. **The shell has
  no equivalent guard.**
- The board catches vacuous truth — *every slice complete over no branches* —
  with a `merged > 0` count. **The shell's loop over an empty branch list falls
  through to "proceeding (nothing to verify)".**

### They have separate bug histories, which is the proof

**The shell copy carries a measured bug the board copy could never have**: a
`## Changelog` bullet mentioning a backticked identifier was parsed as a
branch, and **four fully-merged plans were undeliverable** until the branch
prefix test was added. That bug is a *parsing* bug — and the board copy does
not parse, because the pulse already did.

**One rule cannot have two bug histories. Two rules can.**

---

## 5. The distinction that decides it

**The estate also contains a duplication that is correct, and the contrast is
what makes the rule usable.**

`planSlug` exists twice — in `auto-deliver.ts` and `auto-dispatch.ts` —
byte-identical, one line, and the comment argues *for* the copy:

> *"A private twin rather than an import, deliberately kept byte-identical: the
> two modules are independent actors on the same clock, and a shared helper
> would make one able to break the other's slug resolution."*

**That is a defensible copy and the deliver rule is not.** The difference is
not size or intent — it is what the copy *is*:

| | `planSlug` | the deliver rule |
|---|---|---|
| relationship | **a derivation** — same inputs, same output, provably | **a re-implementation** — different inputs, different structure |
| divergence | would be a **bug**, and is testable as one | is the **current state**, and nothing tests for it |
| cost of sharing | couples two independent actors | **removes a class of disagreement** |

**So the rule is not "never duplicate."** It is:

> **A copy that is a derivation may be duplicated. A copy that re-implements a
> decision may not.**

**And the test is mechanical**: can you write an assertion that the two agree
on every input? For `planSlug`, trivially. For the deliver rule, **you cannot
even state it** — the two take different arguments.

---

## 6. Transitions become methods

**A state change is never one write** (Plan §4) — a phase flip *plus* a record
— **and the estate has been bitten by them coming apart twice**: a plan flipped
to Delivered with no `Delivered:` record fell out of the scan's rolling window
entirely, reporting zero.

**Today the pairing is a rule** that four call sites must remember. **It should
be structural:**

```
plan.approve(by, channel, at)   →  { state: 'approved', approved: {...} }
plan.deliver(at)                →  { state: 'delivered', delivered: {...} }
```

**The domain returns what should be written; the adapter writes it.** One
writer per artefact, and the pair cannot come apart because it is one value.

**This is also what makes a transition testable without a filesystem.** The
current test of the deliver *rule* writes a `docs/plans/` tree and shells out
to a parser to ask *is every non-deferred branch merged?* — the answer is a
predicate over a Plan, and it needs neither.

---

## 7. The new workflows fit the same shape

**The story's six jobs map onto four new workflows, and none needs a new source
of truth.**

| new workflow | the domain DECIDES | the adapter PERFORMS | job |
|---|---|---|---|
| **place a slice on an agent** | which agent is `free` | start or reuse a worker | 1 |
| **bound the dial** | what headroom permits | sample spawn cost | 1 |
| **watch a build** | has it reached a terminal state | poll the host | — |
| **report the delta** | what changed since the last pulse | nothing — it is pure | 3 |
| **publish a ticket** | what the summary says · is it already published | the tracker write | — |

**The delta is the interesting one.** Stage 1 left it as unresolved question —
*the scan is stateless by design and a delta needs a previous state*. **With a
domain layer it resolves cleanly: the delta is a pure function of two pulses.**
The *storage* of the previous pulse is an adapter concern; the *diff* is
domain. Manifesto Principle 1 is untouched — nothing is recorded that is not
re-derived.

---

## 8. What this costs and what it buys

### The coupling, measured

| measurement | value |
|---|---|
| board server modules | **30** |
| modules that `spawn`/`execFile`/`execSync` | **27** |
| spawn sites | **235** |
| unit test files | **77** |
| **that `mkdtemp` or spawn** | **34 (44%)** |

> Stage 1 and the story quote **41 of 77**. That was `mkdtemp` (28) plus spawn
> (25) added rather than unioned — 19 files do both. **The union is 34.** The
> argument is unchanged; the number is corrected here.

### The host port is bypassed more than it is used

**`plot-host.sh` is stage 1's proven pattern — *"the ONE place that talks to the
host CLI."* Measured across the other 23 scripts:**

| script | direct `gh`/`bb` calls | via the port |
|---|---|---|
| **`plot-reconcile-scan.sh`** | **18** | **1** |
| `plot-update-board.sh` | 4 | 0 |
| `plot-board-probe.sh` | 2 | 1 |
| `plot-fleet-scan.sh` | 2 | 7 |
| `plot-reap.sh` | 1 | 1 |
| `plot-impl-status.sh` | 1 | 7 |

**Stage 1 named `plot-reap.sh` as the violation. It is the smallest one.** The
reconcile scan makes **eighteen** direct calls against one through the port —
and the port's whole claim is that it is the only place that talks to the host.

**This is not an argument against the port. It is the strongest argument for
it**: a port that a major consumer routes around is one whose interface was too
narrow, and the fix is to widen it, not to abandon it. **`plot-reap.sh` reached
past it for `mergedAt` — a field it did not expose. The same shape, eighteen
times over.**

### What it buys

| today | with the split |
|---|---|
| the deliver rule tested through a sandbox repo | tested with a `Plan` object |
| the same rule in two languages with two bug histories | one rule, one history |
| `unknown` guards one copy and not the other | the guard is the rule's |
| 34 of 77 unit tests touch the world | the adapters' tests do; the domain's do not |
| a transition is a phase flip *and* a record, by convention | one value the adapter writes |

**The acceptance criterion the story states — every domain object testable with
no external dependency — is not a testing preference.** It is the mechanical
consequence of the cut: **if a rule can be tested without git, it did not
contain any git.**

---

## 9. What is unresolved

| # | question | blocks |
|---|---|---|
| 1 | **Which copy of the deliver rule survives?** The board's is better-guarded; the shell's runs where there is no board | the split's first move |
| 2 | **Does the shell call the domain, or duplicate a compiled artefact?** A shell script cannot import TypeScript | every workflow with a script entrance |
| 3 | **Is the pulse the domain's input or its output?** `allWavesMerged` reads a pulse; `plot-deliver.sh` reads PRs | where the boundary sits |
| 4 | **Widen `plot-host.sh` by how much?** 18 direct calls name the gap; a port that answers everything is not a port | the reconcile scan |

**2 is the one to settle first.** Every other answer depends on it: if the
shell entrances must keep their own implementations, the deliver rule stays
duplicated by necessity and the rule in §5 cannot be applied. **If they can
shell out to one binary, the whole left column collapses into one place.**

> **Stage 3 — comparison against other agent runtimes — follows this.**
