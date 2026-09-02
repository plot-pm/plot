import type { PortResult } from '../port-result.js';
import type { SlotClaim } from '../rules/concurrency.js';

/** One slot, as the shared state holds it. */
export interface HeldSlot {
  /** Which slot this is — `0` to `bound - 1`. */
  index: number;
  /** What the claim file holds. */
  claim: SlotClaim;
}

/**
 * Bounds how many host calls one ACCOUNT has open at once, across processes.
 *
 * **A PORT BECAUSE THE COUNT IS SHARED AND THE DOMAIN MAY NOT LOOK.** The
 * population this bounds is processes, not promises: the 2026-08-27 incident
 * was eight WORKERS, each shelling `plot-host.sh` once, and the board's own
 * refresh is sequential. A semaphore inside one process bounds nothing that
 * incident measured, which is why the count lives where every spender on the
 * computer can see it.
 *
 * **THE RECORD CANNOT HOLD IT, AND THAT IS SETTLED RATHER THAN ASSUMED.**
 * `BudgetRecord` is append-only with a 512-byte line cap — the two properties
 * that make it lock-free — and an in-flight count needs a DELETE on release. A
 * process killed between claim and release would leave a line nothing removes,
 * and the account would read as permanently full: the cap degrading into a
 * deadlock, which is a worse failure than the 403 it exists to prevent. So the
 * claims sit BESIDE the record, one file per slot, where releasing is an
 * unlink and a dead claimant is a measurement rather than a timer.
 *
 * **IT IS A CONNECTOR CONCERN AND KEYED PER ACCOUNT.** Two boards are two
 * budgets against one cap — the plan's whole name — so the key is the account,
 * exactly as `BudgetKey` is. A filesystem port has no account and no budget,
 * and must not be made to implement any of this.
 *
 * **NOTHING HERE WAITS.** `acquire` answers immediately, and a caller at the
 * cap decides for itself whether to wait, ask again, or proceed — the same
 * split `reactionTo` keeps for a refusal. A port that slept would block a
 * worker for as long as the account is busy, and `plot-reap.sh`'s safety
 * argument needs an unreachable host to ANSWER rather than to hang.
 */
export interface Slots {
  /**
   * Takes one slot for this process, or reports that every slot is held.
   *
   * ATOMIC OR IT IS NOTHING. Two processes asking at the same moment must not
   * both be given the last slot, so the claim is an exclusive create rather
   * than a read-then-write — the same guarantee `O_APPEND` gives the record,
   * obtained the only other way a filesystem offers.
   *
   * A STALE CLAIM IS RECLAIMED HERE, not swept later. The process that wants a
   * slot is the one already reading every claim file, and a separate sweeper
   * would re-read them all to learn the same thing — the argument
   * `truncationOwed` makes for the record's pruning.
   *
   * @param account - the account the cap belongs to, as `BudgetKey` spells it.
   * @param bound - the cap; a caller with none does not call this at all.
   * @returns the slot's index where one was taken, `null` where every slot is
   *   held by a live process, and `failed` where the claims could not be read
   *   or written. **`failed` IS NOT `null`**: the first says nothing is known,
   *   the second says the account is busy, and a caller must not read either as
   *   the other.
   */
  acquire(account: string, bound: number): Promise<PortResult<number | null>>;

  /**
   * Gives a slot back.
   *
   * IDEMPOTENT, AND A MISSING SLOT IS SUCCESS. A claim reclaimed as stale
   * while its owner still ran is a case this must survive: the owner releasing
   * a slot somebody else now holds must not remove theirs, and the file it
   * wrote is checked before it is unlinked.
   *
   * @param account - the account the slot belongs to.
   * @param index - the slot the matching `acquire` returned.
   * @returns nothing on success.
   */
  release(account: string, index: number): Promise<PortResult<void>>;

  /**
   * Every slot currently claimed, live or stale.
   *
   * REPORTS, NEVER DECIDES — the property `BudgetRecord.location` has. This is
   * what lets the board say *how many callers the cap accounts for* without
   * taking a slot to find out, and what lets a test assert the count rather
   * than infer it from a refusal that did not come.
   *
   * @param account - the account to read.
   * @returns the claims, in slot order.
   */
  held(account: string): Promise<PortResult<readonly HeldSlot[]>>;
}
