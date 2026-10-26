# One PR reader for the boards of one repository

> Every board lists PRs from the host on its own 60 s interval. Several boards for one repository on one machine therefore ask the host the same question several times. This plan gives those boards one reader process that writes the PR index, and the boards read the index.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2401 merged
- **Started:** 2026-10-23, Jan Wloka, `feature/one-pr-reader-per-machine-and`
- **Started:** 2026-10-26, Jan Wloka, `feature/pr-reader-lock-elects-one-writer`
- **Started:** 2026-10-26, Jan Wloka, `feature/pr-index-lock-beside-the-index`
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2386
- **Rounds:** 2
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- While no fleet runs, the boards for one repository on one machine share one PR reader process. The reader lists the repository's PRs and writes the PR index, and each board reads the index, so a second board for that repository adds no PR list request. Each board still reads CI runs and its own issues from the host. Boards for two repositories still use two readers.
- A backoff the host names for the PR list now survives a restart of fleetd or of the reader: the next process sends no PR request before the backoff ends.

<!-- Board impact: the board's PR read path changes. The board reads the PR index while the index lock names a live holder (fleetd or the reader), writes a heartbeat beside the lock on every PR tick, starts the reader through the Detached port when no holder lives and no fleetd runs, and shows who reads PRs. The board's issue read does not change. The board writes no index. No plan format, template, helper script or docs/plans layout change. -->

## Motivation

Measured 2026-10-26 on the operator's machine (`~/.plot/state/budget.tsv` and its previous generation):

- The record holds 20,201 requests in 24 h: 16,456 on `github jwloka graphql` and 2,235 on `github jwloka core`.
- No line names a caller, an operation or a repository. The record cannot say which process spent a request.
- With one board and one fleetd on one repository, the quiet hours 00–07 spent about 610 requests per hour.
- No two boards ran on one repository that day.

Issue #2386 reported *about 44 spenders*. That figure is `localSpenders` (`packages/domain/src/rules/refusal.ts:99`): the account's observed rate divided by one board's share. It is a rate quotient, not a count of processes. The two boards measured on 2026-10-23 served two repositories (ewz-kus-portal on :7778, websmith on :7777). This plan keeps one reader per repository, so that machine gets two readers in place of two board reads and gains nothing.

This plan serves one case: several boards for one repository on one machine, and sessions that read PRs through such a board. Today each extra board runs its own PR list (`maybeRefreshPrs`, `packages/board/src/server/fleet.ts:2328`). After this plan it runs none. No measured case of several boards on one repository exists. On 2026-10-26 the operator decided to build the plan without one.

Existing mechanisms stop short of this case:

- `fleetOwnsPrs` (`packages/board/src/server/fleet.ts:2254`) makes the board read the PR store through `readPrsFromStore` instead of the host. It applies only while a fleet supervisor runs.
- `plot-budget.sh` keeps one record per `(connector, account, bucket)` and counts spenders. It measures the spend; it does not schedule it.
- [One account has one budget](2026-09-01-one-account-has-one-budget.md) (Released) made the cadence stretch with the number of spenders. It does not remove the spenders.

## Design

### Approach

Four proposals came from the issue. This plan builds proposal 1, scoped to one reader per repository and connector on one machine. Proposals 2 (one request budget per account, spread across repositories with jitter), 3 (event-driven refresh on `git fetch` or board-open) and 4 (conditional requests with `If-None-Match`) stay unscheduled. The plan records no decision against them.

The PR index has one writer path. `refreshPrs` (`packages/fleet/src/shared/pr-refresh.ts:1360`) folds the host's answer through `writePrStore` (`pr-refresh.ts:1324`), the only caller of `foldPrIndex` (`pr-refresh.ts:1333`). Today only fleetd reaches it with the real store: `fleetPrs` (`packages/fleet/src/shared/fleet-clock.ts:166`) gets `store: prIndexFile({ cwd: repoRoot })` at `packages/fleet/src/server/entry/registryd-main.ts:2204`. Without a fleet, the board calls `refreshPrs` with an in-memory overlay (`fleet.ts:2340`), so every board asks the host on its own. After this plan two processes reach the writer path, fleetd and the reader, and the index lock lets one of them write at a time.

### Reader choice

The operator asked whether fleetd in a PR-only mode can replace a new reader entry. Compared on `origin/main`:

| Criterion | PR-only fleetd | Dedicated reader |
|---|---|---|
| One writer | fleetd has no exclusion of its own; one per repository holds because launchd keys a job by its label (`skills/plot/scripts/plot-fleetctl.sh:82-83`, `registryd-main.ts:158`). A board-started copy runs outside launchd and needs the index lock anyway. | Needs the index lock. |
| Lock races | The same lock, so the same races. | The same lock, so the same races. |
| launchd and supervisor | Under launchd, a board installs a unit, which only `plot-fleetctl.sh` does today, and `KeepAlive` keeps the job after the last board closes. Under the fleet label, the board's supervisor reading (`packages/board/src/server/supervisor-reading.ts:131`) reports a fleet that runs no scan. | No unit and no label. The process ends when no board for the key lives. |
| Shared entry | `run` binds the fleet channel at `.plot/fleet.sock` (`registryd-main.ts:1789`, `:2274`); a real fleetd that starts later runs without it (`:1813`). `run` also starts `fleetAutoWrites` (`:2312`) and the supervision tick (`:2318`). Each needs a flag, and one missed flag lets a PR reader dispatch or deliver. | Runs only `fleetPrs`. It has no channel, no tick and no automatic write to switch off. |
| Inbox (finding 3) | Can run `fleetIssues` (`:2195`) and keep `issues.json` fresh. | Runs no issue read. The board keeps its own issue read. |
| Test seams | `run` takes `seams.scan`, `seams.readPrs` and `seams.tick` (`:2293-2318`). | A small entry with a clock and a lock seam. |
| Lines and gates | Reuses the shipped `plot-fleetd.mjs`. | One new bundle: a `packages/board/build.mjs` copy, a `.gitattributes` line and a README row, each gated. |

The dedicated reader wins. Both designs need the index lock, so the PR-only mode saves no lock work. It adds a launchd or channel conflict, and it puts a PR reader in the entry that holds the automatic writes. The lock protocol stays complete. Two parts shrink: the key loses its account segment, and board heartbeats replace `--while-pid`.

### Index lock

The lock lives beside the file it guards: `<index dir>/<connector>.lock/`. The index dir is the directory `prIndexFile` resolves (`packages/domain/src/adapters/pr-index/pr-index-file.ts:79-92`): `<common git dir>/.plot/state/index`, or `PLOT_PR_INDEX_HOME` in tests. The connector segment comes from `connectorFile` (`pr-index-file.ts:32`). The lock adapter and `prIndexFile` resolve the directory through one shared function. One physical index file therefore has one lock directory, whatever path spelling reached it (`/tmp` or `/private/tmp`). The key is `(realpath(common git dir), connector)` and needs no encoding. It has no account segment: a `gh auth switch` or a `null` account cannot give two locks over one index file, and no tick calls `spend-rate` to build a key.

Ownership is decided by one `link`:

- The holder is the owner file with the highest generation, `owner.<n>`. A claim holds `pid`, `startedAt`, `at` and the holder kind (`fleetd` or `reader`). A process writes the claim to a unique scratch file and links it to its target name. `link` returns `EEXIST` to every taker but one.
- **Elect.** No owner file: link `owner.1`. A stale holder at `n`: link `owner.<n+1>`. A live holder that is this process: renew. A live holder that is another process: `held`.
- **Renew.** The holder writes a scratch claim and renames it onto its own `owner.<n>`. It never truncates a claim in place, so a reader never reads an empty claim.
- **Release.** The holder renames a `released` claim onto its own `owner.<n>`. A released claim is stale at once. No process unlinks an owner file on a decision path.
- **Prune.** After it elects, the holder removes `owner.<m>` for every `m < n - 1`. Pruning decides nothing.
- **Stale.** A claim is stale when its pid is dead, when the probe's start time differs from `startedAt` by `CONTINUE_LOCK_SKEW_MS` (3000 ms, `packages/domain/src/rules/continue-lock.ts:29`, compared as at `:35`) or more, or when its `at` is older than `READER_STALE_MS` (10 minutes). The age bound applies also when the process probe cannot answer. The skew bound is needed: a self-stamped start time has millisecond resolution and `ps -o lstart=` has one-second resolution (591 ms apart in the panel's run).
- An owner file that does not decode counts as a claim aged by its file time. It never reads as "no holder".
- **Fence.** The holder re-reads the highest generation immediately before `writePrStore` and skips the fold when it no longer holds. `PrWorld` gets a `holds` check for this. The fence narrows the window to the time between the read and the store's `rename`. A lost update in that window costs one pass of freshness, not a wrong decision, because the index never says no.

The reader and fleetd call `elect` on every PR beat (60 s, `fleet-clock.ts:30`) **before** the cadence gate (`fleet-clock.ts:171`) and before the host request. A holder therefore renews during a host-named backoff longer than `READER_STALE_MS`.

### Reader state

`prError` and the persisted host backoff live in one reader state file beside the index: `<index dir>/<connector>.reader.json`. It holds `prError`, `prNextAt`, `prNextIsBackoff`, `prFullReadFailedAt` and `at`. These fields exist on the in-memory `PrState` (`pr-refresh.ts:50`, `:62`, `:72`, `:74`), and `freshPrState` (`pr-refresh.ts:86`) resets them today.

- The holder writes the file through scratch and `rename`, after its fence check, at the end of each pass.
- Every new holder (the reader and fleetd) adopts the file into its fresh `PrState` before its first host request.
- Every board overlay fallback reads it before its first host request, and holds its own gate until `prNextAt` when `prNextIsBackoff` is set.
- `readPrsFromStore` reads `prError` and the backoff from this file, in place of the fleet bridge (`fleet.ts:2280`) and the forced `prNextIsBackoff = false` (`fleet.ts:2284`). The board's backoff banner therefore shows the holder's backoff.
- The claim stays small: it carries no error and no backoff.

The file holds what the host answered (a named delay, a failure sentence and a failure time), not a lifecycle verdict, and `prNextAt` ends its own effect.

#2419 (`2026-10-23-read-merged-prs-from-the-merge.md`, Approved) adds a back-off after a partial full read through `prFullReadFailedAt` (`pr-refresh.ts:62`, set at `:1811`). That field is in memory, so today every holder change resets it and a Bitbucket full read repeats at once. The reader state file carries the field, so a new holder honours #2419's back-off. #2419 adds no index writer, and its row *"Pairing with #2386's single reader: not needed"* stays true.

### Reader lifetime

The reader lives while any live board for its key lives. Each board writes a heartbeat `<lock dir>/board.<pid>` with its pid and start time on every PR tick, through scratch and `rename`. The board writes the heartbeat whether it follows the index, starts a reader or uses its overlay. On every beat, the reader counts the live heartbeats. A heartbeat is live when its pid is alive, its start time matches within `CONTINUE_LOCK_SKEW_MS`, and its file time is younger than two PR ticks (120 s). With no live heartbeat, the reader releases the lock and exits. The reader removes the heartbeats of dead boards, and a board removes its own on a clean exit.

Reasons for this mechanism:

- The board already runs a PR tick every 60 s, so a heartbeat costs one `rename` per board per minute.
- Pid and start time together defeat pid reuse, and the file-time bound catches a hung board.
- No single pid ties the reader to one board. When the board that started the reader exits, the reader serves the other boards with no hand-over, no overlay tick and no lost `PrState`.

The probe reads start times through `ps`. The reader reads all heartbeat pids in one `ps -o pid=,lstart= -p <pids>` call per beat. Each board probes the holder once per PR tick.

### fleetd and the lock

- fleetd elects on every PR beat before its cadence gate, fences before `writePrStore`, and writes the reader state file and a heartbeat `<lock dir>/fleetd` (pid and start time) on every beat.
- On `held`, fleetd skips the pass. The reader sees the live `fleetd` heartbeat at its next beat, releases and exits, and fleetd elects on the beat after.
- On `failed` (the lock directory cannot be written), fleetd skips the pass and warns once per cause. The lock directory sits beside the index, so a `failed` lock means `writePrStore` would fail too, and skipping loses no write.
- A hung fleetd stops renewing. After `READER_STALE_MS` a board starts a reader, which takes the lock. If fleetd wakes, its fence refuses the fold.

One predicate answers "fleetd reads PRs": a live `fleetd` heartbeat. The reader's exit test and the board's spawn guard both use it. The board never starts a reader while it holds. Because the heartbeat dies with the fleetd pid, the 180 s window in which a fresh bridge outlives a stopped fleetd (`OWNED_BRIDGE_MAX_AGE_MS`, `packages/domain/src/rules/scan-owner.ts:10`) starts no reader churn.

### Board behaviour

- **PRs and issues have two predicates.** The board reads PRs from the store when the lock names a live holder of either kind. The issue read keeps `fleetOwnsScan` (`scan-owner.ts:37`) in `maybeRefreshPrs` (`fleet.ts:2334`, `:2350`) and in `issueCadence` (`fleet.ts:1742`). While only a reader runs, the board reads issues from the host as it does today.
- **The board never elects.** It reads the lock through `holder()` and the pure rule `electReader`. With the verdict `elect` and no live `fleetd` heartbeat, it starts the reader and serves that tick from its overlay. With `unknown`, it serves the overlay and starts nothing.
- **The board starts the reader** through the `Detached` port (`packages/domain/src/ports/detached.ts`): `plot-pr-reader.mjs --lock-dir <abs> --connector <name>`. The reader uses exactly the lock directory the board passed, so the two cannot compute two keys. Its index is the `<connector>.json` beside that lock directory, through `prIndexFile({ home })` (`pr-index-file.ts:42`).
- **Log.** The reader writes to `<repoRoot>/.plot/logs/pr-reader.log` (`logDir`, `packages/fleet/src/shared/process-log.ts:224`). The `Detached` port truncates the log at each start. Each beat writes one line: elected, held or skipped, the gate, and the rows folded.
- **Who reads PRs.** The board shows the PR reader as `fleet`, `reader <pid>` or `this board`. A domain rule over the lock reading computes the value.
- **First pass.** The reader runs one pass at start, subject to the reader state file, so a board's first store read after a start is fresh.
- **Test seam.** `BuildBoardOptions` gets `detached?: Detached`, as `packages/board/src/server/needs-design.ts:18-19` and `:79` do. Board tests pass a recording fake. One test proves that a board test run starts no real reader. Reader tests wait on the reader's own pid before teardown, because `scripts/owned-run.sh` fails a run on a late entry.

`one-pr-index-writer.test.ts` and `one-issue-index-writer.test.ts` stay unchanged and green:

- `foldPrIndex` stays in the domain and the fleet package (`packages/fleet/test/unit/one-pr-index-writer.test.ts:78`).
- No board source writes through `prIndexFile` or `prStoreFor` or hands one to `refreshPrs` (`one-pr-index-writer.test.ts:87`). The board writes heartbeats through the lock adapter and hands the reader a path, not a store.
- Only `registryd-main.ts` hands the real issue store to an issue world (`one-issue-index-writer.test.ts:119`). The reader passes `issueGate: issueGateOf(issueIndexFile(...))` (`packages/fleet/src/shared/issue-refresh.ts:676`) and binds no `issueStore` name.

### Reader entry

`packages/fleet/src/server/entry/pr-reader.ts`, bundled as `plot-pr-reader.mjs`. It builds the `PrWorld` that `registryd-main.ts:2200-2208` builds and runs `fleetPrs` with the lock and the fence. `startFleetClock` requires a `scan` (`fleet-clock.ts:39`), so the reader drives `startPulse` (`packages/domain/src/entities/pulse.ts:271`) with one PR subscriber at `PR_REFRESH_MS`. It runs no scan, no supervision tick, no issue read and no automatic write.

Shipping work, each held by a gate:

- an entry in `packages/fleet/build.mjs`, and the "seven entries" text at `:1`, `:34` and `:38` updated
- a copy to `skills/plot/scripts/board/plot-pr-reader.mjs` in `packages/board/build.mjs` (pattern at `:330-343`)
- a `-merge` line in `.gitattributes` (`scripts/check-bundle-attributes.sh`)
- a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`)

The spawn ratchet does not grow, because the board starts the reader through the `Detached` adapter. `scripts/check-shell-lines.sh` is not affected, because the plan adds no shell.

### State inventory

The lock and the state file live under the index dir, which tests redirect through `PLOT_PR_INDEX_HOME`, so `scripts/check-state-inventory.mjs` sees them under the `pr-index` base. The lock slice adds one row per name, each with its bound: `*.lock/owner.*`, `*.lock/.*.tmp`, `*.lock/board.*`, `*.lock/fleetd`, `*.reader.json` and `*.reader.json.*.tmp`.

### Stale text

The slice that changes the behaviour updates the text that the behaviour makes false:

- fleetd lock slice: the `fleetPrs` doc (`fleet-clock.ts:161`), and the *One writer* paragraph of *A Decision Reads The Index* in `CLAUDE.md`, which then names the lock and the reader state file.
- Board reader slice: `fleetOwnsPrs`'s doc (`fleet.ts:2250-2252`), the wording at `fleet.ts:2271` and `:2277-2278`, the bridge comment at `registryd-main.ts:2307-2308`, and the same `CLAUDE.md` section, which then names the reader as the second process on the one writer path.
- Lock slice: the #2436 TSDoc in `reader-election.ts` and `reader-lock-file.ts`, trimmed to what each export does.

### Moot panel findings

- `account` in the key, `clean()` collisions and symlinked paths: moot, because the lock lives beside the index file.
- The `spend-rate` call per tick to build the key: moot, because the key has no account.
- `--while-pid` without a start time: moot, because heartbeats with pid and start time replace `--while-pid`.
- The 180 s of reader churn after fleetd stops: moot, because both sides read the `fleetd` heartbeat.
- The move-aside-and-restore takeover: moot, because generation files replace it.
- The PR-only fleetd's launchd and channel conflicts: moot, because the dedicated reader wins.

### Constraints

From `CLAUDE.md`:

- *A Decision Reads The Index*: the index keeps one writer path, and one process at a time takes it per index file. A follower never treats a missing row as `pr: none`.
- The layering rule: the domain owns the election rule (`reader-election.ts`), the heartbeat rule and the port (`reader-lock.ts`); the file lock is an adapter (`reader-lock-file.ts`). The board starts the reader through the `Detached` port.
- The cache is the existing PR index. The plan adds a lock directory and a state file beside it, and no cache.

### Open Questions

- [ ] Does Bitbucket return ETags for the PR listing? Open. It belongs to proposal 4, which this plan does not build.
- [x] Where does the reader publish its last PR error? Answered by the operator, 2026-10-26: in the reader state file beside the index, with the persisted backoff. Not on the claim.
- [x] Do the Claude sessions list PRs through a path this plan changes? Answered 2026-10-26: `budget.tsv` names no caller, so the record cannot attribute the session spend. This plan changes only the board path and the sessions that read through a board. The idle baseline is outside this plan (see Notes).
- [x] Should the reader outlive the board that started it? Answered by the operator, 2026-10-26: yes, while any live board for its key lives, through board heartbeats.
- [x] A PR-only fleetd or a dedicated reader? Answered 2026-10-26: the dedicated reader (see Reader choice).
- [x] How does a reader elect itself? Through `reader-election.ts`'s pure rule over generation owner files decided by one `link`, not through `mkdir` as a lock. An unreadable lock directory gives `unknown`, and the board then reads through its own overlay.
- [x] Does the cache replace the PR index store? No. The cache is the PR index store.
- [x] Does the design differ by connector? No. The key has no account segment, so neither connector needs `Host.account()`, which refuses on Bitbucket.

## Slices

### Shared reader

- `feature/one-pr-reader-per-machine-and` → #2436 — one locked reader per host account and repository, with a cache every other process reads <!-- deferred: 2026-10-25, PR #2436 closed unmerged at the operator's request. The shared reader writes the real PR index from the board, and one-pr-index-writer.test.ts refuses any board-side write to that index (commit a1355bfec). The branch keeps 4 commits of work. -->

### Index lock

- `feature/pr-index-lock-beside-the-index` — `reader-election.ts`, the `reader-lock.ts` port and the `reader-lock-file.ts` adapter (from #2436, TSDoc trimmed) over `<index dir>/<connector>.lock/`: generation owner files decided by one `link`, renewal and release through the same decision, start time compared within `CONTINUE_LOCK_SKEW_MS`, the age bound kept when liveness is unknown, the heartbeat rule, and the reader state file codec; state-inventory rows; observable: a multi-process race test in which 8 real `node` processes elect over one stale claim and exactly one wins, a renewing holder is never read as "no holder", and a superseded holder's release leaves the new claim; no caller yet

### fleetd lock

- `feature/fleetd-holds-the-pr-index-lock` — fleetd elects on every PR beat before the cadence gate, fences before `writePrStore`, writes the reader state file and its `fleetd` heartbeat, adopts the state file at start, and skips the pass on `held` and on `failed`; observable: a fleetd restart inside a host-named backoff sends no PR request before `prNextAt`; updates the `fleet-clock.ts` docs and the `CLAUDE.md` paragraph

### Board reader

- `feature/boards-share-one-pr-reader` — `plot-pr-reader.mjs` and its shipping lines; the board writes heartbeats, follows the lock for PRs only, starts the reader through a `Detached` seam when no holder and no fleetd live, reads `prError` and the backoff from the reader state file, and shows who reads PRs; the reader exits when no board heartbeat lives or a `fleetd` heartbeat lives; a test proves board tests start no reader; acceptance: with no fleet and two boards for one repository, one `plot-pr-reader.mjs` process runs, `.plot/logs/pr-reader.log` shows one elected pass per minute, the reader survives the exit of the board that started it, it exits within 2 minutes after the last board, and `budget.tsv`'s `github graphql` rate with two boards matches the rate with one board; updates the stale comments and the `CLAUDE.md` section

## Notes

- Source: issue #2386, https://github.com/plot-pm/plot/issues/2386.
- Panel round 1 (2026-10-26, unanimous amend): `.plot/panels/2026-10-23-one-pr-reader-per-machine-and/`. This text applies its required amendments and the operator's four decisions of 2026-10-26.
- The build goes ahead without a measured multi-board case, by the operator's decision of 2026-10-26.
- Started records: `feature/one-pr-reader-per-machine-and` is #2436's branch, deferred on 2026-10-25; origin keeps its ref at `f0b1a2fa7`. `feature/pr-reader-lock-elects-one-writer` has a brief at `.plot/briefs/pr-reader-lock-elects-one-writer.md` (`d315381c6`) and had no branch on origin on 2026-10-26. This amendment replaces that slice, so the brief describes a superseded slice. No slice in the current Slices section has started.
- The idle baseline of about 610 requests per hour is #2715.
