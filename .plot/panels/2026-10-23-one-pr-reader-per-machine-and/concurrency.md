# Juror verdict: concurrency

Plan: `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` at `cf0232d1b`. Lens: prove that at most one process writes the PR index at any instant. Code cited from the panel worktree (`origin/main` `cf0232d1b`) and from `origin/feature/one-pr-reader-per-machine-and` (the #2436 modules the plan keeps).

Position: amend

## Summary

The redesign fixes the right thing: the board stays a reader, and `pr-refresh.ts` stays the one fold path. But the lock protocol the plan specifies does not yet give "one writer per index file". Five defects let two processes fold into one index file at once. One of the two required fixes, implemented as the plan words it, makes every live reader look stale. None of them is a reason to reject. Each has a small, named change.

## 1. One writer

### The lock key does not equal the index's identity (HIGH)

- Read: the index file is `<common git dir>/.plot/state/index/<connector>.json` (`packages/domain/src/adapters/pr-index/pr-index-file.ts:84-98`). It is keyed by repository and connector. It has no account segment.
- Read: the lock key is `clean(connector)--clean(account)--clean(repo)` under `~/.plot/state/pr-reader/` (branch `reader-lock-file.ts:51-52`, `:21-25`).
- Consequence: two processes that resolve a different `account` for the same repository get two locks over one index file, and both elect. This is reachable. `resolveReaderAccount` returns `null` when `spend-rate` cannot answer (branch `pr-refresh.ts:1057-1060`), so one process keys on `unknown` and another on the real account. fleetd under launchd and a board in a shell can also see different credentials.
- Consequence: `clean()` lowercases and maps every `/` and other non-`[a-z0-9._-]` byte to `-` (branch `reader-lock-file.ts:31-34`). `/w/a-b/.git` and `/w/a/b/.git` both become `-w-a-b-.git`. Two repositories then share one lock. The second repository's board follows a reader that writes the other repository's index, so its store is never refreshed. That is the basename collision the plan sets out to remove, moved one level down.
- Consequence: the store path is `resolve(cwd, out)` with no `realpath` (`pr-index-file.ts:92`). A board started under a symlinked path (`/tmp` versus `/private/tmp` on macOS) and fleetd started under the physical path get two different key strings for one physical index file.
- Amend: key the writer lock on the index file's physical identity, `(realpath(common git dir), connector)`, and drop `account` from the lock key. The account belongs to the budget, not to the writer exclusion. The simplest form puts the lock beside the file it guards, for example `<common git dir>/.plot/state/index/<connector>.lock`, so "same file" and "same lock" cannot diverge and no sanitizing is needed. If the plan keeps the lock under `~/.plot/state`, it must name an injective encoding (for example a hash of the realpath) instead of `clean()`.
- Amend: the board must pass the key it computed to the reader (`--key` or the store path in argv), so the board and the reader cannot compute two keys for one election. Today the plan has each process derive the key on its own.

### The required takeover fix still leaves a two-holder window (HIGH)

- Read: the plan's fix is "rename the owner file to a unique scratch name, compare the moved claim with the one it judged stale, and restore it when they differ" (plan line 55).
- Walk: P1 and P2 both judge claim S stale. P1 renames `owner` aside, finds S, links its own claim F. P2 renames `owner` aside and finds F, not S. Between P2's rename and its restore, `owner` is absent. Any third elector R3 publishes first, before it judges anything (branch `reader-lock-file.ts:194`), so R3 links into the gap. P2's restore by `link` then fails with `EEXIST` and F is lost: P1 and R3 both hold. A restore by `rename` overwrites R3's claim instead: P1 and R3 both still believe they hold. The board's `holder()` read in the same gap sees `null`, gets `elect`, and spawns one more reader.
- Read: the repository's own precedent does not restore at all. `budget_lock_break` moves the lock aside and, on a mismatch, deletes the moved live lock and gives up (`skills/plot/scripts/plot-budget.sh:273-289`). That lock tolerates the loss through its generation counter. The reader lock has no such counter.
- Amend: replace move-aside-and-restore with a scheme where takeover is decided by one atomic create. One form: generation-numbered owner names. The holder is the highest `owner.<n>`. A taker that judged `owner.<n>` stale links `owner.<n+1>`. `link` returns `EEXIST` to every taker but one, and nothing is ever unlinked on the decision path. Cleanup of lower generations runs afterwards and decides nothing.

### Renewal and release mutate the owner file without the same protection (HIGH for renewal, MEDIUM for release)

- Read: renewal overwrites the owner file in place with `writeFile` (branch `reader-lock-file.ts:204-213`). `writeFile` truncates first. A concurrent `readOwner` can read an empty file. `decodeClaim('')` returns `null` (`Number(undefined)` is `NaN`, branch `:89-93`). The board then reads "no holder", gets `elect`, and spawns a reader. That reader's `elect` also reads `null`, treats it as stale (`:215-216`), unlinks the renewed claim, and links its own while the renewing reader continues its pass. Two writers.
- Read: renewal also follows a path checked one step earlier. If another process replaced `owner` between `readOwner` (`:201`) and `writeFile` (`:209`), the renewal writes this pid into the other process's file.
- Read: `release` reads the owner, then unlinks by name (branch `:235-241`). A takeover between the two lets `release` delete the new holder's claim.
- Amend: the plan names only the takeover. It must say that renewal and release use the same atomic decision as takeover. With generation names, renewal writes a scratch and renames it onto the holder's own `owner.<n>` only after confirming `n` is still the highest, and release removes only its own generation file.

### `elect` is checked once per pass, and the fold happens after a host round trip (MEDIUM)

- Read: `fleetPrs` checks the cadence gate and then calls `refreshPrs`, which asks the host and then folds through `writePrStore` (`packages/fleet/src/shared/fleet-clock.ts:165-176`, `pr-refresh.ts:1324-1352`). `writePrStore` is read-fold-rename with no lock around it (`pr-refresh.ts:1327-1346`).
- Walk: a holder that elected, then slept or hung through the host read, can be judged stale by age (`READER_STALE_MS`, 10 minutes). A successor elects and folds. The old holder wakes and folds its older answer. Two writers, and a lost update.
- Read: the harm is bounded. A lost update can drop a row for one pass, and "the index never says no" keeps a missing row from becoming `pr: none`. So this costs data freshness and doubled spend, not a wrong lifecycle decision.
- Amend: the plan must state that a holder re-reads the lock immediately before `writePrStore` and skips the fold when it no longer holds (a fence). It must also state where the elect sits: before `prGateOpen` and before the host read, on every beat. Plan line 46 says fleetd takes the lock "before it folds", which reads as after the host read. That would let fleetd spend host requests while a reader holds the lock.

### Renewal stops during a backoff longer than the stale bound (MEDIUM)

- Read: `fleetPrs` returns before `refreshPrs` while the gate is closed (`fleet-clock.ts:170`). If elect lives inside the pass, a holder renews nothing during a backoff. The Motivation measured a backoff of `prNextIn=863`, about 14.4 minutes. That is longer than `READER_STALE_MS` of 10 minutes (branch `reader-election.ts:33`).
- Consequence: a live, healthy reader in a host-named backoff goes stale by age. The board spawns a successor. The successor starts with `freshPrState()` (in-memory, `registryd-main.ts:2170`; the reader would do the same), so it has no `prNextAt` and no backoff, and it asks the host at once, during the 429 window the first reader was honouring.
- Amend: renew on every beat, independent of the cadence gate. Persist the host-named backoff (`prNextAt`, `prNextIsBackoff`) on the claim or beside the index, and have every new holder (reader, fleetd, a board falling back to its overlay) read it before its first host request. Without this, every hand-over in the plan (board to reader, reader to reader, reader to fleetd, reader death back to the board's overlay through `readPrsFromStore` resetting `prNextIsBackoff = false` at `packages/board/src/server/fleet.ts:2285-2286`) drops the backoff that the issue is about.

### State-by-state walk

| State | Writers | Read or ran |
|---|---|---|
| Fleet running, no reader | fleetd only, provided the board does not spawn while `fleetOwnsScan` is true. The plan does not state that guard. | read |
| Reader running, no fleet | the reader only, subject to the defects above | read |
| Two boards start at once | both spawn; `link` lets one reader win; the loser reads a complete claim and exits `held` | read |
| Reader dies (SIGKILL) | none until the next board PR tick: `kill(pid, 0)` gives `ESRCH`, stale, board spawns. None is acceptable: boards serve the overlay for that tick | read |
| Fleet starts while a reader runs | fleetd gets `held` and skips; reader exits after the bridge turns fresh; fleetd elects on its next beat. Sequential if both elect before the host read | read |
| Fleet stops | the bridge stays fresh for `OWNED_BRIDGE_MAX_AGE_MS` = 180 s (`packages/domain/src/rules/scan-owner.ts:10`) while the supervisor reads `down`. `fleetOwnsScan` is false, so the board spawns a reader each PR tick, and each reader exits at once on `bridgeIsFresh`. No double writer, but three minutes of spawn churn with the board on its overlay | read |
| Two repositories with one directory name | fixed for basename, still broken for `clean()` collisions and symlinked paths (above) | read |

- Amend: the reader's exit test and the board's ownership test must use one predicate. Use `fleetOwnsScan` (supervisor up **and** bridge fresh) in both, or have the reader exit on fleetd's claim instead of on the bridge.

## 2. Claims against the code

- Ran: the required fix "the adapter reads the holder's start time through the process probe" (plan line 56) breaks every live claim if it reuses `readerIsStale` unchanged. The claim stamps `startedAt` as `Date.now() - process.uptime() * 1000` in milliseconds (same derivation as `slots-file.ts:183` and `process-probe-system.ts:57`). The probe reads `ps -o lstart=`, which has one-second resolution (`processes-shell.ts:192-200`, `process-probe-system.ts:37-39`). `readerIsStale` compares `Math.trunc(a) !== Math.trunc(b)`, which is exact on integer milliseconds (branch `reader-election.ts:63-68`). I ran both readings on one node process: self-stamp `1793035271591`, `ps` `1793035271000`, difference 591 ms, `Math.trunc` equal: `false`. So every follower judges every live holder stale and takes it over. The repository already has the right rule: `CONTINUE_LOCK_SKEW_MS = 3000` with `Math.abs(...) <` (`packages/domain/src/rules/continue-lock.ts:28-35`) and `IMPLEMENT_LOCK_SKEW_MS`. Amend: the plan must name that tolerance. `slotIsStale` (`concurrency.ts:74-79`) carries the same latent comparison, harmless today only because both callers pass `null`.
- Read: `readerIsStale` returns `false` on `alive === null` before it checks age (branch `reader-election.ts:61-62`). A claim whose pid cannot be probed holds forever, and followers serve a store nobody refreshes. The plan states "a process-table read that cannot answer keeps the claim" (line 51) as intended. Amend: keep the claim on `null`, but still apply the age bound.
- Read: `--while-pid <board pid>` checks liveness by pid only. A reused pid keeps an orphan reader running and spending. Amend: pass the board's start time too, and compare with the same skew bound.
- Read and confirmed: `fleetOwnsPrs` at `fleet.ts:2254`, `readPrsFromStore` at `:2264`, `prError` from the bridge at `:2280`, the overlay call at `:2340`, `bridgeIsFresh` at `scan-owner.ts:52`, `fleetOwnsScan` at `:37`, the `Detached` port and `detached-node.ts`, `fleetAutoWrites` at `registryd-main.ts:2312`, the `PrWorld` construction at `:2200-2208`, `PR_REFRESH_MS = 60_000`. `maybeRefreshPrs` is a few lines below 2328, which is close enough.

## 3. Slices and Changelog

- Read: the "Reader lock" slice ships with "no caller yet". An observer sees nothing. It is acceptable as a domain slice only if its tests prove the protocol under concurrency: N processes racing takeover of one stale claim must yield exactly one holder, and a reader racing renewal must never read an empty claim. The plan names no such test. Amend: name a multi-process race test (real processes, not one event loop) as the slice's observable.
- Read: the Motivation's measured case is two boards on two different repositories (ewz-kus-portal, websmith) plus about 38 Claude sessions. An election per repository leaves two board-side readers in exactly that case. The plan, as scoped, removes none of the 44 measured spenders unless several boards share a repository. The Changelog line is honest about this ("the number of PR list requests no longer grows with the number of open boards"), but the plan should say plainly that the measured case is not reduced and that the sessions question (open question 3) decides whether this plan answers #2386.

## 4. Open questions

- Q2, where the reader publishes its last error: the claim is the wrong place under the generation scheme above, because the claim file must stay small and atomic. Put `prError` and the persisted backoff in one reader state file beside the index, written by the holder after its fence check. Operator decision only on the file name.
- Q4, should the reader outlive its board: the lock already answers it. Tie the reader's life to "a board for this key is still alive" rather than to one pid. A simple form: every following board touches a heartbeat beside the lock, and the reader exits when no heartbeat is younger than two PR ticks. That removes the one-tick overlay read on every board hand-over. Operator decision on whether that cost is worth it.
- Q1 and Q3 need measurements; the code does not answer them.

## 5. New defects

- State declarations: the branch added `pr-reader` entries to `scripts/state-inventory.json` (`241a2c871`, `f0b1a2fa7`). A move-aside or generation scheme adds new names (aside files, `owner.<n>`), and each needs an inventory row with its bound. If the lock moves under the common git dir, the inventory's own note says those paths are not listed, so the plan must say how the leak gate (`scripts/owned-run.sh`) still sees test leftovers.
- Tests that spawn a detached reader leave a live process past teardown. `owned-run.sh` fails a run on a late entry. The plan must require the reader tests to wait on the reader's own pid before teardown.
- Gates: the board starts the reader through the `Detached` adapter, so the spawn ratchet in `ci.yml` does not grow. No shell is added, so `check-shell-lines.sh` is unaffected. Read only; no gate was run.
- Cost: the board needs the holder's start time each PR tick, and the probe spawns `ps`. That is one `ps` per board per minute. Acceptable, but the plan should name it.

## Required amendments, in order

1. Key the writer lock on `(realpath(common git dir), connector)`, without `account`, with an injective encoding or the lock beside the index; the board passes the key to the reader.
2. Replace move-aside-and-restore with a takeover decided by one atomic `link` (generation names), and route renewal and release through the same decision.
3. Compare start times with a skew bound (`CONTINUE_LOCK_SKEW_MS`, 3000 ms), and keep the age bound when liveness is unknown.
4. Elect on every beat before the cadence gate and the host read; fence (re-read the lock) immediately before `writePrStore`.
5. Persist the host-named backoff and the last PR error beside the index, and have every new holder and every overlay fallback read them first.
6. Use one predicate for "the fleet owns PRs" in the reader's exit test and the board's spawn guard, and state that the board never spawns while that predicate holds.
7. Tie `--while-pid` to pid and start time.
8. Name a multi-process race test as the lock slice's observable.
