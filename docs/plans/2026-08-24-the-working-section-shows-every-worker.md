# The working section shows every worker

> The registry knows 23 agents and WORKING renders none of them. A worker is
> shown only where its branch happens to own a row in the right section, so the
> fleet's account of itself is a side effect of branch bookkeeping.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `bug/the-working-section-renders-the-registry`
- **Started:** 2026-08-25, Jan Wloka, `bug/the-working-count-is-the-rows`
- **Started:** 2026-08-25, Jan Wloka, `feature/a-busy-worker-names-its-wave`
- **Started:** 2026-08-25, Jan Wloka, `bug/a-ready-pr-asks-for-you`
- **Started:** 2026-08-25, Jan Wloka, `bug/the-registry-drops-a-settled-worker`
- **Delivered:** 2026-08-25
- **Released:** 2026-08-26, 2.9.0

## Changelog

- WORKING lists every worker the registry knows — running, idle, stalled,
  finished or unrecognised — instead of only those whose branch happens to hold
  a row the section already renders.
- A busy worker names the **wave** it is working, so a reader sees what the
  fleet is spending itself on rather than only which branch is checked out.
- A worker is dropped from the registry only when its worktree is clean **and**
  its agent session has ended. Either one outstanding and the worker stays
  visible.

## Motivation

### The measurement

Taken from `/api/fleet` against the live estate, 2026-08-24:

| what | count |
|---|---|
| registry entries, every one naming a worktree | **23** |
| rows rendered in WORKING | **0** |
| agents whose branch has no row anywhere | **6** |
| agents whose row is in `done` | **16** |
| agents whose row is in `waiting-on-you` | 1 |

Earlier the same day the section rendered **2** rows beside a control reading
**`3 parallel agents · 5 working`** — three numbers about one fleet, no two
agreeing.

### The cause: a worker is rendered only as a property of its branch

`AgentList.tsx:344` builds `agentByBranch` and joins the registry onto BRANCH
rows. A worker therefore appears only where two things are true of its branch:
the pulse produced a row for it, and `classify` put that row in WORKING.

Both fail routinely, and for reasons that have nothing to do with the worker:

- **No row at all (6 of 23).** The branch is absent from the pulse — a scratch
  branch (`…-recut`), the branch the board itself is served from (`main`), or a
  branch no plan lists. The pulse derives rows from the plan estate, so a
  worktree the estate does not mention cannot be represented.
- **A row in the wrong section (16 of 23).** The branch merged, so `classify`
  places it in DONE — correctly, as a statement about the BRANCH. The worker
  attached to it is then rendered in DONE or nowhere.

A worker in a worktree is a fact about the FLEET. Its branch's state is a fact
about the WORK. Deriving the first from the second is why the section can be
empty while 23 agents exist.

### Two things this is NOT

**Not the pull-request ordering.** A first diagnosis held that `classify`'s PR
arm outranked the worker arm, letting closed-PR workers in and keeping live
ones out. It is wrong: `fleet.ts:4461` strips a closed PR before `classify` is
called (#376), so `classify` receives `pr` open-only and the closed-PR path is
unreachable from there. The two closed-PR rows seen in WORKING that morning
were CORRECT — a live worker, no open PR, unlanded work is exactly a WORKING
row.

**Not a missing registry entry.** `the-agents-tab-filters-to-the-sprint` was
absent from the registry while its worker ran. The registry synthesizes entries
from WORKTREES, and that worktree had been removed after its PR merged. The
registry was right; the worker had already finished.

Both are recorded because both were believed, and each cost a wave in an
earlier draft of this plan.

### Why the count disagrees with the rows

They are computed from different sets and never reconciled:

| number | computed by | over |
|---|---|---|
| `working` | `liveAgentCount` (auto-dispatch.ts:129) | registry entries in `running`/`waiting`, minus landed branches |
| the rows | the branch join in `AgentList.tsx` | branches, sectioned by `classify` |
| `parallelAgents` | a stored setting | nothing — a cap on auto-dispatch, not a measurement |

`LIVE_STATES` admits `running` and `waiting` only, so `stalled`, `finished` and
`unknown` — 21 of the 23 entries here — are counted by neither and rendered by
neither.

## Design

### A worker is a row in its own right

WORKING renders from the REGISTRY, not from the branch rows. Every entry
produces a row whether or not its branch is in the pulse and whatever section
that branch's row occupies.

Where a branch row exists, the worker row still carries what the row knows —
plan, wave, PR, git state — by the same join used today. Where it does not, the
row states what the registry knows: the branch, the worktree, the state. Absent
is not false: it says nothing about a plan it cannot name.

A branch keeps its row in whatever section its own state earns. A merged branch
belongs in DONE; that is a true statement about the work. The worker row in
WORKING is a statement about the fleet, and both can be true at once.

### Every state appears, and the row says which

All five registry states render: `running`, `waiting`, `stalled`, `finished`,
`unknown`.

`someone is on it` narrows to a worker that is genuinely running. An idle,
stalled, finished or unrecognised worker says so plainly — a row whose usual
state is a lie teaches its reader to ignore the row.

### A busy worker names its wave

A registry entry carries `branch`, never `wave`. The pulse already derives waves
per plan (`fleet.waves`, 70 of them here), so the wave is a JOIN on the branch,
not a new field on disk.

A running worker's row names the wave it is working. Where the branch belongs to
no wave — a scratch branch, an unlisted branch — the row says nothing rather
than inventing a name.

### A worker is dropped only when both conditions hold

An entry leaves the registry when **its worktree is clean AND its agent session
has ended**. Either one outstanding and the worker stays visible.

- Dirty worktree, session ended → **stays.** This is the shape that lost work
  on 2026-08-24: a stalled worker exited leaving a complete implementation
  nobody had collected. A registry that had tidied it away would have hidden
  the one fact worth having.
- Clean worktree, session live → **stays.** An agent between edits is working.
- Clean and ended → dropped. It describes nothing.

"Clean" means the worktree holds no uncommitted changes and no commits absent
from its remote — unpushed work is uncollected work.

### The count is the rows

`working` counts what WORKING renders. One derivation read twice, so the two
cannot drift. `parallel agents` stays a cap and is labelled as one: a cap and a
measurement are different claims, and the fleet has exceeded the cap
deliberately before.

### A ready PR asks for you, whatever the worker is doing

`classify` lets a running worker skip the PR arm where `prAsksNobody(pr)` —
draft, green, or pending (`fleet.ts:2843`). The reasoning is recorded as *"a
green or pending PR that asks nothing of anybody"*, and it fixed a measured
defect: WORKING went empty on 2026-08-17 while two agents ran.

**A green, non-draft PR is not nothing.** It is the state where a person is the
only remaining blocker — opening one is the request. Measured 2026-08-24: three
PRs (#389, #390, #391) sat green and reviewable while their rows stayed in
WORKING, invisible to the reader who had to approve them. They were found by
querying the host directly, not by reading the board.

The distinction the arm needs is the one the very next clause already draws:

> *"a draft is still the author's and the author here is the agent, so a green
> draft with a live worker is the clearest possible WORKING row."*

**Draft versus ready**, not green versus failing. A draft says *I am not
finished*; a ready PR says *I am*. So a running worker keeps its branch row
while the PR is a draft, and loses it the moment the PR is marked ready.

This does not undo the 2026-08-17 fix. That defect was an agent whose DRAFT PR
went green — still the author's, still WORKING. The cure was scoped one notch
too wide.

**And the row is not the whole answer.** With WORKING rendering from the
registry (wave `Shown`), the worker keeps its own row there while the BRANCH row
goes to WAITING ON YOU — the agent is still running and the PR still needs
review, and both are true. This wave is what makes the branch row move; `Shown`
is what stops the worker disappearing when it does.

## Waves

### Shown (Branch: bug/the-working-section-renders-the-registry, PR: #398)
- WORKING renders one row per registry entry, joined to a branch row where one
  exists and standing alone where none does; all five states appear and the row
  states which

### Counted (Branch: bug/the-working-count-is-the-rows, PR: #403)
- `working` derives from the set WORKING renders; the cap is labelled as a cap

### Named (Branch: feature/a-busy-worker-names-its-wave, PR: #405)
- a running worker's row names its wave, joined from `fleet.waves`; silent where
  the branch belongs to none

### Ready (Branch: bug/a-ready-pr-asks-for-you, PR: #406)
- a running worker keeps its branch row only while the PR is a DRAFT; a PR
  marked ready reaches WAITING ON YOU whatever the worker is doing

### Reconciled (Branch: bug/the-registry-drops-a-settled-worker, PR: #407)
- an entry is dropped only when the worktree is clean and the session has ended;
  either outstanding and it stays

## Done when

1. **Every registry entry renders a row in WORKING.** Measured against the live
   estate, not a fixture: 23 entries → 23 rows.
2. **A worker whose branch has no row anywhere still renders.** The six here —
   `…-recut` branches, `main`, an unlisted branch — are the case.
3. **A worker whose branch merged still renders in WORKING**, while that branch
   keeps its own row in DONE. Both are true; asserted together.
4. **`N parallel agents · M working` has M equal to the rows rendered.**
   Asserted over a fixture where the two derivations would disagree under the
   old code.
5. **Only a running worker reads `someone is on it`.** Idle, stalled, finished
   and unknown each say their own condition.
6. **A running worker's row names its wave.** Where the branch belongs to no
   wave the row says nothing — asserted, so no fallback string creeps in.
7. **A worker with a dirty worktree and an ended session is still reported**,
   with what it is holding.
8. **A worker with a clean worktree and a live session is still reported.**
9. **A worker with a clean worktree and an ended session is absent.**
10. **A branch whose PR is READY reaches WAITING ON YOU while its worker runs.**
    The #389/#390/#391 case — asserted on the PR's draft flag, not on its checks.
11. **A branch whose PR is a DRAFT keeps its WORKING row while its worker runs**,
    green checks included. This is the 2026-08-17 defect and it must not return.
12. **The worker's own row stays in WORKING through both**, so moving the branch
    row never empties the section.
10. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Not chosen: give every worker a synthetic branch row

WORKING could be filled by fabricating a branch row for each registry entry the
pulse does not mention. It would render, and every row would then carry plan and
wave fields that are empty or invented — the failure mode the estate keeps
re-learning as *absent is not false*. A worker row that states only what the
registry knows says less and lies never.

### Not chosen: count `stalled` and `finished` as live

Widening `LIVE_STATES` would make the count include what the section shows
without making either correct: the count would still be computed over a
different set from the rows. The fix is one derivation, not two agreeing
definitions.

### The cap is not a limit on what is SHOWN

`parallelAgents` bounds auto-dispatch and has never bounded a hand-dispatched
worker. An operator who starts six workers under a cap of three has done
something deliberate; a board that hid the sixth would be lying about the fleet
to defend a setting.

Whether the cap should GATE a start is a separate question, answered by
[`a-worker-asks-for-the-next-wave`](2026-08-24-a-worker-asks-for-the-next-wave.md):
auto-dispatch refuses at the cap, a manual dispatch warns, proceeds, and raises
the cap to the count that resulted. That plan changes what may START; this one
changes only what is DISPLAYED, and the two do not overlap — a worker that
started is shown here whatever gate let it through.
