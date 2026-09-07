---
name: plot-implement
description: >-
  Start (or resume) implementation of an approved plan: staleness
  preflight, branch setup per the plan's recorded ceremony answers, a
  hand-off brief that pre-answers the mechanics, and a Started record.
  Prepares and records — never implements. Part of the Plot workflow.
  Use on /plot-implement.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.6.2
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Implement

Start — or resume — implementation of an approved plan. This command
**prepares and records; it never implements**: it ends by handing a brief
to whatever does the coding (your implementation workflow, a fresh
session, a remote agent).

**Why it exists:** approval and implementation start are two events
(Manifesto, Lifecycle). Under human pacing, days can pass between "this
plan is right" and "someone picks it up" — and the world moves in
between. Starting is therefore its own step, with its own check.

**Input:** `$ARGUMENTS` = `<slug>` (optional if only one approved plan is
ready — propose it per smart defaults).

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Locate Plan | Small | plot-plan-meta.sh lookup |
| 2. Staleness Preflight | Mid–Frontier | Comparing plan assumptions against repo drift is judgment |
| 3. Branch Setup | Small | Git commands per recorded answers; `plot-fleet-scan.sh --next` picks the branch and the ref push claims it — no judgment needed |
| 4. Hand-off Brief | Frontier | Interpretation, not extraction: naming which alternatives a plan rejected and which assertions a naive implementation would pass without is judgment. Smaller tiers fill the header fields and the plan's own `Done when`, then say which sections they could not write |
| 5. Record Started | Small | One Status line + commit; optional board status is a single shell command |
| 6. Summary | Small | Orientation template |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 1. Locate the Plan

Parse all plans (`../plot/scripts/plot-plan-meta.sh docs/plans/*.md`) and
find `<slug>`. Requirements:

- **Phase must be `approved`.** Draft or Design → stop: "Plan isn't
  approved yet — review it and run `/plot-approve <slug>` first."
  (Design is the transitional phase before Approved — a spike or tracer
  bullet still answering whether the approach works; implementation only
  ever references an *approved* plan, so it waits.) Delivered/Released →
  nothing to start.
- If no slug given and exactly one approved plan has no `Started:`
  records, propose it. Several → list them (Ready first) and ask.

> **Unattended (`PLOT_UNATTENDED=1`):** stop unless `$ARGUMENTS` named the plan.
> `PLOT-UNASKED: Which plan should implementation start on? — stopped — <n> candidates listed; no branch created`
- If the plan already has `Started:` records, this is a **resume**: same
  preflight, then re-orient ("branch X exists, PR #N open, plan section 3
  remains") instead of re-creating anything.

### 2. Staleness Preflight

The plan was approved at a point in time; check whether time has broken
it. Gather mechanically, judge with care:

- **Age:** days since the `Approved:` record (parsed field
  `approved_raw`).
- **Base drift:** has the default branch moved over the plan's territory?
  `git log --oneline <approved-date>.. -- <paths the plan touches>` —
  the plan's Design/Branches sections name the areas.
- **Reference drift:** tickets/issues the plan cites — status changed?
  (Ask the user if you can't check the tracker.)
- **Assumption drift:** re-read the plan's Design assumptions against the
  current code — do the named files/functions/versions still exist?

Verdict, per the guidance principle (name the signal, advise):

- **Clean** → say so in one line and proceed.
- **Drift found** → present what changed and its impact, then advise: a
  targeted re-validation of the affected sections (a mini-challenge, not
  a full re-review), a plan amendment, or — if the ground shifted —
  back to `/plot-idea`. The user decides; record material amendments in
  the plan before starting.

> **Unattended (`PLOT_UNATTENDED=1`):** on drift, stop and report — do not
> pick one of the three options and proceed. Which re-validation the drift
> needs is a verdict, not a default, and there is nobody here to give it.
> Name what moved so a person can act on it, then leave the plan and the
> worktree untouched.
> `PLOT-UNASKED: How should this plan's drift be handled? — stopped — drift reported; no branch created and no amendment written`

> **Smaller models:** gather the mechanical signals (age, commit list on
> touched paths), present them, and ask the user for the verdict.

### 3. Branch Setup — per the plan's recorded answers

Read the plan's `Impl:` answer (field `impl` from plot-plan-meta.sh).
Never re-decide it; if it's missing (pre-Plot-2 plan), ask the two
ceremony questions now and record the answers first.

- **`own-branches`** — create the branches named in the plan's
  `## Branches` section from the default branch (worktree-safe):

  ```bash
  DEFAULT_BRANCH=$(../plot/scripts/plot-host.sh default-branch)
  git fetch origin "$DEFAULT_BRANCH"
  git checkout -b <branch> "origin/$DEFAULT_BRANCH"
  ```

  **If a branch already exists** (local or remote — check
  `git ls-remote --heads origin <branch>`), do not recreate it: treat
  that branch as already started (plans approved under pre-Plot-2 flows
  arrive here with branches but no `Started:` records) — check it out,
  record `Started:` if missing, and re-orient as a resume.

  **Which branch, and claiming it.** When the plan groups its branches
  into waves (`### ` subheadings under `## Branches`), do not pick by
  hand and do not take them in file order — ask:

  ```bash
  BRANCH=$(../plot/scripts/plot-fleet-scan.sh --next <slug>) || {
    echo "Nothing claimable: every eligible branch is taken, or the next
    wave is blocked on unmerged work. Run /plot-pulse to see why."; exit 0
  }
  ```

  A wave becomes eligible only once every non-deferred branch in every
  **prior** wave is merged, so this never hands you work that builds on
  an unproven seam. Exit 1 means "nothing to start" — a normal state, not
  an error.

  Then **claim the branch before doing any work**:

  ```bash
  git checkout -b "$BRANCH" "origin/$DEFAULT_BRANCH"
  git push -u origin "$BRANCH"          # ← THE CLAIM
  ```

  The push is the claim, and it is the whole locking mechanism: pushing a
  ref that already exists is rejected, so two sessions racing for the same
  branch cannot both win. The loser takes the rejection, asks `--next`
  again, and moves on. There is no lock manager and none is wanted.

  **Claim first, work second.** Claiming after an hour of work means two
  agents duplicate that hour before discovering the collision.

  Optionally reflect the claim in the plan file for humans and the board:

      - `feature/x` — description <!-- claimed: <ISO-8601>, <session> -->

  This is a *reflection*, never the claim itself. Where the annotation and
  git disagree, **git wins**.

  **Giving a branch up.** If the work turns out to be unnecessary, wrongly
  cut, or blocked, annotate the plan (`deferred:` / `split-from:` /
  `moved:`) and **leave the ref in place** — never delete a remote ref
  another session may be reading. `/plot-reconcile` owns cleanup and uses
  that annotation to tell deliberate abandonment from a dead worker.

  Several eligible branches means several sessions may run concurrently,
  each claiming its own. Check the fleet any time with `/plot-pulse`.
- **`same-branch`** — the plan already rides the work branch; just check
  it out (or confirm you're on it). No new branches.
- **`other-repo`** — no branches here. The hand-off brief (step 4) is the
  artifact that travels; the implementation repo's session creates its
  own branch. If the `Implementation home` repos are checked out locally,
  offer to open the brief there.
- **`none`** — knowledge-only plan; nothing to set up. Skip to step 5.

### 4. Hand-off Brief

Produce the brief that lets the implementing session start without
re-asking mechanics the plan already answers — and without plot.

**Write it to `.plot/briefs/<branch-suffix>.md`** (the branch name with
`/` flattened to `-`, or the plan slug for a `same-branch` plan) and commit
it where the plan lives. A brief that exists only in the dispatching
session's scrollback dies with that session; an agent that is resumed,
replaced or restarted reads the file instead of asking a human to
reconstruct it.

**The brief is interpretation, not extraction.** A summary of the plan is
worth nothing to a reader who can open the plan. What the brief adds is
the decisions that are *settled* — each with the alternative it rejected
and the measurement that killed it — so an implementer does not spend the
first hour re-deriving a mechanism the plan already disproved. A plan
records what will be built; the brief records what must not be rebuilt.

Write these sections. They are what a brief is incomplete without, not a
form to fill:

```markdown
## Implementation brief — <slug>[ (wave N: <wave name>)]

- **Plan (canonical):** <path or URL to the plan file> on <default branch>
- **Approved:** <approved_raw>
- **Branch:** `<branch>` (base: `<default branch>`)
- **Ends as:** <one PR to <base> | merge to <base> | PR in <other repo>>
- **Review of the code:** <per repo convention / plan Notes>

<If this branch belongs to a wave, one line on what waits on it or what it
waits on — the ordering the implementer would otherwise have to infer.>

### What to build

<The change in the implementer's terms, not the plan's: which mechanism,
on top of what that already exists. Lead with the concrete failure it
fixes — the observed one, with its numbers — because that is what tells a
reader whether their fix is the fix. Close by pointing at the plan: it is
canonical, this is orientation.>

### <The decisions the plan settles — do not re-derive them>

<One subsection or bolded paragraph per settled decision. Each names the
obvious alternative and the measurement that killed it: "X cannot answer
this, because …", "measured at N ms", "grep returns nothing". Without the
measurement it reads as preference and gets re-litigated; with it, it
ends the question. This is the section that makes the brief longer than
the plan's summary, and it is the reason the brief exists.>

<Also record the rules carried over unchanged from related work — the
invariants this repo keeps re-learning (absent is not false; read the exit
code, not the emptiness) — so they are not re-discovered by breaking them.>

### Done when

The plan's `## Done when` list is the specification. <Then lift the
assertions that exist *because a naive implementation would pass without
them*, and say for each what it catches.>

Plus: <the repo's gates — test commands, build artifacts, changeset,
platform constraints>.

### Bookkeeping

<The `→ #<number>` duty below, plus: push the first real commit as soon as
it exists.>

### Scope guard

<The files and directories this branch owns. Then the other branches in
flight and what they hold — verified at dispatch, not guessed — so a
collision is a known fact rather than a surprise at merge time.>

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
```

Length follows the work: a one-file change needs no rejected alternatives
because none were rejected. What must never happen is a brief that only
restates the plan's headings — that is the shape that gets skipped, and a
skipped brief is why the mechanics get re-asked.

The brief also carries the bookkeeping duties for the implementing session:
**when the PR is created, append `→ #<number>`** (from another repo:
`→ <owner>/<repo>#<number>`) to this branch's line in the plan's
`## Branches` section — `/plot-deliver` back-fills missed ones via the
host adapter, but written-at-creation keeps the plan current. Where a
project board is configured, the same moment sets the new PR to "Ready"
(step 5) — it is the only point at which the PR both exists and has not
yet been worked on.

For `same-branch`, note that the end-PR body must carry the plan link and
mirror its approval record (the file is the truth; the PR body is the
reviewer-facing mirror). For `other-repo`, the brief plus the plan URL is
everything the other repo sees — plans do not travel (reference, never
copy).

Implementation-side skills must not re-ask what the brief answers (e.g.
"merge, PR, or cleanup?" — the brief's **Ends as** line already says).

### 5. Record Started

Add one line to the plan's `## Status` per started branch:

```
- **Started:** <YYYY-MM-DD>, <who>, `<branch>`
```

Commit it where the plan lives (same branch in `same-branch` flow;
default branch in direct flows — see `/plot-approve` step 4 for the
exact push mechanics and the branch-protection fallback; the plan's
branch otherwise). The board derives **Ready** (approved, no `Started:`)
vs **In progress** from exactly this record.

If `## Plot Config` includes a project board (`owner/number`), set each
started branch's PR to "Ready" once it exists:

```bash
../plot/scripts/plot-update-board.sh <impl-pr-url> "Ready" <owner> <number>
```

At this point the PR usually does not exist yet — the implementing session
creates it. The hand-off brief (step 4) carries this as bookkeeping alongside
the `→ #<number>` annotation, so the status is set when the PR appears rather
than guessed here. Skip if no project board is configured.

### 6. Summary — orient

One short close: what is now in flight, where, and what falls out next —
e.g.:

> Started `feature/<slug>` (recorded in the plan). Hand the brief above
> to the implementing session — when its PR(s) merge, `/plot-deliver
> <slug>` closes the loop.
