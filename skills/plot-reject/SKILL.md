---
name: plot-reject
description: >-
  Reverse a premature delivery — move plan from Delivered back to Approved.
  Part of the Plot workflow. Use on /plot-reject.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.1.4
compatibility: Designed for Claude Code. Requires git and gh CLI.
---

# Plot: Reject Delivery

Reverse a premature delivery — move a plan from Delivered back to Approved so remaining work can be completed. This is the inverse of `/plot-deliver`. RC tags are preserved as historical records.

**Input:** `$ARGUMENTS` is `<slug> [reason]`

Example: `/plot-reject prod-config "5/7 branches unbuilt"`

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
| All (1-7) | Small | Script calls, sprint-file edit — no judgment calls |

All steps are mechanical: parse input, check state, report scope, call `plot-undeliver.sh`, annotate the sprint, commit. The script decides refusals; the skill relays them.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- List delivered plans: `ls docs/plans/delivered/ 2>/dev/null`
- If exactly one exists, propose: "Found delivered plan `<slug>`. Reject it?"
- If multiple exist, list them and ask which one to reject

> **Unattended (`PLOT_UNATTENDED=1`):** stop unless `$ARGUMENTS` named the slug.
> Rejection reverses a recorded delivery — it is a person's correction of a
> person's claim, and there is nothing for an agent to default to.
> `PLOT-UNASKED: Which delivered plan should be rejected? — stopped — <n> candidates; none rejected`
- If none exist, explain: "No delivered plans found in `docs/plans/delivered/`."

Extract `slug` from `$ARGUMENTS` (first word — trimmed, lowercase, hyphens only).

Extract `reason` from remaining arguments (everything after the slug). If no reason provided, ask: "Why is this delivery being rejected?"

### 2. Verify Plan is Delivered

Check that a delivered plan exists for this slug: `ls docs/plans/delivered/<slug>.md`

- If found in `delivered/`: resolve the symlink to find the actual plan file path (e.g., `docs/plans/YYYY-MM-DD-<slug>.md`). Read the plan file and confirm the Phase field says `Delivered`.
- If found in `active/` instead: "Plan `<slug>` is in Approved phase (not yet delivered). Nothing to reject."
- If not found anywhere: "No plan found for `<slug>`."

### 3. Assess Rejection Scope

Read the plan's branches section (heading containing "Branches"). For each branch listed, ask the host through the sourced `plot-pr-merged.sh` helper. It answers one of three readings: `found`, `none`, or `unaskable`.

```bash
. ../plot/scripts/plot-pr-merged.sh
_plot_merged_lookup <branch-name>   # prints found | none | unaskable
```

Skip branches marked with `<!-- deferred: ... -->`.

This step only reports. It decides nothing: the refusal rules live in `plot-undeliver.sh` (step 4), and this step never pre-empts them. Keep `unaskable` apart from `none` — an unreachable host is not an unmerged branch.

Report to the user:

- **N** branches total in plan (excluding deferred)
- **M** branches read `found` (work that was completed)
- **K** branches read `none` (unbuilt — the reason for rejection)
- **U** branches read `unaskable` (host did not answer; listed separately)
- Any deferred branches (listed separately)

Present: "Rejecting `<slug>`: M/N branches were built. K branches remain unbuilt. Reason: *<reason>*. Proceed?"

**Special case:** If ALL non-deferred branches read `found` (fully built), warn: "All plan branches were built and merged. Are you sure this should be rejected rather than fixed with a follow-up?" This catches cases where the issue isn't missing branches but something else (integration bugs, design problems). Require explicit confirmation.

### 4. Revert Plan Phase

Run the controller once:

```bash
bash ../plot/scripts/plot-undeliver.sh <slug> --why "<reason>"
```

The script performs the whole write: `State:` flips to `Approved`, the `Rejected: YYYY-MM-DD (<reason>)` record goes above the kept `Delivered:` line, the state receipt is recorded, and the `delivered/` index entry moves to `active/`. The skill edits none of these by hand. It commits nothing.

**A refusal ends the rejection.** Exit 1 means the domain refused. The script prints the refused rule and writes nothing to the plan. Stop here, do not edit `State:` or either index symlink by hand, and tell the operator the next move for the refusal named:

- `refs-swept` — a branch has no ref, no host `mergedAt`, and a closed unmerged PR, so real work is unaccounted for. Write a new plan that captures the lost work, then retry. Alternatively, confirm the loss is acceptable and handle it outside `/plot-reject`.
- `refs-unknown` — origin or the host did not answer for at least one branch. Retry once both answer. The refusal does not claim anything was deleted.
- Any other refusal — print the script's message whole and stop.

Under `PLOT_UNATTENDED=1`, a refusal ends the run with the script's message in the output.

### 5. Update Sprint File

If the plan has a `Sprint:` field in its Status section, find the corresponding sprint file and locate the `[<slug>]` item.

**Uncheck the item:** `[x]` → `[ ]`

**Update the HTML comment annotation** with what the plan file does not hold:

```markdown
- [ ] [slug] description <!-- reason: <reason>, merged: #54 #55, remaining: branch-a branch-b branch-c -->
```

Where:
- `merged:` lists the PR numbers behind the branches step 3 read `found`
- `remaining:` lists the branch names step 3 read `none`

**No `status:` key.** The plan file carries `State: Rejected` and a dated
`Rejected:` record, and that is what every reader now asks:
`plot-sprint-release.sh` reads the phase through `plot-plan-meta.sh` and scores
the item `withdrawn`. Writing the word here as well would be a second answer to
one question — and measured 2026-09-08 it was never even written: 67 annotated
lines on the estate and **zero** carried `status: rejected`, so the reader
looking for it found nothing while the plan file said so plainly.

If the plan has no `Sprint:` field, skip this step.

### 6. Commit and Push

`plot-undeliver.sh` left the plan file and both index changes in the working tree.

```bash
git add docs/plans/ docs/sprints/
git commit -m "plot: reject <slug> — <reason>"
git push
```

**Important:** RC tags are NEVER deleted. They are preserved as historical records of what was attempted. The rejection commit documents why the delivery was reversed.

### 7. Summary


Print:

```
## Rejected: <slug>

- **Reason:** <reason>
- **Plan file:** docs/plans/YYYY-MM-DD-<slug>.md (unchanged location)
- **Index:** moved from `delivered/` back to `active/`
- **Branches built:** M/N (list merged PRs: #54, #55)
- **Branches remaining:** K (list: branch-a, branch-b, branch-c)
- **Sprint item:** unchecked with rejection metadata
- **RC tags:** preserved (not deleted)
- **Progress:** [ ] Draft > [x] Approved > [ ] Delivered > [ ] Released

**Next:** Build remaining branches, then re-deliver with `/plot-deliver <slug>`.
```

**Tip:** Run `/plot` to see overall status and what to do next.

## Automation Output

When the conversation context indicates automation (see `/plot` for detection rules), append:

```json
{
  "command": "/plot-reject",
  "slug": "<slug>",
  "phase": "Approved",
  "previous_phase": "Delivered",
  "status": "rejected",
  "reason": "<reason>",
  "prs_merged": [{"number": 54}, {"number": 55}],
  "branches_remaining": ["branch-a", "branch-b"],
  "sprint": "<sprint-slug>",
  "next_action": "/plot-deliver",
  "message": "Plan rejected. M/N branches built, K remaining.",
  "progress": {"draft": true, "approved": true, "delivered": false, "released": false}
}
```
