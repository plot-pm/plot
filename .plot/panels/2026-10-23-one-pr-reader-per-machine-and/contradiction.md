# Juror: contradiction

Plan: `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` at `cf0232d1b`. Every claim below is marked **read** (I read source or plan text) or **inferred** (I derived it from read text and did not run it). I ran no code; I ran only `git show`, `sed` and `grep` over the worktree and the two remote branches.

Position: amend

## Summary

The line references are almost all correct. The contradictions are in the design's own coupling to code it does not mention: extending `fleetOwnsPrs` also switches the board's issue read to a store that nobody writes while only the reader runs, and the reader and the board use two different "a fleet runs" predicates. The title promises a jittered budget that the Approach unschedules. The Motivation's measured case (two boards on two repositories) gets two readers under the plan's own per-repository key, so the plan removes none of the 44 measured spenders. The plan names two defects in the #2436 adapter; the adapter has at least two more of the same kind.

## Contradictions

### C1. Title against Approach: the "jittered budget" is not in the plan (read)

- Title, line 1: *"One PR reader per machine and host account, with a shared, jittered budget"*.
- Approach, line 37: *"Proposals 2 (one request budget per account, spread across repositories with jitter) ... stay unscheduled."*

No slice adds jitter or a shared budget. The title names proposal 2, which the plan explicitly does not build. The title also says "per machine and host account", while the key is `(backend, account, repo)` (line 58).

### C2. Motivation against the key: the measured case gets two readers (read + inferred)

- Motivation, line 25: *"about 44 spenders on one host account and repository — two boards (ewz-kus-portal on :7778, websmith on :7777) and about 38 Claude processes."*
- Design, line 58: *"The lock key is `(backend, account, repo)` ... `repo` is the repository's common git dir."*
- Open question, line 76: *"This plan changes the board's read path only."*

The two measured boards serve two different repositories, so "one host account and repository" contradicts its own example. Under the per-repository key the two boards elect two readers: two host readers before, two after (inferred). The other ~38 spenders are sessions the plan does not touch (line 76). So the plan, as written, removes 0 of the 44 measured spenders. The Changelog (line 19) claims the request count *"no longer grows with the number of open boards"*; that only holds for several boards on one repository, a case the Motivation does not measure.

### C3. "The reader runs no issue read" against the code path the plan reuses (read)

- Design, line 41: *"It runs no supervision tick, no scan, no issue read and no automatic writes."*
- Design, line 49: *"`fleetOwnsPrs` ... becomes true while a fleet owns the scan ... **or** while the lock names a live holder for this key. Then `maybeRefreshPrs` ... serves `readPrsFromStore` ... and asks the host nothing for PRs."*
- Code, `packages/board/src/server/fleet.ts:2333-2336`: when `fleetOwnsPrs` is true, `maybeRefreshPrs` calls `readPrsFromStore` **and** `readIssuesFromStore`, and returns. The `refreshIssues` call at `:2350` runs only on the fleet-less branch.
- CLAUDE.md, *A Decision Reads The Index*: *"`refreshIssueIndex` ... is its one writer"* and *"A missing file shows the fleet has left no issue index to read"*. `one-issue-index-writer.test.ts:118-123` keeps the real issue store in `registryd-main.ts` only.

With only a reader running, the board stops asking the tracker, and the issue index has no writer. The *Waiting on you* inbox then shows a stale index, or *"the fleet has left no issue index to read"* (`fleet.ts:2170-2174`). The plan does not mention this. It must either split the PR and issue branches in `maybeRefreshPrs`, or keep the board's own `refreshIssues` while only a reader runs.

### C4. Two predicates for "a fleet runs" (read + inferred)

- Design, line 46: the reader *"exits at its next pass when the fleet bridge is fresh (`bridgeIsFresh`, `scan-owner.ts:52`)"*.
- Design, line 49: the board's `fleetOwnsPrs` uses `fleetOwnsScan` (`scan-owner.ts:37`).
- Code doc, `scan-owner.ts` above `:37`: *"a fresh bridge with no supervisor is the last write of a daemon that stopped"* — `fleetOwnsScan` requires supervisor `up`/`unknown` **and** a fresh bridge; `bridgeIsFresh` only checks age ≤ `OWNED_BRIDGE_MAX_AGE_MS` (180 000 ms, `scan-owner.ts:9`).

For up to 180 s after fleetd stops, the board sees "no fleet" and an empty lock, so it starts a reader. That reader sees a fresh bridge and exits. Each board tick in that window reads the host through the overlay and spawns one reader that exits (inferred). The reader must use the same predicate as the board, or the plan must say why the two differ.

### C5. "Answered: link(), not mkdir" against the adapter the plan keeps (read)

- Open questions, line 78: *"a lock published through a scratch write and `link()`, not through `mkdir` as a lock."*
- Design, line 53: *"Two defects in the #2436 adapter are fixed before reuse"* — and only two are listed.
- #2436 `reader-lock-file.ts` (`git show origin/feature/one-pr-reader-per-machine-and:...`), in `elect`: a renewal *"Overwrite[s] directly"* with `writeFile(join(dir, OWNER_FILE), ...)`, not through scratch and `link()`. `writeFile` truncates first. A rival that reads the empty or partial owner file gets `holder === null`, which the adapter treats as `stale` and then `unlink`s the live holder's file (inferred from the code path).
- In `release`: the adapter reads the owner, compares the pid, then `unlink`s. A takeover between the read and the unlink removes the new holder's claim (inferred). The adapter's own comment says *"unlinking it on the way out would drop a live holder's claim"*, which is the race it still has.
- Renewal and release compare `pid` only and ignore `startedAt`, the same reused-pid flaw the plan's second defect fixes for the stale check.

The plan says it fixes two defects. The adapter has at least two more that cause the same failure: a fresh claim gets removed, so two processes can fold. The *Reader lock* slice should name all four.

### C6. The pid-reuse fix against `--while-pid` (read + inferred)

- Design, line 56: *"The stale check passes `startedAt: null`, so a reused pid keeps a dead reader's lock for 10 minutes. The adapter reads the holder's start time through the process probe."*
- Design, line 47: *"The reader takes `--while-pid <pid>` and exits when that process is gone."*

`--while-pid` carries only a pid. If the board dies and the OS reuses its pid, the reader lives on and renews the lock forever (inferred). This is the reused-pid case the plan fixes one line earlier. The flag needs the board's start time too.

### C7. The staleness bound against the measured backoff, and the backoff that a new reader forgets (read + inferred)

- Motivation, line 25: *"the board then backs off about 14 minutes (`prNextIn=863`)"*.
- Design, line 51 and #2436 `reader-election.ts`: `READER_STALE_MS` is 10 minutes, justified because *"`PR_REFRESH_MS` is on the order of a minute — so a live reader's claim is always younger than this by a wide margin"*.
- Code, `fleet-clock.ts:172-178`: `fleetPrs` returns early while `prGateOpen` is shut, and the backoff lives in the in-memory `PrState` (`prNextAt`, `prNextIsBackoff`, `prFullReadFailedAt`, `pr-refresh.ts:62-103`). Only `wholeAt` is in the store.

If the reader renews only when `fleetPrs` actually runs, a 14-minute backoff makes a live reader stale, and a board starts a second one (inferred). The plan's wording *"before every pass"* (line 45) does not say whether a pass that the gate skips still renews. In every restart case (stale takeover, a board exit and re-election, fleetd handing back to a reader), the new process starts with an empty `PrState` and asks the host at once, inside the backoff the host named. That is the burst the plan exists to stop. The plan must either renew on every beat and say so, or carry the backoff across processes, for example on the claim or in the store.

### C8. Code comments that the plan makes false (read)

- `fleet-clock.ts` doc for `fleetPrs`: *"the fleet is the index's only writer."*
- `fleet.ts:2250-2252` doc for `fleetOwnsPrs`: *"Whether the fleet owns the PR index"*.
- `fleet.ts:2277-2279` in `readPrsFromStore`: *"The fleet is the one process that asks the host here, so its last failure is the board's"*; and `:2272` *"the fleet has left no PR index to read"*.
- CLAUDE.md, *A Decision Reads The Index*: *"A second writer beside the board races: `rename` makes each write atomic and not the read-fold-write sequence around it."*

After the plan, two processes (fleetd and the reader) take the writer path, serialised by the lock. The plan updates none of these statements. Open question 2 (where `prError` goes) is the same gap. The code already answers it: with no bridge, `prError` is `null` (`fleet.ts:2280`), so a failing reader shows as healthy.

### C9. Status against Notes (read)

- Status, line 10: *"Started: 2026-10-23, Jan Wloka, `feature/one-pr-reader-per-machine-and`"*.
- Notes, line 99: *"The first slice (#2436) is deferred ... This design replaces it with the two slices above."*

The Started record names the deferred branch. The two new branches have no Started record.

### C10. "The plan adds no cache location" against the lock's state (read)

- Design, line 70: *"The plan adds no cache location."*
- #2436 `scripts/state-inventory.json` adds `pr-reader/*/owner` and `pr-reader/*/.*.tmp` under the `budget` base.

The lock is new machine-wide state under the budget home, not under the common git dir. The *Reader lock* slice must keep these inventory lines and add one for the rename scratch name that the takeover fix introduces. The plan names neither. A key whose repo segment is the common git dir is an absolute path, so the slice must also say how the path becomes one directory name (`pr-reader/*/owner` allows one segment).

### C11. The sibling #2419 against this plan (read)

- #2419, Scope table: *"Pairing with #2386's single reader | not needed | #2386's slice was deferred on 2026-10-25 ... This plan adds no index writer and no host reader beside `pr-refresh.ts`."* Open point: *"Overlap with #2386 — answered round 1: #2386's slice is deferred, and this plan needs no single reader."*
- This plan, line 99: the design is active again with two new slices, and it does not name #2419 at all.

Each plan describes the other's state as of 2026-10-25. They now interact. #2419 makes a Bitbucket full read cost about 24 requests (its Cost and Open Points), keeps `prFullReadFailedAt` on the entry, not in the store, and its *"partial full read"* back-off also lives in memory. Every reader restart in C7 then also loses #2419's back-off (inferred). Neither plan states this. This plan should name #2419 and say whether its reader restarts reset #2419's back-off.

## Claims checked and found true (read)

`fleetOwnsPrs` at `fleet.ts:2254`, `readPrsFromStore` at `:2264`, `prError` from the bridge at `:2280`, `maybeRefreshPrs` at `:2328`, the overlay `refreshPrs` at `:2340`. `refreshPrs` at `pr-refresh.ts:1360`, `writePrStore` at `:1324`, `foldPrIndex` at `:1333`, `resolveBackend` at `:1021`. `fleetPrs` at `fleet-clock.ts:166`. `prIndexFile` at `registryd-main.ts:2204`, `fleetAutoWrites` at `:2312`. `fleetOwnsScan` at `scan-owner.ts:37`, `bridgeIsFresh` at `:52`. `issueGateOf` at `issue-refresh.ts:676`. `one-pr-index-writer.test.ts:78` and `:87`. The `Detached` port and `detached-node.ts` exist, and its `node()` takes script, args, cwd and log file. `plot-host.sh:3940` refuses `account` on Bitbucket. #2436 keys the lock on `path.basename(opts.repoRoot)`, as line 58 says. #2436's `elect` passes `startedAt` `null` to `readerIsStale` and unlinks before it republishes, as lines 55-56 say.

One small inaccuracy: `packages/fleet/build.mjs` copies nothing to the skills directory. `packages/board/build.mjs` copies each fleet bundle (`fleet/build.mjs:3-6`). A new `plot-pr-reader.mjs` needs that copy too, and the plan names only `packages/fleet/build.mjs` (line 41).

## Required amendments

1. Fix the title (C1), or schedule jitter.
2. Restate the Motivation's measured case, and state how many of the 44 spenders the plan removes (C2). If the answer is none, say which measurement the plan answers.
3. Decide how the board reads issues while only a reader runs (C3).
4. Use one predicate for "a fleet runs" in the reader and the board (C4).
5. Name all four adapter defects in the *Reader lock* slice: non-atomic renewal, read-then-unlink release, pid-only identity, and the two already listed (C5).
6. Carry the board's start time with `--while-pid` (C6).
7. State when the reader renews, and how backoff survives a reader change (C7, C11).
8. List the comments and the CLAUDE.md paragraph that the *Reader process* slice updates, and answer open question 2 from `fleet.ts:2280` (C8).
9. Correct the Started record (C9). Add the state-inventory lines and the key encoding to the *Reader lock* slice (C10). Name #2419 (C11).
