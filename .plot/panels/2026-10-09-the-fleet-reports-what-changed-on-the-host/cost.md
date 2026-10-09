# Juror: cost

Position: amend

Lens: what each slice adds to host calls, rate-limit budget, tick time, file growth and agent tokens, and whether the plan measures or bounds it.

## Summary

The citations hold, and slice 1 is cheap. The plan prices none of the new readings. The estate keeps a per-refresh cost table (`PR_REQUESTS_PER_REFRESH`, `packages/fleet/src/shared/pr-refresh.ts:174`) and stretches its cadence from it, and the plan adds a default-branch CI reading and an event feed without a row in that table, a cadence, or a burst bound. Two existing cost bounds also decide what the new events can say, and the plan does not name them.

## Rubric

**1. Citations.** All checked claims hold. `PrIndexRowSchema` is at `packages/domain/src/entities/pr-index.ts:30-62` with `head` as the branch name and no SHA; `PR_INDEX_VERSION = 3` at `:12`. `BuildPort.runForSha` is at `packages/domain/src/ports/build.ts:103`. `POLL_MS = 30_000` and `FLEET_POLL_MS = 4_000` are at `packages/board/src/app/App.tsx:30-31`. `plot-host.sh:4105`, `:4136` and `:4182` ask `gh pr list --json` without `headRefOid`; `:3754` (`pr-merged-heads`) asks for it. `approve.ts:256` pushes `{ kind: 'pr-merge' }`. `build-shell.ts:159-161` calls `run-for-sha`.

**2. Existing estate.** No SSE route and no event log exist (no `event-stream`, `EventSource` or `/api/events` in `packages/`). A size-rotated log exists: `packages/fleet/src/shared/process-log.ts:37-41` (10 MB, 3 generations); slice 3 should reuse it rather than build a second ceiling. A sha-pinned CI reader already exists per agent: `packages/fleet/src/server/entry/worker-loop.ts:874` calls `ports.build.runForSha(branch, pushedSha)` on each pass of each agent in the CI wait. The plan does not mention it.

**3. Settled rules.** One writer (fleetd) and no-host listeners hold. No contradiction found with the index, controller or layering rules. Slice 1's shell change edits existing `--json` field lists, so the shell-line ratchet costs little.

**4. Order.** Slices 1-5 can merge alone. Slice 3 needs a baseline rule (finding 2) before slices 4 and 7 consume its file, or the first fold after the v4 bump floods every listener.

**5. Most important change.** Give slice 2 a cost row and a correct reading: name the cadence of the default-branch read, add its requests to the cost model, and read the aggregate check state of the default-branch SHA instead of `run-for-sha`'s newest single run (finding 1).

## Findings

### 1. HIGH: slice 2's reading is unpriced, and `run-for-sha` answers for one workflow

- The plan names no cadence for the default-branch read. Read on every fleetd tick (`TICK_INTERVAL_MS = 60_000`, `packages/fleet/src/server/entry/registryd.ts:76`), it is 60 more `gh run list` requests per hour, equal to the whole GitHub PR budget the cadence is tuned to (`pr-refresh.ts:145-148`, "60 requests / hour"). A concluded failure adds one `gh run view` call (`plot-host.sh` run-for-sha arm, "ONE MORE CALL, ONLY FOR A CONCLUDED FAILURE (#1295)").
- `main` moves often. `git log origin/main` shows a `plot-build[bot]` "build the board artifact" commit after each merge (`dbd6b3e6e`, `ccbb55eb4`, `a0131d5bc`, `9548d1ce6`), plus direct delivery and record commits. Each move starts a new pending window, and CI jobs here carry `timeout-minutes` of 10-25 (`.github/workflows/ci.yml:108,194`). So the pending case is the common case, and the plan does not say how often a pending default branch is re-read.
- `run-for-sha` takes the newest run for the SHA across all workflows ("a sha can carry several (a rerun, or several workflows). The newest is the live answer", `plot-host.sh`, github-actions arm). Three workflows run on a push to `main`: `ci.yml`, `build-bundles.yml`, `release.yml`. The newest run can be `release` or `build-bundles` while `ci` is red, so `defaultBranchRed` can answer `green` for the exact case in the Motivation's first row. The plan pays for a call whose answer is not the one it needs.
- Amendment: slice 2 states (a) its read cadence and its re-read rule while `pending`, (b) its requests per refresh, added to the cost model beside `PR_REQUESTS_PER_REFRESH` so `prRefreshMsFor` stretches for it, and (c) a reading that aggregates the checks of the default-branch SHA (all runs for the SHA, or the required checks), not the newest single run. It reads only on a change of the default-branch HEAD SHA or while the stored answer is `pending`, and stops re-reading a terminal answer for an unchanged SHA.

### 2. HIGH: the first fold after the v4 bump, and each daily full read, emit an event burst that listeners pay for

- Slice 1 makes every v3 store unreadable ("a v3 store reads as ask the host"). `indexTransitions(before, after)` with no readable `before` can emit `pr-opened` for every row. The store holds about 937 PRs on this estate (`plot-host.sh:4170-4172`, "over 937 PRs"). The board re-fetches `/api/board` per event (slice 4), and the mod shows toasts and starts a turn per named event kind (slice 7). A turn costs agent tokens.
- The daily full read (`PR_FULL_READ_MS = 24h`, `pr-refresh.ts:297`) replaces the store and can surface many rows the deltas missed, with the same effect.
- Amendment: slice 3 states that a missing, unparseable or other-version `before` emits no events (it sets a baseline), and the unit tests prove it. Slice 4 coalesces events into one `/api/board` fetch per burst. Slice 7 bounds turn starts (for example one turn per N seconds, with the events batched), and the plan names that bound.

### 3. HIGH: `checks-changed` inherits the pending re-ask bound, so the merge controller can wait up to 24 h

- A completed check does not change `updatedAt`, so a delta misses it (`pr-refresh.ts:1460-1463`, "#1277"). The re-ask covers it only for `PR_PENDING_REASK_LIMIT = 5` consecutive no-progress answers, about five minutes at the GitHub cadence (`pr-refresh.ts:223-233`). After that the PR "falls back to being caught by the next full read", up to 24 h.
- This repository's CI runs longer than five minutes (finding 1). So for a typical PR the `checks-changed` event to `green`, the row badge `green@sha` and the merge controller's "checks are green for that SHA" arrive at the next full read, not when CI ends. The plan's promise "the board refreshes when an event arrives" does not hold for the event that matters most, unless the fleet spends more re-asks.
- Amendment: the plan names this bound and decides it. Options: re-ask a pending PR when its run for `headSha` concludes (one `run-for-sha` call, which slice 2 needs anyway), or reset the streak per `headSha`. The decision changes the hourly request count, so it goes into the cost model with a number.

### 4. MEDIUM: the index gains a sha-pinned check reading, and the per-agent reader stays

- `worker-loop.ts:874` asks `runForSha` for each agent in the CI wait on each pass (`PASS_INTERVAL_MS = 60_000`, `worker-loop.ts:114`). With N agents waiting, that is N calls per minute outside the fleet's PR cadence. After slice 1 the index holds `checks` for `headSha`, which answers the same question.
- The plan says "the fleet stays the one reader" but leaves this second reader. This is not a defect of the plan; it is a saving the plan makes possible and does not record.
- Amendment: name it in Notes as a follow-up (the worker reads the index for its pushed SHA, and falls back to the host on a miss, by "the index never says no"), or state why it stays.

### 5. MEDIUM: on the Jenkins arm the check state does not belong to `headSha`

- `plot-host.sh:4105` is the Jenkins-joined arm: `checks` comes from the Jenkins job colour, which is the last build, not the build of the PR's head. Adding `headRefOid` there pairs a SHA with a colour from another commit, and "the check state is recorded for that SHA" becomes false. The merge controller then merges on a stale green.
- Amendment: on the Jenkins arm, slice 1 records `headSha` but the check state for that SHA is `unknown` unless the build's SHA matches (the run-for-sha Jenkins arm reads `lastBuiltRevision.SHA1` and can supply it, at one more call per PR, which must be priced).

### 6. LOW: event-file growth and the tail cost are small and partly specified

- Event volume is a few lines per PR state change; a 10 MB ceiling holds weeks. Reuse `process-log.ts` rotation and name it in slice 3. The board server should tail by byte offset on a change, not re-read the file; the plan's Open Question on replay after rotation covers the correctness part.
- The SSE route and the mod make zero host calls by design. That holds and costs nothing in budget.

### 7. LOW: slice 1's host cost is negligible

- `headRefOid` is a scalar column on the PR node. The host's own measurement says scalar columns are cheap and `statusCheckRollup` is the expensive field (`plot-host.sh:4168-4172`). Adding it changes neither request count nor cadence. No amendment.
