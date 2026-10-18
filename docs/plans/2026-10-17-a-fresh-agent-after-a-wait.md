# Fleet: a new free agent after a wait-bound end, safe supervisor endings, and slice waits

> Three fleet defects (#1903, #1917, #1273): fleetd's start at `agents=0` after a wait-bound end, a supervisor `unreadable` ending acting on a slice the agent no longer held, and the registry's hold on a `waits:` written on a branch line.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #1950, #1903, #1917, #1273
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1954 merged
- **Started:** 2026-10-17, Jan Wloka, `bug/the-registry-reads-branch-line-waits`
- **Started:** 2026-10-18, Jan Wloka, `bug/a-free-desk-ending-acts-on-no-slice`
- **Started:** 2026-10-18, Jan Wloka, `bug/fleetd-at-agents-zero-after-a-wait`
- **Delivered:** 2026-10-18

## Changelog

- A supervisor ending on a free desk that ended at the wait bound no longer restarts or releases a slice the agent had handed off; fleetd starts a new free agent at `agents=0` when approved, startable slices wait, bounded by the configured fleet size; regression tests pin the registry's hold on a `waits:` written on a branch line.

<!-- Board impact: slice 2 may change which ended desks appear in *Waiting on you* (`endedDeskPlacement`, `rules/ended-desk.ts:84-90`); its done-when names the placement. Slices 1 and 3: no change to the plan format, template or helper scripts; if slice 1 changes `plot-plan-meta.sh`, this note is revised. -->

## Motivation

Three defects concern how fleetd and the registry treat a desk at the end of its wait, or before its slice may start. Issue #1950 groups them.

- **#1903** — the row-placement plan (`2026-10-16-row-placement-and-wording-1677-1791`) stops a clean wait-bound end from reading as blocked. It does not change fleetd. On 2026-10-15 (#1743) fleetd ran at `agents=0` and nothing would have built the next approved plan. The start rule already exists: `assign` → `scaleUp` (`packages/domain/src/workflows/assign.ts:191-249`) starts free agents when a slice is held `no-free-agent`, which every ready slice is at `agents: []` (`rules/queue.ts:668-679`); `queue.test.ts:540` pins it, fleetd runs `--start-agents` (`skills/plot/units/com.plot-pm.fleetd.plist:40`), and `.plot/logs/fleetd.log.1:41489` and `:77733` show `agents=0 … no-free-agent=1 … started=1`/`started=2`. So #1743's case has a cause upstream of the start rule, and it is not yet named: the next plan's slices held `no-brief` or `not-claimable`, a desk at the wait bound still counted in `readings.agents`, or a daemon without `--start-agents` or on a stale bundle.
- **#1917** — a free agent whose wait ran out exits `124` and writes no ending (`agentLoop` ROW 2, `packages/domain/src/workflows/agent-loop.ts:473-484`; its comment *"No slice was ever held"* is false for a desk that still has its last slice checked out). On the next tick `killedWorkerEnding` (`ending-action.ts:553`) writes `{reason: "unreadable", actor: "supervisor", branch}`. With a merged PR, `endingAction` answers `leave` (`clean-wait-end.test.ts`). With an unmerged branch, `ending-action.ts:301-306` answers `start-fresh` when the branch carries an open PR, a commit beyond its claim or a dirty tree, and `release-claim` otherwise — for a slice the agent had handed off. `start-fresh` launches a full `Implement command` session, bounded to one per (plan, branch) by `fresh-agents.tsv`.
- **#1273** — measured 2026-10-04: `plot-registryd` handed `infra/the-loop-has-a-workflow` to an agent while the branch its `waits:` names (`infra/the-shell-loop-holds-unlanded-work`, #1271) was open and failing. On current `origin/main` the chain reads that line: `plot-plan-meta.sh` on `2026-10-04-the-worker-loop-runs-in-js.md` returns `waits_on: ["infra/the-shell-loop-holds-unlanded-work"]`, `branchOf` (`plan-store-shell.ts:69-80`) maps it, and `planQueue` (`queue.ts:849-876`) holds on it. #1247 and #1253 (2026-10-03) and #1265 (2026-10-04 00:15) added that reading, within a day before both hand-overs (2026-10-04 23:04, 2026-10-05 08:19). The daemon that handed the slice over started at `registryd.log:30654` and did not restart before either hand-over (`:44964`, `:46711`); none of its tick lines carries a `waits=` counter or a `held on waits` section, which first appear at `:69362` after the restart as `plot-fleetd`. A second candidate is a `merged` set that wrongly named the prerequisite, which would also explain slice 2 reading `no-brief` instead of `not-claimable`.

## Design

### Approach

Each member becomes one slice. The slices land in document order: the registry test, then the supervisor guard, then the start at `agents=0`. The start follows the guard because each new free agent becomes a later exit-124 desk that #1917 can turn into a `start-fresh` session.

"Fresh" in this plan's file name and in the operator's decision means a new free agent with no slice. It never means `endingAction`'s `start-fresh` or `freshAgentCandidateTrees` (`packages/fleet/src/server/entry/registryd.ts:620-830`), which concern an ended desk's slice.

1. **Registry reads branch-line waits (#1273).** Measure first: a test drives a plan with the `waits:` on the bullet line, after a `builds:` marker, through `plot-plan-meta.sh` → `planStoreShell` → `planQueue` → `whyNotReady`, and a second test asserts that slice 2 of the same plan reads `not-claimable` while slice 1 is unmerged and unclaimed. If both pass on `origin/main`, the slice ships the tests, records the cause as the stale daemon above, and changes no rule. If one fails, the fix goes where it fails: the adapter mapping, or the `merged` set `planQueue` receives (merge-subject fallback, `listingWhole`).
2. **Supervisor ending on a free desk (#1917).** A claim is a ref with empty commits and names no agent (`rules/claim.ts:15`); a holder is a live manifest, and the manifest is gone when this rule runs (`ending-action.ts:8-10`). So the guard reads the desk's own records: `freeWaitEnded(ending, exit)` (`rules/ended-desk.ts:64`) and the sealed slice's `ok` declaration (`agent-loop.ts:374-383`). When either says the desk ended a free wait, `endingAction` answers `leave`. A reading that cannot be answered answers `leave`, never `release-claim` or `start-fresh`, after the `dirtyTreeReading` precedent (`registryd.ts:787`). The controller (`registryd.ts` `killedWorkerEndings` / `freshAgentDecisions`) passes the exit record as a value; the reading costs no host or remote call. If the first test shows `freeWaitEnded` cannot separate a free-wait end from a mid-slice 124, the named alternative is agentLoop ROW 2 writing its own ending for a free end with a branch checked out, so `killedWorkerEnding` returns `null`. The slice corrects ROW 2's comment either way.
3. **New free agent at `agents=0` (#1903).** Decided 2026-10-17 by Jan Wloka: after a free desk ends at the wait bound and the fleet is at `agents=0`, fleetd starts one fresh free agent when approved, startable slices are waiting, bounded by the configured fleet size. "Startable" means held `no-free-agent` by `matchQueue`, which needs no new predicate; the bound is `Parallel agents`. The start lives in `scaleUp`; no second starter is added beside `scaleUp` and board auto-dispatch (`rules/auto-dispatch.ts:451-500`). Measure first: a failing test reproduces the #1743 estate (a desk ended at the wait bound, `agents` as fleetd reads it, the next approved plan's first slice) and asserts a `worker-start` write from `assign`. If `scaleUp` already passes it, the fix goes to the reading that kept the queue empty or counted the ended desk as running, and not to the start rule.

Domain rules follow the layering rule in `CLAUDE.md`: new code is arrow functions, with readings as values and no spawn outside an adapter.

### Open Questions

- [ ] #1917: does any path other than a free wait produce a supervisor `unreadable` ending beside exit 124, for example the wrapper's own timeout killing a loop mid-slice? If so, `freeWaitEnded` alone cannot be the guard, and the `ok` declaration or ROW 2's own ending is.
- [ ] #1273: which of the two candidates — the stale daemon or a wrong `merged` set — caused the hand-overs? Slice 1's tests decide.

## Slices

### Registry waits

- `bug/the-registry-reads-branch-line-waits` — regression tests pin the registry's hold on a `waits:` written on a branch line, and slice 2 of the same plan reading `not-claimable` while slice 1 is unmerged (#1273). Done when: a test in `packages/fleet/test/unit/queue-reading.test.ts` named *a branch-line `waits:` holds the slice through the parser* asserts `whyNotReady(...) === 'waits'` for a markdown fixture whose bullet carries a `builds:` marker followed by a `waits:` marker, and a second test asserts `not-claimable` for slice 2; a rule changes only where a test fails on `origin/main`, and the slice's PR names the cause it found.

### Supervisor endings

- `bug/a-free-desk-ending-acts-on-no-slice` — a supervisor `unreadable` ending on a desk that ended a free wait answers `leave` for an unmerged branch, read from the desk's own records (#1917). Done when: `packages/domain/test/clean-wait-end.test.ts` gains the unmerged cases beside the merged one — open PR, commit beyond the claim, nothing beyond the claim — each failing on `origin/main` with `start-fresh` or `release-claim` and answering `leave` after the change; an unanswerable reading answers `leave`; the controller passes the reading with no host call; `endedDeskPlacement` gives such a desk a placement that names it rather than an empty-note row in *Waiting on you*; ROW 2's comment states what the desk holds. → #2012

### Wait-bound fleet

- `bug/fleetd-at-agents-zero-after-a-wait` — after a free desk ends at the wait bound and the fleet is at `agents=0`, fleetd starts a new free agent while an approved slice is held `no-free-agent`, bounded by `Parallel agents` (#1903). Done when: a test reproduces the #1743 estate and asserts a `worker-start` write from `assign` — in `packages/domain/test/queue.test.ts` for a `scaleUp` change, or `packages/fleet/test/unit/registryd-tick.test.ts` if the cause is a desk at the bound counted in `readings.agents`; a slice held `no-brief`, `not-claimable` or `waits` starts none; the start count per tick is pinned in a test to the operator's answer on the open question; no starter is added beside `scaleUp`. → #2040

## Notes

- Created from tracker issue #1950. The issue is the problem statement; this plan proposes the slices.
- Nothing is written to the tracker.
- 2026-10-17: #1903 decided by Jan Wloka: start a fresh agent
- 2026-10-17: #1903 limit decided by Jan Wloka: the existing rule stands. At `agents=0`, `scaleUp` starts towards `Parallel agents`, at most `DESKS_PER_TICK = 3` per tick; no new limit of one start per tick. Slice 3 pins this in a test, and `queue.test.ts:540` keeps its expectation of 3.
- 2026-10-17: Round 1 was a four-lens panel (estate, contradiction, deliverable, cost), unanimous `amend`; verdicts and moderation in `.plot/panels/a-fresh-agent-after-a-wait/`.
- Panel disagreement, #1917 guard reading: estate proposed the desk's own records (`freeWaitEnded`, `ok` declaration), deliverable proposed other live manifests as `otherHolders` or ROW 2 writing its own ending, contradiction proposed the claim ref tip or last manifest; the plan takes the desk's own records with ROW 2 as the named alternative, because the manifest is gone when the rule runs.
- Panel disagreement, #1273 cause: three lenses named a stale daemon bundle, deliverable added a wrong `merged` set; the moderator's log check supports the stale daemon and does not exclude the other, so slice 1's tests decide.
- Panel disagreement, slice order: contradiction said three headings are an order, cost said slice 3 must follow slice 2, estate and deliverable were silent; the plan keeps three headings in document order.
- Follow-up outside this plan (cost lens): a waits-held, briefed, claimable slice still pays one `prMerged` call per 60 s tick (`queue-reading.ts:349-352`), and a failed agent start retries every tick with no back-off (`registryd-main.ts:1251-1253`).
