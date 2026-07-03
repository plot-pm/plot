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
  version: 1.0.1
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
| All (1-8) | Small | Git/gh commands, file edits — no judgment calls |

All steps are mechanical: parse input, check state, move files, update metadata.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- List delivered plans: `ls docs/plans/delivered/ 2>/dev/null`
- If exactly one exists, propose: "Found delivered plan `<slug>`. Reject it?"
- If multiple exist, list them and ask which one to reject
- If none exist, explain: "No delivered plans found in `docs/plans/delivered/`."

Extract `slug` from `$ARGUMENTS` (first word — trimmed, lowercase, hyphens only).

Extract `reason` from remaining arguments (everything after the slug). If no reason provided, ask: "Why is this delivery being rejected?"

### 2. Verify Plan is Delivered

Check that a delivered plan exists for this slug: `ls docs/plans/delivered/<slug>.md`

- If found in `delivered/`: resolve the symlink to find the actual plan file path (e.g., `docs/plans/YYYY-MM-DD-<slug>.md`). Read the plan file and confirm the Phase field says `Delivered`.
- If found in `active/` instead: "Plan `<slug>` is in Approved phase (not yet delivered). Nothing to reject."
- If not found anywhere: "No plan found for `<slug>`."

### 3. Assess Rejection Scope

Read the plan's branches section (heading containing "Branches"). For each branch listed:

```bash
# Check which branches have merged PRs
gh pr list --state merged --head <branch-name> --json number,title --jq '.[0] | "\(.number) \(.title)"'
```

Skip branches marked with `<!-- deferred: ... -->`.

Report to the user:

- **N** branches total in plan (excluding deferred)
- **M** branches with merged PRs (work that was completed)
- **K** branches without merged PRs (unbuilt — the reason for rejection)
- Any deferred branches (listed separately)

Present: "Rejecting `<slug>`: M/N branches were built. K branches remain unbuilt. Reason: *<reason>*. Proceed?"

**Special case:** If ALL non-deferred branches have merged PRs (fully built), warn: "All plan branches were built and merged. Are you sure this should be rejected rather than fixed with a follow-up?" This catches cases where the issue isn't missing branches but something else (integration bugs, design problems). Require explicit confirmation.

### 4. Revert Plan Phase

Update the plan file (the resolved symlink target, e.g., `docs/plans/YYYY-MM-DD-<slug>.md`):

- Change `**Phase:** Delivered` → `**Phase:** Approved`
- If a `**Delivered:** YYYY-MM-DD` line exists, replace it with: `**Rejected:** YYYY-MM-DD (<reason>)`
- If no Delivered line exists, add `**Rejected:** YYYY-MM-DD (<reason>)` to the Status section
- Preserve all other content — branches, design, approvals, everything stays intact

### 5. Move Symlink Back

Move the symlink from `delivered/` back to `active/`:

```bash
git checkout main && git pull origin main

# Remove from delivered/
git rm docs/plans/delivered/<slug>.md

# Re-create in active/ (same relative symlink pattern)
ln -s ../YYYY-MM-DD-<slug>.md docs/plans/active/<slug>.md

# Stage both the symlink and the plan file (Phase was updated)
git add docs/plans/active/<slug>.md docs/plans/YYYY-MM-DD-<slug>.md
```

(Replace `YYYY-MM-DD-<slug>.md` with the actual date-prefixed filename from the resolved symlink.)

### 6. Update Sprint File

If the plan has a `Sprint:` field in its Status section, find the corresponding sprint file and locate the `[<slug>]` item.

**Uncheck the item:** `[x]` → `[ ]`

**Update the HTML comment annotation** with rejection metadata:

```markdown
- [ ] [slug] description <!-- status: rejected, reason: <reason>, merged: #54 #55, remaining: branch-a branch-b branch-c -->
```

Where:
- `merged:` lists the PR numbers that were successfully completed
- `remaining:` lists the branch names that were never built

If the plan has no `Sprint:` field, skip this step.

### 7. Commit and Push

```bash
git add docs/plans/ docs/sprints/
git commit -m "plot: reject <slug> — <reason>"
git push
```

**Important:** RC tags are NEVER deleted. They are preserved as historical records of what was attempted. The rejection commit documents why the delivery was reversed.

### 8. Summary

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
