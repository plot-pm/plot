import { MIN_CONCURRENCY } from './reaction.js';
import type { LimitReading } from '../entities/limit.js';

/**
 * One process's claim on a slot — a pid, and when that pid started.
 *
 * THE START TIME IS WHAT MAKES THE PID A MEASUREMENT. Pids are reused, so
 * liveness alone can name a process Plot never started: a worker killed at 3000
 * and a shell that inherits 3000 an hour later are indistinguishable by number.
 * `Processes.startedAt` exists for exactly this reason and `plot-dispatch.sh`
 * already reads it for claims.
 */
export interface SlotClaim {
  /** The claiming process's id. */
  pid: number;
  /** When that process started, epoch milliseconds; null where it was unreadable. */
  startedAt: number | null;
  /** When the claim was stamped, epoch milliseconds. */
  at: number;
}

/**
 * How long a claim may stand before it is reclaimable on age alone.
 *
 * TEN MINUTES, AND IT IS THE LAST RESORT RATHER THAN THE TEST. Liveness is the
 * measurement — a dead pid frees its slot immediately — and this only catches
 * the case liveness cannot: a pid that is alive, was started before the claim,
 * and yet is not the process that claimed. That happens when a machine is
 * restored from sleep with the clock moved, and it is rare enough that a
 * generous bound costs nothing.
 *
 * It is deliberately far LONGER than any host call. `plot-host.sh` has no retry
 * and no sleep, so a single call is seconds; the longest observed here is the
 * 18.3 s fleet scan, which makes ten minutes roughly thirty times the worst
 * measured case. A shorter age would reclaim a slot a live caller still holds,
 * which is the one failure a concurrency bound must not have — it would let the
 * cap be exceeded by exactly the callers it was counting.
 */
export const CLAIM_STALE_MS = 10 * 60 * 1000;

/**
 * Whether a slot's claim still describes a process that holds it.
 *
 * THREE READINGS, AND THE ORDER IS THE ARGUMENT. A dead pid frees the slot; a
 * live pid whose process started AFTER the claim was stamped is a reused number
 * and frees it too; anything else is held until it is older than
 * {@link CLAIM_STALE_MS}.
 *
 * `alive: null` MEANS THE PROCESS TABLE COULD NOT BE ASKED, AND THAT KEEPS THE
 * SLOT. The whole plan's Done-when says nothing silently reads unreachable as
 * permission, and reclaiming a slot because a reading failed is precisely that
 * — it would raise the number of simultaneous callers on the strength of not
 * knowing. `plot-reap.sh` keeps for the same reason.
 *
 * @param claim - what the slot file holds.
 * @param alive - whether the pid is alive; null where the table could not be
 *   asked.
 * @param startedAt - when the live process actually started, epoch
 *   milliseconds; null where unreadable.
 * @param now - epoch milliseconds.
 * @returns true where the slot may be taken by somebody else.
 */
export const slotIsStale = (
  claim: SlotClaim,
  alive: boolean | null,
  startedAt: number | null,
  now: number,
): boolean => {
  if (alive === false) return true;
  if (alive === null) return false;
  // A PID REUSED IS A SLOT FREE. The claim named a process that started at a
  // moment the live one did not: whatever holds the number now is not what
  // stamped the file, so the claimant is gone whatever the table says.
  if (
    claim.startedAt !== null &&
    startedAt !== null &&
    Math.trunc(startedAt) !== Math.trunc(claim.startedAt)
  ) {
    return true;
  }
  return now - claim.at >= CLAIM_STALE_MS;
};

/** Seconds in the hour every connector limit in this estate is stated over. */
const SECONDS_PER_HOUR = 3600;

/**
 * How long one host call is assumed to occupy a slot, in seconds.
 *
 * FOUR, AND IT IS MEASURED RATHER THAN ROUND. `plot-host.sh` has no retry and
 * no sleep, so a call is one CLI round trip; the fleet scan's 18.3 s covers a
 * whole plan's worth of them, and a single `gh pr list` here runs in the low
 * seconds. Four is the figure that puts GitHub's 5000/hr at 5 simultaneous
 * calls — below the eight that was refused on 2026-08-27 and above the one that
 * would serialise the estate.
 *
 * IT ONLY SETS THE STARTING POINT. A wrong value here is corrected by the first
 * secondary refusal, which is the whole reason the bound is discovered: the
 * number that matters is the one refusals converge on, not the one this divides
 * by.
 */
export const SECONDS_PER_SLOT = 4;

/**
 * The bound a connector's own reading proposes, before any refusal moves it.
 *
 * **DISCOVERED, NEVER COMPILED IN.** Seven has no independent source — both
 * citations in `plot-host.sh` point at the one 2026-08-27 incident, where eight
 * workers failed and seven is the inference — so this slice ships no seven and
 * no cap of its own. What it ships is a derivation from the number the
 * connector already answers with, corrected by the refusals it causes: the same
 * mechanism `correctForRefusal` uses for the ceiling itself.
 *
 * **THE DIVISOR IS THE HOUR, AND THAT IS THE UNIT CONVERSION THE PROBLEM IS.**
 * A limit is requests per hour; a concurrency bound is requests at one moment.
 * The two are not the same quantity, so a bound cannot be READ off a limit — it
 * has to be derived from one, and the honest derivation is *how many calls an
 * hourly ceiling can afford to have open at once*. At {@link SECONDS_PER_SLOT}
 * seconds a call, an account allowed `limit` calls an hour can sustain
 * `limit / (3600 / SECONDS_PER_SLOT)` of them simultaneously without exceeding
 * the hourly figure.
 *
 * **AND IT IS A STARTING POINT, NOT AN ANSWER.** GitHub's 5000/hr yields 5 here
 * and the one refusal ever measured came at 8, so the starting value is in the
 * right region and is certainly not exact. Being roughly right and correctable
 * is the property the plan asks for; being exactly right is not available from
 * any source this estate has.
 *
 * `unknown` YIELDS NULL, NEVER A NUMBER. A connector that reports no ceiling
 * and has no prediction gives nothing to derive from, and inventing a bound
 * there would be the compiled-in seven under another name. A caller reading
 * null runs unbounded, which is what it did before this slice — see
 * {@link concurrencyBound}, where that choice is stated rather than implied.
 *
 * @param reading - what the connector answered about its own limit.
 * @returns the bound the reading proposes, or null where it proposes none.
 */
export const boundFromLimit = (reading: LimitReading): number | null => {
  if (reading.basis === 'unknown' || reading.limit === null) return null;
  if (!Number.isFinite(reading.limit) || reading.limit <= 0) return null;
  const callsPerHour = SECONDS_PER_HOUR / SECONDS_PER_SLOT;
  return Math.max(MIN_CONCURRENCY, Math.floor(reading.limit / callsPerHour));
};

/**
 * The bound a caller runs at — the connector's proposal, floored by every
 * refusal it has already caused.
 *
 * **THE REFUSAL OUTRANKS THE PREDICTION AND NEVER THE OTHER WAY ROUND.** A
 * secondary refusal is a measurement of the real ceiling; a derived bound is an
 * inference from a number about a different quantity. So where both exist the
 * lower wins, and a prediction can never raise a bound a refusal established —
 * the same one-directional rule `loweredConcurrency` states, applied where the
 * two sources meet.
 *
 * **A NULL PROPOSAL AND A NULL CORRECTION BOTH MEAN UNBOUNDED**, and that is
 * the honest answer rather than a safe-looking one. Before this slice nothing
 * bounded anything; a connector that reports no limit, has no prediction and
 * has refused nothing gives no evidence for any number, and a bound invented
 * there is the compiled-in seven the plan refuses. The caller runs as it did
 * yesterday and the first refusal supplies the evidence.
 *
 * @param proposed - what {@link boundFromLimit} derived, or null.
 * @param corrected - the bound refusals have already lowered a caller to, or
 *   null where none has refused.
 * @returns the bound, or null where nothing licenses one.
 */
export const concurrencyBound = (
  proposed: number | null,
  corrected: number | null,
): number | null => {
  if (proposed === null) return corrected;
  if (corrected === null) return proposed;
  return Math.max(MIN_CONCURRENCY, Math.min(proposed, corrected));
};

/**
 * What a caller may do about a slot it is asking for.
 *
 * `go` — a slot was free and is now held; the caller calls and releases it.
 * `wait` — every slot is held by a live process. The caller waits and asks
 *   again; it has NOT been told there is nothing to do.
 * `unknown` — the slots could not be read at all. Not permission and not
 *   refusal: the caller cannot tell whether it is at the cap.
 */
export type SlotVerdict = 'go' | 'wait' | 'unknown';

/**
 * How many slots are genuinely held, given what the lock directory reads.
 *
 * A STALE CLAIM IS NOT A HELD SLOT, and counting it as one is how a cap
 * degrades into a deadlock: eight workers killed by the idle rule would leave
 * eight files behind and every later caller would read the account as
 * permanently full. So each claim is tested and only the live ones count.
 *
 * @param claims - what each slot file holds, paired with the process reading it
 *   licensed.
 * @param now - epoch milliseconds.
 * @returns how many slots a caller must treat as taken.
 */
export const heldSlots = (
  claims: readonly {
    claim: SlotClaim;
    alive: boolean | null;
    startedAt: number | null;
  }[],
  now: number,
): number =>
  claims.filter(({ claim, alive, startedAt }) => !slotIsStale(claim, alive, startedAt, now))
    .length;

/**
 * Whether a caller may make its call now.
 *
 * **AT THE CAP IS `wait`, NEVER `unknown` AND NEVER SILENCE.** The plan's
 * Done-when is that nothing silently reads unreachable as permission, and its
 * mirror matters as much: a caller told *the account is busy* must not read
 * that as *there is nothing to do*. `plot-reap.sh` keeps a worktree it cannot
 * ask about; a caller at the cap keeps its question and asks again.
 *
 * **AND AN UNREADABLE LOCK DIRECTORY IS `unknown`, WHICH THE CALLER SPENDS
 * AGAINST.** This is the one place the answer is deliberately permissive, and
 * the reason is that the alternative is worse: a board that stops asking
 * because a directory could not be created is a board that goes dark on a disk
 * fault, and the cap exists to prevent a 403, not to become a second way to
 * fail. The caller degrades to the behaviour it had before this slice — no
 * bound — and the refusal, if one comes, still lowers the number.
 *
 * @param held - how many slots are genuinely held, from {@link heldSlots}.
 * @param bound - the cap, from {@link concurrencyBound}; null where unbounded.
 * @returns `go`, `wait`, or `unknown`.
 */
export const slotVerdict = (held: number | null, bound: number | null): SlotVerdict => {
  if (held === null) return 'unknown';
  if (bound === null) return 'go';
  return held < bound ? 'go' : 'wait';
};

/**
 * How long a caller waits before asking for a slot again.
 *
 * A FRACTION OF THE SLOT, so a freed slot is taken promptly and a full account
 * is not polled into a spin. {@link SECONDS_PER_SLOT} is how long a call is
 * assumed to hold one, so a quarter of it is the interval at which asking is
 * worth the syscall.
 *
 * IT IS NOT A BACKOFF AND MUST NOT BECOME ONE. A caller waiting for a slot is
 * waiting for a peer to finish, not for a limit to reset — that is
 * `reactionTo`'s question and it has its own answer. Backing off here would
 * turn a busy moment into a slow minute for no evidence at all.
 */
export const SLOT_POLL_MS = (SECONDS_PER_SLOT * 1000) / 4;

/**
 * How long a caller keeps waiting for a slot before giving up on the bound.
 *
 * **THE BOUND MUST DEGRADE THE CADENCE, NOT PRODUCE A REFUSAL** — the plan's
 * Done-when in one sentence. A caller that waited forever would turn a busy
 * account into a hung board, which reads as broken rather than as busy; a
 * caller that gave up immediately would not bound anything. So it waits, and a
 * caller still waiting after this proceeds anyway.
 *
 * PROCEEDING IS THE RIGHT END, AND IT IS NOT A LOOPHOLE. Every slot being held
 * this long means every holder is either stuck or the reading is wrong, and the
 * cost of one extra simultaneous call is a secondary refusal that lowers the
 * bound — evidence, arriving through the mechanism this slice is built on. The
 * cost of the alternative is a board that stops answering.
 *
 * Thirty seconds is {@link SECONDS_PER_SLOT} times the eight simultaneous calls
 * that were refused on 2026-08-27, near enough: a queue that deep drains inside
 * this window at the assumed call length.
 */
export const SLOT_WAIT_MAX_MS = 30 * 1000;

/**
 * Whether a caller that has been waiting should stop waiting and call.
 *
 * @param waitedMs - how long it has been asking for a slot.
 * @returns true where the wait has run out and the call proceeds unbounded.
 */
export const waitExhausted = (waitedMs: number): boolean => waitedMs >= SLOT_WAIT_MAX_MS;
