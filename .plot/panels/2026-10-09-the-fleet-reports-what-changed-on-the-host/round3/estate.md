# Estate juror: the-fleet-reports-what-changed-on-the-host, round 3

Position: amend

Lens: estate. The question is what the repository already holds, what the plan cites wrongly, and what the plan would build twice. All evidence below was read in the worktree at `5788128ea` with grep, sed and git. No test was run.

## 1. Round-2 amendments in the revision

| # | Amendment | Holds? | Evidence |
|---|---|---|---|
| 1 | Decide the channel's scope | Yes, option (a): slice 4 relays the desk findings | plan:75, :139-141 |
| 2 | Fold every run, port op, unconditional shell change, re-ask red, fetch path | Mostly. `foldRuns`, `runsForSha`, the `runs-for-sha` verb, re-ask of `red` and `git ls-remote` are in. The conclusion table covers GitHub's words only (finding M4) | plan:61-63, :98 |
| 3 | Name the merge's checks source | Yes: `pr-state` returns `headRefOid` and the rollup; two requests per merge; Jenkins refuses `checks-unbound` | plan:88-89, :99, :116 |
| 4 | Publish on change, worktree, enum, heartbeat, retract `pr merged`, keep it in cold-store state | In text, yes. The 24 h retention has no data source (finding H1), and the heartbeat has no API (finding L2) | plan:68-71 |
| 5 | Restore a page push | Yes: `/api/events` as server-sent events, 30 s poll kept | plan:77, :143-145 |
| 6 | Reuse `checksVerdict`'s shape; use `StatusPanel.tsx` | Half. The PR badge reuse is right. The status panel has its own shape, `BoardStatus`, and the plan gives it the wrong one (finding M3) | plan:79-82 |
| 7 | Done-when on every slice; fix citations | Done-when: yes, all eight. Citations: `:4105` is now correctly Jenkins, but `:4182` is still mislabelled (finding M5) | plan:129-157, :50-52 |

## 2. Citations checked

Correct as cited: `CLAUDE.md:478` (*Only a terminal answer is read from the index*); `rules/checks-reading.ts:130` (`checksVerdict`, returns `{state, prominence, shown, label, detail}`); `PlanCard.tsx:265` (`ChecksNote` calls `checksVerdict`); `App.tsx:30-31` (`POLL_MS = 30_000`, `FLEET_POLL_MS = 4_000`); `queue.ts:333` (`QUEUE_HOLDS`); `rules/checks-verdict.ts:209` (`checksFromRuns`); `entities/pr-index.ts:30` (`PrIndexRowSchema`); `rules/channel.ts:36-41` (`REFUSED_BY_DESIGN`); `plot-agent-monitor.sh:144`; `board/src/server/findings.ts:3-15`; `pr-refresh.ts:233`, `:1238`, `:1478` (in `packages/fleet/src/shared/`); `plot-host.sh:3496` (`pr view --json number,state,isDraft,url,mergeCommit`), `:3812` (`pr-merge)`), `:4105`/`:4136` (Jenkins and rollup listings), `:4396` (`run-for-sha)`), `:4573` (`.[0]` of the matching runs); `build-jenkins.ts:29-59` (`runForSha` via Jenkins REST, `lastBuiltRevision.SHA1`); `entry/approve.ts:554`; `workflows/decision.ts:153-159` (`PrMergeWrite`); `refreshRuns` at `packages/board/src/server/fleet.ts:1385`; `process-log.ts:38` (`LOG_MAX_BYTES` 10 MiB).

Wrong or misleading: `ports/desk.ts:215-235` (finding M1), `plot-host.sh:4182` (finding M5), `StatusPanel.tsx` as the place that takes the reading (finding M3).

## 3. Findings

### H1. HIGH: the 24 h `pr merged` retention reads a merge time the PR index does not hold

The plan (plan:70) publishes, after a restart, "`pr merged` for each slice PR merged in the last 24 h (from the rows' merge time)", and clears the slot "24 h after the merge". `PrIndexRowSchema` (`entities/pr-index.ts:30-60`) holds `number, head, state, draft, checks, review, url, mergeable, failing_checks, author, updatedAt`, and no merge time. No `pr-list` listing requests `mergedAt`: the `--json` field lists at `plot-host.sh:4105`, `:4136` and `:4182` do not contain it, and `grep mergedAt` over `pr-index.ts` and `pr-refresh.ts` finds nothing. Slice 1 adds `headSha`, `headSince` and `checksSha` only.

So slice 3 cannot be built as written. An implementer either reads `updatedAt` as the merge time (wrong: any later comment or label moves it, and the slot then stays or returns), or uses the time the fold first saw `MERGED` (wrong after a cold store or the v3 to v4 change: every merged row in the store is "first seen" now, and the first fold publishes hundreds of `pr merged` findings, which plan:70 says it must not).

Amendment: slice 1 adds `mergedAt` to `PrIndexRowSchema`, requested in the `pr-list` field lists for terminal rows (a scalar column on the PR node, so no extra request), absent where the host does not answer it. Slice 3 reads that field for the 24 h window. State this in the slice-1 row of *Shell changes* and in slice 1's done-when.

### M1. MEDIUM: slice 4 cites a read that does not exist, and would build the board's reader twice

Plan:75 says fleetd "reads each desk's newest finding per monitor through the desk port (`ports/desk.ts:215-235`), the same read the board makes". `ports/desk.ts:215-245` holds `publishFinding` and `publishBuildFinding`: two writes. The `Desk` port has no read of findings (its methods, `desk.ts:65-245`, are all writes). The board does not read through any port: `packages/board/src/server/findings.ts:67` (`findingsInLog`, a tail read bounded by `MAX_LOG_BYTES`, then `currentFindings`) and `:119` (`findingsFor`, filtered by branch over `MONITOR_LOGS`) use `fs` directly. Fleetd is `packages/fleet`, whose `package.json` depends on `@plot-pm/domain` only, so it cannot import the board's reader.

Without a correction the slice writes a second reader of the same three files in `packages/fleet`, with its own byte bound and its own file list. That is undeclared duplication (*A Shell Script Asks The Domain*) and domain behaviour outside the domain (*The Layering Rule*).

Amendment: slice 4 adds one read operation to the `Desk` port (for example `findings(worktree, branch)`), implemented in `adapters/desk/desk-fs.ts` from the code that is in `board/src/server/findings.ts` today, and moves the board's `findingsFor` onto that port in the same slice. Cite `findings.ts:67` and `:119` as the read that moves.

### M2. MEDIUM: four new finding names change `rules/attention.ts`, and two of them name a fact `build passed`/`build failed` already names

`rules/attention.ts:81` defines `Errand = Exclude<FindingName, 'clear' | 'build passed'>`, and `:91` defines `READINGS: Record<Errand, FindingReading>`, an exhaustive record. `isErrand` (`:149`) and `monitorSubject` (`:161`, a switch over `MonitorName`) complete the set. Slice 3 adds `checks green`, `checks failing`, `pr merged`, `default branch red` and `IndexMonitor`. The domain package then does not compile until each new name has a verdict, an action and a list, or is excluded from `Errand`. The plan names none of these files and makes none of these decisions.

The decision is not mechanical. The BuildMonitor already publishes `build passed`, `build failed`, `build needs approval` and `head moved` per desk (`entities/finding.ts`, `fleet/src/server/entry/worker-loop.ts:1567-1576`), and `build failed` is a `needsHuman` errand. After slice 4 relays it, one failing PR reaches a subscriber as `build failed` (BuildMonitor, the desk's run) and as `checks failing` (IndexMonitor, the rollup), in two slots, because `findingKey` is `monitor + branch`. If both are errands the board lists one failure twice.

Amendment: slice 3 states, per new name, whether it is an errand and on which list, adds `IndexMonitor` to `monitorSubject`, and states how `checks failing` relates to `build failed` (for example: `checks failing` is not an errand, because `build failed` already carries the person's move). Its done-when adds a unit test of `findingReading` for each new name.

### M3. MEDIUM: the status panel has its own shape, and it is not `checksVerdict`'s

Plan:81 says `defaultBranchStatus(reading)` "returns the same shape" (`{state, prominence, shown, label, detail}`) and `StatusPanel.tsx` shows it. `StatusPanel.tsx:31-47` takes `BoardStatus {key, severity, text, tone: 'rose' | 'amber'}`, and the statuses are built in `AgentList.tsx:795-852` with severities 40, 30, 20, 15 and 10. With the plan's shape, an implementer maps `prominence` to `severity` and `state` to `tone` in a component, which is the decision-in-a-`.tsx` that *Every rendered state is a domain property* rules out.

Amendment: `defaultBranchStatus` returns a `BoardStatus` (or `null` when green or unknown) with a stated severity relative to the five that exist, and the slice cites `AgentList.tsx:795` as the place that appends it.

### M4. MEDIUM: `foldRuns` names GitHub's conclusions only, and the plan claims a Jenkins arm

Plan:62 lists `failure`, `timed_out`, `startup_failure`, `success`, `neutral`, `skipped`, `cancelled`, `action_required`, `queued`, `in progress`. Plan:65 says "GitHub Actions and Jenkins answer runs for a SHA". The Jenkins arm of `run-for-sha` passes Jenkins' own result through unchanged: `conclusion: (if .building then null else (.result // null) end)` (`plot-host.sh:4526`), so a Jenkins run concludes `SUCCESS`, `FAILURE`, `UNSTABLE`, `ABORTED` or `NOT_BUILT`. None is in the table, so every Jenkins reading folds to `unknown`, and the hold never fires on Jenkins. GitHub's `stale` conclusion and `waiting`/`requested` statuses are also absent.

Amendment: state where conclusions are normalised. Either `runs-for-sha` maps Jenkins results to the GitHub words (`UNSTABLE` and `FAILURE` to `failure`, `ABORTED` to `cancelled`, `NOT_BUILT` to `skipped`), or `foldRuns` takes a table per `BuildSystem`. Add a Jenkins fixture to slice 2's done-when, and place `stale`, `waiting` and `requested`.

### M5. MEDIUM: `plot-host.sh:4182` is the plain listing, not "no CI"

Plan:52 says "No CI (`:4182`): no checks, so no `checksSha`". The branch structure is `:4029 if rich`, `:4096 if jenkins` / `:4133 else` rollup, `:4167 else` plain. Line 4182 is in the plain (non-rich) arm, which also serves `--rich-open`'s terminal rows (comment at `:4175-4180`). A GitHub repository with no CI goes through the rollup arm (`:4136`) and gets `checks: "none"` from an empty rollup (`:4144`). The rollup belongs to the head commit there too, so `checksSha = headSha` holds for it. Round 2 named this label as wrong, and the revision moved it to another wrong line.

Amendment: rename the arm "plain listing (non-rich, and `--rich-open`'s terminal rows): no checks requested, so no `checksSha`", and make slice 1's done-when fixture a rollup row, an empty-rollup row, a Jenkins row and a plain row.

### M6. MEDIUM: the hold lifts whenever a newer commit on `main` is pending

`defaultBranchRed` reads the HEAD SHA's reading only, and `pending` and `unknown` hold nothing (plan:64). `build-bundles.yml:3-13` pushes a bundle commit to `main` after each push, as a GitHub App whose push starts workflows, and `ci.yml:5` runs on every push to `main`. So after a red merge the next HEAD is the bundle commit, its reading is `pending` for one CI run, and the hold is off for that time. The plan's own measure (plan:105) counts 65 bundle commits in 7 days. Auto-dispatch can hand a slice over onto a red `main` in that window, which is the event the plan's first motivation row describes.

Amendment: the reading keeps the last settled SHA's state beside HEAD's, and `defaultBranchRed` answers `red` while HEAD is `pending` and the last settled reading is `red`. Add that case to slice 2's queue test.

### M7. MEDIUM: the feed shows the desk findings a second time

Plan:82 adds `channelFeed(findings)` for "a pane under the status panel", with the `checksVerdict` shape per item. The board already shows every desk finding as an attention item: `board/src/server/attention.ts:351` (`findingItems`) reads `findingReading` (`rules/attention.ts:137`, `{verdict, action, list}`) and `monitorSubject`. After slice 4 the feed holds the same `owes an answer` and `build failed` findings the attention lists hold. The plan also does not say where the page gets the channel's findings (the `/api/board` payload, or the SSE stream).

Amendment: either limit the feed to IndexMonitor findings, or state that the feed replaces nothing and why a second list is worth it. Name the payload field the findings arrive in, and reuse `FindingReading` for desk findings.

### L1. LOW: `ladder.ts:159` is a third `pr-merge` caller

`packages/board/src/server/entry/ladder.ts:159` merges the micro-PR fallback with `pr-merge`. Slice 8 names the approve merge only. If `--match-head` stays optional the caller still works. State that.

### L2. LOW: the channel has no in-process publish or "seen" mark

`RunningChannel` (`adapters/channel/channel-socket.ts:51-56`) exposes `findings`, `subscriberCount` and `stop`. `lastSeen` is set only inside `publish` (`:151`). The IndexMonitor "marks itself seen after every fold, publish or not" (plan:71) needs a new method, and the relay's monitors (published only on change) will show a stale `lastSeen` in the heartbeat. Name the adapter change in slice 3.

### L3. LOW: `git ls-remote` for the HEAD SHA needs a new refs operation

`Refs.remoteTip` (`ports/refs.ts:538-560`) runs `ls-remote` but answers an equality, not the SHA, and it answers `unaskable` from the board's instance. Name a new operation in `refs-remote-git.ts` that returns the SHA.

## 4. Buildability and cost

Each slice has a done-when line, and each slice except 3 and 4 can be briefed from the plan as it stands. Slice 3 needs H1 and M2 resolved. Slice 4 needs M1 resolved. The cost table is plausible against what I read: the new PR-row fields ride the existing listings; `runs-for-sha` is one `gh run list` per call (`plot-host.sh:4569`); 106 moves of `main` per day with a few re-asks each fits "about 400 per day". The slice order is a chain (3 needs 1 and 2; 4, 5 and 7 need 3; 6 needs 1 to 3), and the sequential headings express that.

## 5. Most important change

H1: give slice 1 a `mergedAt` field on the PR row, so slice 3's 24 h `pr merged` window reads a merge time the index holds. M1 is the second: slice 4 must move the board's desk-finding reader into the `Desk` port rather than write a second one in `packages/fleet`.
