## Implementation brief — board-watches-for-stuck-branches, wave 1 (Detection)

- **Plan (canonical):** `docs/plans/2026-08-17-board-watches-for-stuck-branches.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #181 merged (one interrogation round)
- **Branch:** `feature/scan-reports-stuck-branches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The scan learns to report that a branch **cannot move**, as distinct
from reporting what it *is*.

This wave is **read-only and stateless**. It writes nothing, pushes
nothing, and resolves nothing. The display is wave 2; the one granted
repair is wave 3. **Do not build them.**

### The measurement

Five branches got stuck in one afternoon on 2026-08-17:

| Incident | What it cost |
|---|---|
| #176 artifact conflict | recreate worktree, take a side, rebuild, 547 tests |
| #177 artifact conflict | the same again |
| #177 rebase never pushed | noticed by accident; **30 minutes of dead CI** |
| #179 Playwright CDN `403` | read the log, compare run history, rerun |
| #172 fixture regression | add the missing field |

`plot-fleet-scan.sh` reports what a branch *is* — claimed, eligible,
blocked, in progress. None of the five showed up as anything but normal.
The #177 case is the sharp one: from outside, **a rebase that stayed
local is indistinguishable from an agent that stopped.**

### Four stuck states, each named separately

*Stuck* as one label would be the one-label-many-states defect this repo
keeps removing. Report each with the evidence that produced it:

| State | Detected from |
|---|---|
| **Artifact conflict** | `merge-tree` reports conflicts, and the set is **exactly** the artifact path |
| **Real conflict** | `merge-tree` reports conflicts in any other file |
| **Unpushed work** | `local_ahead > 0` with no matching remote commits |
| **Foreign-shaped CI failure** | `pr.state === 'failing'` — reported **with evidence, never as a verdict** |

### Five decisions the plan settles — do not re-derive them

**Artifact-only is not "artifact among".** The resolvable case is a
conflict set of **exactly one file**, that file being
`skills/plot/scripts/board/board-server.mjs`. A conflict touching the
artifact *and* anything else is a **real conflict** — the merge as a
whole needs judgement even though one of its files does not. An
implementation asking *"is the artifact among the conflicts?"* passes the
artifact-only case and silently misclassifies every mixed one.

**Do NOT judge a CI failure.** The plan calls the fourth state
*foreign-shaped* deliberately: the scan reports **facts**, and a human
concludes. Emit the failing step, the branch's changed paths, and the
branch's own recent run history:

```
CI failed — step: Install Playwright browser
this branch changes only .md
same branch passed at 10:17, failed at 10:19
```

A heuristic mapping failing steps to changed paths was explicitly
rejected: that mapping is a table nobody maintains, and it goes
**silently wrong** the first time the workflow is restructured.
Principle 3 — *scripts collect and report; skills and humans interpret.*

**Unpushed work is reported and never fixed.** Pushing someone else's
uncommitted judgement is not mechanical, and `local_ahead` is true only
on the machine doing the looking (`fleet.ts:702`).

**A branch that is not stuck produces nothing.** A watcher that flags
everything flags nothing.

**Stateless.** Every state is re-derived from git and the host each run.
Nothing is remembered, nothing is written — the posture
`plot-fleet-scan.sh` already takes, and the reason it cannot drift from
reality: there is no watcher state to become stale.

### Done when

- **Each stuck state is named separately, with its evidence.** Assert all
  four; one label for all of them is the defect.
- **An artifact-only conflict is distinguishable from a mixed one.**
  Assert a set of exactly the artifact, and one of the artifact plus
  another file: the first is resolvable, the second is not. The pairing
  that matters: an implementation checking *"is the artifact among the
  conflicts?"* passes the first and misclassifies the second.
- **A CI failure is reported as evidence, not as a verdict.** Assert the
  output states step, changed paths and run history, and does **not**
  classify the failure.
- **Unpushed work is reported and never pushed.** Assert no push is
  issued.
- **A healthy in-progress branch produces nothing.**
- **Nothing is written.** Assert no commit, no push, no file write, on
  every path.
- **Stateless.** Assert a fresh run reaches identical conclusions from
  identical refs, with no stored state.
- **A machine-countable footer**, as the repo's other scans emit — e.g.
  `summary: stuck=2 artifact=1 conflict=1 unpushed=0 ci=0 main=main`.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`,
`pnpm run typecheck`, `pnpm test`, `pnpm run validate` all pass;
`pnpm build:board` run **in your own worktree** and the artifact
committed (CI gates on no-diff); a changeset is present with its
`bumps:` block. **Do not edit versions by hand.**
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as
soon as it exists**, and **push again immediately after any rebase** — a
rebase left unpushed reads from outside exactly like an agent that
stopped, and cost PR #177 half an hour of dead CI.

### Scope guard

The detection itself, the contract field(s) that carry it, and their
tests. Reuse `plot-merge-queue.sh`'s conflict prediction rather than
re-implementing `merge-tree`.

**Do NOT build the display** (wave 2) or the resolver (wave 3).

**Do NOT touch `classify()` or the grouping.** A stuck branch keeps the
group it belongs to; this adds a fact about it.

**`activity-shows-itself` wave 1 (#182) is in flight** and adds
`localDirty` / `localLocked` to `AgentRowSchema`. If it has landed when
you start, build on it; if not, rebase onto it rather than adding a
competing carrier — and keep your contract change additive either way.

**Do NOT touch `[data-change-mark]`, `[data-live-dot]`, or the activity
marks.** #180 ships the precedent — *"leaves the LIVE DOT alone — two
marks, two meanings"* — and no mark may be implemented by modifying
another.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those. The four
classifications reduce to a function over (conflict set, branch state, PR
state) and should follow that pattern.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as
`-merge`: on a conflict there, take **either** side, run
`pnpm build:board`, `git add` it, continue. **Do not read that diff.**

**CI note:** on 2026-08-17 a markdown-only branch failed `validate`
because Playwright's CDN returned `403 — this service is not available in
your location`. If CI fails in a step you did not touch, verify locally
first and **report it** rather than working around it — which is also the
exact shape this wave teaches the scan to surface.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
