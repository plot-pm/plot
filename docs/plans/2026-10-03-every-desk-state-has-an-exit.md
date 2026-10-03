# Every desk state has an exit

> A desk moves through states the domain names, and every state has a defined way out, so no desk outlives the work it held.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #1242, #1243
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A desk whose claim ref is gone and whose commits change no file no longer blocks the next agent handed its slice.
- A slice an agent refused leaves the queue until a person clears the refusal, instead of going to the next free agent.
- The reaper removes a desk whose only content is a marker that records no work, after copying the marker's text to `.plot/state/`.

<!-- Board impact: no plan-format, template or docs/plans change. The queue gains one hold word, which the supervisor's tick line and the board's hold counts print through `QUEUE_HOLDS`; the board needs no change beyond rebuilding the artifact. -->

## Motivation

Measured 2026-10-03 on this repository: `.worktrees/` held 269 desks, and 250 of them existed because of one slice.

1. Desk `free-50562867` held `bug/the-queue-reads-the-scans-order`. Its only commit beyond `origin/main` was `a20c71285 plot: claim …`, which changes no file. Its worker (pid 67263) was dead, and `origin/bug/the-queue-reads-the-scans-order` no longer existed.
2. With no claim ref, the slice read as unclaimed, so the supervisor queued it and handed it to a free agent.
3. The agent asked `checkoutYield` whether `free-50562867` may be removed. `plot-worker-loop.sh:963-972` measures unpushed commits against `@{upstream}`, and a branch whose ref is gone has none, so the reading was not `0` and the rule kept the desk.
4. The agent wrote `PLOT-BLOCKED.md` and stopped. `rules/queue.ts` has no hold for a refused slice, so the next pass handed the slice to another free agent, and `--start-agents` started more agents for the item nobody took.
5. `rules/reapable.ts` refuses every desk carrying a marker (`blocked-marker`), whatever the marker records, so each refusal left a desk behind.

The rate was 17 to 19 desks an hour from 03:00 to 07:00. Removing `free-50562867` by hand (`git worktree remove`, no `--force`, git did not refuse), trashing 250 markers that each named it, and running `plot-reap.sh --yes` took the estate from 269 desks to 21.

`9260f8a65` already fixed one entry to this state: `plot-dispatch.sh --release` detaches a released desk. A claim ref removed any other way still produces it. Each fix so far guards one way a desk gets stuck; the domain has no list of desk states, so a new way to get stuck is found by counting desks.

## Design

### Approach

**Slices 1 and 2 stop today's loop. Slice 3 gives the desk a lifecycle, so the next unforeseen entry has an exit too.**

**Slice 1: an empty claim is not unlanded work.** The loop measures `unpushedCommits` for `checkoutYield` as *commits on `HEAD` that change a file and that `origin/<default>` does not hold*, the reading `plot-dispatch.sh --release` already takes before it detaches a desk. A missing `@{upstream}` stops meaning `unknown` for that reading, because the default branch is always askable. `checkoutYield` itself does not change: it still keeps on `unknown`, and the removal still carries no `--force`.

**Slice 2: a refused slice is held.** `QueueHold` gains `refused`: an agent was handed this slice and wrote a marker. `whyNotReady` tests it before `no-brief`, and `QUEUE_HOLDS` lists it, so the tick line reports `refused: N`. The slice stays held until the marker is gone. The refusal is a reading the caller takes; the queue does not read files.

**Slice 3: the desk lifecycle.** A new domain rule, `rules/desk-lifecycle.ts`, names every state a desk can be in and the exit each state has. Its input is the readings `reapProblems` and `checkoutYield` already take, plus `claimRef` (does `origin/<branch>` exist) and `markerRecordsWork` (does the desk hold anything besides the marker). The first cut of states:

| State | Reading | Exit |
|---|---|---|
| `working` | live worker pid | the worker ends; re-read |
| `finished` | merged PR, clean tree | reap |
| `orphaned` | no live worker, no claim ref, no file-changing commit, clean tree | detach, then reap |
| `refused-empty` | marker, and nothing else in the desk | copy the marker to `.plot/state/refusals.tsv`, then reap |
| `refused-with-work` | marker and work | a person, named on the board |
| `holding-work` | unlanded work, no marker, no live worker | a person, named on the board |
| `unplaced` | no manifest and no recognised name | a person; reconcile §21 reports it as today |

`reapable.ts` and reconcile §21 ask this rule instead of combining readings themselves. The rule's test asserts the property the plan is named for: every member of the state type maps to an exit, and an exit of *a person* names the person-facing reason.

**What does not change.** No removal uses `--force`. A desk holding a file-changing commit or uncommitted work is never removed by a rule. The marker text is kept, moved into `.plot/state/` before its desk goes, because a refusal is evidence even when its desk holds nothing.

### Open Questions

- [ ] Slice 2's reading: where does the supervisor learn *an agent refused this slice*? Candidates: a `PLOT-BLOCKED*` file in a desk whose manifest names the branch, or a line the loop appends to `.plot/state/` when it writes one. The 248 desks measured read `owner: nobody`, so the manifest may already be cleared when the supervisor looks.
- [ ] Slice 2: does `--start-agents` also need to stop counting a `refused` slice as queued work? With the hold, the slice leaves the queue, so the start rule should already see nothing to take. The slice should prove that, not assume it.
- [ ] Slice 3: which existing `desk-*` rules fold into the lifecycle rule (`desk-worker.ts`, `desk-manifest.ts`) and which stay as readings it consumes? This plan does not change `a-desk-and-its-manifest-name-each-other`'s `deskManifest`; the lifecycle rule reads its answer.

## Slices

### An empty claim is not unlanded work

- `bug/an-empty-claim-is-not-unlanded-work` — the loop reads `unpushedCommits` as file-changing commits not on `origin/<default>`, so a desk holding only a claim commit yields (#1242) <!-- builds: a file-changing unpushed reading in plot-worker-loop.sh for checkoutYield -->

### A refused slice is held

- `bug/a-refused-slice-is-held` — `QueueHold` gains `refused`; a slice an agent refused leaves the queue until a person clears the refusal (#1243) <!-- builds: refused, a QueueHold -->

### The desk has a lifecycle

- `bug/the-desk-has-a-lifecycle` — `rules/desk-lifecycle.ts` names each desk state and its exit; `reapable.ts` and reconcile §21 ask it <!-- builds: deskLifecycle, a domain rule -->

## Notes

- 2026-10-03, the measurement above, taken while clearing the estate. `git worktree remove .worktrees/free-50562867` succeeded without `--force`; 250 markers were trashed only where the desk was detached, its sole uncommitted path was `PLOT-BLOCKED.md`, the marker named `free-50562867`, and no worker pid was live. Two desks failed that check and kept their markers. `plot-reap.sh --yes` then reported `reapable=250 removed=250`.
- Deliverable search, 2026-10-03: nothing is named `deskLifecycle`; reconcile §21 reports desks and decides nothing; `checkoutYield` exists and slice 1 changes the reading it is given, not the rule.
