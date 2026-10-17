Position: amend
# The deliverable lens — a fresh agent after a wait

## What I looked at

Code only, plus read-only commands. I read the plan, issues #1950, #1903, #1917, #1273 and #1743 (`gh issue view`), and the code in the worktree. I ran `plot-plan-meta.sh` on `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` and ran `git log` over the parser and queue files. I ran no test suite. Every `endingAction` arm cited below I read from the table in `packages/domain/src/rules/ending-action.ts:293-315`, not from a test run.

## 1. Is each slice's problem real on current code?

**Slice 1, `bug/the-registry-reads-branch-line-waits` (#1273): the mechanism the plan names to fix already works on main.**

- `plot-plan-meta.sh` reads a branch-line `waits:` (`parse_waits`, `skills/plot/scripts/plot-plan-meta.sh:389-405`, called for every line at `:914`). Run on the measured plan, it returns `{"branch":"infra/the-loop-has-a-workflow","waits_on":["infra/the-shell-loop-holds-unlanded-work"]}` with `unread_waits: []`.
- `branchOf` carries it into `PlanRecordBranch.waitsOn` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:69-80`).
- `planQueue` turns it into `waitHeld` (`packages/domain/src/rules/queue.ts:849-877`), and `whyNotReady` returns `waits` ahead of `no-brief` (`queue.ts:484`).
- Existing tests already cover it: `packages/domain/test/queue.test.ts:89-99` and `packages/fleet/test/unit/queue-reading.test.ts:723-777` ("a `waits:` prerequisite holds a slice through the real join").
- Timeline: "The parser reads every wait (#1265)" landed 2026-10-04 00:15 and "The queue reads the assignment (#1267)" landed 2026-10-04 08:32. Both came before the first measurement (2026-10-04 23:04) and before the recurrence (2026-10-05 08:19, issue comment).

So the plan's Approach step 1 ("find where the registry's plan reading builds `waitsOn` … and make it read the same `waits:` annotations") describes a change that has no gap to fill. The handover is still real: it happened twice. Its cause is not the one the plan names. Candidates the plan does not mention:
- (a) The live `plot-registryd` ran a bundle older than #1265/#1267. The board-does-not-reload memory describes this class of failure.
- (b) The `merged` set named the prerequisite, for example through the merge-subject fallback. That would also explain the second defect: `sliceVerdicts` reads slice 1 as settled, so slice 2 becomes claimable and falls through to `no-brief` instead of `not-claimable` (`queue.ts:494-500`).

An unattended agent that follows the slice as written writes a test, sees it pass, and has no instruction for what to do next.

**Slice 2, `bug/a-free-desk-ending-acts-on-no-slice` (#1917): real, and reproducible by reading the table.** `killedWorkerEnding` (`ending-action.ts:553-564`) writes `unreadable`/`supervisor` for any desk that has a branch, a non-zero exit and no ending. `isBoundEnding('unreadable')` is true (`:159`). With `prMerged !== 'merged'` and no marker, the table answers:
- `release-claim` when there is no commit beyond the claim, no open PR and a clean tree (`:305`);
- otherwise `start-fresh`, or `needs-a-person` after one fresh session (`:306`).

The callers are `freshAgentDecisions` (`packages/fleet/src/server/entry/registryd.ts:968-985`), which feeds every reading for bound endings, and `killedWorkerEndings` (`registryd.ts:764-778`). The open question "which arm does it reach" therefore has a known answer, and the plan can state it. The existing test that pins the merged half is `packages/domain/test/clean-wait-end.test.ts:67`. The unmerged half has no test.

**Slice 3, `bug/fleetd-at-agents-zero-after-a-wait` (#1903): the settled behaviour already exists in the domain for ready slices.** `assign` → `scaleUp` (`packages/domain/src/workflows/assign.ts:170, 215-250`) starts agents when slices are held `no-free-agent`. At `agents: []` every ready slice is held `no-free-agent` (`queue.ts:668-677`). `queue.test.ts:540-558` asserts that `agents: []` with two ready slices starts three agents, bounded by the cap and by `DESKS_PER_TICK = 3` (`registryd-main.ts:983`). fleetd passes `--start-agents`, and the cap is read only then (`registryd-main.ts:2258`).

The plan does not mention any of this. The #1743 symptom ("fleetd ran `agents=0`, so nothing would have built the next approved plan") must therefore come from one of these:
- (a) the next plan's slices were held `no-brief` or `not-claimable`, which `scaleUp` deliberately ignores (`queue.test.ts:573-580`);
- (b) the fleet ran without `--start-agents`;
- (c) a desk at the wait bound still counted in `readings.agents`.

The slice cannot be built until the plan says which of these it fixes.

## 2. Is each proposed change the right one, in the right layer?

- **Slice 1:** the layer is right (domain rule plus plan-store adapter), but the change is aimed at code that is already correct. The right change starts by reproducing the handover end to end: plan markdown → `plot-plan-meta.sh` → `planStoreShell` → `planQueue` → `matchQueue`. If that holds, the cause is in the `merged` reading or in a stale daemon, and the change goes there. A regression test is worth keeping either way.
- **Slice 2:** "the fix lives in the domain rule; the controller only passes readings" is the right layer. But the reading the slice names, "the branch's claim names this agent", does not exist. A claim is a ref with empty `plot: claim` commits and carries no agent identity (`packages/domain/src/rules/claim.ts:15-48`). The only link from agent to branch is a manifest: `claimAnswer` reads it as `holders` (`claim.ts:131-169`). The candidate desk is `!registered` by construction (`registryd.ts:950-953`), so it has no manifest of its own to compare against. The implementable reading is "another live manifest names this branch" (`holders.length > 0`). It enters `EndingActionReadings` as a new value field and is tested first in the `isBoundEnding` row. A second route also fits the layering rule: agentLoop ROW 2 (`agent-loop.ts:473-484`) writes its own ending when the free desk still has a branch checked out. Then `killedWorkerEnding` returns `null` and never invents an `unreadable`. The plan should choose one route. As written, an agent has to invent the data source.
- **Slice 3:** the domain already has the rule in `scaleUp`, and readings arrive as values. Code belongs there only if the chosen cause is (a) or (c). If the decision is literally "one fresh agent", it conflicts with the existing `queue.test.ts:540`, which starts up to the cap. The plan must say whether "one" means exactly one, or "at least one, up to the cap" as the current code does.

## 3. What is missing, wrong or contradicted

- **No slice has a done-when.** Each bullet states an outcome. None names the test file, the test's name, or the rule that changes. For an unattended agent, "a test names the failing plan shape" does not say where the test goes or what it asserts.
- Approach step 3 and the Open Questions still leave #1903 open ("The reader decides", "code follows only if the answer is 'start'"). The decision is settled, and the plan must record it with its date and owner. The slice bullet "recorded and implemented if the answer is to start" makes the slice possibly empty. An agent that receives it cannot tell whether it is done.
- **"Startable slices" is undefined.** In code terms it is one of the hold words: `no-free-agent` (ready) or `no-brief`/`not-claimable` (claimable but gated). The two choices lead to different code and different tests.
- Slice 1 merges two defects into one branch, with "if slice 1 holds on the wait, slice 2 follows … and needs no second change". That is a hypothesis, not a done-when, and the two defects may share a root cause (the `merged` set) the plan does not name.
- Slice 2's open question "does the claim still name this agent" cannot be answered: claims name no agent (see 2).
- The Changelog line asserts outcomes that slice 1 may not deliver, because that behaviour already holds. It also says "the plan records whether fleetd starts…", which is stale after the decision.
- The Motivation says #1917 is "not reproduced". The arm follows from `ending-action.ts:302-306`, and the plan can state it now.
- `Board impact: none expected` may be wrong for slice 3 if the fix changes what the board's "Waiting on you" or fleet row shows at `agents=0`. The plan should check `#1902`'s row wording.

## 4. and 5.

See the amendments below.

**Position as a whole:** amend. The three problems are worth fixing, and the bundling is fine. Two of the three slices point at code that already does what the plan asks: the branch-line waits path and `scaleUp` at `agents=0`. The third depends on a reading ("the claim names this agent") that the estate does not record. No slice has a checkable done-when. An unattended agent given this plan would either write passing tests against working code and stop, or invent a data source. A short set of amendments fixes all of this. Nothing here argues for rejecting the plan.

## Amendments

1. Approach step 1: replace "make it read the same `waits:` annotations" with "reproduce end to end first: a fixture plan with the `waits:` on the bullet line, read by `plot-plan-meta.sh` → `planStoreShell` → `planQueue` → `matchQueue`. The parser (#1265) and the queue (#1267) already carry a branch-line wait, so if this test passes on main, look for the cause in the `merged` set that `planQueue` receives (merge-subject fallback, `listingWhole`) or in a stale registryd bundle."
2. Slice 1 done-when: "a test in `packages/fleet/test/unit/queue-reading.test.ts` named *a branch-line `waits:` holds the slice through the parser* asserts `whyNotReady(...) === 'waits'` for a markdown fixture. A second test asserts slice 2 of the same plan reads `not-claimable` while slice 1 is unmerged and unclaimed. Each test fails on main before the fix, or the slice records why main already passes and what the real cause was."
3. Slice 1: allow an outcome of "no code change; regression tests added; cause recorded as a stale daemon bundle", so the agent has an end state if the reproduction passes.
4. Motivation #1917: replace "not reproduced" with "`ending-action.ts:302-306` answers `release-claim` for an unmerged branch with nothing beyond the claim, and `start-fresh` when it holds commits, an open PR or a dirty tree".
5. Approach step 2: replace "when the branch's claim no longer names this agent" with a named reading. Either (a) a new `EndingActionReadings.otherHolders: readonly string[]` (live manifests other than this desk that name the branch, as `claimAnswer` already takes), tested first in the `isBoundEnding` row so that `otherHolders.length > 0` gives `leave`; or (b) agentLoop ROW 2 writes an ending for a free end with a branch checked out, so that `killedWorkerEnding` returns `null`. Choose one.
6. Slice 2 done-when: "`packages/domain/test/clean-wait-end.test.ts` gains *an unmerged branch another manifest holds is answered `leave`*, beside the merged case at `:67`. It fails on main with `release-claim`/`start-fresh`, and `registryd.ts`' `freshAgentDecisions` passes the new reading, covered in `packages/fleet/test/unit/fresh-agent-tick.test.ts`."
7. Delete the Open Question "does the branch's claim still name this agent". A claim records no agent (`rules/claim.ts:15-48`), so the question cannot be answered.
8. Approach step 3 and Open Questions: replace the #1903 question with the settled decision: "Decided by Jan Wloka, 2026-10-17: after a free desk ends at the wait bound and the fleet is at `agents=0`, fleetd starts a fresh free agent when approved, startable slices are waiting, bounded by the configured fleet size."
9. Slice 3: define "startable" as a hold word, e.g. "held `no-free-agent`", or "claimable and held `no-brief`" if briefs are written only by a running agent. State that `scaleUp` (`assign.ts:215`) already starts agents for `no-free-agent` at `agents: []` (`queue.test.ts:540`).
10. Slice 3: state the count. Either "exactly one", which changes `scaleUp` and the existing test at `queue.test.ts:540`, or "towards the cap", which is current behaviour.
11. Slice 3 done-when: "a failing test reproduces the #1743 estate (one or two desks ended at the wait bound, an approved plan's first slice briefed or not, `--start-agents` on) and asserts one `worker-start` write in `assign`'s decision. Name the file: `packages/domain/test/queue.test.ts` for a `scaleUp` change, or `packages/fleet/test/unit/registryd-tick.test.ts` if the cause is a desk at the bound counted in `readings.agents`."
12. Slice 3 bullet: replace "recorded and implemented if the answer is to start" with "fleetd starts a fresh agent at `agents=0` when <startable definition> slices wait, bounded by fleet size", so the slice is never empty.
13. Changelog: rewrite the first entry to match the amended slices, and drop "the plan records whether fleetd starts a fresh agent".
14. Board-impact comment: change to "check `2026-10-16-row-placement-and-wording-1677-1791`'s wait-bound row text against slice 3's start; no format change".
