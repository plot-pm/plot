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
  version: 2.4.3
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
| 2. Determine Review State | Small | plot-plan-meta.sh reports the channel |
| 2b. Suggest Tracer Bullet | Mid | Heuristic evaluation of plan design |
| 3. Effect and Record (`pr`) | Small | One call to `plot-approve.sh`; read back its summary |
| 3b. Record by hand (`in-session` / `ballot`) | Mid | The go or the tally, then the same records without a script |
| 4. Summary | Small | Orientation template |

**What this skill judges and what the script collects.** Manifesto
Principle 3: scripts collect and report, skills interpret and adapt.
Under `Review: pr` every mechanical step — merging, flipping the phase,
filling `Approved:`, clearing the holds, the sprint annotation, the
push — belongs to `../plot/scripts/plot-approve.sh`, and this skill
calls it rather than re-describing it. What stays here is what needs a
reader: whether a draft is *ready*, the in-session walkthrough, the
ballot tally, the two ceremony questions on a pre-Plot-2 plan, and the
tracer-bullet suggestion.

The same script is the board's `Approve` button. One implementation of
the mechanics, two entrances — without that, a project declaring an
`Approve command` would get a second path to the same outcome, free to
drift.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- Find Draft plans: parse `docs/plans/active/*.md` with `../plot/scripts/plot-plan-meta.sh`, plus open idea-branch PRs via `../plot/scripts/plot-host.sh pr-list`
- If exactly one candidate exists, propose: "Found plan `<slug>`. Approve it?"
- If multiple exist, list them and ask which one to approve
- If none exist, explain: "No plans awaiting approval. Create one first with `/plot-idea <slug>: <title>`."

> **Unattended (`PLOT_UNATTENDED=1`):** stop unless `$ARGUMENTS` named the slug.
> Picking a plan to approve is a choice with no safe default, and "there was
> only one candidate" is not consent to approve it.
> `PLOT-UNASKED: Which plan should be approved? — stopped — <n> candidates; none approved`

Extract `slug` from `$ARGUMENTS` (trimmed, lowercase, hyphens only).

### Batch Mode

If the user asks to approve multiple plans at once ("approve all", or lists multiple slugs): loop the single-plan flow for each slug and print a combined summary. No special syntax needed.

### 2. Determine Review State

Read the plan (`../plot/scripts/plot-plan-meta.sh <plan-file>`) — its
recorded `Review:` answer decides what "approve" means. If the field is
missing (pre-Plot-2 plan on an idea branch), treat it as `pr`.

**`Review: pr`** — the mechanical half is `plot-approve.sh`'s (step 3).
It reads the PR state itself and refuses a draft, a closed, or an absent
PR with the reason on stderr, so do **not** pre-check it here — a second
copy of those preconditions is exactly the duplication this split
removes. What this step still owns is the judgement the script cannot
make: **is this draft ready?** Read the plan, surface open points, and
stop if it is not.

**`Review: in-session`** — the reviewer is the human in this session.
If the plan hasn't been walked through yet, do it now (section by
section, surfacing open points). The approval is their explicit go —
never infer it from silence or from "looks good" about something else.

**`Review: ballot`** — check the collected ballot files against the
expected reviewers (plan Notes or the user). All in → report the tally.
Missing ballots → report who's outstanding and stop (no partial
approvals unless the user explicitly rules).

> **Unattended (`PLOT_UNATTENDED=1`):** this is the shape's clearest case, and
> it splits by where the approval already lives.
>
> - **`Review: pr`** — the approval is the PR's non-draft state, a fact
>   `plot-approve.sh` reads for itself. Proceed; the script's own refusals are
>   unchanged.
> - **`Review: ballot`** — the approval is the ballot files, also facts. Tally
>   them and proceed only on a complete tally. A missing ballot stops in both
>   modes, exactly as it does now.
> - **`Review: in-session`** — **refuse.** The reviewer is a human in a session
>   that, by definition, has nobody in it. There is no artefact to read and
>   nothing to infer from; the step above already forbids inferring a go from
>   silence, and an empty room is the emptiest silence there is.
>   `PLOT-UNASKED: Approve <slug> in-session? — refused — in-session review needs a reviewer; phase unchanged`
>
> **The gates do not move.** A draft PR, a closed PR, an incomplete ballot, a
> non-Draft phase — each refuses identically in both modes. `PLOT_UNATTENDED`
> says nobody can be asked; it never says a check may be skipped.

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

> **Unattended (`PLOT_UNATTENDED=1`):** proceed. This step says of itself that
> it is a suggestion and never a hard gate, so its documented default is to
> continue — but say the suggestion went unheard rather than dropping it.
> `PLOT-UNASKED: Add a tracer bullet before approving? — default — proceeded; the suggestion stands unread`

> **Smaller models:** Skip heuristic evaluation. Only check for an existing `### Tracer` subsection. If present and incomplete, warn. Otherwise proceed silently.

### 2c. The panel verdict gate

**A juror returning `reject` refuses the approval. A panel that ran and found
nothing refuses nothing. A plan nobody has questioned approves exactly as it does
today.**

**The gate fires on a verdict, never on a ritual**, and that is the whole design.
Measured 2026-09-12: **268 plans, 73 carrying a `Rounds:` field — 27.2%.** A gate
that refused an unquestioned plan would make 72.8% of this estate unapprovable
overnight, and a gate people turn off protects nothing. This is
`a-merged-pr-carried-work`'s call, made again here.

**Absent is not false.** A plan with no panel record is *unquestioned*, not
*questioned and clean*. Both approve; only one of them was reviewed, and the
difference is recorded in `Rounds:` rather than enforced here.

Read the panel's moderation for this plan:

```bash
SUBJECT=$(basename "$PLAN" .md)
PANEL=".plot/panels/$SUBJECT"
```

| What is there | What this step does |
|---|---|
| No `$PANEL` directory | **Proceed.** Unquestioned, which is approvable. |
| Verdicts, none `reject` | **Proceed.** The panel found nothing that holds. |
| Any juror holds `reject` | **Refuse.** Name the lens and its finding. |

**A `reject` is cleared by a later round that no longer rejects — never by an
override.** There is no waiver flag, no `--force`, and no recorded reason, by
design. The plan is amended and re-questioned; approval unblocks when the newest
round holds no `reject`. An override is a claim about a conversation nobody else
saw; **a round is re-derivable by anyone who reads the plan later.**

So the refusal names the way out, and the way out is work rather than a flag:

```
plan 'the-slug' is held by a panel reject.

  estate — "packages/domain/src/rules/free.ts already answers this"

  A reject is cleared by a later round that no longer rejects. Amend the plan
  and re-run /challenge-the-plan; approval unblocks when no juror rejects.
  There is deliberately no override.
```

**Read the newest round only.** An older `reject` that a later round did not
repeat is already cleared — that is what "cleared by a later round" means, and
re-reading a superseded verdict would make the gate unclearable by its own rule.

**Read the exit code, not the emptiness.** `plot-panel.mjs` exits `3` for a
refusal and `2` for unusable arguments. **A missing bundle is a broken
installation, not a clean panel** — if the mechanism cannot be asked, say the
verdict went unread rather than reporting no reject.

> **Unattended (`PLOT_UNATTENDED=1`):** apply the gate unchanged. It reads files
> and needs nobody: a `reject` refuses, everything else proceeds. `PLOT_UNATTENDED`
> says nobody can be asked; it never says a check may be skipped.
> `PLOT-UNASKED: Approve over a panel reject? — refused — no override exists; amend and re-question`

**Why this lives in the skill and not in `plot-approve.sh`.** The script
**dies** on `Review: in-session` (`plot-approve.sh:194`) and `Review: ballot`
(`:197`) before doing any work — *"a script cannot stand in for a human reviewer
or read a ballot."* So those two channels never reach it, and a gate inside it
would be invisible to exactly the reviews that most need one. This plan's own
`Review:` is `in-session`. The skill is where all three channels converge, so
the gate is here.

### 3. Effect and Record the Approval

**`Review: pr` — one call. Do not do this by hand:**

```bash
../plot/scripts/plot-approve.sh <slug>
```

That performs all seven mechanical steps and reports each one:

```
step: plan docs/plans/2026-08-17-<slug>.md — phase=draft review=pr impl=own-branches pr=#42(OPEN)
step: merged PR #42
  push: clean — plot/approve-<slug> → main
summary: merged=yes phase=flipped record=written holds=2 sprint=updated push=clean
```

| Field | Means |
|---|---|
| `merged` | `yes` \| `already` \| `skipped-same-branch` |
| `phase` | `flipped` \| `already` |
| `record` | `written` \| `already` |
| `holds` | how many `.plot/hold` entries were cleared (`0` is normal) |
| `sprint` | `updated` \| `already` \| `none` \| `missing` |
| `push` | `clean` \| `bypassed` \| `unknown` \| `micro-pr` \| `local` \| `nothing-to-commit` |

**Carry `push: bypassed` into the summary verbatim.** It means the
commit landed but branch protection was waived, and it names the rules
stepped over and the checks that did not run. Nothing needs undoing —
but a missing CI run must not be a mystery later.

**On a refusal (exit 1), report the script's own words and stop.** It
refuses a plan that is not Draft, a `Review:` it cannot act on, and a
PR that is draft, closed, or absent. Do not work around a refusal.

**It is idempotent, and re-running it is the repair.** Step 2 merges the
PR — the one irreversible write — so an interruption after it can leave
the PR merged while the plan still reads `State: Draft`. Every step
tests the source it would have written, so a second run completes
whatever the first left undone and changes nothing that was already
done. If a run dies halfway, **run it again**.

`Impl: same branch` is handled inside the script: the PR is left open
(it carries plan + code and merges once, at the end) and the records go
on the work branch. If `## Plot Config` includes a project board, also
update the plan PR status to "Done":
`../plot/scripts/plot-update-board.sh <plan-pr-url> "Done" <owner> <number>`

**`Review: in-session`** — ask for the explicit go, then write the same
records by hand (step 3b). The channel value is `in-session`.

**`Review: ballot`** — the tally is the approval; the channel value is
e.g. `ballot 3/3`. Then write the records by hand (step 3b).

### 3b. Record by hand — `in-session` and `ballot` only

Only these two channels get here. **Under `Review: pr` the script above
did all of this** — repeating it by hand is how the two paths drift.

The record lives in the plan file — the file is the truth in every flow;
a merge commit merely coincides with it in the `pr` flow.

1. Change `**State:** Draft` → `**State:** Approved`, then declare the write:

   ```bash
   bash ../plot/scripts/plot-state-receipt.sh --unowned <plan file> Approved \
     "Review: in-session — plot-approve.sh refuses this channel by name"
   ```

   **`plot-state-gate.sh` refuses a `State:` line changed by anything but the
   script that owns it**, and this channel has no script: `plot-approve.sh:190`
   refuses `in-session` and `ballot` by name, because a script cannot stand in
   for a human reviewer or read a ballot. The line above is the named escape, and
   it is recorded — each use counts a routing gap rather than turning the gate
   off. Under `Review: pr` you are not here at all; the script did this write and
   left its own receipt.
2. Set the `Review:`/`Impl:` Status fields if they're missing (ask the
   two ceremony questions — see `/plot-idea` step 4 — rather than
   guessing; pre-Plot-2 plans land here)
3. Fill the `Approved:` transition record in `## Status` — the **empty
   placeholder**, above `Started:` and `Delivered:`, never appended
   after the list:

   ```markdown
   - **Approved:** <YYYY-MM-DD>, <who>, <channel>
   ```

   `<who>`: the approving human's name. `<channel>`: `in-session` |
   `ballot <n>/<m>`.
4. Keep/insert the `## Approval` section with `- **Assignee:** <who>`
   (the board reads the assignee from there).
5. Remove the `.plot/hold` entry for **each branch the plan names** —
   the file is keyed by branch, not by plan, and an entry for a branch
   this plan does not name belongs to someone else's review.
6. Commit where the plan lives — the work branch (`same branch`) or the
   current branch (direct flow). Both channels record locally; there is
   no push at the default branch to classify.

### 4. Summary — orient, then offer to chain

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
