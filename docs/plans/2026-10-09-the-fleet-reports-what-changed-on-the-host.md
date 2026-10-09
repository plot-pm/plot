# The fleet reports what changed on the host

> A PR row names the commit its checks read, the default branch has its own CI reading, and the supervisor publishes both on the existing findings channel, so the board, the master agent and an optional mod follow changes instead of polling the host.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A PR's check state names the commit it was read for, and a PR whose checks the host cannot bind to a commit says so.
- The fleet reads the default branch's CI for its HEAD commit across all workflows, and hands no slice over while that reading is red.
- The supervisor starts the findings channel and publishes what the PR index and the default-branch reading learned, so a subscriber hears `checks green`, `checks failing`, `pr merged` and `default branch red` without asking the host.
- The board subscribes to the channel and refreshes when a finding arrives, not only every 30 seconds.
- The board shows the default branch's CI state in a banner, and each slice row shows its PR's checks for a named commit.
- An optional Claude Code mod shows the channel's findings in the operator's session.
- A merge controller merges a PR only when the host confirms the head commit and its checks, and the host merges that commit and no other.

<!-- Board impact: the PR index schema moves from v3 to v4 and the board reads it through FleetState. The board becomes a channel subscriber and gains named render sites; every site shows a domain property. No change to the plan format, the plan template or docs/plans. -->

## Motivation

The fleet reads Git, PRs and CI, but no consumer can learn that a reading changed. Every consumer polls. Measured in the master session of 2026-10-09:

| Event | What happened | The missing part |
|---|---|---|
| `main` went red after #1432 (a missing README row), and #1435 stayed red | the master agent found it by reading #1435's failed check | nothing reads the default branch's CI |
| the #1444 merge watcher aborted twice when the head moved | a temp script compared the head SHA by hand | `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:30`) holds `head` as the branch name and no SHA, so `checks: green` does not say which commit was green |
| a waiter failed after its PR merged and the branch was deleted | the master agent read the output and judged it harmless | no subscriber hears "merged" |
| the PR watch kept stale exclusions and was restarted | `until gh pr list …; sleep 90` | CLAUDE.md, *A Decision Reads The Index*, part 3: "Not built" |
| six merges went through `merge-on-green.sh` in the job's temp directory | the merge rule lived in a script that no reviewer saw | no merge controller (*The Master Agent Uses The Controllers*) |

**The transport exists and nothing starts it.** `The channel carries the findings` (#584, 2026-09-01) built a unix-socket NDJSON channel: `ports/channel.ts`, `adapters/channel/channel-socket.ts` (`startChannel`), `channel-client.ts` (`subscribe`) and `rules/channel.ts` (`admit`). It carries current state, not history: a finding's slot is `monitor + branch` (`entities/finding.ts`, `findingKey`), and a new subscriber gets a `welcome` with every current finding. The master agent's subscriber exists (`packages/board/src/server/entry/act.ts`). **`startChannel` has no production caller**, so the channel does not run. And `rules/channel.ts:36-41` refuses `ci is green` and `ci is red` on purpose, with the reason *"no monitor asks the host about a check run; adding one to serve this would put a host question on a fast loop"*.

This plan starts the channel and adds a publisher that answers `ci is green` **without** a host question: it reads what the supervisor already bought for the PR index. That removes the reason for the refusal, so the refusal changes in the same slice.

**Claude Code mods** (2.1.287) are in-process JS handlers that can draw panes, show toasts and start a turn. They have no git, PR or CI events. A mod that polls `gh` would be a second reader of the host outside the connector's budget, so a mod is at most one more subscriber to the channel.

## Design

### Approach

**One reader, one writer, many subscribers.** `plot-fleetd` folds the PR index and is its only writer (#1444; `pr-refresh.ts:1238`, asserted by `one-pr-index-writer.test.ts`). This plan keeps that, adds the two readings the fleet lacks, and publishes both on the channel. A subscriber reads the channel and never the host.

1. **Rows name their commit.** `PrIndexRowSchema` gains `headSha` and `checksSha`. `headSha` is the PR's head commit as the host gave it. `checksSha` is the commit the check state was read for. The two differ in meaning by arm, and the slice states each:
   - **GitHub rollup** (`plot-host.sh:4136`): `statusCheckRollup` belongs to the head commit, so `checksSha = headSha`.
   - **Jenkins** (`plot-host.sh:4096-4131`): checks join on the branch name, so `checksSha` is the commit of the build the job reports, or absent where the build names none. A row never claims `checksSha = headSha` that the host did not report.
   - **No CI arm** (`:4105`, `:4182`): no checks, so no `checksSha`.
   - **Bitbucket**: the slice records what the Bitbucket path answers, absent where it answers nothing.

   An absent SHA is absent, never `''`, by the rule the schema states for `author`. `PR_INDEX_VERSION` moves to 4; a v3 store reads as "ask the host", as every mismatch does today. The row mapping in `pr-refresh.ts:1066` and `:1094` carries the fields.

   **The pending re-ask is bounded by time, not by count.** Today a delta read misses a completed check and the re-ask stops after `PR_PENDING_REASK_LIMIT = 5` (`pr-refresh.ts:233`), about 5 minutes. CI here runs longer, so a green result can wait up to 24 h for the next full read. The slice keeps the five re-asks on each refresh, then re-asks every 5 minutes while the PR is open, not a draft, and younger than `Checks wait` (3600 s). Each refresh still takes a host slot.

2. **The default branch has its own reading.** A new entity `DefaultBranchReading` in its own file, `.plot/state/default-branch.json`, with its own schema and version: branch, HEAD SHA, check state for that SHA, failing checks, `at`. It stays out of the PR store: the PR store holds the git host's answers, and this reading is the build connector's (`BuildPort`, `packages/domain/src/ports/build.ts`), which is a separate connector. Fleetd is its only writer.
   - **The combined state, not the newest run.** `run-for-sha` returns the newest single run across workflows, and `main` runs three (`ci.yml`, `build-bundles.yml`, `release.yml`). The reading takes every run for the SHA and folds them with the existing `checksFromRuns` (`checks-verdict.ts:209`). A reading that cannot see every workflow answers `unknown`, never `green`.
   - **Cadence.** Fleetd reads when the default branch's HEAD SHA moves (a local ref read, free) and re-asks a `pending` reading on the schedule of step 1. Each read takes a host slot by the rule `refreshRuns` uses (`packages/board/src/server/fleet.ts:1385`).
   - **The hold.** A domain rule `defaultBranchRed` answers `red | green | pending | unknown`. Auto-dispatch adds a `default-branch-red` hold to `QUEUE_HOLDS` (`queue.ts:333`) while the answer is `red`. `unknown` holds nothing. **This reads a non-terminal answer, and that is allowed here:** the hold is reversible, the next reading lifts it, and *One Answer To "Did This Land"* bars non-terminal readings only for destructive decisions.
   - **Arms.** GitHub Actions and Jenkins answer `runForSha` (`build-jenkins.ts:29-59`). Bitbucket Pipelines has no arm and answers `unknown`.

3. **The supervisor starts the channel and publishes what it learned.** Fleetd becomes the channel's first production caller of `startChannel`, on a socket under `.plot/`. It adds a fourth monitor, `IndexMonitor`, which asks the host nothing: after each fold it reads the PR index and the default-branch reading and publishes findings.
   - **New finding names:** `checks green`, `checks failing`, `pr merged` for a slice PR's branch, and `default branch red` for the default branch. `clear` retracts as for every monitor. `MEASURED_BY` maps each to `IndexMonitor`.
   - **State, not history.** Each finding fills the slot `IndexMonitor + branch`. A cold store, a version mismatch or a restart publishes the current state of each open slice PR and of the default branch, and nothing else. No row becomes a transition without a readable previous state, so the first fold after v3 → v4 publishes one finding per open slice PR, not one per stored row.
   - **The refusal changes.** `ci is green` maps to `checks green` and `ci is red` to `checks failing`. Their entry in `REFUSED_BY_DESIGN` goes, and the rule's comment states why: the publisher reads what the supervisor bought on its existing refresh and adds no host question.
   - **Overlap with the BuildMonitor.** The BuildMonitor reads the desk's own run on each pass (`worker-loop.ts:874`) and stops with the desk. The IndexMonitor reads the PR row and goes on after the desk ended, which is the merge-watch case. Both stay; neither publishes the other's names.
   - **Audit.** Each publish writes one line to `fleetd.log` through `process-log.ts`, which already has a size ceiling. There is no separate event file.

4. **The board subscribes.** The board polls `/api/board` every 30 s and the fleet every 4 s (`packages/board/src/app/App.tsx:30-31`). The board server subscribes to the channel with the purpose "everything". When a finding arrives, the page fetches `/api/board`, at most once per 2 s. On reconnect the `welcome` carries the current state, so a board that connected late or lost the socket misses nothing. The 30 s poll stays as the fallback. With no channel running, the board behaves as today.

5. **The board has named render sites.** A render site is a named slot in the page with **one domain function** that returns everything the slot shows: `{show, tone, text}`. The component renders that value and decides nothing. Each function has a unit test; each site has one browser test that proves it shows. The first three:
   - **Banner:** `defaultBranchBanner(reading)` — red shows a banner naming the failing checks; `unknown` shows nothing and the feed says why.
   - **Row badge:** the existing PR badge (`PlanCard.tsx:265`, from `rules/pr-row.ts`) gains the commit: `checks green @a048b6f`, or `checks not bound to a commit` where `checksSha` is absent.
   - **Feed pane:** `channelFeed(findings)` — the channel's current findings, newest first, with their age.

6. **An optional mod subscribes.** A Claude Code mod subscribes to the channel through `channel-client`'s `subscribe` and makes no host call. It draws a pane from the current findings and shows a toast on `checks failing`, `pr merged` and `owes an answer` (the AgentMonitor's finding for a `PLOT-BLOCKED` marker). It starts a turn only on the finding names the operator lists, and at most once per 5 minutes; findings that arrive in that window join the next turn. It never loads in a fleet agent's session. The fleet does not depend on it.

7. **A merge is a controller, and the host decides it.** `plot-ask.mjs merge <pr> <sha>` asks a domain workflow. The index decides only whether to try. The merge itself is destructive, so by *One Answer To "Did This Land"* the workflow re-asks the host for the PR's state, head SHA and checks, and refuses unless all hold: the head equals `<sha>`; `checksSha` equals `<sha>` and the checks are `green`; the PR is not a draft; `defaultBranchRed` is not `red`. Each refusal names its reason and the reading; `checks-unbound` is one of them. On a pass it merges through the path `entry/approve.ts:554` uses (`ctx.scripts.host(['pr-merge', …])`), and `PrMergeWrite` (`workflows/decision.ts:153-159`) gains `sha`. `pr-merge` passes `--match-head-commit <sha>` to `gh`, so a push between the check and the merge fails at the host. Bitbucket has no such flag, so the workflow answers `unaskable` and merges nothing.

### Shell changes

All host access goes through `plot-host.sh` (`check-host-cli-callers.sh`). The plan therefore changes it in up to three places, each carrying data and deciding nothing. `check-shell-lines.sh` requires each slice to remove as many shell lines as it adds, in the same change.

| Slice | Change |
|---|---|
| 1 | `pr-list` requests `headRefOid` at `:4105`, `:4136` and `:4182`, and the Bitbucket path returns its head commit |
| 2 | `runs` returns `headSha`, if the brief finds that `run-for-sha` cannot list every workflow's run for one SHA |
| 7 | `pr-state` returns `headRefOid`, and `pr-merge` takes `--match-head <sha>` and passes `--match-head-commit` |

Every decision is a domain rule or workflow: the row fields and the fold, `defaultBranchRed`, the `IndexMonitor`'s findings, one function per render site, the turn bound and the merge workflow. Moving the host verbs into a TypeScript connector would remove these shell changes, but that belongs to `the-shell-holds-no-behavior`.

### Cost

Measured 2026-10-09: `main` moved 525 times in 7 days (106 in the last day), 65 of them bundle commits.

| Slice | Host requests | Other cost |
|---|---|---|
| 1 | none for the new fields (they ride the existing `pr-list` calls); the re-ask adds at most 11 requests per open, ready PR per CI run, after today's 5 | none |
| 2 | one read per default-branch move, about 75 per day from the figure above, plus re-asks while `pending` on the schedule of slice 1 | one small JSON file |
| 3 | none | one socket; one log line per publish under the existing ceiling |
| 4, 5 | none | board refetches, at most one per 2 s |
| 6 | none | agent turns, at most one per 5 minutes and only on the listed names |
| 7 | two per merge: one `pr-state`, one `pr-merge` | none |

The slice-2 and slice-1 briefs measure the real figures before merge: requests per hour over one working day, from the budget log, against today's.

### Open Questions

- [ ] Slice 6: the mod API facts in this plan come from one research pass. The brief verifies them against the mods reference before any code: the `register(on)` signature, timers, starting a turn, the render sites, and whether a mod can open a unix socket.
- [ ] Slice 6: the Plot plugin is also loaded by fleet agents for its gates. Does the mod ship in the Plot plugin and do nothing under `PLOT_UNATTENDED=1`, or ship as a separate plugin that only the operator installs?
- [ ] Slice 3: does the master agent's subscriber (`entry/act.ts`) start with the channel in this plan, or stay test-only until a later one?

## Slices

### PR rows name their commit

- `feature/a-pr-row-names-its-commit` — `PrIndexRowSchema` gains `headSha` and `checksSha` with a stated meaning per arm, `PR_INDEX_VERSION` moves to 4, `plot-host.sh pr-list` adds `headRefOid` with an equal shell-line removal, and the pending re-ask is bounded by `Checks wait` <!-- builds: headSha and checksSha on PrIndexRowSchema, PR index v4 -->

### The default branch has its own reading

- `feature/the-default-branch-has-its-own-reading` — fleetd writes `DefaultBranchReading` to its own file from every workflow's runs for the HEAD SHA, on each move of that SHA; `defaultBranchRed` adds a `default-branch-red` hold to `QUEUE_HOLDS` <!-- builds: DefaultBranchReading, an entity with a file adapter, and defaultBranchRed, a domain rule -->

### The supervisor publishes on the channel

- `feature/the-supervisor-publishes-on-the-channel` — fleetd starts the findings channel and an `IndexMonitor` that publishes `checks green`, `checks failing`, `pr merged` and `default branch red` from the index as current state; `ci is green` and `ci is red` stop being refused <!-- builds: IndexMonitor, a publisher of index findings, and the first production caller of startChannel -->

### The board subscribes to the channel

- `feature/the-board-subscribes-to-the-channel` — the board server subscribes with the purpose "everything" and the page refetches `/api/board` on a finding, at most once per 2 s; the 30 s poll stays as the fallback <!-- builds: the board's channel subscription -->

### The board has named render sites

- `feature/the-board-has-named-render-sites` — a render site is one domain function returning `{show, tone, text}`; the page gets a banner, the existing PR badge with its commit, and a feed pane <!-- builds: defaultBranchBanner and channelFeed, domain functions, and the render-site components -->

### A mod follows the channel

- `feature/a-mod-follows-the-channel` — a Claude Code mod subscribes to the channel, draws a pane, shows toasts and starts at most one turn per 5 minutes on the finding names the operator lists; it makes no host call and does not load in a fleet agent's session <!-- builds: a Claude Code mod that subscribes to the findings channel -->

### A merge is a controller

- `feature/a-merge-is-a-controller` — `plot-ask.mjs merge <pr> <sha>` re-asks the host and merges only when the head, the checks for that head, the draft state and the default branch agree; `pr-merge` pins the merge with `--match-head-commit` <!-- builds: a merge workflow in packages/domain and its plot-ask.mjs verb --> <!-- waits: feature/the-controllers-are-commands -->

## Notes

- The merge slice is last and carries a `waits:` annotation on `feature/the-controllers-are-commands` (plan `the-fleet-runs-without-the-board`), so the wait holds up no other slice and auto-dispatch cannot hand it over early.
- The supervisor is `plot-fleetd` since #1428. CLAUDE.md still says `plot-registryd` in places; that is CLAUDE.md's drift, not this plan's.
- Round 1 (panel, 2026-10-09): unanimous amend. `.plot/panels/2026-10-09-the-fleet-reports-what-changed-on-the-host/panel.md` lists the seven amendments. This revision makes all seven; the largest is the move from a new event file to the existing channel.
