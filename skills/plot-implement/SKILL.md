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
  version: 1.1.0
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
| 4. Hand-off Brief | Small | Template from parsed fields |
| 5. Record Started | Small | One Status line + commit |
| 6. Summary | Small | Orientation template |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

### 1. Locate the Plan

Parse all plans (`../plot/scripts/plot-plan-meta.sh docs/plans/*.md`) and
find `<slug>`. Requirements:

- **Phase must be `approved`.** Draft → stop: "Plan isn't approved yet —
  review it and run `/plot-approve <slug>` first." Delivered/Released →
  nothing to start.
- If no slug given and exactly one approved plan has no `Started:`
  records, propose it. Several → list them (Ready first) and ask.
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
    wave is blocked on unmerged work. Run /plot-fleet to see why."; exit 0
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
  each claiming its own. Check the fleet any time with `/plot-fleet`.
- **`same-branch`** — the plan already rides the work branch; just check
  it out (or confirm you're on it). No new branches.
- **`other-repo`** — no branches here. The hand-off brief (step 4) is the
  artifact that travels; the implementation repo's session creates its
  own branch. If the `Implementation home` repos are checked out locally,
  offer to open the brief there.
- **`none`** — knowledge-only plan; nothing to set up. Skip to step 5.

### 4. Hand-off Brief

Produce the brief that lets the implementing session start without
re-asking mechanics the plan already answers — and without plot:

```markdown
## Implementation brief — <slug>

- **Plan (canonical):** <URL or path to the plan file>
- **Approved:** <approved_raw>
- **Branch:** <branch> (base: <default branch>)
- **Ends as:** <one PR to <base> | merge to <base> | PR in <other repo>>
- **Review of the code:** <per repo convention / plan Notes>
- **Done when:** <the plan's deliverables/DoD section, distilled>
- **Scope guard:** implement what the plan says; drift → back to the plan.
```

The brief also carries one bookkeeping duty for the implementing session:
**when the PR is created, append `→ #<number>`** (from another repo:
`→ <owner>/<repo>#<number>`) to this branch's line in the plan's
`## Branches` section — `/plot-deliver` back-fills missed ones via the
host adapter, but written-at-creation keeps the plan current.

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

### 6. Summary — orient

One short close: what is now in flight, where, and what falls out next —
e.g.:

> Started `feature/<slug>` (recorded in the plan). Hand the brief above
> to the implementing session — when its PR(s) merge, `/plot-deliver
> <slug>` closes the loop.
