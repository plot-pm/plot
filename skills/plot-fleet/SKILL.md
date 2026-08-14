---
name: plot-fleet
description: >-
  Fleet pulse — report which branch waves of a plan are complete, eligible,
  or blocked, and which branches are claimed. Read-only and stateless; every
  fact is re-derived from git. Use on /plot-fleet.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.1.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git and python3. No git-host
  CLI needed — the pulse reads refs, not pull requests.
---

# Plot: Fleet

One plan can spawn many implementation branches (Manifesto Principle 4). Once
more than one is in flight, the question stops being "what is the next step?"
and becomes "**what is safe to start right now, and is anything stuck?**" This
command answers exactly that, and nothing else.

It is a **pulse**, not a supervisor: it starts no work, claims no branch, and
merges nothing. It reports, and a human decides. The companion command that
*does* fan out (`/plot-dispatch`) is deliberately separate and human-paced —
fanning out is a scope commitment, monitoring is not.

**Input:** `$ARGUMENTS` is optional. A `<slug>` limits the pulse to one plan
(default: all active plans). `--offline` / `--no-fetch` skip the `git fetch`
for a network-free pulse.

## Why it is stateless

There is no fleet database. Every fact this command prints is re-derived from
git refs and plan files on each run. That is the design, not an optimization
(Manifesto Principle 1: git is the database):

- A killed dispatcher, a dead worker, or a crashed pulse costs nothing — the
  next pulse re-derives the truth.
- Any model tier, any machine, any session sees the same state.
- There is nothing to keep in sync, so there is nothing to drift.

**Log clean pulses too.** A pulse that finds nothing wrong must still say so.
Without that, an idle fleet and a dead fleet look identical.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Run the scan | Small | One script call; output is machine-countable |
| 2. Report state | Small | Read the footer counts, print the body |
| 3. Advise next action | Mid | Which eligible branch to start is judgment |
| 4. Flag stalls | Mid–Frontier | Distinguishing "slow" from "stuck" needs context |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).

## Vocabulary

Plot already uses **heartbeat** for the liveness signal *inside* one serial
`ralph-plot-sprint` run. This command's **pulse** is a different thing: an
observation *across* a fleet. Keep the two words distinct — do not describe
this command as a heartbeat.

| Term | Meaning |
|------|---------|
| **wave** | Branches under one `### ` subheading of `## Branches`, runnable concurrently |
| **complete** | Every non-deferred branch in the wave is merged |
| **eligible** | Every *prior* wave is complete — this wave may be started |
| **blocked** | A prior wave still has outstanding work |
| **claimed** | A branch ref exists on the remote with no commits of its own |
| **deferred** | Annotated `<!-- deferred: … -->`; never counts as outstanding |

## Steps

### 1. Run the Scan

```bash
../plot/scripts/plot-fleet-scan.sh [--offline] [<slug>]
```

The scan prints a per-plan wave report and ends with one machine-countable
line. **Read the counts from that footer — never re-count the body:**

```
summary: plans=1 waves=4 branches=6 claimed=0 eligible=1 blocked=3 deferred=0 main=main
```

`eligible` counts branches a worker could pick up *right now*: in an eligible
wave, not already claimed, not deferred, not merged.

### 2. Report State

Print the scan body as-is — it is already shaped for reading. Then give the
one-line orientation the counts support, e.g.:

> Wave 1 (Tracer) is eligible: 1 branch free, 0 claimed. Waves 2–4 blocked
> behind it.

### 3. Advise the Next Action

Name the signal, then advise (Principle 11 — guidance is part of the workflow):

- **Eligible branches, nothing claimed** → the wave is ready to fan out.
  Suggest `/plot-dispatch <slug>`, or starting one branch by hand.
- **Everything claimed, none merged** → work is in flight. Say so and stop;
  there is nothing to start.
- **A wave is complete** → the next wave just became eligible. Say which.
- **All waves complete** → the plan's implementation is done. Suggest
  `/plot-deliver <slug>`.
- **No plans with branches** → say so plainly. This is a normal state, not an
  error.

### 4. Flag Stalls — carefully

A branch claimed long ago with no commits is *suspicious*, not *broken*: a
worker may be thinking, or may be dead. This command **never** reaps. Report
the observation and hand it to `/plot-reconcile`, which owns cleanup and can
tell a deliberately abandoned claim (annotated `deferred:` / `moved:`) from a
dead worker (a bare `claimed:` past the threshold).

Use `Sprint stall limit` from `## Plot Config` as the staleness threshold —
do **not** introduce a second timeout key. One vocabulary for stalls.

### 5. Append a Pulse Line (optional)

When run on a cadence, append one line per pulse to the plan's `## Notes`,
**including clean pulses**:

```
<!-- pulse: 2026-08-14T11:00Z — wave 2: 2 claimed, 1 eligible, 0 stale -->
```

This is the only thing this command ever writes, and it is a log, never state:
deleting the whole log changes no behaviour, because the next pulse re-derives
everything.

## Guardrails

- **Read-only.** This command never creates a branch, pushes a ref, starts a
  worker, or merges anything. If a step seems to require writing, it belongs in
  `/plot-dispatch` or `/plot-implement`.
- **Never claim on the user's behalf.** Reporting a branch as eligible is not
  taking it.
- **Never re-count the body.** The footer is the contract.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Treating `claimed` in the plan file as authoritative | A stale annotation hides a free branch, or fakes a busy one | Git refs are the claim; the annotation is a reflection |
| Reporting a wave eligible while a prior wave has open work | Workers build on an unproven seam | The scan's arithmetic already enforces this — do not second-guess it |
| Reaping a stale claim here | Silent data loss; a thinking worker looks dead | Cleanup belongs to `/plot-reconcile`, which can tell abandoned from crashed |
| Skipping the pulse line when nothing changed | A dead fleet is indistinguishable from an idle one | Log clean pulses explicitly |
| Calling this a heartbeat | Collides with `ralph-plot-sprint`'s per-run liveness signal | This is a pulse: an observation across a fleet |
