# The fleet reports what changed on the host

> A PR row names the commit its checks read, the default branch has its own row, the supervisor writes one event per change, and the board and the operator's session follow those events instead of polling.

## Status

- **State:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- A PR's check state names the commit it read, so a merge on green merges the commit that was green.
- The fleet reads the default branch's CI and hands no slice over while the default branch is red.
- The supervisor writes `.plot/logs/fleet-events.jsonl`: one line per change of a PR, a check or the default branch.
- The board follows the event feed and refreshes when an event arrives, not only every 30 seconds.
- The board shows the default branch's CI state in a banner, and each slice row shows its PR's checks for a named commit.
- A merge controller merges a PR only when its head, its checks and the default branch agree.
- An optional Claude Code mod shows the fleet's events in the operator's session and starts a turn on the events a person asked for.

<!-- Board impact: the PR index schema moves from v3 to v4, and the board reads it through FleetState. The board gains an event route (`/api/events`) and named render sites; every site shows a domain property. No change to the plan format, the plan template or docs/plans. -->

## Motivation

The fleet reads Git, PRs and CI, but no consumer can learn that a reading changed. Every consumer polls. Measured in the master session of 2026-10-09:

| Event | What happened | The missing part |
|---|---|---|
| `main` went red after #1432 (a missing README row), and #1435 stayed red | the master agent found it by reading #1435's failed check | no index row holds the default branch's CI |
| the #1444 merge watcher aborted twice when the head moved | a temp script compared the head SHA by hand | `PrIndexRowSchema` (`packages/domain/src/entities/pr-index.ts:31`) holds `head` as the branch name and no SHA, so `checks: green` does not say which commit was green |
| a waiter failed after its PR merged and the branch was deleted | the master agent read the output and judged it harmless | no event says "merged, branch deleted" |
| the PR watch kept stale exclusions and was restarted | `until gh pr list …; sleep 90` | CLAUDE.md, *A Decision Reads The Index*, part 3: "Not built" |
| six merges this session went through `merge-on-green.sh` in the job's temp directory | the merge rule lived in a script that no reviewer saw | no merge controller (*The Master Agent Uses The Controllers*) |

Claude Code 2.1.287 added mods: in-process JS handlers that can draw panes, show toasts, run timers and start a turn. Mods have no git, PR or CI events (mods reference, `code.claude.com/docs/en/plugins/mods/reference`). A mod that polls `gh` itself is a second reader of the host outside the connector's rate budget. So the fleet stays the one reader, and a mod is at most a view of what the fleet wrote.

## Design

### Approach

**One reader, one writer, many listeners.** `plot-fleetd` already folds the PR index on its tick and is its only writer (#1444). This plan keeps that and adds the two readings the index lacks, then makes every change of a reading a line in a log file. A listener reads the file and never the host.

1. **Rows name their commit.** `PrIndexRowSchema` gains `headSha`. The check state is recorded for that SHA. A row whose host gave no SHA leaves the field absent, never `''`, by the rule the schema already states for `author`. `PR_INDEX_VERSION` moves to 4; a v3 store reads as "ask the host", as every version mismatch does today. **This is the plan's one shell change.** `plot-host.sh pr-list` requests no `headRefOid` from `gh` today (`plot-host.sh:4105`, `:4136`, `:4182`; only `pr-merged-heads` at `:3754` does), and `check-host-cli-callers.sh` allows no other route to the host. So the slice adds the field to those three calls and to the Bitbucket path. The change carries data and decides nothing. `check-shell-lines.sh` requires the slice to remove as many shell lines as it adds, in the same change.
2. **The default branch has a row.** The index gains one `defaultBranch` entry: name, HEAD SHA, check state for that SHA, failing checks, `at`. The fleet reads it through the build port's `runForSha` (`packages/domain/src/ports/build.ts:103`), which exists and is the connector for CI. A domain rule `defaultBranchRed` answers `red | green | pending | unknown`. Auto-dispatch hands no new slice over while the answer is `red`, and the hold has its own key in the tick's counts. `unknown` holds nothing: an unreadable CI is not a red one.
3. **Every change is an event.** On each fold, a domain rule `indexTransitions(before, after)` compares the two stores and returns a list of events. Fleetd appends them to `.plot/logs/fleet-events.jsonl`, one JSON object per line: `{at, kind, pr?, branch?, sha?, from?, to?}`. The kinds: `pr-opened`, `pr-ready`, `checks-changed`, `merged`, `closed`, `head-moved`, `default-branch-changed`. The rule is pure and has unit tests; the file adapter only appends. The file has a size ceiling, as `fleetd.log` has.
4. **The board follows the feed.** The board polls `/api/board` every 30 s and the fleet every 4 s (`packages/board/src/app/App.tsx:30`). The board server reads new lines of `fleet-events.jsonl` and sends them on `/api/events` as server-sent events. The page fetches `/api/board` when an event arrives. The 30 s poll stays as the fallback for a lost connection, so a board with no feed behaves as today. The server reads a file; it calls no host.
5. **The board has named render sites.** Borrowed from the mods' render sites (`Pane`, `AbovePrompt`): the page gets a fixed set of named places, each fed by one domain property and nothing else. The first three: a **banner** (the default branch is red, from `defaultBranchRed`), a **row badge** (a slice PR's checks for its `headSha`, for example `green@a048b6f`), and a **feed pane** (the last N events). A site that needs a decision gets a domain property first, by the rule *Every rendered state is a domain property*; a unit test asserts each property, and one browser test per site proves it shows.
6. **A merge is a controller.** `plot-ask.mjs merge <pr> <sha>` asks a domain workflow that reads the index and refuses unless all of these hold: the row's `headSha` equals `<sha>`; checks are `green` for that SHA; the PR is not a draft; `defaultBranchRed` is not `red`. On a pass it writes one `pr-merge` through the performer, which `approve.ts:256` already uses. Each refusal names its reason and the reading it came from.
7. **An optional mod listens.** A Claude Code mod reads `fleet-events.jsonl` on a timer and makes zero host calls. It draws a pane (default branch state, and each open slice PR with `checks@sha`), shows a toast on `merged`, `checks-changed` to `failing`, and a new `PLOT-BLOCKED`, and starts a turn on the event kinds the operator names. It never loads in a fleet agent's session. The fleet does not depend on it.

**No other slice touches shell.** Every decision this plan adds is a domain rule or workflow: `headSha` and the fold, `defaultBranchRed`, `indexTransitions`, one domain property per render site, and the merge workflow. Slice 2 reads through the existing `BuildPort.runForSha` and refs adapter, and slice 6 writes through the existing `pr-merge` verb. Moving `pr-list` into a TypeScript host connector would remove the shell change too, but it belongs to `the-shell-holds-no-behavior` and is larger than this plan.

**What stays out.** Fleetd emits events and runs no handlers: a listener is a reader of a file, so no plugin code runs in the supervisor. The five PreToolUse gates stay shell hooks: they also guard Codex through `AGENTS.md`, and they cost about 40 ms per call.

### Open Questions

- [ ] Slice 7: the mod API facts in this plan come from one research pass. The slice's brief verifies them against the mods reference before any code: the `register(on)` signature, `$.clock.every`, `$.prompt.submit`, the render sites.
- [ ] Slice 7: the Plot plugin is also loaded by fleet agents for its gates. Does the mod ship in the Plot plugin and do nothing under `PLOT_UNATTENDED=1`, or ship as a separate plugin that only the operator installs?
- [ ] Slice 4: a board opened before the first event, or after the feed file rotated, must not miss a change. Does the page re-fetch `/api/board` on every reconnect, or does the event route replay from an offset the page sends?
- [ ] Slice 5: which render sites exist after the first three? This plan names a banner, a row badge and a feed pane; the agent-lifecycle sites (prompt start, prompt end with exit code, spend) belong to a separate plan about agent rows, because the worker loop and not the host produces them.
- [ ] Slice 2: Bitbucket. `runForSha` answers for `github-actions`; the brief records what a Jenkins or Bitbucket Pipelines repository gets, which must be `unknown` and never `green`.

## Slices

### PR rows name their commit

- `feature/a-pr-row-names-its-commit` — `PrIndexRowSchema` gains `headSha`, the check state is recorded for that SHA, `PR_INDEX_VERSION` moves to 4, and `plot-host.sh pr-list` adds `headRefOid` with an equal shell-line removal <!-- builds: headSha on PrIndexRowSchema, PR index v4 -->

### The default branch has a row

- `feature/the-default-branch-has-a-row` — the index holds the default branch's HEAD SHA and its CI state through `BuildPort.runForSha`; `defaultBranchRed` holds new hand-overs while the answer is `red` <!-- builds: defaultBranchRed, a domain rule, and the defaultBranch index entry -->

### The supervisor writes events

- `feature/the-supervisor-writes-events` — `indexTransitions` compares two index stores and fleetd appends the result to `.plot/logs/fleet-events.jsonl` with a size ceiling <!-- builds: indexTransitions, a domain rule, and the fleet-events.jsonl adapter -->

### The board follows the event feed

- `feature/the-board-follows-the-event-feed` — the board server sends new `fleet-events.jsonl` lines on `/api/events` as server-sent events; the page fetches `/api/board` on an event and keeps the 30 s poll as the fallback <!-- builds: /api/events, a server-sent event route -->

### The board has named render sites

- `feature/the-board-has-named-render-sites` — the page has a banner, a row badge and a feed pane, each fed by one domain property: `defaultBranchRed`, a slice PR's checks for its `headSha`, and the last events <!-- builds: named render sites in packages/board/src/app -->

### A merge is a controller

- `feature/a-merge-is-a-controller` — `plot-ask.mjs merge <pr> <sha>` merges only when the head SHA, the checks for that SHA, the draft state and the default branch agree; each refusal names its reason <!-- builds: a merge workflow in packages/domain and its plot-ask.mjs verb -->

### A mod shows the fleet's events

- `feature/a-mod-shows-the-fleets-events` — a Claude Code mod reads `fleet-events.jsonl`, draws a pane, shows toasts and starts a turn on the event kinds the operator names; it makes no host call and does not load in a fleet agent's session <!-- builds: a Claude Code mod that reads fleet-events.jsonl -->

## Notes

- Waits on `the-fleet-runs-without-the-board`: the merge controller (slice 6) takes its shape from `feature/the-controllers-are-commands`. Slices 1 to 5 need only #1444, which merged; the merge slice sits after the board slices so that this wait holds up nothing else.
- The adapter parts exist: `plot-host.sh` `pr-merge` (called by `approve.ts`) and `run-for-sha` (called by `build-shell.ts:161`).
