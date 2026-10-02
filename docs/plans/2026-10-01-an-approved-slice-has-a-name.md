# An approved slice has a name

> A plan can be approved while it names a branch under no `###` heading. The agent then cannot open the slice's PR until it writes the heading, and it writes it on its own branch. The board reads the plan from the main branch, so the row shows `(unnamed)` until the PR merges. This plan refuses the approval instead, and holds an already-approved slice of that shape in the queue.

## Status

- **State:** Approved
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Issue:** #1057
- **Sprint:** the-fleet-runs-through-its-limits
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `bug/approval-refuses-an-unnamed-slice`
- **Started:** 2026-10-02, Jan Wloka, `bug/the-queue-holds-an-unnamed-slice`

## Changelog

- Approving a plan that names a branch under no slice heading is refused, and the refusal names each such branch and the heading to add.
- The supervisor does not hand an agent a slice whose branch sits under no heading. The board shows the hold with its reason.

Board impact: the board renders a new queue hold word. The row's name rule (`fleet.ts:6730`) does not change. No payload field is added.

## Motivation

#1057 reports a slice row reading `(unnamed)` with no PR link, on a Bitbucket estate, Plot 2.21.0. The panel on `a-slice-row-finds-its-pr-by-head` separated the report into two facts.

### The name is the real defect

The chain, read on `origin/main` (`a651aff5`):

1. **The approved plan names the branch under no heading.** Nothing refuses that. `approve` (`packages/domain/src/workflows/approve.ts:104`) refuses on the phase, the review channel and the PR (`ApproveRefusal`, `:10-19`). Its readings carry the branches as one flat list (`branches`, `:41`), with no slice name.
2. **Opening the PR refuses the branch.** `openSlicePr` refuses `slice-unnamed` (`packages/domain/src/rules/slice-pr.ts:33`, `:203-208`): *"names '…' under no wave heading — the PR title is that heading"*. `/plot-implement` tells the agent to open the PR with `plot-open-pr.sh` and names that refusal (`skills/plot-implement/SKILL.md:270-275`).
3. **The agent adds the heading on its own branch.** `plot-open-pr.sh` searches the plan directory of the working tree (`skills/plot/scripts/plot-open-pr.sh:88-100`), so a heading written on the slice branch satisfies it. The PR opens.
4. **The board reads the main branch.** The row's name is `wave.name || '(unnamed)'` (`packages/board/src/server/fleet.ts:6730`), from the plan on the read ref. The heading is not there until the PR merges.

Each step follows its own rule. The defect is at step 1: a plan reaches `Approved` in a shape that step 2 refuses.

**On this estate the shape is historical.** `plot-plan-meta.sh` over all plans on `origin/main` finds 5 waves with branches and no name, and none of them is in a Draft or Approved plan. So the approval refusal refuses nothing on this estate today. The reporting estate had one.

### The link already works on `origin/main`

The panel verified it live: a plan with no `→ #N` on the read ref, whose branch had open PR #1060, rendered that PR. `fleet.ts` asks the head map first (`held ?? pr`, `fleet.ts:6507`).

The reporter's comment on #1057 names the missing link's cause on 2.21.0: the board banner read *"possibly truncated (6 rows, requested limit 1000 unprovable)"* and showed PR data 3046 minutes old. On `origin/main` that note is written to stderr with exit 0 (`skills/plot/scripts/plot-host.sh:2628`), and `fleet.ts:2902` uses the rows of any `answered` or `partial` result. Read from the code, not reproduced on Bitbucket. Bitbucket `bb` 1.10.1 is not in the page-length table (`packages/domain/src/adapters/host/listing-paging.ts:15-17`), so its pages still read as possibly truncated. That is a notice, not a missing link, and this plan does not change it.

## Design

### The rule

**A plan reaches `Approved` only if every branch it names sits under a `###` slice heading.** The heading is the slice's name on the board and its PR title, so it must be on the main branch before any agent starts.

### One predicate, two callers

A rule in `packages/domain/src/rules/` answers *which branches does this plan name under no heading*, from the plan's parsed waves (`plot-plan-meta.sh` reports `waves[].name` and `waves[].branches`). A deferred branch counts, because a deferred branch can return to the queue.

- **`approve` asks it.** A new `ApproveRefusal`, `slice-unnamed`, fires after the phase check. Its detail names each branch and the repair: *"add `### <name> (Branch: <branch>)` above it under `## Slices`"*. The readings gain the list, and `plot-approve.sh` passes it through `board/plot-transition.mjs` (`packages/board/src/server/entry/transition.ts`), as it passes the other readings.
- **The queue asks it.** A plan approved before slice 1 can still hold such a branch. `QueueHold` (`packages/domain/src/rules/queue.ts:102`) gains `slice-unnamed`, and `QUEUE_HOLDS` (`:138`) lists it. `queueOfPlan` (`packages/board/src/server/queue-reading.ts:125`) reads it from the same parsed waves. The supervisor does not hand that slice to an agent, so no agent reaches step 3.

**The refusal applies to every review channel.** `approve` serves `pr` today and `an-in-session-approval-has-a-controller` (#1088) routes `in-session` through a controller. Whichever controller records the approval asks the same rule, so neither path can approve an unnamed slice.

### What this does NOT do

- **It does not read plans from a feature branch.** The board reads the main ref on purpose.
- **It does not name a row from a PR title or a branch name.** `slice-pr.ts:107-113` refuses a branch name as a title for the same reason.
- **It does not change `/plot-implement`.** The skill already names the refusal. After this plan an agent does not meet it.
- **It does not change the PR link.** That already resolves by head.

## Done when

- Approving a plan with a branch under no heading refuses with `slice-unnamed`, names the branch and the heading to add, and writes nothing, asserted in the domain test for `approve`.
- A plan whose every branch sits under a heading approves as before, asserted.
- A deferred branch under no heading also refuses, asserted.
- The queue holds such a slice as `slice-unnamed` and hands it to nobody, asserted in the domain test for `matchQueue`, and the board renders the hold word.
- The predicate run over every plan on `origin/main` reports the 5 historical waves and no Draft or Approved plan, recorded in the PR.

## Slices

### Approval refuses an unnamed slice (Branch: bug/approval-refuses-an-unnamed-slice, PR: #1189)

The predicate, the `slice-unnamed` refusal in `approve`, the reading through `plot-approve.sh` and `entry/transition.ts`, and the tests above. <!-- builds: unnamedBranches, the slice-unnamed approval refusal -->

### The queue holds an unnamed slice (Branch: bug/the-queue-holds-an-unnamed-slice, PR: #1208) <!-- waits: bug/approval-refuses-an-unnamed-slice -->

The `slice-unnamed` queue hold from the same predicate, in `queue.ts` and `queue-reading.ts`, and its word on the board. <!-- builds: the slice-unnamed queue hold -->

## Notes

- **Replaces the rejected `a-slice-row-finds-its-pr-by-head`** (`docs/plans/2026-09-29-a-slice-row-finds-its-pr-by-head.md`). That plan proposed resolving the row's PR by head branch. The panel found that mechanism already on `main` and found that the head map cannot supply a slice name. This plan leaves the link alone and stops the unnamed slice where it starts: at approval, and in the queue for plans approved before.
- The reporter's estate is on Plot 2.21.0. Whether its link was missing for the stale-data reason on that version is not re-measured here; the code path on `origin/main` uses the rows.
