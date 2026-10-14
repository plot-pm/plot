import {
  recordDeliveryFailure,
  retryVerdict,
  type DeliveryFailure,
  type RetryVerdict,
} from './auto-deliver.js';
import type { HeldSlice } from './queue.js';
import type { Headroom } from '../entities/machine.js';

/**
 * The consecutive failed runs of one plan under one commit.
 *
 * The shape is {@link DeliveryFailure}'s, and `reading` holds the commit the
 * run started under. A record whose commit differs from the plan's current one
 * no longer applies.
 */
export type RunFailure = DeliveryFailure;

/** How many failed runs, across plans and since the last success, halt the fleet's runs of this kind. */
export const RUN_HALT_AFTER = 3;

/**
 * The failure state a daemon persists for one run kind, beside and apart from
 * the delivery failures.
 */
export interface RunStore {
  /** The failed runs per plan slug. */
  readonly failures: Readonly<Record<string, RunFailure>>;
  /** Epoch milliseconds of every failed run since the last success, across plans. */
  readonly failedAt: readonly number[];
  /** Epoch milliseconds of the last successful run, or `0` for none. */
  readonly lastSuccessAt: number;
}

/**
 * Records one more failed run of a plan.
 *
 * The count continues only when `previous` carries the same commit.
 *
 * @param previous - the record before this failure, or `undefined`.
 * @param commit - the plan's commit when the failed run started.
 * @param at - epoch milliseconds of the failure.
 * @returns the new record.
 */
export const recordRunFailure = (
  previous: RunFailure | undefined,
  commit: string,
  at: number,
): RunFailure => recordDeliveryFailure(previous, commit, at);

/**
 * What a plan's run failures allow now: `ready`, `waiting` for the delay after
 * the last failure, or `stopped` after {@link RUN_HALT_AFTER} happen not to be
 * the bound this reads — see `retryVerdict`'s own `AUTO_DELIVER_MAX_FAILURES`.
 *
 * @param failure - the recorded failures, or `undefined` for none.
 * @param commit - the plan's current commit.
 * @param now - epoch milliseconds.
 * @returns the verdict.
 */
export const runRetryVerdict = (
  failure: RunFailure | undefined,
  commit: string,
  now: number,
): RetryVerdict => retryVerdict(failure, commit, now);

/**
 * How many failed runs, across plans, are newer than the last success.
 *
 * @param store - the persisted failure state.
 * @returns the count.
 */
export const failuresSinceSuccess = (store: Pick<RunStore, 'failedAt' | 'lastSuccessAt'>): number =>
  store.failedAt.filter((at) => at > store.lastSuccessAt).length;

/**
 * Whether the fleet starts no run of this kind, for any plan:
 * {@link RUN_HALT_AFTER} or more failed runs are newer than the last success.
 * A person's restart that succeeds moves `lastSuccessAt` and lifts it.
 *
 * @param store - the persisted failure state.
 * @returns `true` when halted.
 */
export const runHalted = (store: Pick<RunStore, 'failedAt' | 'lastSuccessAt'>): boolean =>
  failuresSinceSuccess(store) >= RUN_HALT_AFTER;

/** The last of {@link verifyStart}'s and `specStart`'s refusals: no slot was free. */
export type SlotRefusal = 'queue-unread' | 'no-free-agent' | 'starved';

/** What {@link slotRefusal} reads to decide the slot refusal, shared by every run kind. */
export interface SlotRefusalInput {
  /** The slices the queue's last pass held, or `null` where no pass has been read. */
  readonly held: readonly HeldSlice[] | null;
  /** The machine's headroom. */
  readonly headroom: Headroom;
  /** Whether `Machine override` is on. */
  readonly machineOverride: boolean;
}

/**
 * The slot refusal a run start reads last, in order: `queue-unread` while no
 * queue pass has been read, `no-free-agent` while any slice is held on one,
 * `starved` without `Machine override`. `null` when none applies.
 *
 * @param input - the readings.
 * @returns the refusal, or `null`.
 */
export const slotRefusal = (input: SlotRefusalInput): SlotRefusal | null => {
  if (input.held === null) return 'queue-unread';
  if (input.held.some((slice) => slice.hold === 'no-free-agent')) return 'no-free-agent';
  if (input.headroom === 'starved' && !input.machineOverride) return 'starved';
  return null;
};
