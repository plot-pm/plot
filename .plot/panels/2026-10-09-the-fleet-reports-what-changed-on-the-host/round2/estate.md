# Estate juror, round 2

Position: amend

Lens: estate. I read the revised plan at `4330647f1`, the round-1 panel, CLAUDE.md and every cited file in the worktree. I ran grep, sed and git only. I ran no test.

## 1. Round-1 amendments

| # | Amendment | Holds? |
|---|---|---|
| 1 | Merge pinned to the SHA, `sha` on `PrMergeWrite`, host re-ask, `approve.ts:554`, second shell change | Partly. The pin, the field and the citation hold. The re-ask of the checks has no verb: see finding E4. |
| 2 | Per-arm meaning of `headSha`/`checksSha`, `checks-unbound` | Partly. The Jenkins arm is described as "the commit of the build the job reports, or absent" but the Jenkins join never carries a commit: see E5. |
| 3 | Default-branch reading out of the PR store, combined state, cadence, slot, reversible hold | Partly. The store split, cadence, slot and hold argument hold. The "combined state" rests on a function that does not combine runs and on a port operation that does not exist: see E2. |
| 4 | Build on the channel, baseline rule, re-ask bound, `process-log.ts` | Partly. The baseline rule, the bound and the log reuse hold. The channel premise is incomplete: see E1 and E6. |
| 5 | Close reconnect, define a render site, reuse the badge | Partly. Reconnect is closed by `welcome`. The badge citation is wrong and the render-site shape duplicates an existing one: see E3. |
| 6 | Drop `PLOT-BLOCKED` or add it as a kind; bound turns | No. The revision swaps `PLOT-BLOCKED` for `owes an answer`, which is also not on the channel: see E1. The turn bound holds. |
| 7 | `waits:` annotation or move last | Yes. Slice is last, `<!-- waits: feature/the-controllers-are-commands -->` matches the parser format (`plot-plan-meta.sh:133-136`), and the branch exists in `2026-10-09-the-fleet-runs-without-the-board.md:127` (State: Approved). |

## 2. Citations checked

Correct: `startChannel` has no production caller (only tests in `packages/domain/test/channel-*.test.ts` and `packages/board/test/unit/the-master-agent-subscribes.test.ts`); `REFUSED_BY_DESIGN` at `rules/channel.ts:36-41`; `findingKey` = `monitor + branch` at `entities/finding.ts:112-113`; `act.ts` subscribes through `subscribe`; `QUEUE_HOLDS` at `queue.ts:333`; `PR_PENDING_REASK_LIMIT = 5` at `pr-refresh.ts:233`; row mapping around `pr-refresh.ts:1066`/`:1094`; `writePrStore` at `:1238`; `refreshRuns` at `board/src/server/fleet.ts:1385` with the `github-actions`-only slot rule at `:1419-1426`; `PrMergeWrite` at `decision.ts:153-159`; `pr-merge` call at `entry/approve.ts:554`; `runForSha` at `worker-loop.ts:874`; `plot-host.sh` `:4096`, `:4105`, `:4136`, `:4182`; `App.tsx:30-31`; `PR_INDEX_VERSION = 3` and `PrIndexRowSchema` at `entities/pr-index.ts:12`/`:30`; `LOG_MAX_BYTES` in `process-log.ts:38`; `withHostSlot` exists in `fleet/src/shared/pr-refresh.ts`.

Wrong or incomplete: E1, E2, E3, E4, E5 below.

## 3. Findings

**E1 — HIGH. No monitor publishes on the channel, so starting it carries only the new IndexMonitor.** The plan says "the transport exists and nothing starts it" (line 37), and that a new subscriber gets "every current finding". The WorkerMonitor, AgentMonitor and BuildMonitor write per-desk JSONL files, not the socket: `plot-agent-monitor.sh:144` (`.plot-worker.monitor.agent.jsonl`), `ports/desk.ts:215-235` (`publishFinding`, `publishBuildFinding` append to files), and the only code that parses a `{"type":"publish"}` line is `channel-socket.ts` itself. The board reads those files on purpose: `packages/board/src/server/findings.ts:9-15` argues for "a file read rather than a socket subscription". Three consequences:
- Slice 6 toasts on `owes an answer` (plan line 79). That is an AgentMonitor finding, and it never reaches the channel. This is round-1 finding 4 in a new form.
- The master agent's subscriber waits `until owes a review` (`act.ts:53`), also an AgentMonitor finding. Starting the channel does not serve it; open question 3 cannot be answered "yes" without a relay.
- Line 69 says "neither publishes the other's names" about BuildMonitor and IndexMonitor, as if BuildMonitor published on the channel. It does not.
Amendment: state that the channel will carry only IndexMonitor findings, drop `owes an answer` from slice 6 and resolve open question 3 as "stays test-only"; or add a slice in which fleetd relays the desk JSONL findings onto the channel, with its cost.

**E2 — MEDIUM. Slice 2's "combined state" has no function and no port operation.** `checksFromRuns` (`checks-verdict.ts:209`) takes ONE run (`readings.run`), the pushed SHA, the tip and the wait bound, and returns the loop's wait verdict `none | wait | settled | no-answer | tip-moved`. It does not fold several runs. `BuildPort` (`ports/build.ts:47-124`) offers `runs(branch)`, whose `BuildRun` carries no SHA (`entities/build.ts:109-124`), and `runForSha`, which returns one run. No operation lists every workflow's run for one SHA, so the shell change the table marks "if the brief finds" (line 90) is certain, and the port, the github, jenkins, none and fixture adapters all widen. Amendment: name a new fold (for example `defaultBranchChecks(runs)`), name the new `BuildPort` operation and its adapters, and make the slice-2 shell row unconditional.

**E3 — MEDIUM. Slice 5 builds two things the board already has.**
- The badge at `PlanCard.tsx:265` reads `checksVerdict` from `rules/checks-reading.ts:130`, not `rules/pr-row.ts` (which exports `prRowPlacement`, used by `server/fleet.ts`). That function already returns the render-site value the plan invents: `{state, prominence, shown, label, detail}` (`checks-reading.ts:63-74`). The plan's `{show, tone, text}` is a second vocabulary for the same contract. Amendment: cite `checks-reading.ts`, extend `ChecksVerdict` with the commit, and use its shape for the new sites.
- A default-branch "banner" contradicts `StatusPanel.tsx:3-12`: the operator corrected one-banner-per-condition into "one box at the top that carries every status". Amendment: make `default branch red` an entry in `StatusPanel`, not a new banner.

**E4 — MEDIUM. The merge controller re-asks checks with no verb.** `pr-state` asks `gh pr view --json number,state,isDraft,url,mergeCommit` (`plot-host.sh:3496`). The slice-7 shell row adds only `headRefOid`. The workflow must also re-ask the checks for the SHA, and on a Jenkins repository the checks come from Jenkins, not from `gh`. The cost row "two per merge" (line 106) therefore under-counts. Amendment: name the checks re-ask (a `statusCheckRollup` field on `pr-state`, or `runForSha` through the build connector) in the shell table and the cost table.

**E5 — LOW. On Jenkins `checksSha` is always absent.** The Jenkins arm joins `jen_map` on branch name (`plot-host.sh:4108-4131`), and `jenkins_build_map` (`:1450`) builds the map from `jen`, which per `build-jenkins.ts:29-34` "answers build history and never a commit". So every Jenkins PR reads `checks-unbound`, and the merge controller refuses every Jenkins merge. Amendment: state this as the outcome, so a brief does not add a per-branch REST call to fill it.

**E6 — MEDIUM. The IndexMonitor's publish rule is unstated, and the channel routes every publish.** `channel-socket.ts:149-171` sends each published finding to every matching subscriber, even when it repeats the held one. The existing monitors publish only on change (`findings.ts:17-20`; the 2026-08-30 plan, line 1049, warns of "an action that fires per message"). The plan says the IndexMonitor publishes "after each fold". Republishing each fold sends a toast for each `checks failing` every minute and a board refetch each fold. Amendment: publish only when a slot's finding differs from `channel.findings()`. Also state: the value of the required `worktree` field (`finding.ts:87`) for a default branch and for an ended desk; the new member of the closed `MonitorNameSchema` (`finding.ts:12`, which carries a `plot-state: classification` declaration); and how fleetd publishes in-process, because `RunningChannel` (`channel-socket.ts:51-56`) exposes no `publish`.

**E7 — LOW.**
- `pr merged` slots are never retracted, so `held` grows with every merge for fleetd's lifetime and every `welcome` carries them. State a `clear` rule.
- The 2026-08-30 plan (`2026-08-30-two-monitors-watch-the-agent.md:233-235`) placed the lift of `ci is green` on the BuildMonitor. The revision moves it to the IndexMonitor; name that move.
- The Notes cite `.plot/panels/…/panel.md`; since `3e60e1b33` it is `round1/panel.md`.

## 4. Buildability and cost

Slices 1, 4 and 7 are buildable from the plan once E4 and E5 are stated. Slice 2 is not briefable until E2 names the port operation. Slice 3 needs the E6 publish rule. Slice 5 needs E3. Slice 6 promises a toast that cannot fire (E1). The cost table is plausible for slices 1-3; slice 7 under-counts (E4). Each slice can merge alone and leave main working: the board keeps its 30 s poll and its file reads when no channel runs.

## 5. Most important change

Resolve E1: say what the channel carries once fleetd starts it. Either it carries IndexMonitor findings only, and slice 6 and open question 3 drop the AgentMonitor findings, or a slice relays the desk JSONL findings onto the channel.
