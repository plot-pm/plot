import {
  AUTO_DELIVER_MAX_FAILURES,
  recordDeliveryFailure,
  retryVerdict,
  type DeliveryFailure,
  type RetryVerdict,
} from './auto-deliver.js';
import type { HeldSlice } from './queue.js';
import type { Headroom } from '../entities/machine.js';

/**
 * The consecutive failed verify runs of one plan under one delivery commit.
 *
 * The shape is {@link DeliveryFailure}'s, and `reading` holds the plan's
 * delivery commit. A record whose commit differs from the plan's current one no
 * longer applies: a re-delivery after `/plot-reject` starts the count again.
 */
export type VerifyFailure = DeliveryFailure;

/** How many consecutive failed verify runs under one delivery commit stop a plan. */
export const VERIFY_MAX_FAILURES = AUTO_DELIVER_MAX_FAILURES;

/** How many failed verify runs, across plans and since the last success, halt the fleet's verify runs. */
export const VERIFY_HALT_AFTER = 3;

/**
 * The failure state the daemon persists in `.plot/state/auto-verify-in-flight.json`,
 * beside and apart from the delivery failures.
 */
export interface VerifyStore {
  /** The failed runs per plan slug. */
  readonly failures: Readonly<Record<string, VerifyFailure>>;
  /** Epoch milliseconds of every failed run since the last prune, across plans. */
  readonly failedAt: readonly number[];
  /** Epoch milliseconds of the last successful run, or `0` for none. */
  readonly lastSuccessAt: number;
}

/**
 * Records one more failed verify run of a plan.
 *
 * The count continues only when `previous` carries the same delivery commit.
 *
 * @param previous - the record before this failure, or `undefined`.
 * @param commit - the plan's delivery commit when the failed run started.
 * @param at - epoch milliseconds of the failure.
 * @returns the new record.
 */
export const recordVerifyFailure = (
  previous: VerifyFailure | undefined,
  commit: string,
  at: number,
): VerifyFailure => recordDeliveryFailure(previous, commit, at);

/**
 * What a plan's verify failures allow now: `ready`, `waiting` for the delay
 * after the last failure, or `stopped` after {@link VERIFY_MAX_FAILURES}.
 *
 * @param failure - the recorded failures, or `undefined` for none.
 * @param commit - the plan's current delivery commit.
 * @param now - epoch milliseconds.
 * @returns the verdict.
 */
export const verifyRetryVerdict = (
  failure: VerifyFailure | undefined,
  commit: string,
  now: number,
): RetryVerdict => retryVerdict(failure, commit, now);

/**
 * How many failed runs, across plans, are newer than the last success.
 *
 * @param store - the persisted failure state.
 * @returns the count.
 */
export const failuresSinceSuccess = (store: Pick<VerifyStore, 'failedAt' | 'lastSuccessAt'>): number =>
  store.failedAt.filter((at) => at > store.lastSuccessAt).length;

/**
 * Whether the fleet starts no verify run of any plan: {@link VERIFY_HALT_AFTER}
 * or more failed runs are newer than the last success. A person's restart
 * that succeeds moves `lastSuccessAt` and lifts it.
 *
 * @param store - the persisted failure state.
 * @returns `true` when halted.
 */
export const verifyHalted = (store: Pick<VerifyStore, 'failedAt' | 'lastSuccessAt'>): boolean =>
  failuresSinceSuccess(store) >= VERIFY_HALT_AFTER;

/** The two `## Plot Config` readings the daemon path needs. */
export interface AutoVerifyConfig {
  /** `Auto-verify`: `true` only for the literal `true`. */
  readonly autoVerify: boolean;
  /** `Verify command`: the shell invocation that starts a run, or `''`. */
  readonly verifyCommand: string;
}

/**
 * Whether the daemon path is on: `Auto-verify` is `true` and `Verify command`
 * is declared.
 *
 * @param config - the two config readings.
 * @returns `true` when the fleet may start verify runs.
 */
export const autoVerify = (config: AutoVerifyConfig): boolean =>
  config.autoVerify && config.verifyCommand.trim() !== '';

/** Why {@link verifyStart} starts no run. */
export type VerifyRefusal =
  | 'off'
  | 'starved'
  | 'no-free-agent'
  | 'running'
  | 'tracer'
  | 'halted'
  | 'stopped'
  | 'waiting';

/** What {@link verifyStart} answers: start, or the named reason it does not. */
export type VerifyStartAnswer =
  | { readonly start: true }
  | { readonly start: false; readonly reason: VerifyRefusal };

/** What {@link verifyStart} reads. */
export interface VerifyStartInput {
  /** What {@link autoVerify} answered. */
  readonly on: boolean;
  /** The plan's slug. */
  readonly slug: string;
  /** `Tracer: yes` on the plan. */
  readonly tracer: boolean;
  /** The plan's delivery commit, `recordCommit(file, 'Delivered')`. */
  readonly deliveryCommit: string;
  /** The machine's headroom. */
  readonly headroom: Headroom;
  /** Whether `Machine override` is on. */
  readonly machineOverride: boolean;
  /** The slices that stayed queued this pass. */
  readonly held: readonly HeldSlice[];
  /** The slugs with a verify run going. */
  readonly going: ReadonlySet<string>;
  /** The persisted failure state. */
  readonly store: VerifyStore;
  /** Epoch milliseconds. */
  readonly now: number;
}

/**
 * Decides whether a verify run of one Delivered plan may start, and names the
 * reason when it may not. The first refusal that holds is the answer, in this
 * order: `off`, `tracer`, `running`, `halted`, `stopped`, `waiting`,
 * `no-free-agent`, `starved`.
 *
 * `starved` refuses only without `Machine override`. `no-free-agent` refuses
 * while any slice is held on it: work that was ready and had nobody to take it
 * goes before a verification. `running` is per plan; a run going for another
 * plan does not refuse.
 *
 * @param input - the readings.
 * @returns the answer.
 */
export const verifyStart = (input: VerifyStartInput): VerifyStartAnswer => {
  const refuse = (reason: VerifyRefusal): VerifyStartAnswer => ({ start: false, reason });
  if (!input.on) return refuse('off');
  if (input.tracer) return refuse('tracer');
  if (input.going.has(input.slug)) return refuse('running');
  if (verifyHalted(input.store)) return refuse('halted');
  const verdict = verifyRetryVerdict(input.store.failures[input.slug], input.deliveryCommit, input.now);
  if (verdict === 'stopped') return refuse('stopped');
  if (verdict === 'waiting') return refuse('waiting');
  if (input.held.some((slice) => slice.hold === 'no-free-agent')) return refuse('no-free-agent');
  if (input.headroom === 'starved' && !input.machineOverride) return refuse('starved');
  return { start: true };
};

/** One row of *Waiting on you* for a Delivered plan whose verification needs a person. */
export interface VerificationRow {
  readonly slug: string;
  /** What the row says, in one line. */
  readonly reason: string;
  /** The log of the failed run. */
  readonly log: string;
  /** The command that restarts the run by hand. */
  readonly restart: string;
  /** Whether this plan itself reads `stopped`. */
  readonly stopped: boolean;
  /** Whether the fleet starts no verify run of any plan. */
  readonly fleetHalted: boolean;
}

/**
 * The *Waiting on you* row of a plan with a failed verify run, or `null` for
 * a plan with none that applies.
 *
 * The row reads the failure records; it derives none. A record under another
 * delivery commit does not apply. `fleetHalted` is set from the store, so a
 * plan with one failure still says the fleet is halted when it is.
 *
 * @param slug - the plan slug.
 * @param commit - the plan's current delivery commit.
 * @param store - the persisted failure state.
 * @param log - the path of the failed run's log.
 * @param now - epoch milliseconds.
 * @returns the row, or `null`.
 */
export const verificationRow = (
  slug: string,
  commit: string,
  store: VerifyStore,
  log: string,
  now: number,
): VerificationRow | null => {
  const failure = store.failures[slug];
  if (failure === undefined || failure.reading !== commit) return null;
  const stopped = verifyRetryVerdict(failure, commit, now) === 'stopped';
  const fleetHalted = verifyHalted(store);
  const parts = [`verification failed ${failure.count} time${failure.count === 1 ? '' : 's'}`];
  if (stopped) parts.push('the fleet stopped retrying this plan');
  if (fleetHalted) parts.push('the fleet is halted on verification failures');
  return { slug, reason: parts.join('; '), log, restart: `/plot-deliver --verify ${slug}`, stopped, fleetHalted };
};
