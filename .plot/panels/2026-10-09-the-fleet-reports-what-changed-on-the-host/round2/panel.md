# Panel: the-fleet-reports-what-changed-on-the-host — round 2

- **Date:** 2026-10-09
- **Caller:** challenge-the-plan Phase 3P (Draft plan, round 2, revision 4330647f1)
- **Lenses:** estate, contradiction, deliverable, cost
- **Gate:** `plot-panel.mjs check Position proceed,amend,reject` passed for all four files
- **Reconcile:** `unanimous amend estate,contradiction,deliverable,cost`
- **Round 1:** `round1/panel.md`

## What each juror looked at

All four read the plan, the round-1 moderation, the revision diff, CLAUDE.md and the cited code with grep, sed and git. No juror ran a test. The positions rest on reading.

## Round-1 amendments

Amendment 7 (`waits:` on the last slice) holds in all four readings. Amendments 2, 3 and 5 hold in part. Amendments 1 and 6 do not hold: the merge re-ask has no source for checks, and the `owes an answer` toast replaced `PLOT-BLOCKED` with a finding the channel also does not carry.

## Where all four agree

1. **Starting the channel carries only the IndexMonitor.** The WorkerMonitor, AgentMonitor and BuildMonitor write per-desk JSONL files (`plot-agent-monitor.sh:144`, `ports/desk.ts:215-235`), and the board reads those files on purpose (`board/src/server/findings.ts:9-15`). Nothing in production publishes to the socket. So slice 6's `owes an answer` toast never fires, slice 5's feed shows index findings only, and `entry/act.ts`'s `until owes a review` is never served. The plan's text treats the BuildMonitor as a channel publisher, which it is not. This is the HIGH finding of estate, contradiction and deliverable, and MEDIUM for cost.
2. **`checksFromRuns` does not fold runs.** `rules/checks-verdict.ts:209` reads one run and returns a wait verdict (`none | wait | settled | no-answer | tip-moved`), never red or green, and it keeps `cancelled` and `timed_out` at `wait`. `run-for-sha` takes the first matching run (`plot-host.sh:4573`). Slice 2 needs a new rule that folds runs into `red | green | pending | unknown`, a port operation that lists every run for one SHA, and an unconditional shell change. HIGH for cost, MEDIUM for the others.
3. **The merge re-ask has no source for checks.** `pr-state` (`plot-host.sh:3439`, `:3496`) returns no checks, and the slice-7 shell row adds only `headRefOid`. The destructive merge would still decide from an index row, and "two requests per merge" under-counts. HIGH for contradiction, MEDIUM for the others.
4. **Smaller corrections all four or three name:** `plot-host.sh:4105` is the Jenkins arm, not a no-CI arm; the badge comes from `checksVerdict` in `rules/checks-reading.ts`, not `rules/pr-row.ts`; on Jenkins `checksSha` is always absent, so every Jenkins merge refuses `checks-unbound`; the IndexMonitor needs a `worktree` value, a place in the closed `MonitorNameSchema` and a heartbeat.

## Findings one or two lenses raised

- **Estate: the render-site shape exists.** `checksVerdict` already returns `{state, prominence, shown, label, detail}`. The plan's `{show, tone, text}` would build it twice. A new banner also contradicts the one-box `StatusPanel.tsx` design.
- **Estate: no publish-on-change rule.** The channel forwards every publish, so an IndexMonitor that publishes on every fold makes a toast and a refetch each time. `pr merged` is never retracted.
- **Contradiction and cost: the page has no push channel.** `packages/board/src` has no SSE or WebSocket. Round 1's `/api/events` route did that job, and the revision dropped it, so slice 4 tells the server and not the page.
- **Contradiction: the cold-store rule hides `pr merged`.** After a restart a late `until pr merged` subscriber waits for ever. The "free local ref read" needs a fetch that fleetd does not make. The non-terminal licence cites the wrong section; the rule it relaxes is `CLAUDE.md:478`.
- **Cost: the re-ask cost is per listing, not per PR.** One rich listing per refresh covers all pending PRs (`pr-refresh.ts:1478`); the time-bounded tail adds up to 12 GraphQL listings per hour against the priced 60. "Younger than `Checks wait`" has no start point; deliverable proposes the current head SHA's push time. Re-ask `red` as well as `pending`, because a re-run can fix a failure. A real Jenkins `checksSha` costs one Jenkins request per branch per refresh. Slice 2's 75 calls per day is about five times low (up to about 400, REST, about 17 per hour against 5000).
- **Deliverable: only slice 5 names its proving test.** Each slice needs a done-when and a test that fails without the change.

## No disagreement on the position

All four say amend, and for the first time they agree on the most important change: **decide what the channel carries.** Round 2's findings are narrower than round 1's: the transport choice holds, and the defects are a missing relay, a missing fold rule and a missing checks source.

## Shared blind spot

No juror asked whether slice 4 is worth its cost without a page push: if the board server subscribes and the page still polls every 30 s, the slice changes little a person sees. Contradiction and cost noticed the missing push but did not weigh dropping the slice against restoring the route. No juror executed anything, so the call counts remain reasoned figures.

## Amendments for the author

1. **Decide the channel's scope** (a choice for the plan's owner): either (a) a new slice relays the desk monitors' JSONL findings onto the channel, with its cost, or (b) the channel carries IndexMonitor findings only, and slice 6 and open question 3 drop the AgentMonitor findings.
2. Slice 2: add a rule that folds every run for a SHA into `red | green | pending | unknown`, treating `cancelled` and `timed_out` explicitly; add a port operation that lists every run for one SHA; make the shell change unconditional; re-ask `red` as well as `pending`; state how the default-branch ref is fetched.
3. Slice 7: name the checks source for the re-ask (a `pr-checks` verb, or `pr-state` returning the rollup), add it to the shell table, and recount the requests. State what Jenkins repositories get.
4. Slice 3: publish only on change; give the IndexMonitor a `worktree` value, an enum entry and a heartbeat; retract `pr merged`; keep `pr merged` in the cold-store state for PRs merged since the last restart.
5. Slice 4: restore a page push (`/api/events`), or drop the slice and let slice 5 read the payload.
6. Slice 5: reuse `checksVerdict`'s shape, and place the default-branch state inside `StatusPanel.tsx` instead of a new banner.
7. Every slice: a done-when line and the test that fails without the change. Fix the citations listed above.
