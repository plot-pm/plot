Position: amend
# The estate lens — a fresh agent after a wait

## Summary

Current `origin/main` already has two of the three fixes. Slice 1 (#1273) and slice 3 (#1903) describe behaviour that is in the code and has tests. Slice 2 (#1917) is a real defect. Its guard, "the branch's claim names this agent", is not a reading the estate has. The estate has other readings that can carry the guard. The plan must say what is already present, change slices 1 and 3 into a measurement and a regression test, and name the reading slice 2 uses.

## 1. Is each slice's problem real on current code?

### Slice 1 — `bug/the-registry-reads-branch-line-waits` (#1273): not reproducible on current code

- The parser reads a wait on a branch line. I ran the current parser on the plan from the incident: `bash skills/plot/scripts/plot-plan-meta.sh docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` returns `infra/the-loop-has-a-workflow ['infra/the-shell-loop-holds-unlanded-work']`, `unread []`. That is the exact branch-line shape from #1273, with a `builds:` marker in front of the `waits:` marker.
- The registry reads the field. `packages/domain/src/adapters/plan-store/plan-store-shell.ts:69-80` (`branchOf`) maps `waits_on` (a list or a string) to `PlanRecordBranch.waitsOn`. `rules/queue.ts:849-876` (`planQueue`) turns any unmerged prerequisite into `waitHeld`. `whyNotReady` (`queue.ts:471-500`) tests `waits` before `no-brief`.
- These tests already exist: `packages/domain/test/plan-store-shell.test.ts:54-69` (`branchOf — waits_on maps to waitsOn`), `packages/domain/test/queue.test.ts:89-99, 184-270` (the waits hold and its table), `packages/fleet/test/unit/queue-reading.test.ts:723-777` (*"a `waits:` prerequisite holds a slice through the real join"*), and `test/reconcile/parser.test.mjs:1884-2054` (branch-line `waits:`, several markers, and the heading spelling).
- The ordering half also has a test. `queue.test.ts` *"does not offer the second slice while the first is claimed and unmerged"* covers it. `planQueue` counts a slice as outstanding by `settled` (merged only, `queue.ts:745`), not by the claim ref. A released claim on an unmerged slice 1 therefore still holds slice 2 `not-claimable`.
- **The timing explains the incident.** `git log` on `plan-store-shell.ts` gives `76e774813 2026-10-03 The queue reads the scan's order (#1247)`, `84ec3299d 2026-10-03 Every wait reaches the verdict (#1253)` and `8e5fe3e18 2026-10-04 00:15 The parser reads every wait (#1265)`. Before #1247, `branchOf` did not read `waits_on` at all, as plan `2026-10-02-a-slice-waits-on-every-branch-it-names.md` §Motivation states. The #1273 handovers came at 23:04 on 2026-10-04 and 08:19 on 2026-10-05, within a day of these merges. A long-running `plot-registryd` that had not reloaded its bundle matches the evidence. The plan does not mention these three PRs, and it proposes to "find where the registry builds `waitsOn` and make it read" a field the registry already reads.

### Slice 2 — `bug/a-free-desk-ending-acts-on-no-slice` (#1917): real, and readable without reproduction

- `endingTableAnswer` (`packages/domain/src/rules/ending-action.ts:301-306`) sends `unreadable` to the `bound` row (`BOUND_ENDINGS`, `:159`). With `prMerged !== 'merged'` and no marker, it gives `release-claim` when the branch holds nothing, and `start-fresh` when it holds a commit, an open PR or a dirty tree.
- A free desk's last slice was sealed (`seal`, `workflows/agent-loop.ts:374-383`). It usually has an open PR that waits for review or merge, so the `start-fresh` arm is reachable by reading the code. The plan's first #1917 open question is answered: `start-fresh` with an open PR, `release-claim` with nothing beyond the claim.
- `packages/domain/test/clean-wait-end.test.ts` (from `a007fd0d7 Clean end (#1748)`) already builds this full path: `killedWorkerEnding` with `exit: '124'`, then `endingAction`. It only covers `prMerged: 'merged'`. Slice 2's "reproduce first" step is one more `it` in that file, not new scaffolding.

### Slice 3 — `bug/fleetd-at-agents-zero-after-a-wait` (#1903): the decided behaviour already exists

- `workflows/assign.ts:191-249` (`scaleUp`): when a slice is held `no-free-agent`, fleetd requests `fleet.size`, and `fleetSize` subtracts the running agents. At `agents=0`, every ready slice is held `no-free-agent` (`matchQueue`, `queue.ts:669-677`), so fleetd starts agents up to the configured size. That is the operator's 2026-10-17 decision.
- The CLI flag gates the behaviour. `--start-agents` is in the installed unit (`skills/plot/units/com.plot-pm.fleetd.plist:40`), and the tick passes `fleetCapForRepo` (`size: settings.parallelAgents`) only under that flag (`registryd-main.ts:2258`).
- These tests exist: `queue.test.ts:540-595` (*"starts agents for slices nothing could take, up to the cap"*, *"starts nothing over an empty queue"*, *"starts nothing for a slice held by its brief or its plan"*), and `packages/fleet/test/unit/registryd-tick.test.ts:723` (*"a tick starts agents when queued > running"*).
- **The live log shows it working.** `.plot/logs/fleetd.log.1:41489` reads `agents=0 … no-free-agent=1 … started=1`, and `:77733` reads `agents=0 … no-free-agent=1 … started=2`. The `agents=0` ticks that start nothing carry `no-free-agent=0` (e.g. `:3757`, `:5978`: `not-claimable=409`, `waits=3`, `no-brief=0`). In those ticks no slice was ready, so starting an agent would have put a worker in front of a gate (the comment at `assign.ts:196-198`). #1743's side note, *"nothing would have built the next approved plan"*, does not record whether that plan's slices were briefed and claimable. The plan copies the claim without checking it.

## 2. Is each proposed change the right one, in the right layer?

- **Slice 1:** a code change in `plan-store-shell.ts`, `rules/queue.ts` or `rules/eligible.ts` has nothing left to fix. The right change is a regression test that joins the real parser output for the #1273 line (with `builds:` before `waits:`) through `branchOf` into `planQueue` and `whyNotReady`. A corpus-style test in `packages/domain/corpus/plan-store.corpus.test.ts` or `test/reconcile` already runs the parser. The second deliverable is a recorded reason: which bundle the registry ran on 2026-10-04.
- **Slice 2:** the domain is the right layer (`endingAction` or `killedWorkerEnding`), with the controller `packages/fleet/src/server/entry/registryd.ts:765-778` (`killedWorkerEndings`) passing one more reading. The guard as written, "the branch's claim names this agent", contradicts the estate's model. A claim is a ref, and it names no agent (`rules/claim.ts:15`, `ClaimAnswer = 'absent' | 'claim-only' | 'work' | 'unknown'`). Who holds a branch is read from live manifests (`claimAnswer.holders`, `claim.ts:132-169`). `EndingActionReadings` notes that the manifest is gone once the loop has ended (`ending-action.ts:8-10`). The estate already has two readings that answer "this desk handed the slice off":
  - `freeWaitEnded(ending, exit)` (`rules/ended-desk.ts:64-68`): a supervisor `unreadable` ending beside an exit of `124`. The #1902 slice built it for the same desk shape, and its TSDoc states that every other 124 exit writes its own ending.
  - The sealed slice's `declaration` with `status: 'ok'` (`agent-loop.ts:374-383`). `sealDeclaration` keeps it and removes `.plot-worker.ending.json` (`a007fd0d7`).

  Either one is a value the controller already reads from the desk (`deskFile`). Neither needs a new claim concept.
- **Slice 3:** no code. If a gap remains, it is a test that names the scenario: a free desk ends at the wait bound, `agents: []`, one ready slice, and `assign` starts at least one agent.

## 3. What is missing, wrong or contradicted

1. The Motivation for #1273 leaves out #1247, #1253 and #1265, which landed in the 24 hours before the incident and added the reading the issue says is missing. It also leaves out the Released plan `2026-10-02-a-slice-waits-on-every-branch-it-names`, which named `branchOf` as not reading the field.
2. The Approach for slice 1 names three files to change. On current code none of them needs a change.
3. The Approach for slice 3 and the first Open Question treat as undecided something the code already does (`scaleUp`). The settled decision says "one fresh free agent … bounded by the configured fleet size". The existing code requests up to `fleet.size` (log `started=2` at `:77733`), capped by `DESKS_PER_TICK = 3` (`registryd-main.ts:983`). The plan must say whether "one" is a new per-tick limit or whether the existing cap meets the decision. Otherwise slice 3 changes tested behaviour (`queue.test.ts` *"starts agents for slices nothing could take, up to the cap"* expects 3).
4. The guard in slice 2 depends on a reading that does not exist ("claim names this agent"). The plan must name the reading.
5. The Open Question on #1917 "which arm" can be answered now from `ending-action.ts:301-306`. It does not need to stay open.
6. Slice 2 must also keep the reaper's view of the desk consistent: `endedDeskPlacement` already treats a merged free-wait desk as owing nothing. The plan does not say what the board row shows for an unmerged free-wait desk once `endingAction` answers `leave`. `endedDeskPlacement` returns `owesPerson: true` when `merged !== true` (`ended-desk.ts:84-90`), so such a desk stays in *Waiting on you* with an empty note.
7. "Board impact: none expected" holds for slices 1 and 3. Slice 2 may change which desks appear in *Waiting on you* (item 6).
8. Nothing contradicts the active plan `2026-10-16-the-agent-s-ci-wait-never` (Jenkins). It does not touch `endingAction`, the queue or `scaleUp`.

## 4. Amendments

See `## Amendments` below.

## 5. Position

**amend.** Slice 2 is real and belongs in the domain where the plan puts it. Slices 1 and 3 propose code for behaviour that `origin/main` already has, with tests and live log evidence. As written, slice 1 sends an agent to change correct code, and slice 3 may change a tested cap without saying so. The amendments are small, and the plan keeps its shape.

## What I looked at

- I read the code, the plans, the issues and git history, and I executed read-only commands. I ran `plot-plan-meta.sh` on `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md`. I ran `git log` on `plan-store-shell.ts`, `rules/queue.ts` and `ending-action.ts`. I ran `git show a007fd0d7`. I ran `gh issue view` for #1950, #1903, #1917, #1273 and #1743 (with comments) and `gh pr view` for #1253 and #1265. I grepped `.plot/logs/fleetd.log.1` for `agents=0` ticks.
- I read `plan-store-shell.ts`, `rules/queue.ts`, `workflows/assign.ts`, `rules/ending-action.ts`, `rules/ended-desk.ts`, `rules/claim.ts`, `workflows/agent-loop.ts` (ROW 2, `seal`), `fleet/src/server/entry/registryd.ts` (`killedWorkerEndings`), `registryd-main.ts` (`fleetCapForRepo`, `--start-agents`), and `fleet/src/server/entry/worker-loop.ts` (the wait-bound log line).
- I read these tests: `clean-wait-end.test.ts`, `queue.test.ts`, `plan-store-shell.test.ts`, the `queue-reading.test.ts` waits block, the `registryd-tick.test.ts` scale-up block and the `parser.test.mjs` waits block.
- I read these plans: `2026-09-06-a-stated-wait-is-a-parsed-wait`, `2026-10-02-a-slice-waits-on-every-branch-it-names`, `2026-10-07-every-loop-ending-has-a-supervisor-rule` (its open question kept `unreadable` at `leave`), `2026-10-16-row-placement-and-wording-1677-1791`, `2026-10-16-the-agent-s-ci-wait-never`, and the `docs/plans/active/` listing.
- I ran no vitest suite. A grep that named `plot-dispatch.sh` was refused by the controller gate, so I did not read that script.

## Amendments

1. Motivation, #1273: add "#1247 (2026-10-03), #1253 (2026-10-03) and #1265 (2026-10-04 00:15) added `waitsOn` to `branchOf` and the `waits` hold to the queue; on current `origin/main` the parser reads the incident's line as `waits_on: ["infra/the-shell-loop-holds-unlanded-work"]`."
2. Slice 1 bullet: change to "`bug/the-registry-reads-branch-line-waits` — a regression test joins the real parser output for a branch-line `waits:` placed after a `builds:` marker through `branchOf`, `planQueue` and `whyNotReady` to `waits`, and a released, unmerged slice 1 to slice 2 `not-claimable`; code changes only if that test fails on `origin/main`."
3. Approach §1: replace "make it read the same `waits:` annotations" with "measure first: if the joined test passes on `origin/main`, record that the 2026-10-04 handovers came from a registry running a bundle older than #1247/#1265, and ship only the test."
4. Approach §3 and Open Question 1: replace them with "Decided 2026-10-17 (Jan Wloka): fleetd starts a fresh agent at `agents=0` when a slice is held `no-free-agent`, bounded by `Parallel agents`. `scaleUp` (`workflows/assign.ts:191-249`) already does this under `--start-agents`; `fleetd.log.1:41489` and `:77733` show `agents=0 … no-free-agent=1 … started=1`/`started=2`."
5. Slice 3 bullet: change to "`bug/fleetd-at-agents-zero-after-a-wait` — a test pins the wait-bound case (`agents: []`, one ready slice, `assign` starts ≥ 1 agent; a slice held `no-brief`/`not-claimable`/`waits` starts none); no change to `scaleUp`." Alternatively, drop the slice and record the finding under Notes.
6. If "one fresh agent" is meant as a new limit, add to slice 3: "changes `scaleUp` to start at most one agent per tick from `agents=0`, and updates `queue.test.ts` *'starts agents for slices nothing could take, up to the cap'*, which expects 3." Otherwise state that the existing cap meets the decision.
7. Slice 2 bullet: replace "only while the branch's claim names this agent" with "never for a free-wait end: `freeWaitEnded(ending, exit)` (`rules/ended-desk.ts:64`), or an `ok` declaration for that branch, makes `endingAction` answer `leave`; the controller (`fleet/src/server/entry/registryd.ts` `readFreshAgentCandidates`) passes the exit record as a reading."
8. Approach §2: add "A claim is a ref and names no agent (`rules/claim.ts:15`); a holder is a live manifest, and the manifest is gone when this rule runs (`ending-action.ts:8-10`). The guard reads the desk's own records instead."
9. Open Question 2 (#1917, which arm): resolve to "`start-fresh` when the branch carries an open PR, a commit beyond its claim or a dirty tree; `release-claim` otherwise (`ending-action.ts:301-306`)." Slice 2's first test extends `packages/domain/test/clean-wait-end.test.ts` with `prMerged: 'not-merged'`.
10. Open Question 3: replace it with "Does any non-free-wait path produce a supervisor `unreadable` ending beside exit 124, e.g. the wrapper's own timeout killing a loop mid-slice? If so, `freeWaitEnded` cannot be the guard alone, and the `ok` declaration is."
11. Slice 2 Done-when: add "an unmerged free-wait desk whose `endingAction` is `leave` gets a placement from `endedDeskPlacement` that names it, not an empty-note row in *Waiting on you*", or state that this stays out of scope.
12. Board impact comment: change to "Slices 1 and 3: none. Slice 2 may change which ended desks appear in *Waiting on you* (`endedDeskPlacement`)."
13. Changelog: drop "the plan records whether fleetd starts a fresh agent at `agents=0`" and state the regression tests that ship instead.
