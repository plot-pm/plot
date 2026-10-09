# Round 3 — deliverable lens

Position: amend

Revision read: `5788128ea`. The juror read the plan, `round2/panel.md`, CLAUDE.md, and every cited file:line with `sed`, `grep` and `git`. The juror ran no test. The juror ran `claude plugin --help` once to check the slice-7 done-when command.

## 1. Round-2 amendments in the revision

| # | Amendment | Holds? | Evidence |
|---|---|---|---|
| 1 | Decide the channel's scope | In part | The owner chose the relay (slice 4). The relay's cited read does not exist: `ports/desk.ts:215-245` declares `publishFinding` and `publishBuildFinding`, which append lines. The desk port has no read method. The board reads the files with `readFileSync` in `packages/board/src/server/findings.ts:67` (`findingsInLog`) and `:119` (`findingsFor`), not through the port. See finding M1. |
| 2 | `foldRuns`, a runs-for-SHA port op, unconditional shell change, re-ask red, the ref read | In part | All five are in the text (plan lines 60-63, 99). The conclusion table names GitHub words only, and the Jenkins arm returns Jenkins words verbatim (finding M3). The refs port has no op that returns a remote tip's SHA: `remoteTip` (`ports/refs.ts:557`) compares for equality only (finding L2). |
| 3 | Name the merge's checks source; recount | Yes | Slice 8 names `pr-state` with `headRefOid` and the rollup. `pr-state` today asks `number,state,isDraft,url,mergeCommit` (`plot-host.sh:3496`). The cost row says two requests per merge. Jenkins refuses `checks-unbound`. |
| 4 | Publish on change; `worktree`, enum entry, heartbeat; retract and keep `pr merged` | In part | The text is there (plan lines 68-71). The 24 h rule reads "the rows' merge time", and no row carries one (finding H1). "Marks itself seen" needs a channel API that does not exist (finding M4). |
| 5 | Restore a page push | Yes | Slice 5 serves `/api/events`; `App.tsx:30-31` holds the two polls the plan cites. |
| 6 | Reuse `checksVerdict`'s shape; use `StatusPanel.tsx` | In part | `checksVerdict` at `rules/checks-reading.ts:130` returns `{state, prominence, shown, label, detail}`, as cited. Its `shown` is `checks !== 'green'` (`:113`), so the plan's example `checks green @a048b6f` never renders (finding M2). `StatusPanel` takes `BoardStatus {key, severity, text, tone}` (`StatusPanel.tsx:31-48`), not that shape, and renders nothing when no status is true (`:183-185`) (finding L3). |
| 7 | A done-when line and a failing test per slice | Yes | Each of the eight slices has a done-when line. `claude plugin test [dir]` exists ("Run a mod's tests"), so the slice-7 command is real. |

## 2. Code claims checked

Hold: `CLAUDE.md:478` is the "Only a terminal answer is read from the index" paragraph. `pr-refresh.ts:233` (`PR_PENDING_REASK_LIMIT = 5`), `:1066`, `:1094`, `:1238` (`foldPrIndex`), `:1478` (one `pr-list --rich --state open` for all askable PRs). `plot-host.sh:4096-4131` and `:4105` are the Jenkins arm, `:4136` the rollup arm, `:4182` the no-CI arm, `:4396` `run-for-sha`, `:4573` takes `.[0]`, `:3812` `pr-merge`. `build-jenkins.ts:29-59` describes and implements `runForSha` through Jenkins REST. `rules/channel.ts:36-41` holds the two refusals. `queue.ts:333` is `QUEUE_HOLDS`. `findings.ts:3-15` states the file-read design. `entry/approve.ts:554` calls `ctx.scripts.host(['pr-merge', …])`. `workflows/decision.ts:153-159` is `PrMergeWrite` with `pr` and `deleteBranch`. `startChannel` has no production caller (only `adapters/index.ts:160` re-exports it). `entry/act.ts:90` subscribes `until owes a review`.

Do not hold: `ports/desk.ts:215-235` as a read (M1); "the rows' merge time" (H1). Note: two exports named `checksVerdict` exist (`rules/checks-verdict.ts:82`, a wait verdict, and `rules/checks-reading.ts:130`); only the second is exported from `packages/domain/src/index.ts:76`. The plan names the right file, so this is LOW.

## 3. Findings

### H1 — HIGH: `pr merged` retention reads a field no row has

Plan line 70: "`pr merged` for each slice PR merged in the last 24 h (from the rows' merge time) … A `pr merged` slot is cleared 24 h after the merge." `PrIndexRowSchema` (`entities/pr-index.ts:30-62`) has `number, head, state, draft, checks, review, url, mergeable, failing_checks, author, updatedAt` and no merge time. No `pr-list` arm asks for one: the three GitHub `--json` lists (`plot-host.sh:4105`, `:4136`, `:4182`) and the Bitbucket jq (`:4293`) carry no `mergedAt`. Slice 1 adds only `headSha`, `headSince` and `checksSha`.

So the slice-3 implementer must either use `updatedAt` as the merge time, which is wrong code (a comment after the merge moves `updatedAt`, and the schema calls it "when the host last saw this PR change"), or add `mergedAt` to the row, which needs a second schema version after slice 1 has merged and a shell change the shell table does not list. Slice 3's done-when also does not test the 24 h rule, so neither choice is caught.

Amendment: slice 1 adds `mergedAt` to `PrIndexRowSchema` (absent, never `''`, as for `author`) and to the `pr-list` field lists in the same change, and its done-when stores it for a merged fixture row. Slice 3's done-when adds a test that a `pr merged` slot clears 24 h after `mergedAt` and that a cold store publishes `pr merged` for a PR merged 23 h ago and not for one merged 25 h ago.

### M1 — MEDIUM: slice 4 cites a desk read that does not exist

Plan line 75 and the cost row (line 112) say fleetd reads desk findings "through the desk port (`ports/desk.ts:215-235`), the same read the board makes". The cited lines are two append methods. The board's read is `findingsFor` in `packages/board/src/server/findings.ts`, a board-server module that fleetd must not import. An implementer who follows "the same read the board makes" can import board server code into `packages/fleet`, or read files outside an adapter, and both break The Layering Rule.

Amendment: slice 4 adds a read method to the desk port (for example `currentFindings(worktree)`) with an adapter that reads the three `.plot-worker.monitor.*.jsonl` files, and the board's `findingsFor` may move onto it later. Correct the citation.

### M2 — MEDIUM: the green badge example cannot render

`checksShown` returns `readings.checks !== 'green'` (`rules/checks-reading.ts:113`), and `ChecksNote` returns `null` when `!verdict.shown` (`PlanCard.tsx:266`). The comment states the rule: "SILENT WHEN THE NEWS IS GOOD". The plan's example `checks green @a048b6f` (line 80) and slice 6's done-when ("each place one browser test that proves it shows") point the implementer at the one state that is hidden. Making green visible breaks a settled render rule and its existing browser test.

Amendment: state that the commit shows on the shown states (`checks failing @a048b6f`, `checks running @a048b6f`, and `checks not bound to a commit` where `checksSha` is absent and checks are not green), and that green stays silent. The browser test asserts a failing row.

### M3 — MEDIUM: `foldRuns` reads Jenkins as `unknown`

`ShaRun.conclusion` is "How it ended, verbatim" (`entities/build.ts:153`), and the Jenkins arm passes `.result` through (`plot-host.sh:4526`), which Jenkins spells `SUCCESS`, `FAILURE`, `UNSTABLE`, `ABORTED`. The `foldRuns` table (plan line 62) names GitHub words only. A Jenkins default branch then never reads `red`, and line 65 says Jenkins answers. Because `unknown` holds nothing, main still works, but the Jenkins arm ships without effect and no test sees it.

Amendment: the table names the Jenkins words (`FAILURE` → red, `SUCCESS` → green, `UNSTABLE` and `ABORTED` stated explicitly), and the done-when adds a Jenkins fixture. Also name GitHub `stale` and the statuses `waiting`, `requested` and `pending`, or say they read `unknown`.

### M4 — MEDIUM: the IndexMonitor needs channel API that does not exist

`RunningChannel` (`channel-socket.ts:51-56`) exposes `findings()` and `subscriberCount()` and no in-process publish. `publish` is internal (`:149`) and is reached only by a socket `{"type":"publish"}` message (`:92-97`). `lastSeen` changes only inside `publish` (`:151`), so "marks itself seen after every fold, publish or not" (plan line 71) has no call to make. The relay (slice 4) has the same gap, and a relayed line carries the file's old `measuredAt`, so the heartbeat would show the AgentMonitor as last seen at its last change.

Amendment: slice 3 states that `RunningChannel` gains `publish(finding)` and `seen(monitor, at)` (or that the IndexMonitor connects as a socket client), and slice 4 states what `lastSeen` a relayed monitor gets. No consumer reads liveness today (`monitorLiveness` has no caller outside `channel-socket.ts`), so this is not HIGH.

### M5 — MEDIUM: slice 6 has no stated data path

Slice 5 forwards findings as events and the page refetches `/api/board`. Slice 6's `channelFeed(findings)` and `defaultBranchStatus(reading)` need the current findings and `.plot/state/default-branch.json` in the payload, and no slice says which payload field carries them or who reads the file. The board-impact comment names only the PR index through FleetState.

Amendment: slice 5 (or 6) names the payload fields: the board server keeps the channel's current findings and puts them in `/api/board`, and reads `DefaultBranchReading` through a decode function in the domain beside the PR index.

### L1 — LOW: Bitbucket approval and `--match-head`

Line 88: "the plan-approval merge passes its head too". `pr-merge` has a Bitbucket arm (`plot-host.sh:3828-3831`). If that arm refuses the new flag, plan approval on Bitbucket stops. Say that the Bitbucket arm ignores `--match-head`, or that approve passes it only on GitHub. The approval also needs a head SHA, which costs one `pr-state` call that the cost table does not list.

### L2 — LOW: the HEAD SHA read needs a new refs op

`remoteTip(branch, pushedSha)` answers `pushed | other | unknown` and returns no SHA, and the board's refs instance answers `unaskable` for network ops (`ports/refs.ts:557-571`). Name the new op (for example `remoteTipSha(branch)`) and that fleetd composes `refs-remote-git.ts`.

### L3 — LOW: StatusPanel's contract

`StatusPanel` answers "is something wrong?" and vanishes when empty (`StatusPanel.tsx:13-18`, `:183-185`). `defaultBranchStatus` must map to `BoardStatus` and add a status only for `red` (and perhaps `unknown`), never for `green`. Say so in slice 6.

### L4 — LOW: smaller gaps

- `ci is green` "maps to" `checks green` (line 72): `admit` has no alias table today (`rules/channel.ts:60-79`); say whether the alias is served or refused with a pointer to the new name.
- Line 70 says "one finding for each open slice PR", but a `pending` PR has no finding name. Say that pending publishes nothing.
- The IndexMonitor needs the set of slice branches to tell a slice PR from another PR; name the reading it takes them from.
- Slice 2 adds a sentence to CLAUDE.md, so `AGENTS.md` must be regenerated (`check-agents-md.sh --write`).
- Slice 8 does not state the merge method (`--squash` or `--merge`); `approve.ts:554` passes neither, which gives `--merge`.

## 4. Buildability, cost and cadence

Slices 1, 2, 5 and 8 are buildable from the plan and a brief, with the citations above corrected. Slice 3 is not buildable as written because of H1 and M4. Slice 4 needs M1. Slice 6 needs M2 and M5. Slice 7 has two open questions; the second (ship in the Plot plugin or separately) is an owner decision that a brief cannot make, so record the answer before slice 7 is dispatched. The slice order is safe: each slice leaves main working, because `unknown` holds nothing, a v3 store reads as "ask the host", and the 30 s poll stays.

The cost figures are plausible. The re-ask bound of 12 listings per hour against 60 matches one listing per refresh (`pr-refresh.ts:1478`). After a restart or the v3 → v4 move, `headSince` is the fold time for every row, so every pending or failing PR is re-asked for one hour; that is still at most 12 listings per hour. Slice 2's 400 REST requests per day is a reasoned figure; the slice measures it.

## 5. Most important change

Add `mergedAt` to the PR row in slice 1, with its shell field and a test, so that slice 3's 24 h `pr merged` rule reads a real field. The four MEDIUM findings are corrections a brief can carry, but each should be one sentence in the plan so the implementer does not guess.
