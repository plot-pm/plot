import {
  recordDeliveryFailure,
  retryVerdict,
  type DeliveryFailure,
  type RetryVerdict,
} from './auto-deliver.js';
import { BOUND_CODE } from './board-run-end.js';
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

/** How many failed verify runs, across plans and since the last success, halt the fleet's verify runs. */
export const VERIFY_HALT_AFTER = 3;

/**
 * The failure state the daemon persists in `.plot/state/auto-verify-in-flight.json`,
 * beside and apart from the delivery failures.
 */
export interface VerifyStore {
  /** The failed runs per plan slug. */
  readonly failures: Readonly<Record<string, VerifyFailure>>;
  /** Epoch milliseconds of every failed run since the last success, across plans. */
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
 * after the last failure, or `stopped` after `AUTO_DELIVER_MAX_FAILURES`.
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
  | 'queue-unread'
  | 'running'
  | 'hand-run'
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
  /** The slices the queue's last pass held, or `null` where no pass has been read. */
  readonly held: readonly HeldSlice[] | null;
  /** The slugs with a verify run this fleet started that is still going. */
  readonly going: ReadonlySet<string>;
  /** Whether the plan has verification trees on this machine that this fleet did not start. */
  readonly handRun: boolean;
  /** The persisted failure state. */
  readonly store: VerifyStore;
  /** Epoch milliseconds. */
  readonly now: number;
}

/**
 * Decides whether a verify run of one Delivered plan may start, and names the
 * reason when it may not. The first refusal that holds is the answer, in this
 * order: `off`, `tracer`, `running`, `hand-run`, `halted`, `stopped`,
 * `waiting`, `queue-unread`, `no-free-agent`, `starved`.
 *
 * `running` refuses while any verify run is going, for any plan: the machine
 * carries at most one verify process. `hand-run` refuses a plan whose trees a
 * person's run holds. `queue-unread` refuses while no queue pass has been read,
 * because an unread queue is not an empty one. `no-free-agent` refuses while
 * any slice is held on it. `starved` refuses only without `Machine override`.
 *
 * @param input - the readings.
 * @returns the answer.
 */
export const verifyStart = (input: VerifyStartInput): VerifyStartAnswer => {
  const refuse = (reason: VerifyRefusal): VerifyStartAnswer => ({ start: false, reason });
  if (!input.on) return refuse('off');
  if (input.tracer) return refuse('tracer');
  if (input.going.size > 0) return refuse('running');
  if (input.handRun) return refuse('hand-run');
  if (verifyHalted(input.store)) return refuse('halted');
  const verdict = verifyRetryVerdict(input.store.failures[input.slug], input.deliveryCommit, input.now);
  if (verdict === 'stopped') return refuse('stopped');
  if (verdict === 'waiting') return refuse('waiting');
  if (input.held === null) return refuse('queue-unread');
  if (input.held.some((slice) => slice.hold === 'no-free-agent')) return refuse('no-free-agent');
  if (input.headroom === 'starved' && !input.machineOverride) return refuse('starved');
  return { start: true };
};

/** A Delivered plan as the default branch reads it. */
export interface VerifyPlanReading {
  /** The plan's delivery commit. */
  readonly deliveryCommit: string;
  /** Whether the plan carries a current record, `supported` or `refuted`, for that commit. */
  readonly verified: boolean;
}

/** What a finished verify run counts as. */
export type VerifySettlement =
  | { readonly settle: 'success' }
  | { readonly settle: 'failure'; readonly why: string }
  | { readonly settle: 'gone'; readonly why: string };

/**
 * What one finished verify run counts as.
 *
 * The run succeeded when the default branch now holds a current record for
 * the commit it judged. It failed otherwise: on its time bound (`124`), on
 * another non-zero exit, or on a clean exit that left no record. A run whose
 * plan no longer reads Delivered, or whose plan was delivered again under
 * another commit, is `gone`: it is neither, because what it judged no longer
 * applies.
 *
 * @param code - the run's exit code, or `null` where none was recorded.
 * @param commit - the delivery commit the run judged.
 * @param plan - the plan at the default branch, or `null` where it no longer reads Delivered.
 * @returns the settlement.
 */
export const settleVerifyRun = (
  code: number | null,
  commit: string,
  plan: VerifyPlanReading | null,
): VerifySettlement => {
  if (plan === null) return { settle: 'gone', why: 'the plan no longer reads Delivered' };
  if (plan.deliveryCommit !== commit) return { settle: 'gone', why: 'the plan was delivered again' };
  if (plan.verified) return { settle: 'success' };
  if (code === BOUND_CODE) return { settle: 'failure', why: 'the run reached Worker bound' };
  if (code !== null && code !== 0) return { settle: 'failure', why: `the run exited ${code}` };
  return { settle: 'failure', why: 'the run left no record' };
};

/** One finished run, as {@link settleVerifyRuns} reads it. */
export interface EndedVerifyRun {
  readonly slug: string;
  /** The delivery commit the run judged. */
  readonly commit: string;
  /** The exit code, or `null` where none was recorded. */
  readonly code: number | null;
}

/** What {@link settleVerifyRuns} answers. */
export interface VerifySettled {
  /** The failure state after the settlements. */
  readonly store: VerifyStore;
  /** Each settled run and what it counted as; a person's record is listed with `success`. */
  readonly settled: readonly { readonly slug: string; readonly settlement: VerifySettlement }[];
}

/**
 * Settles the finished runs into the failure state, then clears the failure
 * record of every plan a person verified since.
 *
 * A success removes the plan's failure record, sets `lastSuccessAt` and clears
 * `failedAt`, which lifts a fleet halt. A failure adds one to the plan's
 * count under the commit it judged and one entry to `failedAt`. A `gone` run
 * changes nothing. A plan with a failure record, no run going, and a current
 * record at the default branch was verified by a person's
 * `/plot-deliver --verify`: it counts as a success.
 *
 * @param store - the failure state before.
 * @param ended - the runs that finished.
 * @param plans - the Delivered plans at the default branch, by slug.
 * @param going - the slugs with a run still going.
 * @param now - epoch milliseconds.
 * @returns the new state and the settlements.
 */
export const settleVerifyRuns = (
  store: VerifyStore,
  ended: readonly EndedVerifyRun[],
  plans: ReadonlyMap<string, VerifyPlanReading>,
  going: ReadonlySet<string>,
  now: number,
): VerifySettled => {
  let failures: Record<string, VerifyFailure> = { ...store.failures };
  let failedAt = [...store.failedAt];
  let lastSuccessAt = store.lastSuccessAt;
  const settled: { slug: string; settlement: VerifySettlement }[] = [];
  const succeed = (slug: string): void => {
    failures = Object.fromEntries(Object.entries(failures).filter(([key]) => key !== slug));
    failedAt = [];
    lastSuccessAt = now;
  };
  for (const run of ended) {
    const settlement = settleVerifyRun(run.code, run.commit, plans.get(run.slug) ?? null);
    settled.push({ slug: run.slug, settlement });
    if (settlement.settle === 'success') succeed(run.slug);
    if (settlement.settle === 'failure') {
      failures = { ...failures, [run.slug]: recordVerifyFailure(failures[run.slug], run.commit, now) };
      failedAt = [...failedAt, now];
    }
  }
  const endedSlugs = new Set(ended.map((run) => run.slug));
  for (const slug of Object.keys(failures)) {
    if (going.has(slug) || endedSlugs.has(slug) || plans.get(slug)?.verified !== true) continue;
    settled.push({ slug, settlement: { settle: 'success' } });
    succeed(slug);
  }
  return { store: { failures, failedAt, lastSuccessAt }, settled };
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
