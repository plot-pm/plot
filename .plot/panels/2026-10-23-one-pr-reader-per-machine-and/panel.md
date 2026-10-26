# Panel round 1 — moderation

Subject: `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md` at `cf0232d1b` (#2386, State Approved). Jurors: concurrency, estate, deliverable, contradiction. Gate: all four committed (exit 0). Reconcile: `unanimous amend`.

## Evidence basis

All four jurors read the plan, the code on `cf0232d1b` and the #2436 branch. Only the concurrency juror ran something: one `node` process compared its self-stamped start time with `ps -o lstart=` (591 ms apart). No juror measured spend by caller, and no juror ran a test or a bundle. Every cited line in the plan was confirmed by at least two jurors; the only inaccuracies are the bundle copy step (`packages/board/build.mjs`, not `packages/fleet/build.mjs`) and the `account` field name.

## Findings all four share

1. **The measured case gets no benefit.** The Motivation's two boards serve two repositories (ewz-kus-portal, websmith). The lock key is per repository, so that machine gets two readers in place of two board reads. The sessions are untouched. Estate and deliverable add that "44 spenders" is a rate quotient (`localSpenders`, observed rate ÷ one board's share), not a headcount, so "2 boards and about 38 Claude processes" is an inference the record cannot support. The plan as written removes none of the measured spend.
2. **Renewal during a backoff.** `fleetPrs` returns early while the cadence gate is shut. A host-named backoff of 863 s is longer than `READER_STALE_MS` (10 min). A live reader then reads stale, a successor starts with an empty in-memory `PrState`, and it asks the host inside the backoff. Fix: renew on every beat before the gate, and persist the backoff so a successor honours it. Contradiction adds that #2419's partial-read back-off (`prFullReadFailedAt`) is lost the same way.

## Findings three jurors share

3. **The inbox regresses.** `fleetOwnsPrs` also routes issues to `readIssuesFromStore` (`fleet.ts:2334`). The reader writes no `issues.json`, so a board without a fleet shows a stale inbox or "the fleet has left no issue index to read". Split the PR and issue predicates (estate, deliverable, contradiction).
4. **More adapter races than the plan names.** Renewal overwrites the owner file with `writeFile` (truncate first); a concurrent read decodes `''` as no holder, takes over, and two readers fold. Release reads then unlinks by name and can delete a new holder's claim (concurrency, estate, contradiction).
5. **Two "a fleet runs" predicates.** The reader exits on `bridgeIsFresh`; the board uses `fleetOwnsScan`. For up to 180 s after fleetd stops, every board tick spawns a reader that exits at once (concurrency, estate, contradiction).

## Findings two jurors share

6. **The lock key includes `account`, the index file does not.** A `gh auth switch`, a `null` account or launchd credentials give two locks over one `github.json`, so two writers. Key the lock on `(realpath(common git dir), connector)`, preferably beside the index file (concurrency, estate).
7. **`--while-pid` carries no start time**, the same reused-pid flaw the plan fixes one line earlier (concurrency, contradiction).

## Single-juror findings worth keeping

- **Concurrency (ran):** the required start-time fix, if it reuses `readerIsStale` unchanged, judges every live holder stale: self-stamp is millisecond, `ps` is second resolution, and `Math.trunc` compares exactly. Use the `CONTINUE_LOCK_SKEW_MS` tolerance (3000 ms).
- **Concurrency:** the plan's takeover fix (rename aside, compare, restore) still leaves a window where `owner` is absent and a third elector links in. Replace it with generation-numbered owner files decided by one `link`. Fence: re-read the lock immediately before `writePrStore`.
- **Estate:** fleetd's behaviour on a `failed` lock is undefined; board tests reaching a PR tick would start a real detached reader (thread the `Detached` seam); the new bundle needs `packages/board/build.mjs`, `.gitattributes` and a README row; the reader's log location is unnamed; the #2436 domain TSDoc breaks the factual-documentation rule.
- **Deliverable:** boards still read CI runs (`refreshRuns`), so the Changelog's "reads the index instead of the host" covers the PR list only; no acceptance observation and no place to see that a reader runs.
- **Contradiction:** the title promises "a shared, jittered budget" that no slice builds; the Started record names the deferred branch; #2419 still says #2386 needs no single reader.

## Disagreement

- **Where `prError` lives.** Estate and deliverable favour a field on the claim (the board already reads it). Concurrency argues against it: under a generation scheme the claim must stay small and atomic, so `prError` and the persisted backoff belong in one reader state file beside the index, written after the fence check. This is a real design conflict, not a wording choice: the operator chose "on the lock claim" in the challenge before this panel reported, and the concurrency finding is new evidence against that choice.
- **Reader lifetime.** Concurrency proposes board heartbeats beside the lock; estate notes nothing records "any board for this key" today. Both are compatible with the operator's "any live board" answer; they differ only in mechanism.

## Shared blind spot

All four jurors judged the design they were given. None asked whether the plan should exist once finding 1 holds: if the measured machine gains nothing and the sessions dominate, a lock protocol with four races to fix buys the case of several boards on one repository, which nobody measured. The operator's "measure first" answer is the right gate, and it belongs before slice 1 too, not only before slice 2, because slice 1 carries most of the concurrency work. No juror considered the smallest alternative either: run the existing fleetd in a PR-only mode for boards without a fleet, which reuses its one-writer path and needs no new lock.
