---
name: plot-idea
description: >-
  Create a plan with ceremony matched to the change: answer the two
  ceremony questions (review channel, implementation home) within the
  repo's declared bounds, then create the plan file — on an idea branch
  with a draft PR, on the work branch, or directly on the default branch.
  Part of the Plot workflow. Use on /plot-idea.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.1.0
compatibility: Designed for Claude Code and Cursor. Requires git. Host operations (PRs, default branch) go through plot-host.sh (GitHub or Bitbucket).
---

# Plot: Create Idea

Create a plan for review, with ceremony that scales to the weight of the
change (Manifesto Principles 10 and 11).

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
    <!-- Ceremony bounds (optional; see plot/SKILL.md for all posture keys): -->
    <!-- - **Plan PRs:** required | never | optional -->
    <!-- - **Implementation home:** this repo | <repo list> | none -->
    <!-- - **Hosts plans:** yes | no -->
    <!-- - **Tracker:** none | jira <url> | github-issues | linear <url> -->
    <!-- - **Git host:** github | bitbucket -->

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Parse Input | Small | String parsing |
| 2. Read Ceremony Bounds | Small | plot-config.sh reads, hard gates are mechanical |
| 3. Pre-flight Checks | Small (hard gate), Mid (soft warning) | Slug collision is mechanical; title similarity needs mid-tier |
| 4. Answer the Ceremony Questions | Mid | Weight assessment + recommendation; smaller models ask instead of recommending |
| 5-8. Create Branch through Board Status | Small | Git/host commands, template resolution, file ops |
| 9. Summary | Small | Template formatting |

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

**Intake (Principle 11):** before any mechanics, make sure the problem
picture is complete. If the conversation already contains it, do not
re-ask — but if the idea arrived bare, ask for the brain dump: goal, why,
what's been tried, constraints, deadlines, and any sources that exist
(tickets, meeting notes, threads — ask for them by name and offer to
ingest). A messy dump is better input than a tidy summary; structuring it
is your job, not the user's.

### Batch Mode

If the user provides multiple slugs (comma-separated or as a list), or asks to create multiple plans "in batch" or "together":

1. Parse each `<slug>: <title>` pair
2. Create a single branch: `idea/batch-<first-slug>` (or a name the user provides)
3. Create all plan files on that branch, each with its own file and active symlink
4. Create a single PR titled "Plan: <title1>, <title2>, ..."

The plans are still independent after approval — `/plot-approve` processes each slug separately.

**Detection:** Multiple `:` entries in `$ARGUMENTS`, words like "batch"/"together"/"all at once" in conversation context, or an explicit list of slugs.

Batch mode requires PR review (it exists to bundle plan review); if the
repo declares `Plan PRs: never`, create the plans individually instead.

### 2. Read Ceremony Bounds

Read the repo's declared posture (all optional; defaults preserve
pre-Plot-2 behavior):

```bash
PLAN_PRS=$(../plot/scripts/plot-config.sh get "Plan PRs" "optional")
HOSTS_PLANS=$(../plot/scripts/plot-config.sh get "Hosts plans" "yes")
IMPL_HOME=$(../plot/scripts/plot-config.sh get "Implementation home" "this repo")
TRACKER=$(../plot/scripts/plot-config.sh get "Tracker" "none")
```

**Hard gates — these are not advice:**

- **`Hosts plans: no`** → STOP. This repo refuses plan files (typical:
  a code repo handed over to a client wholesale). Tell the user where
  plans for this code live instead (the `Implementation home` declaration
  of the planning repo, if you can see it; otherwise ask) and offer to
  create the plan there. Never write a plan file here, even on explicit
  request — the config must change first.
- **`Plan PRs: never`** → no idea branch and no plan PR, ever (typical: a
  knowledge/workspace repo where everything lands on the default branch
  directly). The `Review:` answer cannot be `pr`; proceed with the direct
  flow in step 5.

If no posture keys are declared at all, behave as before (PR flow
available) and — once per repo, not per plan — suggest declaring them:
"This repo hasn't declared ceremony bounds; want me to add `Plan PRs` /
`Tracker` / `Git host` keys to its Plot Config?"

### 3. Pre-flight Checks

- Warn if working tree has uncommitted changes (offer to stash)
- If the PR flow is possible (`Plan PRs` ≠ never), verify host CLI auth: `../plot/scripts/plot-host.sh backend` and the matching CLI's auth status
- Check that branch `idea/<slug>` does not already exist (if it does, ask whether to check it out or pick a new name)
- **Duplicate detection:**
  - `ls docs/plans/active/ 2>/dev/null` + `../plot/scripts/plot-host.sh pr-list | jq -r .head | grep '^idea/'` to find existing plans and idea branches
  - **Hard gate:** if a plan with the identical slug already exists (file or branch), stop and ask the user to pick a different name
  - **Soft warning:** if any existing plan title shares 3+ significant words with the proposed title, warn the user and ask to confirm this is intentionally separate work (only check Draft/Approved plans, not Delivered ones)

> **Smaller models:** Skip the title similarity check. Enforce the hard gate (identical slug) only. Ask the user: "Could not check for similar plan titles. Please verify manually that this doesn't overlap with existing plans."

### 4. Answer the Ceremony Questions

Every plan records two independent answers (Manifesto Principle 10).
Decide them now — within the bounds from step 2 — and record them in the
plan's `## Status` block in step 5. Never re-derive them downstream; the
recorded answers drive `/plot-approve`, `/plot-implement`, and
`/plot-deliver`.

**Q1 — `Review:` how is this plan reviewed and approved?**

| Answer | When |
|---|---|
| `pr` | The review needs an addressable async surface: inline discussion, multiple reviewers, remote/autonomous work where the PR is the shared state |
| `in-session` | The reviewer is here: walk the plan through now, record the approval in the file |
| `ballot` | Async decision by several people without PR machinery (per-person ballot files) |

**Q2 — `Impl:` where does implementation happen?**

| Answer | When |
|---|---|
| `own branches` | Plan merges first, implementation branches fan out (multiple reviewable slices) |
| `same branch` | Small, well-described change: the plan rides the work branch and one PR carries plan + code |
| `other repo` | This is a planning repo; code changes happen in the repo(s) named by `Implementation home` |
| `none` | Knowledge-only work — nothing to implement |

**How to decide (lightest-allowed default):**

- A small, well-described change in a code repo → recommend `in-session` +
  `same branch` (one branch, one PR, no extra ceremony).
- Architecture work, multi-party review, or a repo where plot is the
  tracker and merges share state → recommend `pr`.
- `Implementation home` names other repos → `Impl: other repo`.
  `Implementation home: none` → `Impl: none`.
- Unsure → ask both questions in plain words — "who needs to review this,
  and where does the work happen?" — with your recommendation and the
  signal behind it stated (ask-and-advise).

Needing *more* ceremony than the lightest allowed path is what requires a
stated reason — never the reverse. If the user overrides your
recommendation: push back once with your reasoning, then comply and note
the override in the plan's Notes.

> **Smaller models:** don't assess weight — present both question tables
> and ask.

### 5. Create the Plan

```bash
CREATE_DATE=$(date -u +%Y-%m-%d)
TEMPLATE=$(../plot/scripts/plot-config.sh get "Plan template" skills/plot/templates/plan.md)
DEFAULT_BRANCH=$(../plot/scripts/plot-host.sh default-branch)
```

Resolve the plan template via the `Plan template` config key (repo-root-relative path; falls back to the shipped template). Write `docs/plans/${CREATE_DATE}-<slug>.md` from it, substituting `<title>` and `<slug>`, and fill the `Review:` and `Impl:` Status fields with the step-4 answers.

Ask the user what **Type** to use, presenting this reference:

| Type | Use when | Examples |
|------|----------|----------|
| `feature` | New user-facing functionality | API endpoint, UI component, CLI command |
| `bug` | Fixing a defect | Crash fix, data corruption, incorrect output |
| `docs` | Documentation-only | README updates, API docs, guides |
| `infra` | CI, build, tooling, release automation | GitHub Actions, Dockerfile, linter config, deps |

Always ask — don't infer from the title.

**Where the plan file goes depends on the recorded answers:**

- **`Review: pr`** — new branch from the default branch (worktree-safe,
  does not check out the default branch):

  ```bash
  git fetch origin "$DEFAULT_BRANCH"
  git checkout -b idea/<slug> "origin/$DEFAULT_BRANCH"
  ```

- **`Review: in-session` or `ballot`, `Impl: same branch`** — the plan
  rides the work branch: create (or stay on) `feature/<slug>` (or the
  type-appropriate prefix) from the default branch; the plan file is its
  first commit. No idea branch exists in this flow.

- **`Review: in-session` or `ballot`, other `Impl:` answers** — the plan
  commits directly to the current branch (knowledge repos: the default
  branch). No branch is created.

### 6. Create Active Symlink and Commit

```bash
mkdir -p docs/plans/active docs/plans/delivered
ln -s ../${CREATE_DATE}-<slug>.md docs/plans/active/<slug>.md
git add docs/plans/${CREATE_DATE}-<slug>.md docs/plans/active/<slug>.md
git commit -m "plot: <title>"
```

Push per the flow: `git push -u origin idea/<slug>` (PR flow),
`git push -u origin <work-branch>` (same-branch flow), or push the
current branch directly (direct flow — on knowledge repos this is the
default branch, which is the point).

### 7. Create PR (`Review: pr` only)

Create a **draft** PR (plan is still being written/refined):

```bash
../plot/scripts/plot-host.sh pr-create \
  --draft \
  --title "Plan: <title>" \
  --head idea/<slug> \
  --body "## Plan

See [\`docs/plans/${CREATE_DATE}-<slug>.md\`](../blob/idea/<slug>/docs/plans/${CREATE_DATE}-<slug>.md) on this branch.

Refine the plan, then mark ready for review. Once reviewed, run \`/plot-approve <slug>\` to record the approval.

---
*Created with \`/plot-idea\`*"
```

For `in-session`: no PR — the review happens now. Walk the user through
the plan section by section; their go is recorded by `/plot-approve` as
an in-file transition record. For `ballot`: point reviewers at the
committed plan file and collect ballots; `/plot-approve` records the
tally.

### 8. Update Board Status

If `## Plot Config` includes a project board (`owner/number`), update the plan PR status:

```bash
../plot/scripts/plot-update-board.sh <pr-url> "Planning" <owner> <number>
```

If no project board is configured, skip this step.

### 9. Summary — orient, don't enumerate

Close by telling the user where they are and what falls out next, and
why (Principle 11). Adapt to the recorded answers, e.g. for
`in-session` + `same branch`:

> Plan drafted on `feature/<slug>` (`docs/plans/<date>-<slug>.md`) —
> review it with me now; nothing else is created until you approve.
> On your go I record the approval in the file (`/plot-approve <slug>`),
> then `/plot-implement <slug>` starts the work on this same branch —
> one PR at the end carries plan + code.

And for `pr`:

> Plan drafted on `idea/<slug>`, draft PR open — refine, then mark ready
> for review. After review, `/plot-approve <slug>` merges it (that IS
> the approval), and `/plot-implement <slug>` fans out the
> implementation branches.

Always include: `Progress: [x] Draft > [ ] Approved > [ ] Delivered > [ ] Released`.
