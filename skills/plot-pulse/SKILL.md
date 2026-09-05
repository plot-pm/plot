---
name: plot-pulse
description: >-
  Fleet pulse — report which branch waves of a plan are complete, eligible,
  blocked or unapproved, and which branches are claimed. Stateless — every fact is
  re-derived from git; the only thing written is a pulse line. Use on
  /plot-pulse.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.6.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git and python3. No git-host
  CLI needed — the pulse reads refs, not pull requests.
---

# Plot: Pulse

One plan can spawn many implementation branches (Manifesto Principle 4). Once
more than one is in flight, the question stops being "what is the next step?"
and becomes "**what is safe to start right now, and is anything stuck?**" This
command answers exactly that, and nothing else.

It is a **pulse**, not a supervisor: it starts no work, claims no branch, and
merges nothing. It reports, and a human decides. The companion command that
*does* fan out (`/plot-dispatch`) is deliberately separate and human-paced —
fanning out is a scope commitment, monitoring is not.

**This command was `/plot-fleet` until 2026-09-05.** It answers the same
question with the same scan, and it took the name it had always printed:
`/plot-fleet` now starts, stops and reports on the supervisor and the agents —
the processes on this machine. This one is about the estate. **There is no
alias**, because the name is reused rather than retired: a `/plot-fleet` that
answered a pulse would give the old behaviour to somebody asking for the new
one.

**Input:** `$ARGUMENTS` is optional. A `<slug>` limits the pulse to one plan
(default: all active plans, plus any plan **delivered within the last 24
hours** — merge and delivery are minutes apart, so a pulse that dropped a plan
the instant it was delivered would lose the work at the moment it finished. A
delivered plan with no `Delivered:` date does not appear at all, and `--next`
never names a branch from one). `--offline` / `--no-fetch` skip the `git fetch`
for a network-free pulse — which also skips the prune that keeps merged
branches from reading `wip` (see *The local walk is not the only source*). `--log-pulse` appends one line per plan to its
`## Notes`. `--loose` relaxes wave eligibility (see below) — strict is the
default and should stay that way.

## Why it is stateless

There is no fleet database. Every fact this command prints is re-derived from
git refs and plan files on each run. That is the design, not an optimization
(Manifesto Principle 1: git is the database):

- A killed dispatcher, a dead worker, or a crashed pulse costs nothing — the
  next pulse re-derives the truth.
- Any model tier, any machine, any session sees the same state.
- There is nothing to keep in sync, so there is nothing to drift.

**Log clean pulses too.** A pulse that finds nothing wrong must still say so.
Without that, an idle fleet and a dead fleet look identical — so `--log-pulse`
is part of the normal invocation, not an extra (step 5 explains why the script
still defaults to writing nothing).

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Run the scan | Small | One script call; output is machine-countable |
| 2. Report state | Small | Read the footer counts, print the body |
| 3. Advise next action | Mid | Which eligible branch to start is judgment |
| 4. Flag stalls | Mid–Frontier | Distinguishing "slow" from "stuck" needs context |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — each question below declares what to do instead, and every skipped question is named in the output. See [Running unattended](../plot/docs/unattended.md).

## Vocabulary

Plot already uses **heartbeat** for the liveness signal *inside* one serial
`ralph-plot-sprint` run. This command's **pulse** is a different thing: an
observation *across* a fleet. Keep the two words distinct — do not describe
this command as a heartbeat.

| Term | Meaning |
|------|---------|
| **wave** | Branches under one `### ` subheading of `## Branches`, runnable concurrently |
| **complete** | Every non-deferred branch in the wave is merged |
| **eligible** | A dispatch would take this: every prior wave is complete **and** the plan is approved |
| **blocked** | A prior wave still has outstanding work — resolves by merging |
| **unapproved** | The plan is not approved, so nothing here may be dispatched — resolves by a person approving it |
| **claimed** | A branch whose only commits beyond main are empty `plot: claim …` markers |
| **deferred** | Annotated `<!-- deferred: … -->`; never counts as outstanding |

### Worker states

`--json` carries a `worker` field per branch. Six describe the **process**; two
describe the **task**, and the split matters because the process cannot answer
the task's question. Measured across seven worktrees in a four-agent fleet run:
*every* worker exited 0, including two that stopped mid-task. All three read
`finished`, whose move is *review it*, and two of them needed an answer instead.

| State | The reader's move |
|-------|-------------------|
| `running` | Leave it alone |
| `finished` | Review it — the work reached a PR, or nothing was left behind |
| `waiting` | **Answer it** — a marker in the tree asks a question |
| `stalled` | **Resume it** — work is on the floor and no PR covers it |
| `failed` | Restart it; `worker_exit` says how it died |
| `ended` | Read the log; the exit status was not recorded |
| `none` | A worktree is here but no pid — look in it. Unknown, never "nobody" |
| `elsewhere` | No worktree here — ask the machine that took it |

`waiting` and `stalled` are as opposite as `failed` and `finished`: one sends a
**person** to a question, the other sends a **worker** back to work. Never
report a `waiting` branch as stalled — relaunching it walks into the same wait,
which is a loop rather than a rescue, and was measured happening twice to one
branch.

### The blocked marker

A worker that stops to ask a person something writes **`PLOT-BLOCKED:`** into a
file in its worktree, followed by the question. That token is what makes
`waiting` detectable; `TODO(you)` and `TODO(human)` are also recognised, because
they emerged from workers before Plot named anything and still exist in trees.

Two properties are load-bearing:

- **In the tree, not only in the log.** The log records that a question *was
  asked*; only the tree records that it is still *unanswered*, and only the tree
  clears when someone writes the answer.
- **Removed when answered.** A marker left behind after its question is settled
  reports `waiting` forever, and a row nobody can clear is one people learn to
  ignore.

## Steps

### 1. Run the Scan

```bash
../plot/scripts/plot-fleet-scan.sh --log-pulse [--offline] [<slug>]
```

`--log-pulse` is deliberate on every run — see step 5. Drop it only if the user
asks for a look without leaving a trace.

The scan prints a per-plan wave report and ends with one machine-countable
line. **Read the counts from that footer — never re-count the body:**

```
summary: plans=1 waves=4 branches=6 claimed=0 eligible=1 blocked=3 deferred=0 merge_detect=pr-merge main=main
```

`eligible` counts branches a worker could pick up *right now*: in an eligible
wave, not already claimed, not deferred, not merged.

`merge_detect` says how a branch whose ref was deleted at merge was recognised,
so an `open` can be weighed rather than trusted blindly:

| Value | Meaning |
|-------|---------|
| `pr-merge` | Conforming merge commits found and examined exhaustively — `open` means the branch really has no merge |
| `truncated` | The merge walk hit its cap; a branch merged before that point may still read `open` |
| `none` | The default branch carries no conforming merge commits at all (a squash/rebase repo) — `open` says nothing about whether work merged |

Under `truncated` or `none`, do not read `open` as "not started" when advising
the next action — say what the scan could not see.

**The local walk is not the only source.** A squash merge leaves no merge
commit, so the walk above cannot see it. When a branch has **no ref at all** —
nothing local left to read — the scan asks the host once for that branch, and a
PR reported `MERGED` reads `merged`. This is what lets a wave complete in a
repo that squash-merges by default.

The lookup is skipped entirely with `--offline`/`--no-fetch`, and when the host
cannot answer — unreachable, or no PR found — the branch reads `open` exactly
as it did before. An unreachable host never becomes a fabricated `merged`, so
an `open` under those conditions still carries the caveat above.

**Reaching that arm requires a pruned mirror.** `git fetch` does not remove
remote-tracking refs for branches deleted upstream, so a branch merged with
`--delete-branch` leaves `refs/remotes/origin/<branch>` behind. The state is
chosen on that ref's *presence*: a leftover sends the branch down the ancestry
path, which a squash merge breaks by construction, and the host is never asked
— so the branch reads `wip` and its wave never completes. The scan's fetch
therefore prunes, on the connection it already opens.

`--offline`/`--no-fetch` skips the fetch, so it cannot prune either. An
offline pulse keeps whatever stale refs the checkout holds and may report
`wip` for merged work, holding a wave blocked; the footer says so. Re-run
without `--offline` before concluding a wave is genuinely unfinished.

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

A `worker: stalled` branch is a **different** finding from a stale claim, and
the two must not be merged in the report. `stalled` means a worker ran and
stopped with work on the floor — that work is worth keeping, and naming what is
uncommitted is the useful thing to say. A stale claim means nothing was ever
built. Restarting a stalled branch is `/plot-dispatch`'s to do and this
command's to *report*; it starts nothing.

A branch claimed long ago with no work on it is *suspicious*, not *broken*: a
worker may be thinking, or may be dead. This command **never** reaps. Report
the observation and hand it to `/plot-reconcile`, which owns cleanup and can
tell a deliberately abandoned claim (annotated `deferred:` / `moved:`) from a
dead worker (a bare `claimed:` past the threshold).

The staleness threshold is `Claim stale after` (hours, default 24), read by
`plot-reconcile-scan.sh`. It is deliberately NOT `Sprint stall limit`: that
counts *iterations without a deliverable* in a serial run — a count, not a
duration — so reusing it would silently read "3 iterations" as "3 hours".

### 5. Append a Pulse Line — by default, not on request

**Pass `--log-pulse` on every `/plot-pulse` run** unless the user asks you not
to. A pulse that finds nothing wrong must still leave a trace, or an idle fleet
and a dead fleet are indistinguishable — which is the failure this command
exists to prevent.

The *script* defaults to writing nothing, because `/plot-implement` and
`/plot-dispatch` call it internally and must never amend a plan as a side
effect of asking what to work on. The default therefore lives here, in the
human-facing command: the script writes only when asked, and this command asks
every time.

Appends one line per pulse to the plan's `## Notes`, **including clean pulses**:

```
<!-- pulse: 2026-08-14T11:00Z — wave 2: 2 claimed, 1 eligible, 0 stale -->
```

This is the only thing this command ever writes, and it is a log, never state:
deleting the whole log changes no behaviour, because the next pulse re-derives
everything.

## Guardrails

- **Read-only, with one exception.** This command never creates a branch,
  pushes a ref, starts a worker, or merges anything. The single thing it writes
  is the pulse line (step 5) — a log, not state: deleting the whole log changes
  no behaviour, because the next pulse re-derives everything from git. If a
  step seems to require any other write, it belongs in `/plot-dispatch` or
  `/plot-implement`.
- **Never claim on the user's behalf.** Reporting a branch as eligible is not
  taking it.
- **Never re-count the body.** The footer is the contract.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Treating `claimed` in the plan file as authoritative | A stale annotation hides a free branch, or fakes a busy one | Git refs are the claim; the annotation is a reflection |
| Reporting a wave eligible while a prior wave has open work | Workers build on an unproven seam | The scan's arithmetic already enforces this — do not second-guess it |
| Reading `unapproved` as "blocked" and waiting for a merge | Nothing will land to clear it — it needs an approval | Say the plan needs approving, and name `/plot-approve` |
| Reaping a stale claim here | Silent data loss; a thinking worker looks dead | Cleanup belongs to `/plot-reconcile`, which can tell abandoned from crashed |
| Dropping `--log-pulse` because nothing changed | A dead fleet is indistinguishable from an idle one — the quiet pulses ARE the evidence | Pass it every run; it is the default, not an option |
| Calling this a heartbeat | Collides with `ralph-plot-sprint`'s per-run liveness signal | This is a pulse: an observation across a fleet |
