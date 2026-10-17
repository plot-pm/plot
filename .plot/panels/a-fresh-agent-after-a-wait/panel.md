# Panel — a fresh agent after a wait

Subject: `docs/plans/2026-10-17-a-fresh-agent-after-a-wait.md` (`a26254dfc`, 2026-10-17 11:20:07 +0200), plan PR #1954, answering #1950 (#1903, #1917, #1273)
Convened: 2026-10-17, on `origin/main` at `9242e0c50` plus the plan
Lenses: estate, contradiction, deliverable, cost — four jurors (opus), one rubric, persona varied only. Commitment: `Position: proceed | amend | reject`.
Settled before the panel and given to every juror as binding: #1903 decided by Jan Wloka on 2026-10-17 — after a free desk ends at the wait bound and the fleet is at agents=0, fleetd starts one fresh free agent when approved, startable slices are waiting, bounded by the configured fleet size.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | What it looked at |
|---|---|---|
| estate | **amend** | read code, plans, issues, git history; ran `plot-plan-meta.sh` on the incident plan; grepped `fleetd.log.1` for `agents=0` ticks |
| contradiction | **amend** | read code and DESIGN docs; ran `plot-plan-meta.sh` on the incident plan, `git log -S`, `gh issue view` |
| deliverable | **amend** | read code; ran `plot-plan-meta.sh` on the incident plan, `git log` |
| cost | **amend** | read code; ran `plot-plan-meta.sh` on a scratch plan with the issue's exact line |

Gate: all four committed on the first run (`plot-panel.mjs check Position proceed,amend,reject <lens>` exit 0). Reconcile: `unanimous amend estate,contradiction,deliverable,cost`. No juror ran a vitest suite.

## Where all four agree

1. **#1273's first defect does not reproduce on current code.** All four ran the parser on the measured line and got `waits_on: ["infra/the-shell-loop-holds-unlanded-work"]`, `unread_waits: []`. `branchOf` (`plan-store-shell.ts:69-80`) maps it and `planQueue` (`queue.ts:849-876`) holds on it; #1247, #1253 and #1265 landed 2026-10-03 to 2026-10-04 00:15, before both hand-overs. Slice 1 as written sends an agent to change correct code.
2. **#1903's decided behaviour already exists.** `assign` → `scaleUp` (`assign.ts:191-249`) starts free agents when a slice is held `no-free-agent`, which every ready slice is at `agents: []`; `queue.test.ts:540` pins it; fleetd runs `--start-agents` (`com.plot-pm.fleetd.plist:40`). The estate juror found `fleetd.log.1:41489` and `:77733` with `agents=0 … no-free-agent=1 … started=1`/`started=2`. Slice 3 must find what kept the queue empty in #1743's case, not build a second starter.
3. **#1917 is real, and its arm is readable now.** `ending-action.ts:301-306` answers `start-fresh` for an `unreadable` ending on an unmerged branch with an open PR, a commit beyond the claim or a dirty tree, and `release-claim` otherwise. `clean-wait-end.test.ts` covers only the merged case.
4. **The guard "the branch's claim names this agent" reads a fact the estate does not record.** A claim is a ref with empty commits (`rules/claim.ts:15`); the holder is a live manifest, and the manifest is gone when the rule runs (`ending-action.ts:8-10`).
5. **"One fresh agent" and the code disagree.** `scaleUp` requests the full fleet size and fleetd starts up to `DESKS_PER_TICK = 3` per tick; the decision says one. Every juror asked the plan to say which.
6. **No slice has a checkable done-when**, and slice 3 ("implemented if the answer is to start") may ship nothing.

## Where they disagree

1. **What reading carries the #1917 guard.** estate: the desk's own records — `freeWaitEnded(ending, exit)` (`ended-desk.ts:64`) or the sealed slice's `ok` declaration — with no new claim concept and no host call. deliverable: either `otherHolders` (live manifests other than this desk naming the branch) as a new `EndingActionReadings` field, or agentLoop ROW 2 writing its own ending so `killedWorkerEnding` returns `null`. contradiction: a new field sourced from the claim ref tip or the last manifest, with an unanswerable read answering `leave`. cost: any reading, provided it costs nothing for a desk with no supervisor ending. **This is a disagreement about where the fact lives, not about whether to guard.** The estate's objection to manifest-based readings (the manifest is gone at decision time) is not answered by the deliverable or contradiction jurors. **Moderator recommends:** the slice reads the desk's own records first — `freeWaitEnded` plus the `ok` declaration — and an unanswerable reading answers `leave`, never `release-claim` or `start-fresh`; ROW 2 writing its own ending is the named alternative if the first test shows `freeWaitEnded` cannot separate a free-wait end from a mid-slice 124 (estate's open question 10).
2. **The cause behind #1273's hand-overs.** estate, contradiction and cost name a daemon on a bundle older than #1247/#1265; deliverable adds a second candidate, a `merged` set that wrongly named the prerequisite, which would also explain slice 2 reading `no-brief` instead of `not-claimable`. **Moderator check (executed):** `.plot/logs/registryd.log` shows one `plot-registryd: supervising` start at line 30654, no restart before either hand-over (`:44964`, `:46711`), and no tick line before `:69361` (the restart as `plot-fleetd`) carries a `waits=` counter or a `held on waits` section; the first appears at `:69362`. The daemon that handed the slice over had no waits hold in its tick at all. That supports the stale-bundle cause and does not exclude the `merged`-set one; slice 1's test decides.
3. **Slice order.** contradiction: three `###` headings are an order (`DESIGN-slice.md:49`), so "no ordering between them" is false. cost: slice 3 must wait on slice 2, because each extra free agent becomes a later exit-124 desk that #1917 can turn into a `start-fresh` Sonnet session. estate and deliverable are silent. **Moderator recommends:** keep the headings and state that the slices land in document order; slice 3 already sits after slice 2, which meets the cost juror's dependency.

## Single-lens findings, uncontested

- contradiction: "fresh" already means `start-fresh` / `freshAgentCandidateTrees` — an ended desk's slice — which is exactly #1917's path. Use "new free agent" for #1903.
- contradiction: agentLoop ROW 2's comment *"No slice was ever held"* (`agent-loop.ts:474`) is false for a desk that still has its last slice checked out.
- estate: an unmerged free-wait desk answered `leave` still gets `owesPerson: true` from `endedDeskPlacement` (`ended-desk.ts:84-90`) and shows in *Waiting on you* with an empty note; the board-impact comment is wrong for slice 2.
- cost: a failed start retries every 60 s tick with no back-off (`registryd-main.ts:1251-1253`); a waits-held, briefed, claimable slice still pays one `prMerged` call per tick (`queue-reading.ts:349-352`). The moderator records both as follow-ups rather than slice scope: neither is caused by this plan, and the plan adds no newly held slice if slice 1 changes no code.
- deliverable: "startable" must be a hold word; `no-free-agent` matches the decision's "approved, startable" and needs no new predicate.

## What the lenses had in common

Every juror read the same three files for the core findings (`plan-store-shell.ts`, `queue.ts`, `assign.ts`) and every juror's only executed evidence was the same parser call. **None ran `planQueue` or `assign` on the incident's shape**, so "slice 1 and slice 3 are already fixed" is a strong reading of code plus one parser run, not a test result — which is why the amendments make each of those slices start with a failing test rather than drop it. None checked which bundle the daemon ran; the moderator's log check above is the only evidence for the stale-bundle cause. And all four accepted the decision's "fleet at agents=0 after a wait-bound end" as the trigger: none asked whether a desk at the wait bound still counts in `readings.agents` (deliverable lists it as cause (c) without measuring it), which is the one #1903 cause that would make `scaleUp` see agents≠0.

## Needs the operator

- **"One fresh free agent" vs `scaleUp`'s current request.** Does "one" mean a new limit of one start per tick at `agents=0` (changes `scaleUp` and the test at `queue.test.ts:540` that expects 3), or does the existing start up to `Parallel agents`, at most 3 per tick, meet the decision? The plan records this as an open question and slice 3 pins the answer in a test.
