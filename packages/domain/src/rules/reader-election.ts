/**
 * One process's claim to be the machine's PR reader for one `(connector,
 * account, repo)` — a pid, and when that pid started.
 *
 * SAME SHAPE AS `SlotClaim` ({@link "./concurrency.js"}), AND FOR THE SAME
 * REASON. Pids are reused, so liveness alone can name a process this Plot
 * never started; `startedAt` is what tells a reused pid from the one that
 * actually wrote the claim.
 */
export interface ReaderClaim {
  /** The claiming process's id. */
  pid: number;
  /** When that process started, epoch milliseconds; null where it was unreadable. */
  startedAt: number | null;
  /** When the claim was last renewed, epoch milliseconds. */
  at: number;
}

/**
 * How long a claim may stand with no renewal before it is reclaimable on age
 * alone.
 *
 * **TEN MINUTES, MIRRORING {@link "./concurrency.js".CLAIM_STALE_MS}.** The
 * reader renews on every refresh — {@link
 * "../../../fleet/src/shared/pr-refresh.js".PR_REFRESH_MS} is on the order of
 * a minute — so a live reader's claim is always younger than this by a wide
 * margin, and a claim this old names a reader that has stopped refreshing
 * without exiting cleanly (a hang, a hard kill, a machine sleep). It is the
 * same number for the same reason `plot-push-lock.mjs`'s default differs from
 * `plot-budget.sh`'s: this lock spans a refresh cycle the way a push spans a
 * network round trip, not a single rename.
 */
export const READER_STALE_MS = 10 * 60 * 1000;

/**
 * Whether a reader's claim still describes a process that holds it.
 *
 * Three readings, same order as `slotIsStale`: a dead pid frees the claim; a
 * live pid that started AFTER the claim was stamped is a reused number and
 * frees it too; anything else is held until it is older than
 * {@link READER_STALE_MS}.
 *
 * `alive: null` KEEPS THE CLAIM. A reading that could not ask the process
 * table is not evidence the reader is gone — electing a second reader on the
 * strength of not knowing is exactly the double-read this mechanism exists to
 * prevent.
 *
 * @param claim - what the lock file holds.
 * @param alive - whether the pid is alive; null where the table could not be asked.
 * @param startedAt - when the live process matching that pid actually started,
 *   epoch milliseconds; null where unreadable.
 * @param now - epoch milliseconds.
 * @returns true where the claim may be taken over by somebody else.
 */
export const readerIsStale = (
  claim: ReaderClaim,
  alive: boolean | null,
  startedAt: number | null,
  now: number,
): boolean => {
  if (alive === false) return true;
  if (alive === null) return false;
  if (
    claim.startedAt !== null &&
    startedAt !== null &&
    Math.trunc(startedAt) !== Math.trunc(claim.startedAt)
  ) {
    return true;
  }
  return now - claim.at >= READER_STALE_MS;
};

/**
 * What a process should do about reading PRs for one `(connector, account,
 * repo)`.
 *
 * `elect` — no live holder exists; this process asks the host and becomes the
 *   holder.
 * `follow` — a live holder exists and is not this process; read its cache and
 *   ask the host nothing.
 * `unknown` — the lock could not be read at all. Not an election and not a
 *   refusal: the caller cannot tell whether a holder exists.
 */
export type ReaderVerdict = 'elect' | 'follow' | 'unknown';

/**
 * Decides the verdict from what the lock directory currently reads.
 *
 * **A STALE OR ABSENT HOLDER IS `elect`, NEVER `follow`.** A missing lock is
 * the state of every `(connector, account, repo)` nobody has read yet, and a
 * stale one names a reader that stopped without releasing — both cases where
 * reading a cache nobody is refreshing would silently serve data that will
 * never update again.
 *
 * **THIS PROCESS ALREADY HOLDING THE LOCK IS `elect`.** A reader re-asking
 * mid-refresh must keep refreshing rather than switch to following its own
 * stale idea of the cache — the pid comparison here is what tells
 * "I still hold this" from "somebody else does".
 *
 * @param held - the holder's claim, or null where the lock names none.
 * @param readable - whether the lock could be read at all.
 * @param pid - this process's own id.
 * @param alive - whether the held claim's pid is alive; ignored where `held`
 *   is null.
 * @param startedAt - when the live process matching that pid actually
 *   started; ignored where `held` is null.
 * @param now - epoch milliseconds.
 * @returns the verdict.
 */
export const electReader = (
  held: ReaderClaim | null,
  readable: boolean,
  pid: number,
  alive: boolean | null,
  startedAt: number | null,
  now: number,
): ReaderVerdict => {
  if (!readable) return 'unknown';
  if (held === null) return 'elect';
  if (held.pid === pid) return 'elect';
  return readerIsStale(held, alive, startedAt, now) ? 'elect' : 'follow';
};
