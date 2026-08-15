# Sync plan phase transitions to GitHub Projects board columns

> Keep GitHub Projects board status in sync with Plot phase transitions via a shared helper script.

## Status

- **Phase:** Delivered
- **Type:** feature
- **Delivered:** 2026-08-15

## Approval

- **Approved:** 2026-03-15T21:02:30Z
- **Approved by:** eins78
- **Assignee:** eins78

## Changelog

- Plot spoke commands now update the GitHub Projects board Status field when plans transition phases (idea → approve → deliver)

## Motivation

Plot's 4-phase lifecycle (Draft → Approved → Delivered → Released) doesn't map to GitHub Projects' built-in PR automations. GitHub only auto-handles "PR added → Todo" and "PR merged → Done", but Plot has intermediate phases (Planning, Ready, In Progress) that require explicit Status field updates.

Currently Plot only adds PRs to a board via `gh pr edit --add-project`. After that, items sit in whatever default column GitHub assigns. Users must manually drag items between columns — defeating the purpose of the board.

## Design

### Approach

**One script, short references from each spoke.**

Add `scripts/plot-update-board.sh` to the main plot skill. Each spoke skill adds a one-liner calling this script after its phase transition. The script:

1. Accepts: PR URL, target status name, project owner, project number
2. Resolves the project's GraphQL node ID (`gh project view`)
3. Adds the PR to the board and captures the item ID (`gh project item-add` — idempotent)
4. Finds the Status field and the matching option (`gh project field-list`)
5. Calls `gh project item-edit` to set the status
6. Exits silently (exit 0) if: no board configured, token lacks `project` scope, PR URL invalid. Emits a warning to stderr on unexpected errors (e.g., project not found) so agents can log issues without blocking the workflow.

This **replaces** the old `gh pr edit --add-project` approach entirely. One script handles both adding and status-setting. Skills just say "set this PR to this status" — they don't need to know field IDs, GraphQL, or whether the item is already on the board.

### Phase-to-Status Mapping

Based on the GitHub Projects "Kanban" board template (adapted):

| Plot event | Spoke skill | Board Status | Which PR(s) |
|---|---|---|---|
| `/plot-idea` | plot-idea | **Planning** | Plan PR (draft) |
| `/plot-approve` | plot-approve | **Done** | Plan PR (now merged) |
| `/plot-approve` | plot-approve | **Ready** | New implementation PRs |
| impl work starts | (manual — agent calls script) | **In Progress** | Implementation PR being worked on |
| `/plot-deliver` | plot-deliver | **Done** | All implementation PRs |

Note: `/plot-release` and `/plot-reject` don't need board updates. Release items are already Done. Rejection moves a plan from Delivered back to Approved — the impl PRs stay on the board in their current status (typically Done or Ready), which is correct since they may need further work.

### Config Changes

The `## Plot Config` template and `claude-md-snippet.md` need updating:

```markdown
<!-- Optional: uncomment if using a GitHub Projects board -->
<!-- - **Project board:** owner/number (e.g. eins78/5) -->
```

The format changes from `<name> (#<number>)` to `<owner>/<number>` because `gh project` commands need owner + number, not the board name. This is a breaking change — existing adopters must update their `## Plot Config` section.

**GitHub automations note:** Users should disable GitHub Projects' built-in "Pull request merged → Done" and "Item added to project → Todo" automations if using Plot's board sync. The "merged → Done" rule conflicts with implementation PRs: Plot sets new impl PRs to "Ready" on creation, but the built-in rule would override that to "Done" when they're eventually merged (before Plot's `/plot-deliver` runs). The "added → Todo" rule would override Plot's initial status assignment (e.g., "Planning" for plan PRs, "Ready" for impl PRs).

### Script Design: `plot-update-board.sh`

```
Usage: plot-update-board.sh <pr-url> <status> <owner> <project-number>

Arguments:
  pr-url          Full PR URL (e.g. https://github.com/eins78/slideshow-app/pull/17)
  status          Target status name (e.g. "Planning", "Ready", "In progress", "Done")
  owner           GitHub user or org that owns the project (e.g. "eins78")
  project-number  Project number (e.g. "5")

Exit codes:
  0  Success, or gracefully skipped (no board, no scope, item not found)
  1  Usage error (missing arguments)
```

Internally:
1. `gh project view <number> --owner <owner> --format json --jq '.id'` — resolve project GraphQL node ID (needed by `item-edit`)
2. `gh project item-add <number> --owner <owner> --url <pr-url> --format json --jq '.id'` — add to board (idempotent) and capture item ID
3. `gh project field-list <number> --owner <owner> --format json` — find Status field ID + matching option ID for the target status
4. `gh project item-edit --project-id <project-node-id> --id <item-id> --field-id <field-id> --single-select-option-id <option-id>` — set status

**Performance note:** Steps 1 and 3 fetch project metadata that doesn't change between calls. When `/plot-approve` creates multiple impl branches, it calls the script in a loop — redundantly fetching the same metadata each time. The script may cache project node ID and field IDs in a temp file (e.g., `/tmp/plot-board-cache-<owner>-<number>.json`) to avoid repeated API calls during bulk operations.

### Spoke Skill Changes

Each spoke adds a short "Update Board Status" step referencing the script, and **removes** the existing `gh pr edit --add-project` steps (plot-idea step 7, plot-approve step 5). The new script replaces that approach entirely.

Each spoke's `## Model Guidance` table should include the new step as **Small** tier (it's a single shell command).

Example for plot-idea:

```markdown
### N. Update Board Status

If `## Plot Config` includes a project board, update the plan PR status:

    ../plot/scripts/plot-update-board.sh <pr-url> "Planning" <owner> <number>

If no project board is configured, skip this step.
```

### Open Questions

- [x] Board column names — confirmed from real board: Planning, Ready, In progress, Done
- [x] **Consolidate add+update:** Yes. The script handles both adding PRs to the board (`gh project item-add`) and setting status in one call. This replaces `gh pr edit --add-project` everywhere, eliminating the old board name config format. One script, one config format (`owner/number`).
- [x] **"In Progress" handling:** Manual. The agent calls the script when starting work on an impl branch. No new infrastructure (GitHub Actions, hooks). Consistent with Manifesto — board is a convenience, not source of truth. If the agent forgets, items stay in "Ready" until delivered.

## Branches

- `feature/board-sync` — Add `plot-update-board.sh` script, update spoke skills with board sync references, update config template → #8

## Notes

- Real board structure from eins78's project #5: Status field has Planning, Ready, In progress, Done
- Also has Priority (P0/P1/P2) and Size (XS/S/M/L/XL) fields — not in scope for this plan but could be useful for sprint integration later
- The `gh project` CLI requires `project` scope on the token — add via `gh auth refresh -s project`

Delivered 2026-08-15, five months after PR #8 merged — the work shipped in
releases long before it was booked. A refutation pass over the mapping table at
delivery time found the third transition (new implementation PRs → **Ready**)
had never been built. It was written for Plot 1, where `/plot-approve` created
the implementation branches; Plot 2 moved that to `/plot-implement` and the
transition did not move with it. Closed in #98 before this plan was delivered,
so all five transitions now exist.

Nothing failed loudly in between, which is the lesson: a board update that never
happens is indistinguishable from a board nobody configured. `plot-update-board.sh`
still has no test.
