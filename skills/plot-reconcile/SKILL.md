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
  version: 1.4.2
compatibility: >-
  Designed for Claude Code. Requires git and jq; gh (GitHub) or bb (Bitbucket)
  CLI adds open-PR precision — without one the sweep degrades to git
  merge-state.
---

# Plot: Reconcile

The periodic reconciliation pass for the plot workflow. It closes the loop that per-delivery attention misses: drift only becomes visible in aggregate, across dozens of plans and branches. This command surfaces it so a stale symlink, an un-delivered plan, or a merged-but-undeleted branch gets caught in one sweep instead of rediscovered by hand every few weeks.

Run it on a cadence (weekly fits), and especially **after a delivery batch**, when drift is freshest — a `/plot-deliver` that half-lands (symlink moved, phase not flipped) is exactly what this catches. It is **read-only**: it prints the exact remediating command for every finding but never runs it. The judgment — is this branch still relevant, should this plan be delivered or rejected — stays yours.

**Input:** `$ARGUMENTS` is optional. `--no-fetch` skips the `git fetch` (offline, or when you just fetched); `--no-pr` skips the git-host `pr list` call; `--offline` skips both (a fully network-free sweep — what the `/plot` hygiene line uses). Flags combine in any order. For the explicit `/plot-reconcile` command, run the **full** sweep (no flags) so the stale-branch section is accurate against the git host.

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

> **Unattended (`PLOT_UNATTENDED=1`):** relay the report and act on nothing.
> This command is read-only by design — it prints remediating commands and a
> human decides which to run — so the unattended path is simply the whole
> command: the scan runs, the findings print, and no branch is deleted.
> `PLOT-UNASKED: Which of the <n> findings should be remediated? — stopped — report relayed; nothing deleted, nothing pushed`

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor) for all questions, proposals, and confirmations.
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

## What you do

This is a **two-stage** review: a deterministic extraction you trust, then the decisions only you can make.

### Stage 1 — Scan (computational, trust it)

Run the scanner (it lives in the plot skill's `scripts/` directory, next to the other helpers) from anywhere inside the adopting project — it operates on the repo you are in:

```bash
../plot/scripts/plot-reconcile-scan.sh            # full sweep (fetches origin first)
../plot/scripts/plot-reconcile-scan.sh --no-fetch # skip the fetch (offline / just-fetched)
../plot/scripts/plot-reconcile-scan.sh --offline  # no network at all (skips fetch + git-host pr list)
```

It reads `origin/*` refs plus the configured plan directory and emits seven sections, each finding carrying its exact remediating command as copy-paste text:

1. **Phase↔symlink drift** — a plan whose phase disagrees with which index dir (`active/` vs `delivered/`) its symlink lives in. The `Delivered` + still-in-`active/` case is the classic half-delivery failure mode.
2. **Merged-but-not-delivered** — a plan still `Approved` whose impl branch (resolved from the `## Branches` `→ #NNN` links) is already merged to the main branch. Candidate `/plot-deliver`.
3. **Stale branches** — remote branches under a configured prefix with no open PR: merged into the main branch → deletion candidates; ahead of it → orphans needing judgment, unless the branch is *contained in an open PR* (see below). The main branch and `release/*` are never listed.
### Contained in an open PR (inside section 3)

A branch that is an **ancestor of some open PR's head** is work in flight on a
stack, not abandoned work. The scan lists it separately and it does **not**
count toward `stale=`:

```
  -- contained in an open PR (work in flight, not stale) --
  origin/feature/stack-base — contained in open PR #200 → not orphaned
```

Being the head of an open PR was always recognised; being *below* one was not,
so every branch under the top of a stack read as an orphan.

This test runs **after** the claim check, and the obvious justification for
that order is wrong. An empty claim is an ancestor of nothing — its claim
commit puts it one commit *ahead* of the branch point. The real case is the
reverse: once a worker builds on its claim, the claim commit becomes part of
the working branch, which is typically the head of the PR it opens. Such a
claim is legitimately contained in an open PR, and must still be reported as a
**claim**, because that is the more specific fact.

Containment is only asked for *unmerged* branches. A merged branch is an
ancestor of the main branch, and therefore of every open PR branched from it —
asking earlier would swallow the whole deletion-candidate class.

### Claims (inside section 3)

A branch whose only commits beyond main are **empty `plot: claim …` markers**
is a claim: a dispatcher pushed it to take that work. Two very different situations leave that
identical artifact, and git cannot tell them apart:

| Plan says | Meaning | Report |
|---|---|---|
| `deferred:` / `moved:` on that branch | the worker gave it up deliberately | **abandoned claim** — deletion candidate, with the command |
| a bare `claimed:`, or nothing | the worker may be thinking, or may be dead | **needs judgment** — no deletion command offered |

Reading the plan annotation here is the one deliberate exception to "git is the
truth, the annotation is only a reflection". It is safe because this gate
decides *cleanup*, not *work*: a wrong annotation costs at most a missed
cleanup, never lost or duplicated work.

**Never offer to delete a claim that was not explicitly given up.** A worker
that is simply slow looks exactly like a dead one, and deleting its branch
destroys work in progress. Check `/plot-pulse` and the worker's log
(`../plot-wt-*/.plot-worker.log`) before deciding.

4. **Concurrent-delivery check** — each active plan's impl branch shown as ahead/behind `origin/<main>`, so a parallel session's delivery is visible before you act on the same plan.
5. **Needs attention** — malformed or non-conforming plans: an unrecognized phase value, a front-matter `status:`/`phase:` disagreement, or a **dangling index symlink** (a link in `active/`/`delivered/` whose target no longer exists). Skip-and-warn — never a crash, never silent.
6. **Delivered but already released** — a `Delivered` plan whose merge commit is already inside a release tag. Candidate `/plot-release`.
7. **Uncut slices** — a `### ` wave heading carrying more than one branch line. A wave holds one branch; one holding several is a shape `/plot-reslice` can repair. Actionable but non-blocking; see below.
8. **Prose wave names** — a `### ` wave heading written as a sentence, not a label. A sentence-length name paints over the cells beside it on the board; the fix is to rename the heading in the plan. Actionable but non-blocking; see below.
9. **Index drift (convenience)** — a plan with no symlink in either index, or a `.md` file in the plan directory carrying no `Phase:` field at all. Nothing depends on either; see below.

### Why an unlinked plan is not a defect (and what still is)

The index directories used to be the query path: `plot-fleet-scan.sh` globbed
`active/`, so a plan with no symlink was genuinely unreachable — invisible to
every unscoped pulse, absent from the board, undispatchable. Calling it
*orphaned* and counting it as attention was accurate.

Since the phase grouping became derived from plan content, the same plan is
visible everywhere that decides anything. The symlinks now buy human browsing
and stable slug-named paths, so a missing one is a **convenience** finding: it
is printed with an `optional:` command in section 9 and deliberately kept out
of `attention=`, because that count gates `/plot-deliver`'s delivery-landed
check and the `/plot` hygiene line, and a cosmetic gap must not hold up a
delivery.

Two things kept their severity, and both stay in section 5:

- **A dangling symlink.** A link pointing at nothing is a broken pointer —
  `cat active/foo.md` fails and a bookmarked path 404s. No `fix:` command is
  offered: repointing it at a renamed plan and removing a link whose plan is
  gone are different remedies, and the script cannot tell which applies.
- **An unrecognized phase value.** The file *declared* a phase; the parser did
  not recognise it. That is a plan with a bad field.

**A file with no `Phase:` field is not a plan** — the same rule
`plot-fleet-scan.sh` applies, so the two consumers of one directory give one
answer. `plot-plan-meta.sh` is the format contract; "is this a plan" is its
call, and a sweep answering differently would be a second implementation free
to drift. Such a file is still listed in section 9 (`not a plan (decision log /
note?)`) — a phase-less file in the plan directory is worth a glance — but it
no longer claims to be a broken plan.

Plan files are parsed by the shared `plot-plan-meta.sh` parser, which understands both the canonical `## Status` body format (`- **Phase:** …`) and YAML front matter (`status:`/`phase:`). Do not re-derive this list by hand; the script is the source of truth for *what the state is*. Your job is *what to do about it*.

**PR state, bound to origin's git host.** The scan enumerates open-PR branches with the CLI matching the `origin` remote's host — `gh` on GitHub, `bb` on Bitbucket — never a CLI's own idea of the "current repo" (a second remote on another git host must not win). Without a matching CLI it prints `PR state: DEGRADED` and falls back to git merge-state alone; in that mode the stale-branch section may list a branch that still has an open PR, so confirm each before deleting.

**Summary footer.** The report's final line is machine-countable — consumers that only need counts (the `/plot` hygiene line, the Automation Output below) read it instead of parsing section bodies:

```
summary: drift=1 merged_not_delivered=1 stale=3 claims=0 attention=0 concurrent=1 unreleased_delivered=0 uncut_slices=1 prose_slice_names=0 index_drift=2 pr_source=gh main=main
```

`uncut_slices` is the count from section 7 — slices carrying more than one
branch, a shape `/plot-reslice` can repair. It is actionable but **non-blocking**
and kept out of `attention=` for the same reason `index_drift` is: an unsliced
wave is a shape to fix, not a branch that cannot move.

`prose_slice_names` is the count from section 8 — slice names too long to be a
label. Non-blocking for the same reason: the fix is to rename the heading in
the plan, and a cosmetic name must not gate a delivery.

`index_drift` is the convenience count from section 9. It is reported so the
gap is visible, and it must never be read as a blocker: `attention=0` with
`index_drift=2` is a healthy estate with two stale browsing links.

`double_claims` is the count from section 12 — branches listed by more than one
plan, each finding naming both plans and the wave each lists it under. Only
meaningful since the branch matcher anchored to the start of a list item: before
that, a plan CITING another plan's branch to declare a dependency read as a
second claim. Non-blocking for the same reason as the others — a double claim is
a shape for a person to resolve, not a branch that cannot move — so it stays out
of `attention=`.

### Stage 2 — Act (your judgment)

For each finding, decide whether to run the printed command. The scan never runs them; you do, deliberately.

- **Drift (section 1):** almost always safe to fix — run the printed `git rm … && ln -s … && git add -A` (one `git add -A`, so the flip and the symlink move commit together — a per-path `git add` on the removed path aborts staging and ships a half-fix).
- **Merged-but-not-delivered:** run `/plot-deliver <slug>` — but first `git fetch` and check section 4's counts; a parallel session may already be delivering it.
- **Stale branches:** confirm the branch is truly done (no open PR, work landed) before `git push origin --delete`. Orphans (ahead of the main branch) need a real look — `git log` them first; they may be unfinished work, not trash.
- **Needs attention → dangling symlink:** `readlink` it first. If the plan was renamed, repoint the link; if the plan is gone, `git rm` the link. Never guess — a link is the only remaining record of what the plan was called.
- **Uncut slices (section 7):** a wave carrying more than one branch. Run the printed `/plot-reslice <slug>` only when someone decides to slice it — the order is a human judgment `/plot-reslice` asks for. Non-blocking: never present it alongside drift as comparable work, and a `complete` wave listed here is history `/plot-reslice` will decline.
- **Prose wave names (section 8):** a wave heading written as a sentence, not a label. The fix is a human editing the plan — shorten the heading to a label; the full name stays on hover on the board. Non-blocking: never present it alongside drift as comparable work.
- **Index drift (section 9):** optional, always. Run the printed `ln -s` only if someone wants the browsing path back. A phase-less file listed here is pre-plot history or a note — leave it (no backfill) unless you are deliberately adopting it into the plot lifecycle. Never propose "fixing" all of section 9.
- **Double-claimed branches (section 12):** two plans listing one branch. There is no command to run — deciding which plan OWNS the branch is the judgment, and the other plan should cite it in prose rather than list it. Read both plans before proposing either side; the branch itself is usually fine, and the fault is in the bookkeeping. Non-blocking: never present it alongside drift as comparable work.

Batch the fixes you choose into one commit, then re-run the scan to confirm the sections you acted on are clear.

## Output

You produce **text only** — a short summary of what the scan found and which findings you recommend acting on, ordered by safety (drift first, branch deletions last, the non-blocking sections 7, 8 and 9 last of all — or omitted when nothing else was found). You do NOT apply fixes automatically; you present them and let the human run the ones they choose (or run them yourself only on explicit confirmation, one batch, then re-scan).

## What you must NOT do

- **Do not let the command mutate anything on its own.** The scan is read-only by construction; keep it that way. Symlink moves, phase flips, and branch deletions happen only when the human runs a printed command (or explicitly tells you to run a batch).
- **Do not flag a phase-less file as a broken plan.** It never claimed to be one — `plot-fleet-scan.sh` applies the same rule. It appears in section 9 for visibility; report the count and move on.
- **Do not report index drift as something to fix.** Section 9 findings block nothing. Presenting `index_drift=3` alongside `drift=3` as comparable work is the misreading this split exists to prevent.
- **Do not report an uncut slice or a prose slice name as a blocker.** Sections 7 and 8 findings block nothing either; `/plot-reslice` and a plan rename are the repairs, and both are human judgments. Presenting `uncut_slices=3` or `prose_slice_names=3` alongside `drift=3` as comparable work is the same misreading.
- **Do not report a double claim as a blocker, and do not resolve one yourself.** Section 12 findings block nothing, and which plan owns a contested branch is not a fact the scan holds — it is a decision about what the two plans MEAN. Present the collision and both claimants; let a person choose.
- **Do not delete a branch the scan degraded on.** If no git-host CLI was available, the "no open PR" signal is unverified — confirm before any deletion.
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
    "concurrent_delivery": 0,
    "uncut_slices": 0,
    "prose_slice_names": 0,
    "index_drift": 0
  },
  "actions_taken": [],
  "message": "Sweep complete. This report is advisory — nothing was changed.",
  "next_action": null
}
```

`pr_source` is `gh`, `bb`, `degraded` (no git-host CLI), or `off` (PR enumeration deliberately skipped via `--no-pr`/`--offline`). Sections 4, 7, 8 and 9 are informational — divergence counts, unsliced-wave shapes, prose slice names, and browsing gaps, not defects — so they report under `info`, not `findings`. `uncut_slices`, `prose_slice_names` and `index_drift` belong there for the same reason they are kept out of `attention=`: an uncut slice is a shape `/plot-reslice` can repair, a prose slice name is a plan rename, and nothing depends on a symlink since the phase grouping became derived. Fill every count from the scan's `summary:` footer line — do not re-count section bodies.
