# Juror: contradiction (round 2)

Position: amend

Subject: `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` at `3e60e1b33`. I read the plan, the round-1 panel, CLAUDE.md and the cited code. I ran no test. Every finding below rests on a file and line I read.

## 1. Round-1 amendments

| # | Amendment | Holds? |
|---|---|---|
| 1 | Merge pinned to the SHA, re-ask head and checks, `sha` on `PrMergeWrite`, cite `entry/approve.ts:554`, declare the shell change | Partly. The pin, the citation and the shell row hold. The checks re-ask does not: see finding A. |
| 2 | Per-arm meaning of the SHA fields, `checks-unbound` refusal | Holds, with a wrong label (finding G). |
| 3 | Default-branch reading out of the PR store, combined state, cadence, host slot, non-terminal licence | Partly. The separate file and the host slot hold. The fold reuses a rule that cannot fold (finding C), the cadence trigger depends on a fetch nobody makes (finding D), and the licence cites a section that is not the one it relaxes (finding E). |
| 4 | Build on the channel, baseline rule for a cold store, re-ask bound, `process-log.ts` | Partly. The cold-store rule loses `pr merged` (finding B2). The channel has no other publisher (finding B1). |
| 5 | Close reconnect, define a render site, reuse the badge | Partly. Reconnect and the render-site definition hold. The page has no way to hear the server's subscription (finding F). |
| 6 | Drop `PLOT-BLOCKED` or add it, bound turns | Not effective. `owes an answer` replaces it, but no monitor publishes that finding on the channel (finding B1). The turn bound holds. |
| 7 | `waits:` annotation or move last | Holds: the merge slice is last and carries `<!-- waits: feature/the-controllers-are-commands -->` (plan:144). |

## 2. Findings

### A. The merge workflow re-asks the host for checks, but no verb it calls returns checks — HIGH

Plan:81 says the workflow "re-asks the host for the PR's state, head SHA and checks" and refuses unless "`checksSha` equals `<sha>` and the checks are `green`". The shell table (plan:91) adds only `headRefOid` to `pr-state`, and the cost table (plan:106) prices the merge at "two per merge: one `pr-state`, one `pr-merge`".

`pr-state` (`skills/plot/scripts/plot-host.sh:3439`) answers `number, state, draft, url, mergeCommit` (the miss shape at `:3463`); it carries no checks on either the GraphQL or the REST route. So the workflow can only get checks from the PR index, which is a non-terminal row, for a destructive decision. That is the defect round-1 amendment 1 named, and the plan's own text (plan:81, "by *One Answer To 'Did This Land'* the workflow re-asks the host") says it must not happen. A rollup read early can also be green before a later workflow registers its check, so a green row for the right SHA is not the host's last word.

Amendment: name the host verb that returns the check state for the head SHA at merge time (extend `pr-state`, or call `pr-list` for the one PR), add it to the slice-7 shell row, and correct the cost to three requests per merge if it is a separate call.

### B1. Starting the channel does not put the existing monitors on it — HIGH

Plan:37 says "The transport exists and nothing starts it" and that a new subscriber "gets a `welcome` with every current finding". Starting it is not enough. No monitor publishes on the socket: the WorkerMonitor, AgentMonitor and BuildMonitor append to `.plot-worker.monitor.<subject>.jsonl` (`packages/board/src/server/findings.ts:3-15`, which states "THE MONITORS PUBLISH TO A FILE AND THE BOARD READS IT"; `plot-agent-monitor.sh:144`; `plot-dispatch.sh:1592`; `desk-fs.ts:33-36`). A grep for `startChannel`, `channel-client` and a socket path over `packages/*/src` and `skills/` finds only the channel's own adapters and `entry/act.ts`.

Three parts of the plan depend on findings that no publisher sends:

- The mod's toast on `owes an answer` (plan:79) never fires. That is the AgentMonitor's finding, and the AgentMonitor writes a file.
- The master agent's subscriber (`entry/act.ts:53`, purpose `until owes a review`) waits for an AgentMonitor finding that the channel never carries. Open question 3 (plan:114) asks whether to start it; started, it is never served, which is the failure `rules/channel.ts:46-49` says the channel exists to end.
- The feed pane `channelFeed(findings)` (plan:77) shows only `IndexMonitor` findings, while the row reads desk findings from the files (`findings.ts`). The page then has two sources of findings that disagree on what exists.

Amendment: either add a slice (or a step in slice 3) where fleetd relays the monitors' JSONL lines onto the channel, with one reader and no second parser (`entities/finding.ts:76-80` already states one shape for all three), or restrict the plan to `IndexMonitor` findings: drop `owes an answer` from the mod, state that open question 3 stays closed, and say the feed shows index findings only.

### B2. The cold-store rule removes `pr merged` from the channel's current state — MEDIUM

Plan:67 says a cold store, a version mismatch or a restart "publishes the current state of each open slice PR and of the default branch, and nothing else". A merged PR is not open. So after a fleetd restart, a slice that merged keeps no `pr merged` slot, and a subscriber that joins with `until pr merged` for that branch (`entities/subscription.ts:17-29`, `serves` at `:92-96`) waits for ever. The channel's model is that a late subscriber "gets what is true now instead of a replay" (`entities/finding.ts:104-111`), and the merge-watch case is the motivation's row 3 (plan:33). Under this rule `pr merged` is a transition, not a state, which the same paragraph says it must not be.

Amendment: define a bounded state for `pr merged` that survives a restart, for example every slice PR whose plan is not Delivered, or every slice PR merged within `Claim stale after` hours, and state the bound with its size.

### C. `checksFromRuns` cannot fold several runs into red or green — MEDIUM

Plan:60 says the reading "takes every run for the SHA and folds them with the existing `checksFromRuns` (`checks-verdict.ts:209`)". That rule takes ONE `run` (`readings.run`, `:213`) and answers `none | wait | settled | no-answer | tip-moved` (`:181`), the worker loop's CI wait. It does not fold runs and has no red or green. `BuildPort` has only `runForSha` returning one `ShaRun | null` (`ports/build.ts:103`). So slice 2 needs a new port method and a new fold rule, and the brief would start from a reuse that does not exist.

Amendment: name a new domain rule (for example `defaultBranchChecks(runs)`) and a new `BuildPort` method that lists every run for one SHA, and keep the conditional shell row (plan:90) tied to it.

### D. "A local ref read, free" moves only when something fetches — MEDIUM

Plan:61 says fleetd reads the default branch when its HEAD SHA moves, "a local ref read, free". A local `origin/main` moves only on a fetch. No code under `packages/fleet/src` runs `git fetch`; the domain's fetch is `refs-remote-git.ts:45`, used for claims. If nothing fetches, the reading stays on an old SHA and the hold never sets. If fleetd fetches each tick, the read is a remote call per tick, not free.

Amendment: state who moves the ref and on what cadence, and price it in the cost table. Also price the `pending` re-asks: at 75 moves per day and a re-ask every 5 minutes during each CI run, the figure is a multiple of the "about 75 per day" in plan:102, not 75.

### E. The non-terminal licence cites the wrong section and leaves CLAUDE.md contradicting the plan — MEDIUM

Plan:62 says a reversible hold may read a non-terminal answer because *One Answer To "Did This Land"* bars that only for destructive decisions. The blast-radius rule is there (`CLAUDE.md:543`). But the rule the plan relaxes is *A Decision Reads The Index*: "Only a terminal answer is read from the index ... the rows record no SHA to revalidate against" (`CLAUDE.md:478`). That section grants no reversible exception. The plan's own slice 1 removes the reason the rule gives (the rows gain a SHA), and slice 3 builds part 3 of that section's table ("Not built", `CLAUDE.md` table under *A Decision Reads The Index*).

Amendment: add to slice 1 (or slice 3) a CLAUDE.md change that states the new licence where the rule lives: a non-terminal row with a SHA may feed a reversible decision, a destructive decision re-asks the host. Update the part-3 row in the same change.

### F. The page cannot hear the board server's subscription — MEDIUM

Plan:72 says "When a finding arrives, the page fetches `/api/board`". The subscription is in the board server; the page polls (`App.tsx:30-31`). The board has no server-to-page push: a grep for `EventSource`, `text/event-stream` and `WebSocket` under `packages/board/src` finds nothing. Slice 4 is not buildable from the plan without that path.

Amendment: name the path. The cheapest one that exists: the server bumps a findings counter in the `/api/fleet` payload, which the page already polls every 4 s, and the page refetches `/api/board` when the counter moves. Or name SSE and its endpoint.

### G. Citations — LOW

- Plan:52 labels `:4105` as "No CI arm". `plot-host.sh:4105` is the Jenkins arm's `gh pr list` call; the plain arm is `:4182`.
- Plan:76 says the badge at `PlanCard.tsx:265` comes "from `rules/pr-row.ts`". `ChecksNote` calls `checksVerdict` (`PlanCard.tsx:6`, `:265`); `rules/pr-row.ts` answers placement (`prRowPlacement`, `:38`).
- Plan:51 allows a Jenkins `checksSha` "of the build the job reports". `jenkins_build_map` (`plot-host.sh:1450`) builds a map from job colour and carries no commit, so the Jenkins arm answers absent today and every Jenkins merge refuses `checks-unbound`. The plan should say that outcome, not leave it to the brief.

### H. Smaller design gaps in slice 3 — LOW

- `FindingSchema.worktree` is required and means "The desk it was read from" (`entities/finding.ts:86-87`). The `IndexMonitor` has no desk. State what it writes.
- `monitorLiveness` (`rules/channel.ts`) reads a monitor as `gone` after silence, and `lastSeen` moves only on a publish (`channel-socket.ts:151`). State whether the `IndexMonitor` republishes each fold (heartbeat holds, log grows by slots times folds) or publishes on change (log small, the monitor reads `gone`).
- `MonitorNameSchema` carries a `plot-state: classification` marker and a "Three subjects" comment (`entities/finding.ts:6-12`); the slice updates both.
- `PrMergeWrite` (`workflows/decision.ts:153-159`) is the approve workflow's write. Adding `sha` changes plan-PR approval too; say so or give the new workflow its own write.

## 3. Buildability and cost

Slices 1, 2, 5 and 7 are buildable once findings A, C and E are fixed. Slice 4 needs finding F. Slice 6 depends on open questions 1 and 2, which the brief can answer. Slice 3 needs a decision on finding B1 before a brief can state its scope. The order is strict and each slice leaves main working: the board falls back to its 30 s poll with no channel, and the merge slice is last behind its `waits:`.

## 4. The single most important change

Finding A: the merge workflow must get the check state for the head SHA from the host at merge time, through a named verb in the slice-7 shell row, with the cost corrected. Without it the one destructive decision in the plan rests on a non-terminal index row, which the plan itself and *A Decision Reads The Index* both forbid.
