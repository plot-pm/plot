---
name: plot-reconcile
description: >-
  Plot/branch hygiene sweep — enumerate plan phase↔symlink drift,
  merged-but-not-delivered plans, and stale branches. Read-only; prints
  remediating commands, the human decides what to run. Use on /plot-reconcile.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.0
compatibility: >-
  Designed for Claude Code. Requires git and jq; gh (GitHub) or bb (Bitbucket)
  CLI adds open-PR precision — without one the sweep degrades to git
  merge-state.
---

# Plot: Reconcile

The periodic reconciliation pass for the plot workflow. It closes the loop that per-delivery attention misses: drift only becomes visible in aggregate, across dozens of plans and branches. This command surfaces it so a stale symlink, an un-delivered plan, or a merged-but-undeleted branch gets caught in one sweep instead of rediscovered by hand every few weeks.

Run it on a cadence (weekly fits), and especially **after a delivery batch**, when drift is freshest — a `/plot-deliver` that half-lands (symlink moved, phase not flipped) is exactly what this catches. It is **read-only**: it prints the exact remediating command for every finding but never runs it. The judgment — is this branch still relevant, should this plan be delivered or rejected — stays yours.

**Input:** `$ARGUMENTS` is optional. Pass `--no-fetch` to skip the `git fetch` (offline, or when you just fetched).

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
    - **Sprint directory:** docs/sprints/
    <!-- Optional: only when origin/HEAD detection picks the wrong branch -->
    <!-- - **Main branch:** develop -->

The scan reads the plan directory, both indexes, and the branch prefixes from
`## Plot Config` (via the shared `plot-config.sh` accessor), falling back to
plot's defaults. Branches are compared against the **main branch**, detected
from `origin/HEAD` (self-healing via `git remote set-head origin -a` during
the fetch); set `- **Main branch:** <name>` only when that detection is wrong
for your setup.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| Stage 1 — Scan | Small | Run the script, read structured output. No judgment. |
| Stage 2 — Act | Frontier | Which drift to fix, whether a branch is truly stale, whether a plan should be delivered or rejected — semantic judgment on unstructured state. |

The scan is mechanical; a small model can run it and relay the report verbatim. Deciding *what to do* about each finding — especially stale-branch deletion and orphan branches ahead of the main branch — is where a frontier tier earns its keep. Smaller tiers should present the findings and ask the human rather than act.

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.

## What you do

This is a **two-stage** review: a deterministic extraction you trust, then the decisions only you can make.

### Stage 1 — Scan (computational, trust it)

Run the scanner (it lives in the plot skill's `scripts/` directory, next to the other helpers) from anywhere inside the adopting project — it operates on the repo you are in:

```bash
../plot/scripts/plot-reconcile-scan.sh            # full sweep (fetches origin first)
../plot/scripts/plot-reconcile-scan.sh --no-fetch # skip the fetch (offline / just-fetched)
```

It reads `origin/*` refs plus the configured plan directory and emits five sections, each finding carrying its exact remediating command as copy-paste text:

1. **Phase↔symlink drift** — a plan whose phase disagrees with which index dir (`active/` vs `delivered/`) its symlink lives in. The `Delivered` + still-in-`active/` case is the classic half-delivery failure mode.
2. **Merged-but-not-delivered** — a plan still `Approved` whose impl branch (resolved from the `## Branches` `→ #NNN` links) is already merged to the main branch. Candidate `/plot-deliver`.
3. **Stale branches** — remote branches under a configured prefix with no open PR: merged into the main branch → deletion candidates; ahead of it → orphans needing judgment. The main branch and `release/*` are never listed.
4. **Concurrent-delivery check** — each active plan's impl branch shown as ahead/behind `origin/<main>`, so a parallel session's delivery is visible before you act on the same plan.
5. **Needs attention** — malformed or non-conforming plans: no phase field (pre-plot legacy), an unrecognized phase value, a front-matter `status:`/`phase:` disagreement, or a dated plan with no symlink in either index. Skip-and-warn — never a crash, never silent.

Plan files are parsed by the shared `plot-plan-meta.sh` parser, which understands both the canonical `## Status` body format (`- **Phase:** …`) and YAML front matter (`status:`/`phase:`). Do not re-derive this list by hand; the script is the source of truth for *what the state is*. Your job is *what to do about it*.

**PR state, bound to origin's forge.** The scan enumerates open-PR branches with the CLI matching the `origin` remote's host — `gh` on GitHub, `bb` on Bitbucket — never a CLI's own idea of the "current repo" (a second remote on another forge must not win). Without a matching CLI it prints `PR state: DEGRADED` and falls back to git merge-state alone; in that mode the stale-branch section may list a branch that still has an open PR, so confirm each before deleting.

**Summary footer.** The report's final line is machine-countable — consumers that only need counts (the `/plot` hygiene line, the Automation Output below) read it instead of parsing section bodies:

```
summary: drift=1 merged_not_delivered=1 stale=3 attention=0 concurrent=1 pr_source=gh main=main
```

### Stage 2 — Act (your judgment)

For each finding, decide whether to run the printed command. The scan never runs them; you do, deliberately.

- **Drift + orphans:** almost always safe to fix — run the printed `git rm … && ln -s … && git add -A` (one `git add -A`, so the flip and the symlink move commit together — a per-path `git add` on the removed path aborts staging and ships a half-fix).
- **Merged-but-not-delivered:** run `/plot-deliver <slug>` — but first `git fetch` and check section 4's counts; a parallel session may already be delivering it.
- **Stale branches:** confirm the branch is truly done (no open PR, work landed) before `git push origin --delete`. Orphans (ahead of the main branch) need a real look — `git log` them first; they may be unfinished work, not trash.
- **Needs attention → legacy (no phase field):** these are pre-plot historical plans. Leave them (no backfill) unless you're deliberately adopting one into the plot lifecycle. They are listed for visibility, not as a to-do.

Batch the fixes you choose into one commit, then re-run the scan to confirm the sections you acted on are clear.

## Output

You produce **text only** — a short summary of what the scan found and which findings you recommend acting on, ordered by safety (drift/orphans first, branch deletions last). You do NOT apply fixes automatically; you present them and let the human run the ones they choose (or run them yourself only on explicit confirmation, one batch, then re-scan).

## What you must NOT do

- **Do not let the command mutate anything on its own.** The scan is read-only by construction; keep it that way. Symlink moves, phase flips, and branch deletions happen only when the human runs a printed command (or explicitly tells you to run a batch).
- **Do not flag legacy plans as errors.** A plan with no phase field is pre-plot history, not a defect. Report the count; don't propose fixing all of them.
- **Do not delete a branch the scan degraded on.** If no forge CLI was available, the "no open PR" signal is unverified — confirm before any deletion.
- **Do not re-derive the state by hand.** Trust the scan for *what is*; spend your judgment on *what to do*.

**Tip:** Run `/plot` to see overall status and what to do next.

## Automation Output

When the conversation context indicates automation (see `/plot` for detection rules), append:

```json
{
  "command": "/plot-reconcile",
  "main_branch": "main",
  "pr_source": "gh",
  "findings": {
    "drift": 0,
    "merged_not_delivered": 0,
    "stale_branches": 0,
    "needs_attention": 0
  },
  "info": {
    "concurrent_delivery": 0
  },
  "actions_taken": [],
  "message": "Sweep complete. This report is advisory — nothing was changed.",
  "next_action": null
}
```

`pr_source` is `gh`, `bb`, or `degraded`. Section 4 (concurrent-delivery) is informational — divergence counts, not defects — so it reports under `info`, not `findings`. Fill every count from the scan's `summary:` footer line — do not re-count section bodies.
