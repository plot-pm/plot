# Juror verdict: estate lens

Plan: `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` at `cf0232d1b`. Lens: the maintainer of the code the plan touches. All line numbers are from the panel worktree. Method: I **read** source with `sed`/`grep`/`git show`. I **ran** no test, no bundle and no `node`. One deviation: I ran `git fetch -q` once in the worktree to confirm `origin/main`; it changed nothing (`origin/main` stayed `cf0232d1b`), and it was a read against the remote, not a write.

Position: amend

## Summary

The redesign fixes the defect that closed #2436: no board source hands the real store to `refreshPrs`, and every line reference I checked is correct. Five gaps remain. Each one makes the board show wrong data or allows two writers, so slice 3 is not ready to build as written:

1. Widening `fleetOwnsPrs` also switches the board's **issue** reads to `issues.json`, which the reader never writes.
2. The lock key includes `account`, but the index file does not. A process whose account reading differs gets its own lock for the same index file, so there are two writers.
3. The #2436 adapter has a third race that the plan does not name: a renewal that is not atomic, followed by a takeover because an undecodable claim counts as stale.
4. `READER_STALE_MS` (10 min) is shorter than the backoff measured in Motivation (863 s). A reader that renews only on open-gate passes loses its lock while it is alive, and its replacement starts with no backoff.
5. The Motivation's 44 spenders is a rate quotient, not a headcount. Its two boards belong to two different repositories, so a lock keyed per repository removes no spender from that measurement.

## 1. One writer

Read: `fleet.ts:2254-2345`, `registryd-main.ts:2185-2210`, `fleet-clock.ts:160-178`, `scan-owner.ts:37-56`, #2436 `reader-lock-file.ts` (whole file), `reader-election.ts`.

- **Fleet running, no reader:** one writer. fleetd elects and folds (`registryd-main.ts:2204`). The board reads (`fleet.ts:2332-2334`). OK.
- **Reader running, no fleet:** one writer, provided the keys agree (see the next bullets). The board follows. OK.
- **Two boards start at once:** both read no holder, both get `elect`, and both start `plot-pr-reader.mjs`. `link()` lets one reader win, and the other gets `held` and exits. One writer. Cost: one extra short-lived process. OK.
- **Two writers through key disagreement.** The PR index is one file per `(common git dir, connector)` (`pr-index-file.ts:32-34,52`). The lock key adds `account` from `spend-rate` (`plot-host.sh:5936` → `budget_account`, `plot-host.sh:3445-3466`). That value depends on `PLOT_BUDGET_ACCOUNT`, on `GH_CONFIG_DIR`/`hosts.yml` (it changes on `gh auth switch`), and on whether `spend-rate` answers at all. In #2436, `resolveReaderAccount` returns `null`, which becomes `''`, then `unknown`. fleetd under launchd, a board and a reader can disagree on any of these. Example: reader A holds `github--alice--<repo>`. The operator runs `gh auth switch`. A board now computes `github--bob--<repo>`, finds no holder, and starts reader B, which elects. A and B both fold into the same `github.json`. **Fix:** key the lock by exactly what keys the file: connector and common git dir. Account does not name the resource the lock protects. Alternatively, put the lock beside the index under `<common git dir>/.plot/state/`, which also removes the `clean()` lowercasing collision for paths that differ only in case.
- **Two writers through the adapter (a third defect the plan does not list).** Renewal writes the owner file in place with `writeFile` (#2436 `reader-lock-file.ts`, the `RENEWAL` branch). That truncates and then writes, so a concurrent `readOwner` can read `''`. `decodeClaim('')` returns `null`, and then two paths treat `null` as stale: `elect` computes `stale = holder === null || …`, then unlinks and publishes, and `holder()` returns `answered(null)`, which `electReader` turns into `elect`, so the board starts a second reader. The renewing reader returned `elected` for this pass, and so did the new one. Two writers fold in one pass. **Fix:** renew through scratch plus `rename`, and make an undecodable owner file read as `failed`/`unknown`, never as "no holder". The plan's Answered bullet ("An unreadable lock gives `unknown`") holds for an unreadable *directory* only. It does not hold for an unreadable *claim*.
- **Elect-then-fold window.** The lock is checked before the host request, and the fold happens after it. A takeover is possible only when the claim is older than 10 min, so the window is safe only while every pass renews well within 10 min. See the next bullet.
- **Reader alive but stale (backoff > 10 min).** `fleetPrs` returns early while the gate is closed (`fleet-clock.ts:171`). A host-named backoff passes through untouched (`pr-refresh.ts:1000`), and Motivation measured 863 s. A quota reset can take up to an hour. If "before every pass" means before every open-gate pass, the claim ages past `READER_STALE_MS` while the reader lives. A board then elects a replacement, or fleetd takes over, and the new owner starts with a fresh `PrState` that has no backoff, because the PR index persists no backoff (`entities/pr-index.ts:123-156`). So the host is asked inside a named backoff, which is the 429 pattern this plan exists to stop. **Fix:** renew on every beat, independent of the cadence gate. Also persist the backoff end on the claim (or the index) so a successor honours it.
- **Reader dies:** a dead pid makes the claim stale, and the board elects and restarts the reader. After fix 2 (start time read through the probe), a reused pid is handled too. OK.
- **Fleet starts while a reader runs:** fleetd gets `held` and skips, and the reader exits when `bridgeIsFresh`. One writer. But the reader's exit predicate (`bridgeIsFresh`, `scan-owner.ts:52`) is weaker than the board's (`fleetOwnsScan`, `scan-owner.ts:37`, which also needs the supervisor `up`/`unknown`). After a `bootout`, the bridge stays fresh for up to `OWNED_BRIDGE_MAX_AGE_MS` = 180 s (`scan-owner.ts:10`). For those 3 minutes, every board PR tick starts a reader that exits at once, and every board reads the host through its overlay. That is no worse than today, but it churns processes. Using one predicate for both the reader and the board fixes it.
- **fleetd gets `failed` from the lock:** the plan defines `held` (skip) and nothing else. Skip means no writer while the lock directory is broken, which is a regression from today. Fold risks two writers. This needs an explicit choice.
- **fleetd hung while it holds the lock:** its pid is alive and its start time matches, so the board follows for up to 10 min while nothing writes. The board shows an honest `prAt` with stale rows. This is acceptable, but the plan should state it.
- **Two boards for one repository:** one reader, tied by `--while-pid` to the board that started it. When that board exits, the other board restarts the reader on its next tick and serves one overlay tick. One writer.
- **Two repositories with one directory name:** the common-git-dir segment fixes this. Under `clean()` (#2436), paths are lowercased, so `/A/x` and `/a/x` collide on a case-sensitive filesystem. This is minor, and the lock-beside-the-index fix removes it.

## 2. Claims against the code

Every reference I read is correct at `cf0232d1b`:

- `fleetOwnsPrs` is at `fleet.ts:2254`, `readPrsFromStore` at `:2264`, the `prError` read from the bridge at `:2280`, `maybeRefreshPrs` at `:2328`, and the overlay call at `:2340`.
- In `pr-refresh.ts`, `refreshPrs` is at `:1360`, `writePrStore` at `:1324`, `foldPrIndex` at `:1333` and `resolveBackend` at `:1021`.
- In `registryd-main.ts`, `fleetPrs` is at `:2200`, `store: prIndexFile` at `:2204` and `fleetAutoWrites` at `:2312`. `fleetPrs` is defined at `fleet-clock.ts:166`.
- In `scan-owner.ts`, `fleetOwnsScan` is at `:37` and `bridgeIsFresh` at `:52`. `issueGateOf` is at `issue-refresh.ts:676`. The `Detached` port is in `ports/detached.ts` and its adapter in `adapters/detached/detached-node.ts`.
- The test lines `one-pr-index-writer.test.ts:78,87` and `one-issue-index-writer.test.ts:119` say what the plan says.

False, stale or incomplete:

- **"`fleetOwnsPrs` becomes true … while the lock names a live holder" is wrong in effect.** `fleetOwnsPrs` gates more than PRs:
  - `maybeRefreshPrs` calls `readIssuesFromStore` under it (`fleet.ts:2334`).
  - `issueCadence` reads `issues.json`'s gate under it (`fleet.ts:1742`).

  The reader runs no issue read, so while only a reader runs, the board stops reading issues from the host. It then serves `issues.json` as a stale fleet left it, or it shows *"the fleet has left no issue index to read"* (`fleet.ts:2203`) and an empty *Waiting on you*. Slice 3 must split this into one predicate for PRs and one for issues. The issue predicate stays `fleetOwnsScan`.
- **`readPrsFromStore` carries fleet-only wording and data.** It sets *"the fleet has left no PR index to read"* (`:2271`) and copies `prError` from a bridge that may be hours old (`:2280`). While only a reader runs, a dead fleet's last error shows as current. Open question 2 names the bridge half. It is a defect, not an open choice: slice 3 cannot ship without an answer.
- **"`account` comes from `spend-rate`'s `budget_account` field"** is imprecise. The JSON field is `account` (`pr-refresh.ts:777-786`). `budget_account` is the shell function that fills it. On GitHub it can answer `unknown` (`plot-host.sh:3466`). Because of item 1 above, the lock key should drop this segment anyway.
- **"bundled … beside the other fleet entries in `packages/fleet/build.mjs`"** is incomplete. A shipped bundle also needs:
  - a `shipped<Name>` declaration and copy in `packages/board/build.mjs` (pattern at `:330-343`), or a plugin install has no `plot-pr-reader.mjs` under `skills/plot/scripts/board/`
  - a `-merge` line in `.gitattributes`, gated by `scripts/check-bundle-attributes.sh`
  - a row in `skills/plot/scripts/README.md`, gated by `scripts/check-helper-table.sh` (c)
  - an update to the "seven entries" comment and the docstring in `packages/fleet/build.mjs`

  The gates catch these, but the slice text should name them.
- **"It builds the same `PrWorld` … and runs `fleetPrs` on the fleet clock's PR beat"** is incomplete. `startFleetClock` requires `scan` (`fleet-clock.ts:39`, which is not optional). The reader must pass a no-op scan or drive `startPulse` directly. That is a small point, but say which.
- **"Two defects in the #2436 adapter"** names two. There are three: the non-atomic renewal plus null-as-stale race in section 1. The #2436 TSDoc is also stale: `readerLockKey`'s `@param account` says *"as `Host.account()` answered it"* and `@param repo` says *"from the origin remote"*. Both contradict the plan.
- **#2436 domain files break the domain TSDoc rule** in `CLAUDE.md` ("Factual API documentation"). Examples: `reader-election.ts` (*"SAME SHAPE AS `SlotClaim` … AND FOR THE SAME REASON"*, *"TEN MINUTES, MIRRORING …"*), and a doc link from the domain into `../../../fleet/src/shared/pr-refresh.js`. The slice reuses these files, so it inherits the debt unless it trims them.

## 3. Slices against the Changelog

- **Slice `pr-reader-lock-elects-one-writer`** has "no caller yet", so no observer sees anything. That is acceptable as a domain-only slice, but the Changelog correctly says nothing about it. It must carry the claim-format decision from open question 2 (a `prError` field on the claim changes the owner-file encoding `pid\tstartedAt\tat`), plus the backoff field from section 1. So that question has to be answered before this slice, not before slice 3.
- **Slice `pr-reader-process-writes-the-index`** ships the visible change. The Changelog line says *"the number of PR list requests no longer grows with the number of open boards."* That holds only for boards of **one repository**. It should say so, because the per-repository key is the design.
- **The 44-spender measurement is not answered.**
  - `prSpenders` is `localSpenders` = observed rate ÷ one board's share, floored at 1 (`packages/domain/src/rules/pr-status.ts:99-109`). The schema comment says *"FROM THE RECORD, NEVER A HEADCOUNT"* (`schema.ts:4412`). So "two boards and about 38 Claude processes" is not something the record can say. The number is about 44 board-equivalents of spend.
  - Motivation also says "one host account and repository" and then names two boards on two repositories (ewz-kus-portal, websmith). With the lock keyed per repository, those two boards keep two readers, so this plan removes **zero** spenders from the measured case.
  - The remaining spend goes through paths this plan does not touch: worker loops calling `plot-fleet-scan.sh --next` (`:1047,1063`), `plot-pr-merged.sh`, `plot-impl-status.sh` and `plot-open-pr.sh`.
  - Motivation and the Changelog need rewording to claim only what the slice buys. Better, the plan states the expected saving: at most one board's share per extra board on the same repository.

## 4. Open questions

- **ETags on Bitbucket.** The code does not answer this. It belongs to proposal 4, which no slice here builds. Move it to #2386 rather than keep an open box in an Approved plan.
- **Where the reader publishes `prError`.** The code forces an answer: without one, the board shows a stale fleet error or none (`fleet.ts:2280`). A claim field is the cheapest option because the board already reads the claim. Decide it before slice 2, because it changes the claim encoding.
- **Claude sessions.** Partly answered by code: the spender figure is a rate quotient (`pr-status.ts:99`), and session-side listings go through scripts this plan does not change (list above). Which of those dominates the measured rate needs a measurement, for example by grouping `budget.tsv` lines by caller. That is an operator decision on scope.
- **Should the reader outlive its board.** This is an operator decision. Two code facts bear on it:
  - Every reader restart loses in-memory `PrState`: the backoff, and `prFullReadFailedAt` (`pr-refresh.ts:1811`). The sibling plan #2419 makes a Bitbucket full read cost about 24 requests and relies on that failure grace. Frequent restarts weaken it.
  - If the reader does outlive its board, `--while-pid` becomes "while any board for this key is alive". Nothing in the lock records that today.

## 5. New defects

- **Board tests can start real readers.** Once `maybeRefreshPrs` starts `plot-pr-reader.mjs` through `Detached`, every board test that reaches a PR tick launches a detached process. That process asks the real host (the `no-network.test.ts` rule) and may outlive the test (`scripts/owned-run.sh` fails on leaked entries). `needs-design.ts:79` shows the seam (`opts.detached ?? detachedNode()`). Slice 3 must thread it and add a test that board tests start no reader.
- **The state inventory needs another glob.** #2436 declared `pr-reader/*/owner` and `pr-reader/*/.*.tmp`. Fix 1's rename-to-unique-scratch adds a third name, and `scripts/check-state-inventory.mjs` reports any undeclared file a contract run leaves. If the lock moves under the common git dir, the inventory's coverage note says that directory is not listed, so the entries change base.
- **The reader's log file** (the `Detached.node(…, logFile)` argument) needs a declared location. The plan names none.
- **Spawn ratchet (`ci.yml:1224`, `allowed=11`).** Not affected: `Detached` is an adapter, and the board gains no `spawn`/`execFile`. **`check-shell-lines.sh`** is not affected either, because the plan adds no shell. Both are fine as planned.
- **Cost of the election.** Every board PR tick in #2436 runs `plot-host.sh spend-rate` (one `bash`) only to build the key. If the key drops `account`, that call goes away. Otherwise the board pays one extra shell per tick, and fleetd pays one per pass.
- **First tick after a start.** The board starts the reader and on its next tick follows it. If the reader has not folded yet (its first PR beat can be up to 60 s away), `readPrsFromStore` replaces the board's fresh overlay maps with whatever older index exists (`applyPrMaps`, `fleet.ts:2273`). The reader should run one pass at start. Alternatively, the board keeps its overlay until the store's `at` is newer than its own `prAt`.
- **`CLAUDE.md` "A Decision Reads The Index"** says the board reads *Waiting on you* from `issues.json` "while a fleet runs" and describes `pr-refresh.ts` as having one writer. Slice 3 should update the section to name the reader process as a second caller of that one path, serialized by the lock, so the next juror does not read it as a violation.

## Required amendments

1. Split `fleetOwnsPrs` so the issue path keeps `fleetOwnsScan`, and make `readPrsFromStore` stop reading a stale fleet's `prError` and fleet-only wording while a reader owns PRs.
2. Key the lock by connector and common git dir only, and preferably place it under `<common git dir>/.plot/state/`.
3. Add the third adapter fix: atomic renewal, and an undecodable claim reads as `unknown`, never as "no holder".
4. Renew the claim on every beat regardless of the cadence gate, and persist the backoff end so a successor honours it.
5. Define fleetd's behaviour on `failed`, and use one ownership predicate for both the reader and the board.
6. Name the shipping work (`packages/board/build.mjs`, `.gitattributes`, the README row) and the board-test `Detached` seam.
7. Rewrite Motivation and the Changelog so they claim the per-repository saving only, and either drop the 44-spender framing or say this plan addresses about 1 share of it.
