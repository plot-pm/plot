# The fleet reports what changed on the host

> A PR row names the commit its checks read, the default branch has its own CI reading, and the supervisor publishes these and the desk monitors' findings on the existing findings channel, so the board, the master agent and an optional mod follow changes instead of polling the host.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 3

## Changelog

- A PR's check state names the commit it was read for, and a PR whose checks the host cannot bind to a commit says so.
- The fleet reads the default branch's CI for its HEAD commit and hands no slice over while that reading is red.
- The supervisor starts the findings channel. It publishes `checks green`, `checks failing`, `pr merged` and `default branch red` from what it already read, and relays the desk monitors' findings, such as `owes an answer`, so a subscriber hears both without asking the host.
- The board page refreshes within seconds of a finding, not only every 30 seconds.
- The board shows the default branch's CI state in its status panel, and each slice row shows its PR's checks for a named commit.
- An optional Claude Code mod shows the channel's findings in the operator's session.
- A merge controller merges a PR only when the host confirms the head commit and its checks, and the host merges that commit and no other.

<!-- Board impact: the PR index schema moves from v3 to v4 and the board reads it through FleetState. The board server subscribes to the channel and serves `/api/events`; the status panel and the PR badge gain fields from domain properties. No change to the plan format, the plan template or docs/plans. -->

## Motivation

The fleet reads Git, PRs and CI, but no consumer can learn that a reading changed. Every consumer polls. Measured in the master session of 2026-10-09:

| Event | What happened | The missing part |
|---|---|---|
| `main` went red after #1432 (a missing README row), and #1435 stayed red | the master agent found it by reading #1435's failed check | nothing reads the default branch's CI |
| the #1444 merge watcher aborted twice when the head moved | a temp script compared the head SHA by hand | `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30`) holds `head` as the branch name and no SHA, so `checks: green` does not say which commit was green |
| a waiter failed after its PR merged and the branch was deleted | the master agent read the output and judged it harmless | no subscriber hears "merged" |
| the PR watch kept stale exclusions and was restarted | `until gh pr list …; sleep 90` | CLAUDE.md, *A Decision Reads The Index*, part 3: "Not built" |
| six merges went through `merge-on-green.sh` in the job's temp directory | the merge rule lived in a script that no reviewer saw | no merge controller (*The Master Agent Uses The Controllers*) |

**The transport exists, nothing starts it, and nothing publishes to it.** `The channel carries the findings` (#584, 2026-09-01) built a unix-socket NDJSON channel: `ports/channel.ts`, `adapters/channel/channel-socket.ts` (`startChannel`), `channel-client.ts` (`subscribe`) and `rules/channel.ts` (`admit`). It holds current state, not history: a finding's slot is `monitor + branch` (`entities/finding.ts`, `findingKey`), and a new subscriber gets a `welcome` with every current finding. The master agent's subscriber exists (`packages/board/src/server/entry/act.ts`, `until owes a review`). But **`startChannel` has no production caller**, and **the three monitors publish only to files**: each appends to `.plot-worker.monitor.<subject>.jsonl` in its desk (`plot-agent-monitor.sh:144`, `ports/desk.ts:215-235`), and the board reads those files on purpose so that a finding shows with no channel running (`board/src/server/findings.ts:3-15`). `rules/channel.ts:36-41` also refuses `ci is green` and `ci is red`, with the reason *"no monitor asks the host about a check run; adding one to serve this would put a host question on a fast loop"*.

This plan starts the channel, relays the desk findings onto it, and adds a publisher that answers `ci is green` **without** a host question: it reads what the supervisor already bought. That removes the reason for the refusal, so the refusal changes in the same slice.

**Claude Code mods** (2.1.287) are in-process JS handlers that can draw panes, show toasts and start a turn. They have no git, PR or CI events. A mod that polls `gh` would be a second reader of the host outside the connector's budget, so a mod is at most one more subscriber to the channel.

## Design

### Approach

**One reader, one writer, many subscribers.** `plot-fleetd` folds the PR index and is its only writer (#1444; `pr-refresh.ts:1238`, asserted by `one-pr-index-writer.test.ts`). This plan keeps that, adds the two readings the fleet lacks, and publishes them with the desk findings on the channel. A subscriber reads the channel and never the host. The board's file read of the desk findings stays: the channel adds timing, not a second source.

1. **Rows name their commit.** `PrIndexRowSchema` gains `headSha`, `headSince` and `checksSha`. `headSha` is the PR's head commit as the host gave it; `headSince` is when the fold first saw that SHA; `checksSha` is the commit the check state was read for. The meaning differs by arm, and the slice states each:
   - **GitHub rollup** (`plot-host.sh:4136`): `statusCheckRollup` belongs to the head commit, so `checksSha = headSha`.
   - **Jenkins** (`plot-host.sh:4096-4131`, including `:4105`): checks are the job colours per branch and carry no commit, so `checksSha` is absent. Binding a Jenkins build to a commit costs one Jenkins request per branch per refresh and is out of scope.
   - **No CI** (`:4182`): no checks, so no `checksSha`.
   - **Bitbucket**: the slice records what the Bitbucket path answers, absent where it answers nothing.

   An absent SHA is absent, never `''`, by the rule the schema states for `author`. `PR_INDEX_VERSION` moves to 4; a v3 store reads as "ask the host", as every mismatch does today. The row mapping in `pr-refresh.ts:1066` and `:1094` carries the fields.

   **The re-ask is bounded by time, and covers red too.** Today a delta read misses a completed check, and the re-ask stops after `PR_PENDING_REASK_LIMIT = 5` (`pr-refresh.ts:233`), about 5 minutes; CI here runs longer, so a result can wait up to 24 h for the next full read. The re-ask is one rich listing per refresh for all pending PRs (`pr-refresh.ts:1478`). The slice keeps the five re-asks on each refresh, then re-asks every 5 minutes while any open, non-draft PR is `pending` or `failing` and its `headSince` is younger than `Checks wait` (3600 s). `failing` is re-asked because a re-run can turn it green.

2. **The default branch has its own reading.** A new entity `DefaultBranchReading` in its own file, `.plot/state/default-branch.json`, with its own schema and version: branch, HEAD SHA, combined state, failing runs, `at`. It stays out of the PR store, which holds the git host's answers; this reading is the build connector's (`BuildPort`, `ports/build.ts`), a separate connector. Fleetd is its only writer.
   - **The HEAD SHA** comes from `git ls-remote` on the default branch through the refs adapter, once per refresh. That is a git-protocol call and spends no API budget.
   - **Every run for the SHA.** `run-for-sha` takes the first matching run (`plot-host.sh:4573`), and `main` runs three workflows (`ci.yml`, `build-bundles.yml`, `release.yml`). A new port operation `BuildPort.runsForSha(branch, sha)` lists them all; `plot-host.sh` gains it (see *Shell changes*).
   - **A new fold rule.** `checksFromRuns` (`rules/checks-verdict.ts:209`) reads one run and returns a wait verdict, so it is not reused. A new rule `foldRuns(runs)` answers `red | green | pending | unknown`: `red` when any run concluded `failure`, `timed_out` or `startup_failure`; `pending` when none failed and any is queued, in progress or `action_required`; `green` when at least one run exists and every run concluded `success`, `neutral` or `skipped`; `unknown` for no runs, a `cancelled` run with nothing failed, or an unreadable answer.
   - **Cadence.** Fleetd reads the runs when the HEAD SHA changes, and re-asks while the reading is `pending` or `red` on the schedule of step 1, measured from when the SHA first appeared. Each read takes a host slot by the rule `refreshRuns` uses (`packages/board/src/server/fleet.ts:1385`).
   - **The hold.** A domain rule `defaultBranchRed` answers from the reading. Auto-dispatch adds a `default-branch-red` hold to `QUEUE_HOLDS` (`queue.ts:333`) while it is `red`; `unknown` holds nothing. **This reads a non-terminal answer**, which the rule *"Only a terminal answer is read from the index"* (`CLAUDE.md:478`) does not cover: that rule is about the PR index and decisions that cannot be undone. The hold is reversible, and the next reading lifts it. The slice adds one sentence there to say so.
   - **Arms.** GitHub Actions and Jenkins answer runs for a SHA (`build-jenkins.ts:29-59`). Bitbucket Pipelines has no arm and answers `unknown`.

3. **The supervisor starts the channel and publishes what it read.** Fleetd becomes the first production caller of `startChannel`, on `.plot/fleet.sock`, and runs an `IndexMonitor` in the same process.
   - **Vocabulary.** `MonitorNameSchema` gains `IndexMonitor`. `FindingNameSchema` gains `checks green`, `checks failing`, `pr merged` (per slice-PR branch) and `default branch red` (on the default branch's name). `MEASURED_BY` maps each to `IndexMonitor`. `worktree` is `''`, because these findings describe a PR or a branch, not a desk.
   - **Publish on change.** After each fold the monitor computes the finding for each slot and publishes only when it differs from the slot's current finding. `clear` retracts a slot whose finding stopped holding.
   - **State after a restart.** The first fold after a start, a cold store or a version mismatch publishes the current state: one finding for each open slice PR, `pr merged` for each slice PR merged in the last 24 h (from the rows' merge time), and the default branch. No row becomes a transition without a readable previous state, so the first fold after v3 → v4 publishes tens of findings, not one per stored row. A `pr merged` slot is cleared 24 h after the merge.
   - **Liveness.** The channel's heartbeat lists each monitor's `lastSeen`. The IndexMonitor runs in the channel's process, so it marks itself seen after every fold, publish or not.
   - **The refusal changes.** `ci is green` maps to `checks green` and `ci is red` to `checks failing`. Their `REFUSED_BY_DESIGN` entries go, and the rule's comment states why.
   - **Audit.** Each publish writes one line to `fleetd.log` through `process-log.ts`, which has a size ceiling. There is no separate event file.

4. **The supervisor relays the desk findings.** On each tick fleetd reads each desk's newest finding per monitor through the desk port (`ports/desk.ts:215-235`), the same read the board makes, and publishes it on the channel when it differs from that slot's current finding. The WorkerMonitor, AgentMonitor and BuildMonitor keep writing their files and do not change. After this slice `owes an answer` (a `PLOT-BLOCKED` marker), `owes a review` and `build failed` reach every subscriber, and `entry/act.ts`'s `until owes a review` is servable. Cost: one small file read per desk per tick, which is the read the board already makes, and no host call.

5. **The board page hears the channel.** The board polls `/api/board` every 30 s and the fleet every 4 s (`packages/board/src/app/App.tsx:30-31`), and has no push route. The board server subscribes to the channel with the purpose "everything" and forwards each finding to the page on a new route, `/api/events`, as server-sent events. The page fetches `/api/board` when an event arrives, at most once per 2 s. On reconnect the channel's `welcome` carries the current state, and the page fetches once. The 30 s poll stays as the fallback, so with no channel running the board behaves as today. One `/api/board` build costs what a poll costs today; the slice measures it and states the figure.

6. **The board shows the new readings in places it has.** The render-site shape exists: `checksVerdict` (`rules/checks-reading.ts:130`) returns `{state, prominence, shown, label, detail}`, and the PR badge in `PlanCard.tsx:265` renders it. This slice reuses that shape and adds no second one.
   - **PR badge:** `checksVerdict` gains the commit: `checks green @a048b6f`, or `checks not bound to a commit` where `checksSha` is absent.
   - **Default branch:** a new domain function `defaultBranchStatus(reading)` returns the same shape, and `StatusPanel.tsx` shows it as one line in its existing box. There is no new banner.
   - **Feed:** a domain function `channelFeed(findings)` returns the current findings, newest first, with their age, in the same shape per item, for a pane under the status panel.

   Each function has a unit test; each place has one browser test that proves it shows.

7. **An optional mod subscribes.** A Claude Code mod subscribes to the channel through `channel-client`'s `subscribe` and makes no host call. It draws a pane from the current findings and shows a toast on `checks failing`, `pr merged` and `owes an answer`. It starts a turn only on the finding names the operator lists, at most once per 5 minutes; findings that arrive in that window join the next turn. It never loads in a fleet agent's session. The fleet does not depend on it.

8. **A merge is a controller, and the host decides it.** `plot-ask.mjs merge <pr> <sha>` asks a domain workflow. The index decides only whether to try. The merge cannot be undone, so the workflow re-asks the host through `pr-state`, which gains the head commit and the check rollup (see *Shell changes*), and refuses unless all hold: the head equals `<sha>`; the rollup is green for that head; the PR is not a draft; `defaultBranchRed` is not `red`. Each refusal names its reason and the reading. On a pass it merges through the path `entry/approve.ts:554` uses (`ctx.scripts.host(['pr-merge', …])`); `PrMergeWrite` (`workflows/decision.ts:153-159`) gains `sha`, and the plan-approval merge passes its head too. `pr-merge` passes `--match-head-commit <sha>` to `gh`, so a push between the check and the merge fails at the host.
   - **Other hosts and CI.** Bitbucket has no such flag, so the workflow answers `unaskable` and merges nothing. A Jenkins repository's checks carry no commit, so the workflow refuses `checks-unbound`. In this plan the controller merges on GitHub with GitHub Actions or another check source that reports through the rollup.

### Shell changes

All host access goes through `plot-host.sh` (`check-host-cli-callers.sh`). The plan changes it in three places, each carrying data and deciding nothing. `check-shell-lines.sh` requires each slice to remove as many shell lines as it adds, in the same change.

| Slice | Change |
|---|---|
| 1 | `pr-list` requests `headRefOid` in its GitHub calls (`:4105`, `:4136`, `:4182`), and the Bitbucket path returns its head commit |
| 2 | a new `runs-for-sha` verb lists every run for one SHA, beside `run-for-sha` (`:4396`), which returns the first |
| 8 | `pr-state` returns `headRefOid` and the check rollup (`:3496`), and `pr-merge` takes `--match-head <sha>` and passes `--match-head-commit` (`:3812`) |

Every decision is a domain rule or workflow: the row fields and the fold, `foldRuns` and `defaultBranchRed`, the IndexMonitor's findings and the relay's change test, one function per place on the page, the turn bound and the merge workflow. Moving the host verbs into a TypeScript connector would remove these shell changes, but that belongs to `the-shell-holds-no-behavior`.

### Cost

Measured 2026-10-09: `main` moved 525 times in 7 days (106 in the last day), 65 of them bundle commits.

| Slice | Host requests | Other cost |
|---|---|---|
| 1 | none for the new fields (they ride the existing `pr-list` calls); the time-bounded re-ask adds at most 12 GraphQL listings per hour while any PR is pending or failing, against 60 per hour for the refresh today | none |
| 2 | one `runs-for-sha` per SHA change plus re-asks while pending or red: up to about 400 REST requests per day (about 17 per hour against 5000); one `git ls-remote` per refresh, no API budget | one small JSON file |
| 3 | none | one socket; one log line per publish under the existing ceiling |
| 4 | none | one file read per desk per tick, the read the board makes today |
| 5 | none | page refetches, at most one per 2 s while findings arrive |
| 6 | none | none |
| 7 | none | agent turns, at most one per 5 minutes and only on the listed names |
| 8 | two per merge: one `pr-state`, one `pr-merge` | none |

**A slice is refused at review if it exceeds its row.** Slices 1 and 2 measure requests per hour over one working day from the budget log, against the day before, and state both figures in the PR.

### Open Questions

- [ ] Slice 7: the mod API facts in this plan come from one research pass. The brief verifies them against the mods reference before any code: the `register(on)` signature, timers, starting a turn, the render sites, and whether a mod can open a unix socket.
- [ ] Slice 7: the Plot plugin is also loaded by fleet agents for its gates. Does the mod ship in the Plot plugin and do nothing under `PLOT_UNATTENDED=1`, or ship as a separate plugin that only the operator installs?

## Slices

### PR rows name their commit

- `feature/a-pr-row-names-its-commit` — `PrIndexRowSchema` gains `headSha`, `headSince` and `checksSha` with a stated meaning per arm, `PR_INDEX_VERSION` moves to 4, `pr-list` adds `headRefOid` with an equal shell-line removal, and the re-ask covers pending and failing PRs for `Checks wait` after the head moved. Done when a fold over a fixture with a rollup row, a Jenkins row and a no-CI row stores the three meanings, and a re-ask test fails with the count bound restored <!-- builds: headSha, headSince and checksSha on PrIndexRowSchema, PR index v4 -->

### The default branch has its own reading

- `feature/the-default-branch-has-its-own-reading` — fleetd writes `DefaultBranchReading` from every run for the HEAD SHA through `BuildPort.runsForSha` and `foldRuns`; `defaultBranchRed` adds a `default-branch-red` hold to `QUEUE_HOLDS`. Done when `foldRuns` has a test per conclusion and a three-workflow fixture with one failure reads `red`, and a queue test holds a slice while the reading is red and releases it when green <!-- builds: DefaultBranchReading, foldRuns and defaultBranchRed in packages/domain, and the runs-for-sha verb -->

### The supervisor publishes on the channel

- `feature/the-supervisor-publishes-on-the-channel` — fleetd starts the channel on `.plot/fleet.sock` and an `IndexMonitor` that publishes `checks green`, `checks failing`, `pr merged` and `default branch red` on change; `ci is green` and `ci is red` stop being refused. Done when a subscriber test receives one finding per change and none for an unchanged fold, and a cold-store test publishes current state only <!-- builds: IndexMonitor, a publisher of index findings, and the first production caller of startChannel -->

### The channel carries the desk findings

- `feature/the-channel-carries-the-desk-findings` — fleetd relays each desk's newest WorkerMonitor, AgentMonitor and BuildMonitor finding onto the channel when it changes; the monitors and their files do not change. Done when a subscriber waiting `until owes a review` receives it after a fixture desk's AgentMonitor file gains that line <!-- builds: a relay of desk monitor findings onto the findings channel -->

### The board page hears the channel

- `feature/the-board-page-hears-the-channel` — the board server subscribes to the channel and serves `/api/events` as server-sent events; the page refetches `/api/board` on an event, at most once per 2 s, and keeps the 30 s poll. Done when a server test sees one event per published finding, and the page test refetches once for a burst of findings and polls as before with no channel <!-- builds: /api/events, a server-sent event route, and the board's channel subscription -->

### The board shows the new readings

- `feature/the-board-shows-the-new-readings` — `checksVerdict` names the commit, `defaultBranchStatus` adds one line to `StatusPanel.tsx`, and `channelFeed` fills a pane, all in the existing `{state, prominence, shown, label, detail}` shape. Done when each function has a unit test and each place one browser test <!-- builds: defaultBranchStatus and channelFeed, domain functions -->

### A mod follows the channel

- `feature/a-mod-follows-the-channel` — a Claude Code mod subscribes to the channel, draws a pane, shows toasts and starts at most one turn per 5 minutes on the finding names the operator lists; it makes no host call and does not load in a fleet agent's session. Done when `claude plugin test` passes for the mod against a fixture channel, and a test shows no turn start for a second finding inside 5 minutes <!-- builds: a Claude Code mod that subscribes to the findings channel -->

### A merge is a controller

- `feature/a-merge-is-a-controller` — `plot-ask.mjs merge <pr> <sha>` re-asks the host through `pr-state` and merges only when the head, the rollup for that head, the draft state and the default branch agree; `pr-merge` pins the merge with `--match-head-commit`. Done when the workflow has one test per refusal, including `checks-unbound` and `unaskable`, and a host fixture proves `--match-head-commit` is passed <!-- builds: a merge workflow in packages/domain and its plot-ask.mjs verb --> <!-- waits: feature/the-controllers-are-commands -->

## Notes

- The merge slice is last and carries a `waits:` annotation on `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`), so the wait holds up no other slice and auto-dispatch cannot hand it over early.
- The supervisor is `plot-fleetd` since #1428. CLAUDE.md still says `plot-registryd` in places; that is CLAUDE.md's drift, not this plan's.
- Round 1 (panel, 2026-10-09): unanimous amend; `.plot/panels/2026-10-09-the-fleet-reports-what-changed-on-the-host/round1/panel.md`. The revision moved the transport from a new event file to the existing channel.
- Round 2 (panel, 2026-10-09): unanimous amend; `round2/panel.md`. The owner chose to relay the desk findings onto the channel (slice 4) and to restore a page push (`/api/events`, slice 5). This revision adds `foldRuns` and `runsForSha`, names `pr-state` as the merge's checks source, publishes on change, reuses `checksVerdict`'s shape and `StatusPanel.tsx`, and gives each slice a done-when line.
