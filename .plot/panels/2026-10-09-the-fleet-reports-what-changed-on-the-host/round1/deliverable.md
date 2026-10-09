# Juror: deliverable

Position: amend

Lens: each slice is read as the brief an implementer gets. The question per slice is: what does done look like, which test proves it, and what must the implementer guess.

## Rubric answers

### 1. Do the cited claims hold?

Mostly yes. I read each cited line.

- `packages/domain/src/entities/pr-index.ts:30-62`: `PrIndexRowSchema` holds `head: z.string()` (the branch name, :35) and no SHA. `PR_INDEX_VERSION = 3` is at :12. The `:31` citation points at `.object({`; the name is on :30. LOW.
- `packages/domain/src/ports/build.ts:103`: `runForSha(branch, sha, limit)` is there. Holds.
- `skills/plot/scripts/plot-host.sh:4105`, `:4136`, `:4182`: three `gh pr list --json` calls, none asks `headRefOid`. `:3754` (`pr-merged-heads`) asks it. Holds.
- `packages/board/src/app/App.tsx:30-31`: `POLL_MS = 30_000`, `FLEET_POLL_MS = 4_000`. Holds.
- `packages/domain/src/workflows/approve.ts:256`: pushes `{ kind: 'pr-merge', pr, deleteBranch: true }`. Holds.
- `build-shell.ts:161`: the file is at `packages/domain/src/adapters/build/build-shell.ts`; `runForSha` calls `run-for-sha` at :160-162. Holds, with a path the plan does not give.
- Open Question for slice 2 is false. It says "`runForSha` answers for `github-actions`" and a Jenkins repository "must be `unknown`". `packages/domain/src/adapters/build/build-jenkins.ts:29-34,58` implements `runForSha` through the Jenkins REST API (`lastBuiltRevision.SHA1`, "since 2026-09-11"), and `build-resolve.ts:37-42` selects it for `CI: jenkins`. See finding 3.

### 2. Does the estate already have it?

- SHA-bound check verdicts exist: `packages/domain/src/rules/checks-verdict.ts` has `checksFromRuns` (:209), `runWasNotAcquired` (:158) and `evidenceSha` (:65). `worker-loop.ts:872-884` already asks `runForSha` and filters "a run is evidence only for its own sha". Slice 2 must reuse these and the plan does not name them.
- Hold counts exist: `QUEUE_HOLDS` (`packages/domain/src/rules/queue.ts:333`) and `holdCounts` printed by `registryd.ts:514-515`. "The hold has its own key in the tick's counts" means a new `QUEUE_HOLDS` member; the plan does not say so.
- A size-bounded log writer exists: `packages/fleet/src/shared/process-log.ts` ("a log the writing process owns, rotated by size", 10 MB default). Slice 3's "size ceiling, as `fleetd.log` has" is this module; the plan does not name it.
- A change-only NDJSON feed read by the board exists: `packages/board/src/server/findings.ts:1-25` reads `.plot-worker.monitor.*.jsonl`, "one NDJSON line per change". It is prior art for slices 3 and 4.
- A per-PR checks badge exists: `packages/board/src/app/components/PlanCard.tsx:265` renders `checksVerdict({ checks, mergeable })` from the domain. Slice 5's "row badge" is an extension of this site, not a new one.
- No SSE route exists (no `text/event-stream` or `EventSource` in `packages/*/src`). No default-branch CI reading exists (no match for `defaultBranch(Red|Ci|Checks|State)`). No merge controller exists. These three are new.

### 3. Does a slice contradict a settled rule?

- One writer: kept. `foldPrIndex` has one caller, `packages/fleet/src/shared/pr-refresh.ts:1238`. Slice 3 hooks in there and adds no writer.
- The index never says no: kept. `defaultBranchRed` `unknown` holds nothing, and a v3 store fails `z.literal(PR_INDEX_VERSION)` (`pr-index.ts:87`) and reads as "ask the host".
- Only a terminal answer is read from the index: **slice 6 breaks it as written.** CLAUDE.md, *A Decision Reads The Index*: "`OPEN`, `CLOSED` and draft rows are stale in either direction and the rows record no SHA to revalidate against". `headSha` supplies the SHA, but the plan never revalidates it at the host. See finding 1.
- Layering and controllers: kept for slices 1 to 5. Slice 6 is the right direction (a controller instead of `merge-on-green.sh`).
- Project-agnostic: slice 7 is Claude Code only and optional. It does not break principle 5 while the fleet does not depend on it.

### 4. Order and merge independence

The order is linear and correct. Slices 1 and 2 both edit `pr-index.ts` and the store version, so they cannot run in parallel. 4 needs 3. 5 needs 1, 2 and 3. 6 needs 1 and 2. 7 needs 3. Each slice can merge alone and leave main working, because each consumer falls back (30 s poll, `unknown`, v3 → host). One gap: slice 2 adds a `defaultBranch` field to a store whose version is a literal; the plan does not say whether slice 2 bumps `PR_INDEX_VERSION` to 5 or adds an optional field under v4. The implementer must guess.

### 5. Most important change

Slice 6 must pin the merge to the SHA at the host. Today it cannot, and the plan says it needs no shell change. See finding 1.

## Findings

### 1. HIGH: slice 6 cannot merge "the commit that was green" with the existing verb

Evidence: `plot-host.sh:3812-3833` (`pr-merge`) accepts only `--squash` and `--delete-branch` and runs `gh pr merge <num>`. `PrMergeWrite` (`packages/domain/src/workflows/decision.ts:153-159`) carries `pr` and `deleteBranch`, no SHA. The controller reads `headSha` from an index that is up to one fleetd tick old. A push between that read and the merge merges an unchecked head. That is the #1444 failure the Motivation table names, and Changelog line 14 promises the opposite.

The plan also says "No other slice touches shell" and "slice 6 writes through the existing `pr-merge` verb". Both must change.

Amendment:
- `PrMergeWrite` gains `headSha`. `plot-host.sh pr-merge` gains `--match-head-commit <sha>` on the GitHub arm (a `gh pr merge` flag). The Bitbucket arm refuses with a named reason, or the slice states what Bitbucket gets.
- State the shell-line cost of this change and where the removal comes from.
- Done when: a unit test on the merge workflow shows each refusal (`head-moved`, `checks-not-green-for-sha`, `draft`, `default-branch-red`, `checks-unbound`) with its reading; a contract test on `plot-host.sh pr-merge` shows the SHA reaches `gh` as `--match-head-commit`.

### 2. HIGH: slice 1's "check state is recorded for that SHA" is false on the Jenkins arm

Evidence: `plot-host.sh:4096-4131`. With `CI: jenkins`, `checks` comes from Jenkins "joined on branch name" (`$jmap[.headRefName]`), not on the head commit. The latest Jenkins build of a branch can be for an older commit. On the rollup arm (`:4136`) `statusCheckRollup` and `headRefOid` come from one GraphQL response, so they agree. The plain arm (`:4182`) carries no checks. Bitbucket carries `checks: "unknown"` unless Jenkins fills it.

So a row with `headSha` and `checks: green` means "green for this SHA" on one arm and "the branch's last build was green" on another. Slice 6 then merges on the second meaning.

Amendment: slice 1 states per arm (GitHub rollup, GitHub + Jenkins, plain, Bitbucket, Bitbucket + Jenkins) whether `checks` is bound to `headSha`. Where it is not, the row records that fact (for example an absent `checksSha`, by the `author` rule), and slice 6 refuses with `checks-unbound`. Done when: a fixture per arm proves the row the store gets.

### 3. MEDIUM: slice 2's Jenkins question has a wrong premise, and the slice names none of the parts it reuses

Evidence: `build-jenkins.ts:29-34,58` and `build-resolve.ts:37-42` (see rubric 1). `checksFromRuns` and `runWasNotAcquired` (`checks-verdict.ts:158,209`) already turn a `ShaRun` into a verdict. `QUEUE_HOLDS` (`queue.ts:333`) is where the new hold goes.

Amendment: rewrite the Open Question: Jenkins answers `runForSha`; only a CI with no build port answers `unaskable`, which reads `unknown`. Name `checksFromRuns` as the input to `defaultBranchRed`, or say why not. Name the new `QUEUE_HOLDS` member. Say where the HEAD SHA comes from (`RefsPort.defaultBranch()` and `resolve()` at `ports/refs.ts:133,161`) and how fresh it is (does fleetd fetch first?). Say whether the store version moves to 5. Done when: unit tests for `defaultBranchRed` over `red | green | pending | unknown`, and a queue test that a red reading holds a slice under the new key while `unknown` holds nothing.

### 4. MEDIUM: slice 3 has no rule for the first fold and for a full read

Evidence: `indexTransitions(before, after)` with `before = null` (cold store, a v3 store after slice 1, a v4 store after slice 2 if it bumps) compares against nothing. Read literally, it emits `pr-opened` for every PR the host holds. The store holds hundreds of rows (`plot-host.sh:4175` measures 937 PRs). A full read (`wholeAt`) also replaces rows a delta keeps.

Amendment: state the answer for `before = null` and for a version mismatch (no events, or one `baseline` line). Name the call site (`pr-refresh.ts:1238`, where `previous` and `folded` both exist). Name `process-log.ts` as the size bound. Done when: unit tests for each kind, for `null` before, for an unchanged fold (zero events), and for a row a delta did not return (no `closed` event).

### 5. MEDIUM: slice 7 toasts on an event slice 3 never writes

Evidence: slice 7 shows a toast on "a new `PLOT-BLOCKED`". Slice 3's kinds are `pr-opened`, `pr-ready`, `checks-changed`, `merged`, `closed`, `head-moved`, `default-branch-changed`. `PLOT-BLOCKED` is a desk fact the monitors write to `.plot-worker.monitor.*.jsonl` (`findings.ts:1-25`). Slice 7 reads only `fleet-events.jsonl`.

Amendment: drop the `PLOT-BLOCKED` toast from slice 7, or add a kind and its producer to slice 3. Also resolve Open Question 2 (plugin placement) before the brief; it decides the done condition "does not load in a fleet agent's session" and which test proves it.

### 6. MEDIUM: slice 5 does not say what "named render sites" is as an artifact

Evidence: the row badge already exists (`PlanCard.tsx:265`, `checksVerdict` from the domain). "A fixed set of named places" can mean a component per site, a registry type, or a layout slot. The slice names no domain property for the badge's `@sha` text or for the feed pane's "last N events" (what N, from which reader).

Amendment: say the row badge extends `PlanCard.tsx:265`. Name each domain property (for example `defaultBranchBanner(entry)`, `checksAtSha(row)`, `recentEvents(lines, n)`). Name the three browser tests. Drop "named render sites" as a mechanism unless the slice defines it as a type with a test.

### 7. MEDIUM: slice 4's done condition depends on an open question

Evidence: Open Question 3 (reconnect: re-fetch or replay from an offset) decides the route's contract. `process-log.ts` rotates by size, so a byte offset breaks after a rotation.

Amendment: answer it in the plan: the page fetches `/api/board` on every `open` of the event source, and the route sends only lines appended after the connection opened. Then the 30 s poll and the reconnect fetch together cover a rotation. Done when: a server test appends a line to a fixture file and reads one SSE message; a second test rotates the file and the route keeps sending. Name `findings.ts` as the existing file-read pattern.

### 8. LOW: slice 1 omits the TypeScript half and states the shell gate loosely

Evidence: the row mapping is `pr-refresh.ts:1066` (host answer to row) and `:1094` (row to answer); `updatedAt` passes through both and `headSha` must too. The slice line omits Bitbucket (`source.commit.hash`, already read at `plot-host.sh:3771`), which the Approach includes. `scripts/check-shell-lines.sh` counts net non-comment lines; adding `headRefOid` to an existing `--json` list adds zero lines, so "an equal shell-line removal" can be zero.

Amendment: list `pr-refresh.ts` in the slice. Put Bitbucket in the slice line. Write the shell condition as "`./scripts/check-shell-lines.sh pr` exits 0". Done when: a store round-trip test shows `headSha` present where the host gave it and absent (not `''`) where it did not.

## Summary

The design follows the settled rules for slices 1 to 5. Two slices promise a SHA guarantee the code cannot give: the Jenkins arm binds checks to a branch name (finding 2), and `pr-merge` merges whatever head the host holds (finding 1). Slices 2 to 7 need named reuse targets, an answer for the first fold, and a test per done condition before a brief can be written without guessing.
