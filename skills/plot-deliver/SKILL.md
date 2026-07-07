---
name: plot-deliver
description: >-
  Verify all implementation is done, then deliver the plan.
  Part of the Plot workflow. Use on /plot-deliver.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.1
compatibility: Designed for Claude Code and Cursor. Requires git. Currently uses gh CLI for forge operations, but the workflow works with any git host that supports pull request review.
---

# Plot: Deliver Plan

Verify all implementation is done, then deliver the plan. This workflow can be run manually (using git and forge CLI), by an AI agent interpreting this skill, or via a workflow script (once available).

For docs/infra work, this is the end — live when merged. For features/bugs, `/plot-release` follows when the team is ready to cut a versioned release.

**Input:** `$ARGUMENTS` is the `<slug>` of a plan on main.

Example: `/plot-deliver sse-backpressure`

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
| 1-4. Parse through Verify PRs | Small | Git/gh commands, helper script, state checks |
| 5. Verify Completeness | Frontier (orchestrator) + Small (subagents) | Orchestrator extracts deliverables and consolidates; small subagents gather PR diffs in parallel |
| 6. Release Note Check | Small | File existence checks |
| 7-8. Deliver and Board Status | Small | File ops, git commands, board sync |
| 7b. Delivery-Landed Gate | Small | Run the reconcile scan, grep for the delivered plan; gate progression on the real grep result |
| 9. Summary | Small | Template formatting |

Step 5 is the prime example of subagent delegation: a frontier orchestrator handles the judgment (extracting deliverables, consolidating Done/Partial/Missing), while small subagents handle the data collection (running `gh pr diff`, reading PR metadata) in parallel. Without subagents, the frontier model does everything sequentially.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

### 1. Parse Input

If `$ARGUMENTS` is empty or missing:
- List active plans: `ls docs/plans/active/ 2>/dev/null`
- If exactly one exists, propose: "Found plan `<slug>`. Deliver it?"
- If multiple exist, list them and ask which one to deliver
- If none exist, explain: "No active plans found in `docs/plans/active/`."

Extract `slug` from `$ARGUMENTS` (trimmed, lowercase, hyphens only).

### 2. Verify Plan Exists

Check that an active plan exists for this slug: `ls docs/plans/active/<slug>.md` on main.

- If not in `active/`, check `docs/plans/delivered/<slug>.md` — if found there: "Already delivered."
- Also check the Phase field in the plan file — if already `Delivered`, stop.
- If not found anywhere: "No plan found for `<slug>`."

Resolve the symlink to find the actual plan file path (e.g., `docs/plans/YYYY-MM-DD-<slug>.md`).

### 3. Read and Parse Plan

Read the plan file (resolved from the `active/` symlink) and find the section headed with "Branches" (matches `## Branches`, `## Implementation Branches`, `### Implementation Branches`, or any heading containing the word "Branches"). Parse it for PR references. If the plan has a `Sprint: <name>` field in its Status section, extract it for the summary.

Expected format after `/plot-approve`:
```markdown
- `feature/name` — description → #12
```

### 4. Verify All PRs Merged

Run the helper:

```bash
../plot/scripts/plot-impl-status.sh <slug>
```

Or for each PR number found in the Branches section:

```bash
gh pr view <number> --json state,isDraft --jq '{state: .state, isDraft: .isDraft}'
```

- If all are `MERGED`: proceed to step 5
- If any are `OPEN`:
  - If any open PRs have `isDraft: true`, list them and run `gh pr ready <number>` to mark each one ready for review — this is part of the delivery flow, not optional
  - List all remaining open PRs and ask the user: "These PRs are still open. Merge them first, or deliver anyway?"
  - If user declines, stop and list the unfinished PRs
- If any are `CLOSED` (not merged): warn — these need manual attention

### 4b. Verify All Plan Branches Accounted For

Re-read the plan's branches section (heading containing "Branches"). For each branch listed (skipping branches marked with a deferred annotation):

**Deferred annotation format:** `<!-- deferred: <reason> -->` — must begin with exactly `<!-- deferred:` (case-sensitive, with colon and space). Appears at end of a branch line. Branches without this exact prefix are NOT considered deferred.

For each non-deferred branch:

1. Check if a merged PR exists for that branch: `gh pr list --state merged --head <branch-name> --json number`
2. If no merged PR exists for the exact branch name, check if another merged PR covers that branch's scope (e.g., branches were consolidated into fewer PRs)
3. If a branch has no merged PR AND no consolidation evidence, it is **unaccounted for**

**If any branches are unaccounted for:**
- List them with their descriptions from the plan
- Ask: "These plan branches have no merged PRs. Were they consolidated into other PRs, deferred, or not yet implemented?"
- If deferred or not implemented: **stop delivery** — "Cannot deliver: N branches have no implementation. Build them first, or update the plan to remove/defer them."
- If consolidated: user confirms which PR covers the scope, proceed

**This is a hard gate.** Do not proceed to Step 5 if branches are unaccounted for.

### 5. Verify Plan Completeness

> **Model tiers for this step:**
> - **Frontier (e.g., Opus):** Full deliverable extraction, parallel PR diff review via subagents (small-model subagents gather diffs, frontier consolidates), Done/Partial/Missing checklist.
> - **Mid (e.g., Sonnet):** Extract deliverables and check PR titles/descriptions (skip full diff review). Can delegate PR metadata collection to small subagents. Present a simplified checklist based on PR metadata rather than code changes. Ask user to verify.
> - **Small (e.g., Haiku):** Skip entirely. Verify all PRs are merged (step 4), then ask: "All implementation PRs are merged. Ready to deliver this plan?" Human judgment is the final gate.

Compare what the plan promised against what was actually delivered.

1. **Extract deliverables** from the plan file. Look for actionable items in sections like `## Design`, `## Branches`, or bulleted lists that describe what should be built. Number each deliverable for reference.

2. **Gather PR evidence using parallel subagents.** Launch one Task agent per merged PR to review what was implemented:
   - Each agent receives the PR number and the full list of deliverables.
   - Each agent runs `gh pr diff <number>` and reads the PR body via `gh pr view <number> --json title,body,files`.
   - Each agent returns: which deliverables (by number) are addressed by that PR, with a one-line summary of the evidence for each.
   - Launch all PR agents in parallel since they are independent.

3. **Consolidate results.** Merge the per-PR reports into a single checklist. For each deliverable, mark it:
   - **Done** — clear evidence in one or more PRs
   - **Partial** — some work done but not fully matching the plan
   - **Missing** — no evidence found in any PR

4. **Present the checklist** to the user and **ask to confirm** the plan is complete enough to deliver.
   - If all items are done: "All deliverables verified. Proceed with delivery?"
   - If any are partial/missing: list them and ask "Deliver anyway, or hold off?"
   - If the user declines, stop — do not deliver.

### 6. Check for Release Note Entries

For feature and bug plans, check whether release note entries exist:

**Discover release note tooling** — check in this order, stop at first match:

1. **Changesets:** Does `.changeset/config.json` exist? If so, the project uses `@changesets/cli`. Check if `.changeset/*.md` files (excluding README.md) exist on main.
2. **Project rules:** Read `CLAUDE.md` and `AGENTS.md` for release note instructions (e.g., custom scripts, specific commands).
3. **Custom scripts:** Check `package.json` for release-related scripts (e.g., `release`, `version`, `changelog`).

If no tooling is found, skip this step.

If tooling was found but no release note entries exist for this plan's work, **warn** the user: "No release note entries found for this feature. Consider adding one before releasing."

This is a warning, not a blocker — proceed with delivery regardless.

Skip this step entirely for docs/infra plans (they don't need release notes).

### 7. Deliver Plan

The plan file stays in place — only the symlink moves from `active/` to `delivered/`.

Do **not** check out main locally (see Branch Safety in the hub skill). Use a disposable branch:

```bash
git fetch origin main
git checkout -b plot/deliver-<slug> origin/main

# Update Phase field in the plan file
# Change **Phase:** Approved → **Phase:** Delivered
# Add - **Delivered:** YYYY-MM-DD to the Status section
DELIVER_DATE=$(date -u +%Y-%m-%d)

# Move symlink from active/ to delivered/
# (mkdir -p first — a fresh adopter repo has no delivered/ yet, and a bare
#  `ln -s` into a missing dir half-lands the delivery: phase flips, symlink doesn't move.)
mkdir -p docs/plans/delivered
git rm docs/plans/active/<slug>.md
ln -s ../YYYY-MM-DD-<slug>.md docs/plans/delivered/<slug>.md
git add docs/plans/delivered/<slug>.md docs/plans/YYYY-MM-DD-<slug>.md
```

**Update sprint file** (if the plan has a `Sprint:` field): find the `[<slug>]` item in the sprint file.

**Before checking the box:** re-read the plan's branches section (heading containing "Branches"). For each branch (skipping branches marked `<!-- deferred: ... -->`), verify its PR is merged via `gh pr view <N> --json state`. If ANY non-deferred branch PR is not merged, do NOT check the sprint item — warn and list unmerged branches.

When all branches are verified merged, check the box and update annotation:

```markdown
- [x] [slug] description <!-- status: delivered, pr: #<primary>, branches: N/N -->
```

```bash
git add docs/sprints/
git commit -m "plot: deliver <slug>"
git push origin plot/deliver-<slug>:main
```

(Replace `YYYY-MM-DD-<slug>.md` with the actual date-prefixed filename from the resolved symlink.)

### 7b. Delivery-Landed Gate

Delivery is a multi-step write (flip phase, move symlink, commit, push) — the biggest drift source in practice is a delivery that half-lands. This step is a **gate, not a rule**: the objective, checkable condition is *the reconcile scan's own output shows no drift for the plan you just delivered*. You cannot answer "did the delivery land?" without running the scan and reading its result — so run it, and **show the real output**. Do not declare delivery complete (do not proceed to the Summary) on a self-asserted claim; proceed only on the pasted evidence below.

Run the scan and capture both its `summary:` footer and the targeted grep:

```bash
../plot/scripts/plot-reconcile-scan.sh 2>/dev/null | tee /tmp/plot-deliver-gate.txt | grep "YYYY-MM-DD-<slug>.md"
tail -1 /tmp/plot-deliver-gate.txt   # the summary: footer — paste this as the gate artifact
```

Read the **grep's exit result**, which is the gate condition (the scan fetches first, so it sees the delivery push; the dated basename appears only in plan-finding lines — sections 1, 2, and 5):

- **grep printed a line (exit 0) → the delivery half-landed.** This is a hard stop. Show the finding and its printed `fix:` command, apply it (with confirmation), then **re-run the scan and grep** — repeat until the grep is empty. Only an empty grep on a real run clears the gate.
- **grep printed nothing (exit 1) → gate cleared.** Carry the actual `summary:` footer line forward as the Summary's gate evidence.

Two expected non-failures (neither trips the gate — the grep does not match branch lines):

- The just-merged **impl branches** may now show in section 3 as deletion candidates — that is normal post-delivery housekeeping, not a failed delivery. Mention it in the summary as optional cleanup (the printed `git push origin --delete <branch>` commands), don't act unasked.
- If the scan is genuinely unavailable (older plot install, or it errors — e.g. `jq` missing, which the scan now reports on stderr and exits non-zero), you cannot clear the gate by asserting success. Skip the step **explicitly**, and say so in the Summary in place of the gate evidence: `Delivery-landed gate: SKIPPED — scan unavailable (<reason>)`. The delivery itself is unaffected, but the reader must see the check did not run.

### 8. Update Board Status

If `## Plot Config` includes a project board (`owner/number`), update all implementation PRs to "Done":

For each merged implementation PR from the Branches section:

```bash
../plot/scripts/plot-update-board.sh <impl-pr-url> "Done" <owner> <number>
```

If no project board is configured, skip this step.

### 9. Summary

Print:
- Delivered: `<slug>`
- Plan file: `docs/plans/YYYY-MM-DD-<slug>.md` (unchanged location)
- Index: moved from `active/` to `delivered/`
- All implementation PRs: merged
- Delivery-landed gate: paste the **actual** `summary:` footer line the scan produced in step 7b (the objective artifact — not the words "verified" or "clean"), e.g. `summary: drift=0 merged_not_delivered=0 stale=… attention=0 concurrent=… pr_source=… main=…`. If the gate was skipped, print `Delivery-landed gate: SKIPPED — scan unavailable (<reason>)` instead. Add any optional branch-cleanup commands the scan suggested.
- If the plan has a Sprint field: show sprint progress ("N/M sprint items delivered")
- Progress: `[ ] Draft > [ ] Approved > [x] Delivered > [ ] Released`
- Type reminder:
  - If feature/bug: "Run `/plot-release` when ready to cut a versioned release."
  - If docs/infra: "Live on main — no release needed."
- Tip: Run `/plot` to see overall status and what to do next
