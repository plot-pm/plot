# Cost juror, round 2

Position: amend

Lens: cost. I read the revised plan, the round-1 panel and the cited code in the worktree. I ran no test and no process. Every line number below is one I read myself.

## Rubric 1: the seven round-1 amendments

| # | Amendment | Holds? |
|---|---|---|
| 1 | Merge pinned to the SHA | Yes. `--match-head-commit`, `sha` on `PrMergeWrite` (`workflows/decision.ts:153-159` today has no `sha`), a host re-ask before the merge, `entry/approve.ts:554` cited correctly, and the shell change is declared. |
| 2 | Checks per arm, `checks-unbound` | Partly. The arms are named, but the Jenkins arm has no commit to give (finding C4). |
| 3 | Default-branch reading | Partly. The separate file, the cadence, the host slot and the reversible-hold argument hold. The "combined state" rests on `checksFromRuns`, which cannot fold runs (finding C1), and the cost row undercounts (finding C6). |
| 4 | Channel, baseline, re-ask, log | Mostly. Channel, baseline rule and `process-log.ts` (`packages/fleet/src/shared/process-log.ts`) hold. The re-ask bound is priced per PR, but the call is per refresh (finding C3). |
| 5 | Reconnect, render site, badge | Reconnect and render site hold. The page has no way to hear a finding (finding C5). |
| 6 | `PLOT-BLOCKED`, turn bound | The turn bound holds. The new `owes an answer` toast reads a finding that nothing publishes on the channel (finding C2). |
| 7 | `waits:` or last | Yes. The merge slice is last and carries `waits: feature/the-controllers-are-commands`, which exists in `2026-10-09-the-fleet-runs-without-the-board.md:127`. |

## Rubric 2: claims about current code

Correct: `startChannel` has no production caller (only tests and `adapters/index.ts` name it); `REFUSED_BY_DESIGN` at `rules/channel.ts:36-41`; `MEASURED_BY` and `findingKey` (`entities/finding.ts:60-71`, `:112-113`); `act.ts:86-90` subscribes with an `until` purpose; `PR_PENDING_REASK_LIMIT = 5` at `packages/fleet/src/shared/pr-refresh.ts:233`; `storeRow`/`recordOf` near `:1052`/`:1083`; `writePrStore` near `:1229`; `refreshRuns` at `packages/board/src/server/fleet.ts:1385` with `withHostSlot` at about `:1430`; `QUEUE_HOLDS` at `rules/queue.ts:333`; `worker-loop.ts:874`; `PlanCard.tsx:265`; `pr-merge` at `plot-host.sh:3812-3833`; rollup call at `:4135`; plain arm at `:4181`.

Wrong or imprecise:

- `checksFromRuns` (`rules/checks-verdict.ts:209`) is not a fold. It takes one `run`, compares it to `pushedSha`, and returns `none | wait | settled | no-answer | tip-moved`. It never returns green or red, and `SETTLED_CONCLUSIONS` excludes `cancelled` and `timed_out` (comment at `:245-251`). See C1.
- The plan cites `:4105` as a "No CI arm". `plot-host.sh:4104-4105` is the Jenkins arm's `gh pr list` call. LOW.
- The re-ask is not per PR. `pr-refresh.ts:1478-1479` makes one `pr-list --rich --state open` call per refresh for every askable PR together. See C3.
- `PlanCard.tsx:265` renders `checksVerdict` (imported at `PlanCard.tsx:6`), not a function from `rules/pr-row.ts`. LOW; the slice can still reuse the badge.

## Findings

**C1 (HIGH): slice 2 has no rule that yields `red` or `green`.** The plan says the reading "takes every run for the SHA and folds them with the existing `checksFromRuns`". That function reads one run and answers a wait verdict (`checks-verdict.ts:209-226`). It cannot combine three workflows (`ci.yml`, `build-bundles.yml`, `release.yml` all run on `push: main`), and it keeps `cancelled` and `timed_out` at `wait`. Two cost results follow. First, a `cancelled` or `timed_out` run on HEAD holds the reading at `pending`, so fleetd re-asks every 5 minutes until `Checks wait` and the hold never fires. Second, `run-for-sha` takes `.[0]` of the matching runs (`plot-host.sh:4573`), so the shell change that the table marks "if the brief finds" is certain, not conditional. Amendment: name a new domain rule (for example `foldShaRuns(runs, expectedWorkflows)`) that returns `red | green | pending | unknown`, state how `cancelled`, `timed_out`, `action_required` and a missing workflow map, and make the `runs`/`run-for-sha` shell change unconditional with its line removal.

**C2 (MEDIUM): `owes an answer` never reaches the channel.** The AgentMonitor writes its JSONL file; no production code sends `{"type":"publish"}` to a socket (grep over `skills/` and `packages/` finds only tests and `channel-socket.ts`). Slice 3 adds only the IndexMonitor as a publisher. So slice 6's toast on `owes an answer` never fires. Amendment: either slice 3 also relays the existing monitors' JSONL findings onto the channel (and prices that: one file read per monitor per tick), or slice 6 drops `owes an answer`.

**C3 (MEDIUM): the re-ask cost is modelled per PR and is not in the cadence.** The cost row says "at most 11 requests per open, ready PR per CI run". The real unit is one rich listing of all open PRs per refresh (`pr-refresh.ts:1478`). `PR_REQUESTS_PER_REFRESH` says the re-ask is "DELIBERATELY NOT COUNTED" because `PR_PENDING_REASK_LIMIT` keeps it "small and finite" (`:163-172`). The new time bound removes that argument: on an estate where some PR is nearly always mid-CI, the tail adds up to 12 rich GraphQL listings per hour against the priced 60 per hour (`:620`), about 20 %, with no stretch of the interval. "Younger than `Checks wait`" also has no start point: PR age would skip a PR pushed again after one hour. Amendment: price the re-ask per refresh (at most one call), state the steady worst case in requests per hour, either add it to the stretch or argue why not, and define the clock as "since the PR's checks first read `pending` for this `updatedAt`".

**C4 (MEDIUM): the Jenkins arm has no commit, and getting one costs N calls per tick.** `jenkins_build_map` builds its map from `jen job list --json` colours only (`plot-host.sh` about `:1546-1590`); no field carries a revision. A `checksSha` for Jenkins needs one build read per branch per refresh, which is a new Jenkins request rate that the cost table (slice 1: "none") does not show. Amendment: state that the Jenkins arm leaves `checksSha` absent in this plan (zero cost, merges answer `checks-unbound`), or price the per-branch read and its cadence.

**C5 (MEDIUM): slice 4 needs a server-to-page transport that the plan does not name.** The board has no server push (no `EventSource`, `text/event-stream` or `WebSocket` in `packages/board/src`). The server can subscribe, but the page cannot learn a finding arrived without a new SSE route or a change counter on the 4 s `/api/fleet` poll. Each `/api/board` call runs `boardState` over the estate (`packages/board/src/server/index.ts:444-470`), and its cost is not stated. Amendment: name the transport, state the cost of one `/api/board` build, and keep the 2 s bound per server, not per tab.

**C6 (MEDIUM): a red reading is never re-asked, so a re-run leaves the fleet held.** Fleetd reads on a HEAD move and re-asks only `pending`. A flaky red (the 2026-08-17 CDN 403 that `plot-host.sh` `runs` documents) fixed by a re-run on the same SHA stays `red` until `main` moves again, and auto-dispatch hands nothing over in that time. The idle fleet is the cost. Amendment: re-ask a `red` reading on the same schedule as `pending`, bounded by `Checks wait`.

**C7 (LOW): slice 2's request count is low by about five times, but in the cheap bucket.** The plan uses the 7-day mean (75 moves per day). The last day had 106, and a reading that stays `pending` for a 15 to 25 minute CI run is re-asked every 5 minutes, so the upper bound is about 106 + 288 = about 400 REST calls per day, plus one `gh run view` per failed run (`plot-host.sh:4583-4586`). `gh run list` is REST (`github core` in `budget.tsv`), not GraphQL, so this is about 17 per hour against 5000. Amendment: correct the row and name the bucket.

**C8 (LOW): the measurement has no threshold.** "Measure requests per hour over one working day before merge" asks a slice agent to run a branch fleetd for a day, and states no bound to compare against. `budget.tsv` has a bucket column but no op column, so the GraphQL re-ask tail and the REST run reads separate by bucket only. Amendment: give each slice a bound (for example "at most 12 added GraphQL calls per hour", "at most 20 added REST calls per hour") and measure it from a unit test that counts host calls over a simulated hour, not from a day of live use.

## Rubric 3: new problems

C1 and C2 are new: both come from the revision's own text. The state-not-history model fits the new findings: `findingKey` is `monitor + branch`, so a branch's `checks green` replaces its `checks failing`. The IndexMonitor publishes only on change, so the heartbeat's `lastSeen` for it goes stale under `monitorLiveness` (`rules/channel.ts:189-199`); a subscriber reading liveness sees `gone`. LOW; the slice should either publish a heartbeat or exclude the IndexMonitor from liveness. `FindingSchema.worktree` is required (`entities/finding.ts:87`) and the IndexMonitor has no desk; the slice must say what it writes. LOW.

## Rubric 4: buildable, cost and cadence

Slices 1, 3, 6 and 7 are buildable from the plan and a brief once C2 to C4 are answered. Slice 2 is not buildable as written (C1). Slice 4 is not buildable without a named transport (C5). Cost and cadence are stated for every slice, which is a real improvement on round 1, but slices 1 and 2 price the wrong unit (C3, C7).

## Rubric 5: the most important change

Slice 2 must name a new rule that folds every run for the HEAD SHA into `red | green | pending | unknown`, map `cancelled` and `timed_out`, re-ask `red` as well as `pending`, and make its shell change unconditional. Without it the hold has no input and the reading can sit at `pending` and cost a re-ask every 5 minutes for an hour.
