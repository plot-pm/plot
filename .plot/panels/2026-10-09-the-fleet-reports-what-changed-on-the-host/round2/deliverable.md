# Juror: deliverable (round 2)

Position: amend

The lens reads each slice as the agent who builds it from the plan and a brief alone. The revision answers most of round 1, and slices 1, 2, 4 and 7 are close to buildable. One design gap remains HIGH: the channel that slices 3 to 6 build on carries no desk-monitor finding, because nothing publishes those findings to the socket. Two citations send the implementer to code that does not do what the plan says.

## Evidence I checked myself

- `startChannel` (`packages/domain/src/adapters/channel/channel-socket.ts:68`) has no production caller. Only `packages/domain/test/channel-*.test.ts` and `packages/board/test/unit/the-master-agent-subscribes.test.ts` call it. The plan's claim holds.
- The socket accepts `{"type":"publish","finding":…}` lines (`channel-socket.ts:21-24`, `:88-93`). A grep for a publisher over `packages/*/src` and `skills/plot/scripts/*.sh` finds only the socket itself. The three existing monitors write `.plot-worker.monitor.{worker,agent,build}.jsonl` files in the desk (`plot-agent-monitor.sh:144`, `desk-fs.ts:33-36`, `plot-dispatch.sh:1592`), and the board reads those files directly (`packages/board/src/server/findings.ts:3-15`, `:39-42`).
- `REFUSED_BY_DESIGN` is at `rules/channel.ts:36-41` with the quoted reason. `findingKey` is `monitor + branch` (`entities/finding.ts`, last export). `MonitorNameSchema` holds three names. `FindingSchema` requires `worktree: z.string()`.
- `entry/act.ts:86-91` subscribes with `{ kind: 'until', finding: 'owes a review' }`, an AgentMonitor finding.
- `checksFromRuns` (`rules/checks-verdict.ts:209-224`) takes ONE run, a pushed SHA, a tip reading and a bound, and returns `'none' | 'wait' | 'settled' | 'no-answer' | 'tip-moved'`. It does not fold several runs and does not answer red or green.
- `BuildPort` (`ports/build.ts:76`, `:103`) has `runs(branch, limit)` and `runForSha(branch, sha, limit)`, which returns one `ShaRun | null`.
- `PlanCard.tsx:265` is `ChecksNote`, which calls `checksVerdict` from `@plot-pm/domain` (`checks-verdict.ts`). `rules/pr-row.ts` exports `prRowPlacement` and `prChecksSuppressedByMerge`, not the badge text.
- `PR_PENDING_REASK_LIMIT = 5` at `pr-refresh.ts:233`; `:1066` and `:1094` are the row mapping in both directions; `:1238` is the `foldPrIndex` call. The re-ask at `pr-refresh.ts:1469-1480` is ONE `pr-list --rich --state open` call per delta for all pending PRs, not one call per PR.
- `fleet.ts:1385` is `refreshRuns`. `queue.ts:333` is `QUEUE_HOLDS`. `decision.ts:153-159` is `PrMergeWrite` with no `sha`. `entry/approve.ts:554` is `ctx.scripts.host(['pr-merge', …, '--delete-branch'])`. `worker-loop.ts:874` (in `packages/fleet`) is the `runForSha` call. `App.tsx:30-31` holds 30 000 and 4 000 ms. `one-pr-index-writer.test.ts` exists in `packages/fleet/test/unit/`.
- `plot-host.sh`: `:4096` opens the Jenkins arm, `:4105` is the Jenkins arm's `gh pr list` (no rollup), `:4136` is the rollup arm, `:4182` is the plain arm. `pr-merge` is `:3812-3833` and passes no SHA. `pr-state` (`:3439`) returns `number,state,draft,url,mergeCommit` and no checks. The verb list (`:3361-5166`) has no per-PR checks verb.
- `<!-- waits: … -->` after another annotation on one line has precedents in `docs/plans`, and `feature/the-controllers-are-commands` exists in `2026-10-09-the-fleet-runs-without-the-board.md`.

## Round-1 amendments

1. Merge pinned to the SHA: held (`--match-head-commit`, `sha` on `PrMergeWrite`, `unaskable` on Bitbucket, correct `approve.ts:554`, shell row 7). Partly missed: the host re-ask of the checks has no verb (finding 3).
2. Per-arm meaning and `checks-unbound`: held. The arm list mislabels `:4105` as a no-CI arm; it is the Jenkins arm (finding 6).
3. Default-branch reading: held for the separate file, the cadence, the host slot, the cost row and the reversible-hold argument. Wrong for the fold: `checksFromRuns` cannot fold runs (finding 2).
4. Channel, baseline, re-ask bound, `process-log.ts`: held for IndexMonitor. Missed: the channel has no path for the three desk monitors (finding 1).
5. Reconnect and render site: held. Badge source cited wrong (finding 6). Feed and banner data path to the page is not stated (finding 4).
6. `PLOT-BLOCKED`: replaced by `owes an answer`, which is the right finding name but does not reach the channel (finding 1). Turn bound: held.
7. `waits:` annotation and last position: held.

## Findings

### 1. No desk-monitor finding reaches the channel — HIGH

The plan treats the channel as the bus for every finding: slice 6 toasts on `owes an answer`, slice 5's feed shows "the channel's current findings", and Open Question 3 asks whether `entry/act.ts` starts its `owes a review` subscriber. Today WorkerMonitor, AgentMonitor and BuildMonitor write desk files only, and no code sends a `publish` line to the socket. Once slice 3 starts the channel, it carries IndexMonitor findings and nothing else. So the mod never toasts `owes an answer`, the feed pane shows only index findings while the board already shows desk findings from files, and `act.ts` would wait for a finding nobody publishes. An implementer of slice 6 cannot finish the stated toast without inventing a bridge in a slice that does not own it.

Amendment: decide one of two, and write it in Design §3 and the slice 3 line. (a) Slice 3 also adds a bridge in fleetd that reads the three `MONITOR_LOGS` files of each live desk on the fleet's existing pass and publishes changed lines, with its cost; or (b) the channel carries IndexMonitor findings only in this plan, slice 6 drops `owes an answer`, the feed pane is named "index findings", and Open Question 3 closes as "stays test-only, nothing publishes `owes a review`".

### 2. The combined default-branch state cites a function that does not fold runs — MEDIUM

Design §2 says the reading "folds them with the existing `checksFromRuns` (`checks-verdict.ts:209`)". That function decides one pass of a worker's wait for one run and returns `wait/settled/no-answer/tip-moved/none`. The slice-2 implementer will find no fold to reuse and must also add a port operation, since `runForSha` returns one run and the shell row 2 is conditional ("if the brief finds…").

Amendment: name a new domain rule (for example `defaultBranchChecks(runs, sha, expectedWorkflows)`) with its answers `red | green | pending | unknown`, state that "every workflow" means the set of workflows that ran on the previous default-branch SHA or a configured list, and make the port change unconditional: either `runs` gains `headSha` or a `runsForSha` operation lists all runs for one SHA. Reuse `runWasNotAcquired` per run, which does apply.

### 3. The merge controller's host re-ask of checks has no verb — MEDIUM

Design §7 re-asks "the PR's state, head SHA and checks". Shell row 7 adds only `headRefOid` to `pr-state`, and `pr-state` returns no checks. No per-PR checks verb exists. The implementer must guess between a full `pr-list --rich --state open` (all open PRs, the 18 s rollup cost the plain-arm comment at `plot-host.sh:4167-4172` measures for all rows) and a new verb that the shell table does not declare.

Amendment: name the source. The smallest is "`pr-state` returns `headRefOid` and the rollup state for that head", one row in the shell table with its line removal, and on the Jenkins arm the workflow answers `checks-unbound` unless a build names the SHA.

### 4. The banner and feed have no stated data path to the page — MEDIUM

Slice 5's `defaultBranchBanner(reading)` needs `DefaultBranchReading` in the page payload, and `channelFeed(findings)` needs the channel's findings in the page. The plan says the board server subscribes (slice 4) and the page refetches `/api/board`, but not which payload field carries the reading or the findings, nor whether the board reads `.plot/state/default-branch.json` or the `default branch red` finding. The "every rendered state is a domain property" rule needs that field to exist before the function can be unit-tested.

Amendment: name the payload fields (for example `defaultBranch: DefaultBranchReading | null` on `/api/board`, and `channel: Finding[]` held by the board server from its subscription), and which slice adds each.

### 5. Most slices do not name the test that proves them done — MEDIUM

Only slice 5 states its tests (one unit test per function, one browser test per site). The Slices section gives one sentence per branch with no done condition. An implementer can derive tests, but the plan's own risks are specific enough to name. Suggested done-whens, one per slice:

- Slice 1: a v4 fold test where a rollup row has `checksSha = headSha`, a Jenkins row with no build SHA has no `checksSha`, and a v3 store reads as "ask the host"; a re-ask test where a PR pending past 5 tries is re-asked at 5-minute spacing until `Checks wait` and not after. Define "younger than `Checks wait`" as the age of the current `headSha`, not of the PR, or a PR older than an hour gets no re-ask after a new push.
- Slice 2: a `defaultBranchChecks` unit test where one of three workflows is red and the newest run is green, answering `red`; a queue test where `default-branch-red` holds while `red` and `unknown` holds nothing.
- Slice 3: a test that starts the channel and IndexMonitor over a fixture store after a v3 to v4 change and asserts the `welcome` holds one finding per open slice PR plus the default branch, not one per stored row; and that `admit` no longer refuses `ci is green`. State whether `ci is green` becomes an accepted alias of `checks green` or an unknown name; "maps to" reads as an alias.
- Slice 4: a board-server test that a published finding triggers at most one refetch per 2 s, and that with no socket the board serves as today.
- Slice 7: one workflow test per refusal (`head-moved`, `checks-unbound`, `checks-not-green`, `draft`, `default-branch-red`, `unaskable` on Bitbucket) and one shell contract test that `pr-merge --match-head <sha>` passes `--match-head-commit`.

### 6. Citation errors — LOW

- Design §1 lists `:4105` under "No CI arm". It is the Jenkins arm's `gh pr list` (`plot-host.sh:4096-4105`); the no-CI arm is `:4182` alone.
- Design §5 says the badge comes "from `rules/pr-row.ts`". It comes from `checksVerdict` in `rules/checks-verdict.ts` (`PlanCard.tsx:6`, `:265`).
- Cost row 1 says "11 requests per open, ready PR per CI run". The re-ask is one shared `pr-list --rich --state open` call per delta (`pr-refresh.ts:1478-1480`), so the cost is per refresh, not per PR. The figure overstates the cost; the slice-1 brief should measure the shared call.

### 7. Smaller gaps an implementer would guess — LOW

- The socket path is "under `.plot/`" but not named. Fleetd, the board, the mod and `act.ts` must agree on it; name it once (for example `.plot/state/channel.sock`) or the config key that holds it.
- `FindingSchema.worktree` is required. State what IndexMonitor writes for a PR branch with no desk (`''` is the obvious answer; say so, since the schema comment on `author` treats `''` as "the host omitted it").
- `MonitorNameSchema` carries a `plot-state: classification` declaration that says "three subjects"; adding `IndexMonitor` changes that comment and the `check-state-declarations.sh` gate reads it.
- Slice 2's trigger "HEAD SHA moves (a local ref read, free)" is only as fresh as the last fetch of the default branch. Name the ref and what fetches it.
- Slice 6 still has two open questions, and one of them (ship in the Plot plugin with a `PLOT_UNATTENDED=1` no-op, or as a separate plugin) is a design choice, not a fact to verify. Answer it before approval so the slice has one done condition.

## Layering, manifesto and merge order

I found no break of the layering rule: every new decision is a domain rule or workflow, and shell changes carry data. Slices merge in order and each leaves main working: slice 1 changes a store version that every reader already treats as "ask the host"; slice 2's hold is reversible; slices 3 and 4 add a socket the board treats as optional. The defect is in what slice 3 carries, not in the order.

## Single most important change

Decide how desk-monitor findings reach the channel (a fleetd bridge in slice 3, or an explicit index-only channel with `owes an answer` and Open Question 3 removed). Without that, slices 5 and 6 cannot reach their stated done condition.
