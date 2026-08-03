---
name: plot-approve
description: >-
  Record a plan's approval through its declared review channel (merge the
  plan PR, record an in-session go, or tally a ballot) and stop — implementation
  starts separately with /plot-implement. Part of the Plot workflow.
  Use on /plot-approve.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 2.0.0
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Approve Plan

Record a plan's approval — and only that. Approval makes a plan *ready*;
starting the work is `/plot-implement`'s job (Manifesto: approval and
implementation start are two events). This command ends with the plan in
phase Approved, a transition record in the file, and an offer to chain
into `/plot-implement` for the fast-paced case.

**Input:** `$ARGUMENTS` is the `<slug>` of an existing plan.

Example: `/plot-approve sse-backpressure`

<!-- keep in sync with plot/SKILL.md Setup -->
## Setup

Add a `## Plot Config` section to the adopting project's `CLAUDE.md`:

    ## Plot Config
    <!-- Optional: uncomment if using a GitHub Projects board -->
    <!-- - **Project board:** owner/number (e.g. eins78/5) -->
    - **Branch prefixes:** idea/, feature/, bug/, docs/, infra/
    - **Plan directory:** docs/plans/
    - **Active index:** docs/plans/active/
    - **Delivered index:** docs/plans/delivered/

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Parse Input | Small | Slug lookup via helper scripts |
| 2. Determine Review State | Small | plot-plan-meta.sh + plot-host.sh pr-state |
| 2b. Suggest Tracer Bullet | Mid | Heuristic evaluation of plan design |
| 3. Effect the Approval | Small | One merge or one confirmation |
| 4. Record the Approval | Small | Phase flip + Status line + commit |
| 5. Summary | Small | Orientation template |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- Find Draft plans: parse `docs/plans/active/*.md` with `../plot/scripts/plot-plan-meta.sh`, plus open idea-branch PRs via `../plot/scripts/plot-host.sh pr-list`
- If exactly one candidate exists, propose: "Found plan `<slug>`. Approve it?"
- If multiple exist, list them and ask which one to approve
- If none exist, explain: "No plans awaiting approval. Create one first with `/plot-idea <slug>: <title>`."

Extract `slug` from `$ARGUMENTS` (trimmed, lowercase, hyphens only).

### Batch Mode

If the user asks to approve multiple plans at once ("approve all", or lists multiple slugs): loop the single-plan flow for each slug and print a combined summary. No special syntax needed.

### 2. Determine Review State

Read the plan (`../plot/scripts/plot-plan-meta.sh <plan-file>`) — its
recorded `Review:` answer decides what "approve" means. If the field is
missing (pre-Plot-2 plan on an idea branch), treat it as `pr`.

**`Review: pr`** — get the plan PR's state via the host adapter,
`../plot/scripts/plot-host.sh pr-state idea/<slug>` (for
`Impl: same branch`: `pr-state <work-branch>`), and handle:

- **Draft PR**: Error — "Plan is still a draft. Mark it ready for review first."
- **Open, non-draft**: proceed — merging is the approval (step 3)
- **Already merged**: the approval already happened — skip to step 4 to make sure it's recorded
- **Closed (not merged)**: Error — "Plan PR is closed. Reopen it or create a new one."
- **No PR found**: Error — "No PR found for branch `idea/<slug>`. Run `/plot-idea` first."

**`Review: in-session`** — the reviewer is the human in this session.
If the plan hasn't been walked through yet, do it now (section by
section, surfacing open points). The approval is their explicit go —
never infer it from silence or from "looks good" about something else.

**`Review: ballot`** — check the collected ballot files against the
expected reviewers (plan Notes or the user). All in → report the tally.
Missing ballots → report who's outstanding and stop (no partial
approvals unless the user explicitly rules).

### 2b. Suggest Tracer Bullet (optional)

Before approving, check if a tracer bullet might be valuable. This is a suggestion, never a hard gate.

Read the plan file and check for a `### Tracer` subsection under `## Branches`:

- **If `### Tracer` exists with `Status: Complete`:** proceed normally. Mention in summary: "Tracer bullet validated."
- **If `### Tracer` exists but incomplete:** warn: "This plan has an incomplete tracer bullet. Consider finishing it with the `tracer-bullets` skill before approving. Proceed anyway?"
- **If no `### Tracer` subsection:** apply suggestion heuristics:
  - **Strongly suggest** when the `## Design` section describes unfamiliar technology, experimental approaches, or patterns without established docs/tutorials
  - **Strongly suggest** when the plan has 3+ branches AND they show a natural core-plus-extras decomposition
  - If heuristic triggers: "Consider using the `tracer-bullets` skill to validate the architecture first. Add a `### Tracer` subsection to the plan, or proceed without one?"
  - If heuristic does not trigger: proceed silently

> **Smaller models:** Skip heuristic evaluation. Only check for an existing `### Tracer` subsection. If present and incomplete, warn. Otherwise proceed silently.

### 3. Effect the Approval

Per the review channel:

- **`pr`** (with `Impl:` ≠ `same branch`):

  ```bash
  ../plot/scripts/plot-host.sh pr-merge <number> --delete-branch
  ```

  This lands the plan file on the default branch and deletes `idea/<slug>`.
  Default to merge commits (plan refinement history is valuable context);
  follow the project's declared merge strategy if it differs.

- **`pr` with `Impl: same branch`**: do **not** merge — the PR carries
  plan + code and merges once at the end. The approval is the review
  approval on the plan portion: record it in the file (step 4) on the
  work branch; the PR stays open for implementation.

  If `## Plot Config` includes a project board, update the plan PR status
  to "Done": `../plot/scripts/plot-update-board.sh <plan-pr-url> "Done" <owner> <number>`

- **`in-session`**: ask for the explicit go. The channel value recorded in
  step 4 is `in-session`.

- **`ballot`**: the tally is the approval; the channel value is e.g.
  `ballot 3/3`.

### 4. Record the Approval

The record lives in the plan file — the file is the truth in every flow;
a merge commit merely coincides with it in the `pr` flow.

1. Change `**Phase:** Draft` → `**Phase:** Approved`
2. Set the `Review:`/`Impl:` Status fields if they're missing (ask the
   two ceremony questions — see `/plot-idea` step 4 — rather than
   guessing; pre-Plot-2 plans land here)
3. Fill the `Approved:` transition record in `## Status`:

   ```markdown
   - **Approved:** <YYYY-MM-DD>, <who>, <channel>
   ```

   `<who>`: the host login (`pr` flow) or the approving human's name.
   `<channel>`: `plan-PR #<n> merged` | `in-session` | `ballot <n>/<m>`.
4. Keep/insert the `## Approval` section with `- **Assignee:** <who>`
   (the board reads the assignee from there).
5. If `.plot/hold` lists a branch for this plan/story (review hold),
   remove that line — the approval is what releases the gate.
6. Commit where the plan lives:
   - `pr`-merged flow: on the default branch — fetch first; do **not**
     check out the default branch locally. The exact mechanic:

     ```bash
     git fetch origin <default>
     git checkout -b plot/approve-<slug> origin/<default>
     # edit the plan file, commit
     git push origin plot/approve-<slug>:<default>
     git push origin --delete plot/approve-<slug> 2>/dev/null || true
     ```

     **Branch protection fallback:** if that push is rejected, open a
     micro-PR instead (`plot-host.sh pr-create` from
     `plot/approve-<slug>`, then `pr-merge`) — never leave the merged
     plan stranded at `Phase: Draft` on the default branch.
   - `same branch` flow: on the work branch, in place
   - direct flow: on the current branch

### 5. Summary — orient, then offer to chain

The plan is approved and **nothing is in flight** — say so, and say what
falls out next and why:

> Plan `<slug>` approved (<channel>) — it's now Ready. Nothing starts
> until you (or anyone picking it up, today or next week) run
> `/plot-implement <slug>`: that re-checks the plan against what moved
> since approval, sets up the branch per the plan's recorded answers, and
> hands the implementer a brief.

Then offer — once, not pushily — to chain: "Start now?" If yes, invoke
`/plot-implement <slug>` directly (the fast-paced case keeps its
one-step feel).

Progress: `[ ] Draft > [x] Approved > [ ] Delivered > [ ] Released`
