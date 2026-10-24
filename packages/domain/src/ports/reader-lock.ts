import type { PortResult } from '../port-result.js';
import type { ReaderClaim } from '../rules/reader-election.js';

/**
 * Elects one process per `(connector, account, repo)` as the machine's PR
 * reader — the lock behind `electReader`.
 *
 * **A PORT BECAUSE THE ELECTION IS SHARED AND THE DOMAIN MAY NOT LOOK.** The
 * population this elects among is processes on one machine, not promises in
 * one process — the 44-spender measurement (issue #2386) was board and
 * session processes, each with its own refresh timer. A lock inside one
 * process elects nothing those processes compete over.
 *
 * **KEYED PER `(connector, account, repo)`, NOT PER ACCOUNT ALONE.** The PR
 * index itself is per-repository ({@link "./pr-index.js".PrIndexStore}), so
 * the cache a non-holder reads is per-repository too; an account-wide lock
 * would elect one reader for every repository on that account's connector and
 * starve every repository but the first.
 *
 * **NOTHING HERE DECIDES WHO WINS.** The port reads and writes a directory;
 * `electReader` says what the read means. A caller that skipped the rule and
 * treated "the mkdir succeeded" as the whole answer would miss the
 * already-mine and reused-pid cases the rule exists to catch.
 *
 * **ELECTION, NOT A WAIT.** `elect` answers immediately, the same contract
 * `Slots.acquire` keeps: a caller told `follow` reads the cache and returns, it
 * does not block hoping to become the holder. A port that waited would turn
 * "somebody else is already serving this" into a stall.
 */
export interface ReaderLock {
  /**
   * Reads the current holder's claim, without electing.
   *
   * @param key - the `(connector, account, repo)` this lock is scoped to, as
   *   {@link readerLockKey} spells it.
   * @returns the claim, `null` where the lock names no holder, or `failed`
   *   where the directory could not be read at all.
   */
  holder(key: string): Promise<PortResult<ReaderClaim | null>>;

  /**
   * Takes the lock for this process, or confirms this process already holds
   * it — renewing the claim either way.
   *
   * **RENEWS ON EVERY CALL A HOLDER MAKES.** A reader that elected once and
   * never renewed would go stale under `READER_STALE_MS` while it is still
   * the one refreshing, and a second process reading the rule's `elect` verdict
   * for "this process already holds it" would then race a fresh claim against
   * one about to be judged stale.
   *
   * @param key - the lock to take.
   * @param claim - this process's claim, stamped by the caller.
   * @returns `'elected'` where this process now holds the lock (new or
   *   renewed), `'held'` where a live other process holds it, and `failed`
   *   where the directory could not be written at all.
   */
  elect(key: string, claim: ReaderClaim): Promise<PortResult<'elected' | 'held'>>;

  /**
   * Gives the lock back.
   *
   * IDEMPOTENT, AND A MISSING LOCK IS SUCCESS. Only this process's own claim is
   * removed — the same rule `Slots.release` keeps — so a lock already reclaimed
   * as stale while this process still ran is left to its new holder.
   *
   * @param key - the lock to release.
   * @param pid - this process's id, checked against the held claim before
   *   removing it.
   * @returns nothing on success.
   */
  release(key: string, pid: number): Promise<PortResult<void>>;
}
