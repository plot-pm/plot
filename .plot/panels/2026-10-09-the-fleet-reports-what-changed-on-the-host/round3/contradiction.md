# Round 3 — contradiction lens

Subject: `docs/plans/2026-10-09-the-fleet-reports-what-changed-on-the-host.md` at `5788128ea`. I read the plan, the round-2 moderation, CLAUDE.md and the cited code with grep and sed. I ran no test.

Position: amend

## 1. Round-2 amendments

| # | Amendment | Holds? |
|---|---|---|
| 1 | Decide the channel's scope | Decided (relay, slice 4). The relay cites a desk-port read that does not exist, and it has no retraction for a desk that goes away (findings B and C). |
| 2 | Fold every run; port op; red re-ask; ref fetch | Holds. `foldRuns` has a conclusion table, `BuildPort.runsForSha` is named, red is re-asked, and the HEAD SHA comes from `git ls-remote` (the refs adapter already runs `ls-remote` at `adapters/refs/refs-remote-git.ts:47,56`). |
| 3 | A checks source for the merge re-ask | Holds. `pr-state` gains `headRefOid` and the rollup (`plot-host.sh:3496`, which today asks `number,state,isDraft,url,mergeCommit` only). Jenkins answers `checks-unbound`. The fold of that rollup is not named (finding F). |
| 4 | Publish on change; IndexMonitor enum, worktree, heartbeat; retract `pr merged` | Holds in text. The retention reads a merge time that no row carries (finding A), and "marks itself seen" needs a channel operation that does not exist (finding D). |
| 5 | Restore a page push | Holds (slice 5, `/api/events`). |
| 6 | Reuse `checksVerdict`'s shape; use `StatusPanel.tsx` | The shape is reused. The new label text contradicts the rules that shape encodes (finding E). |
| 7 | Done-when per slice; fix citations | Done-when lines hold for all eight slices. One citation is still wrong (finding G). |

## 2. Code claims checked

- Holds: `CLAUDE.md:478` is the "Only a terminal answer is read from the index" paragraph. `rules/checks-reading.ts:130` is `checksVerdict` and returns `{state, prominence, shown, label, detail}`; `PlanCard.tsx:265` calls it. `board/src/server/findings.ts:3-15` states the file-read choice. `pr-refresh.ts:233` (`PR_PENDING_REASK_LIMIT = 5`), `:1066`/`:1094` (row mapping), `:1238` (fold), `:1478` (one rich listing for all pending PRs). `plot-host.sh:3812` is `pr-merge`, `:4396` is `run-for-sha`, `:4573` takes `.[0]`, `:4105` is the Jenkins arm and `:4136` the rollup arm. `build-jenkins.ts:29-59` has `runForSha` through Jenkins' REST API. `queue.ts:333` is `QUEUE_HOLDS`. `App.tsx:30-31` is 30 s and 4 s. `entry/approve.ts:554` calls `pr-merge`. `decision.ts:153-159` is `PrMergeWrite`. `process-log.ts:38` has `LOG_MAX_BYTES`.
- Does not hold: `ports/desk.ts:215-235` holds `publishFinding` (`:226`) and its doc, a write. The port has no read operation (methods at `:65-245` are all writes). The board reads the files with `readFileSync` in `board/src/server/findings.ts:67` and `:119`, not through the port. Slice 4 says "through the desk port, the same read the board makes"; both halves are false.
- Does not hold: `PrIndexRowSchema` (`entities/pr-index.ts:30-62`) has no merge time. Its fields are `number, head, state, draft, checks, review, url, mergeable, failing_checks, author, updatedAt`.
- Does not hold: `plot-host.sh:4182` is the plain (non-rich) arm (`else` at `:4167`), which also carries `--rich-open`'s terminal rows. It is not a no-CI arm.
- Note: `refreshRuns` (`board/src/server/fleet.ts:1385`) runs in the board process (`:1705`, `:1726`), not in fleetd. Slice 2 can copy its slot rule but not call it; LOW.

## 3. Findings

### A. Slice 3 retains `pr merged` by a merge time that no row carries — HIGH

Slice 3 publishes `pr merged` "for each slice PR merged in the last 24 h (from the rows' merge time)" and clears the slot "24 h after the merge". `PrIndexRowSchema` has no `mergedAt`, `pr-list` requests none (`plot-host.sh:4105`, `:4136`, `:4182`), slice 1 adds only `headSha`, `headSince` and `checksSha`, and the shell table has no row for it. An implementer either uses `updatedAt`, which moves on any later activity on the PR and is absent where the host does not answer it, or widens slice 1's schema and shell change outside its stated scope. The first is wrong code; the second breaks the slice boundary and the `check-shell-lines.sh` budget the plan states per slice. The plan contradicts itself between slice 1's field list and slice 3's rule.

Amendment: slice 1 adds `mergedAt` (host's clock, absent when unanswered) to `PrIndexRowSchema` and to the `pr-list` fields on the arms that return merged rows, and the shell table names it. Slice 3 reads that field and treats a merged row without `mergedAt` as outside the 24 h window.

### B. The relay reads through a port operation that does not exist — MEDIUM

See section 2. Fleetd lives in `packages/fleet`; reading desk files with `readFileSync` there, or importing `board/src/server/findings.ts`, puts a file read outside an adapter (The Layering Rule) or makes the fleet depend on the board. Amendment: slice 4 adds a read operation to the desk port (for example `readFindings(worktree)`) and moves `findingsInLog`'s parse into its adapter, so the board and fleetd use one reader.

### C. The relay never retracts a desk that goes away, so the channel becomes a second source — MEDIUM

The channel holds current state per `monitor + branch` (`channel-socket.ts:149-150`, `absorb`). Slice 4 publishes a desk's newest finding when it changes, and says nothing about a desk that is reaped or removed. Its last `owes an answer` stays in the channel until fleetd restarts. The board's rows stop showing it (the file is gone), while slice 6's feed pane and slice 7's toasts keep showing it. That contradicts the Approach (line 47): "the channel adds timing, not a second source". Amendment: when a desk the relay published for is no longer listed, the relay publishes `clear` for each of its slots; slice 4's done-when adds a test for it.

### D. The heartbeat misreports relayed monitors, and the IndexMonitor's "seen" has no operation — MEDIUM

`channel-socket.ts:151` sets `lastSeen` from `finding.measuredAt` on each publish, keyed by monitor name only. Relayed findings carry the desk monitor's own `measuredAt`, are published only on change, and on a restart are old. So the heartbeat (`:174-181`, "how a dead monitor is visible") shows a healthy AgentMonitor as silent for hours, or as seen at an old time, and folds every desk's monitor into one entry. Separately, `RunningChannel` has no way to mark a monitor seen without a publish, which slice 3 requires. Amendment: slice 3 names the new channel operation that records a monitor as seen; slice 4 states what the heartbeat says for relayed monitors (exclude them, or mark them as relayed by fleetd with the relay's own time).

### E. The badge text contradicts the rules `checksVerdict` encodes — MEDIUM

`checksShown` returns false for green (`checks-reading.ts:113`: "silent when the news is good"), so `checks green @a048b6f` never renders. Slice 6 also sets the text to `checks not bound to a commit` wherever `checksSha` is absent, which is every Jenkins row, every plain or terminal row, and every `unknown` row. Used as the label, that replaces `checks failing`, `no checks` and `checks not asked`, and merges states that the same file calls "the whole defect" when they render alike (`:105-108`). Amendment: the label stays per state; the commit, or the fact that the checks are not bound, goes into `detail`; and the plan states whether green stays silent.

### F. The merge's rollup fold is a second implementation the plan does not declare — MEDIUM

Today `pr-list`'s jq folds `statusCheckRollup` into the `checks` word (`plot-host.sh` near `:4160-4165`). Slice 8 has `pr-state` return the raw rollup and says shell changes "decide nothing", so a domain rule must fold it. That is the same rule in two languages, which *A Shell Script Asks The Domain* allows only when declared and held by a corpus test. Amendment: slice 8 names the domain fold, declares it as the duplicate of `pr-list`'s jq, and adds the corpus pair under `packages/domain/corpus/`; or `pr-state` emits the folded word through the same jq function as `pr-list`.

### G. The plan-approval merge passes a head that the Bitbucket arm cannot use — MEDIUM

Slice 8 makes `PrMergeWrite` carry `sha` and says "the plan-approval merge passes its head too". `approve.ts:256` writes `pr-merge` on both hosts. `pr-merge`'s Bitbucket arm (`plot-host.sh:3829-3833`) has no flag to pass. The plan says the merge controller answers `unaskable` on Bitbucket, but not what `pr-merge --match-head` does there for approval. If the arm refuses, plan approval on Bitbucket breaks when slice 8 merges; if it ignores the flag, the pin is silent. Amendment: state the Bitbucket arm's behaviour, and that approval on Bitbucket merges unpinned and says so in its step output.

### H. Smaller contradictions — LOW

- `:4182` is the plain arm, not a no-CI arm. A repository with no CI goes through the rollup arm (`:4136`) with an empty rollup, where the plan's own rule gives `checksSha = headSha`. The arm list contradicts itself.
- CLAUDE.md, *A Decision Reads The Index*, part 3 reads "Not built. No subscription exists." (`CLAUDE.md:470`). After slice 3 that row is false; the plan amends only `:478`.
- The BuildMonitor already publishes `build passed` and `build failed` per desk branch (`entities/finding.ts`, `MEASURED_BY`). The IndexMonitor adds `checks green` and `checks failing` on the same branches. The plan does not say how the two relate or which a subscriber waits for.
- `DefaultBranchReading` stores the folded `combined state` but only the failing runs, so the stored answers cannot re-derive the state (*Answers, never verdicts*). Store each run's status and conclusion, and fold on read.
- With `main` moving about 106 times a day, a new HEAD reads `pending` and lifts a `red` hold until its runs finish. State whether that is intended.

## 4. Buildability, cost and cadence

Each slice has a done-when line that names a test. Slices 1, 2, 5 and 7 are buildable from the plan and a brief. Slice 3 is not (finding A), and slice 4 needs a port operation the plan does not name (finding B). The cost table is plausible: slice 1's 12 listings per hour against 60, and slice 2's about 17 REST requests per hour against 5000, are per listing and match `pr-refresh.ts:1478`. Each slice can merge alone and leave `main` working, except slice 8 on Bitbucket approval (finding G).

## 5. The most important change

Give `pr merged` a real merge time: slice 1 adds `mergedAt` to the row and to `pr-list`, and slice 3 reads it (finding A). Then add the desk-port read and the desk-gone retraction to slice 4 (findings B and C).
