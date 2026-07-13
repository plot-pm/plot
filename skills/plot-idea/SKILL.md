---
name: plot-idea
description: >-
  Create a plan for review: idea branch, plan file, and draft PR.
  Part of the Plot workflow. Use on /plot-idea.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.1
compatibility: Designed for Claude Code and Cursor. Requires git. Currently uses gh CLI for forge operations, but the workflow works with any git host that supports pull request review.
---

# Plot: Create Idea

Create a plan for review: idea branch, plan file, and draft PR.

**Input:** `$ARGUMENTS` in the format `<slug>: <title description>`

Example: `/plot-idea sse-backpressure: Handle SSE client disconnects gracefully`

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
| 1. Parse Input | Small | String parsing |
| 2. Pre-flight Checks | Small (hard gate), Mid (soft warning) | Slug collision is mechanical; title similarity needs mid-tier |
| 3-7. Create Branch through Board Status | Small | Git/gh commands, template resolution (`plot-config.sh get "Plan template"`), file ops |
| 8. Summary | Small | Template formatting |

The entire skill is small-model capable except the soft duplicate warning (title similarity in step 2).

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- Look at the conversation context for clues about what the user wants to plan
- If obvious, propose: "It looks like you want to plan `<slug>: <title>`. Shall I proceed?"
- Otherwise ask: "What's the idea? Usage: `/plot-idea <slug>: <title>`"

Extract `slug` and `title` from `$ARGUMENTS`:
- Everything before the first `:` is the slug (trimmed)
- Everything after is the title (trimmed)
- If no `:` found, treat the entire input as the slug and ask for a title
- Slug must match `[a-z0-9-]+` (lowercase letters, digits, hyphens only). If it doesn't, ask the user to fix it rather than silently normalizing

### Batch Mode

If the user provides multiple slugs (comma-separated or as a list), or asks to create multiple plans "in batch" or "together":

1. Parse each `<slug>: <title>` pair
2. Create a single branch: `idea/batch-<first-slug>` (or a name the user provides)
3. Create all plan files on that branch, each with its own file and active symlink
4. Create a single PR titled "Plan: <title1>, <title2>, ..."

The plans are still independent after approval — `/plot-approve` processes each slug separately.

**Detection:** Multiple `:` entries in `$ARGUMENTS`, words like "batch"/"together"/"all at once" in conversation context, or an explicit list of slugs.

### 2. Pre-flight Checks

- Warn if working tree has uncommitted changes (offer to stash)
- Verify `gh auth status` has project scope
- Check that branch `idea/<slug>` does not already exist (if it does, ask whether to check it out or pick a new name)
- **Duplicate detection:**
  - `ls docs/plans/active/ 2>/dev/null` + `gh pr list --json headRefName --jq '.[].headRefName' | grep '^idea/'` to find existing plans and idea branches
  - **Hard gate:** if a plan with the identical slug already exists (file or branch), stop and ask the user to pick a different name
  - **Soft warning:** if any existing plan title shares 3+ significant words with the proposed title, warn the user and ask to confirm this is intentionally separate work (only check Draft/Approved plans, not Delivered ones)

> **Smaller models:** Skip the title similarity check. Enforce the hard gate (identical slug) only. Ask the user: "Could not check for similar plan titles. Please verify manually that this doesn't overlap with existing plans."

### 3. Create Branch

Create a new branch from `origin/main` — this is worktree-safe (does not check out main):

```bash
git fetch origin main
git checkout -b idea/<slug> origin/main
```

### 4. Create Plan File

```bash
CREATE_DATE=$(date -u +%Y-%m-%d)
TEMPLATE=$(../plot/scripts/plot-config.sh get "Plan template" skills/plot/templates/plan.md)
```

Resolve the plan template via the `Plan template` config key: if the adopting project sets `Plan template` in its `## Plot Config` (a repo-root-relative path), that file is used; otherwise it falls back to the shipped `skills/plot/templates/plan.md`. Read `$TEMPLATE` and write `docs/plans/${CREATE_DATE}-<slug>.md` from it, substituting `<title>` and `<slug>`. A project's own template wins — but as an explicit opt-in via the config key, not by hardcoding a path here.

Ask the user what **Type** to use, presenting this reference:

| Type | Use when | Examples |
|------|----------|----------|
| `feature` | New user-facing functionality | API endpoint, UI component, CLI command |
| `bug` | Fixing a defect | Crash fix, data corruption, incorrect output |
| `docs` | Documentation-only | README updates, API docs, guides |
| `infra` | CI, build, tooling, release automation | GitHub Actions, Dockerfile, linter config, deps |

Always ask — don't infer from the title.

### 5. Create Active Symlink and Commit

```bash
mkdir -p docs/plans/active docs/plans/delivered
ln -s ../${CREATE_DATE}-<slug>.md docs/plans/active/<slug>.md
git add docs/plans/${CREATE_DATE}-<slug>.md docs/plans/active/<slug>.md
git commit -m "plot: <title>"
git push -u origin idea/<slug>
```

### 6. Create PR

Create a **draft** PR (plan is still being written/refined):

```bash
gh pr create \
  --draft \
  --title "Plan: <title>" \
  --body "$(cat <<'EOF'
## Plan

See [`docs/plans/${CREATE_DATE}-<slug>.md`](../blob/idea/<slug>/docs/plans/${CREATE_DATE}-<slug>.md) on this branch.

Refine the plan, then mark ready for review with `gh pr ready`. Once reviewed, run `/plot-approve <slug>` to merge and start implementation.

---
*Created with `/plot-idea`*
EOF
)"
```

### 7. Update Board Status

If `## Plot Config` includes a project board (`owner/number`), update the plan PR status:

```bash
../plot/scripts/plot-update-board.sh <pr-url> "Planning" <owner> <number>
```

If no project board is configured, skip this step.

### 8. Summary

Print:
- Branch: `idea/<slug>`
- Plan file: `docs/plans/<CREATE_DATE>-<slug>.md`
- Active index: `docs/plans/active/<slug>.md` (symlink)
- PR URL (draft)
- Progress: `[x] Draft > [ ] Approved > [ ] Delivered > [ ] Released`
- Suggested next actions:
  1. Refine the plan (especially **Branches** and **Design** sections)
  2. When ready for review: `gh pr ready <number>`
  3. After review: `/plot-approve <slug>`
  - _Alternative:_ add to a sprint with `/plot-sprint <sprint> ` then add `[<slug>]` as an item
