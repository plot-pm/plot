import { allSlicesConfirmed, allSlicesMerged, type PlanFile } from './deliverable.js';
import type { FleetReading } from '../entities/fleet.js';
import { planSlug } from './auto-dispatch.js';

export { planSlug };

/**
 * One plan this pulse says has finished, and the file the delivery will move.
 *
 * The slug is what `plot-deliver.sh` resolves the plan from; `file` is carried
 * only so a log line can name what was delivered.
 */
export interface AutoDeliverPlan {
  slug: string;
  file: string;
}

export interface PlanAutoDeliverInput {
  /**
   * Whether the scan that produced this pulse FINISHED.
   *
   * Threaded in because `allSlicesMerged` needs it to tell *not merged* from
   * *not yet known* (#491), and neither is a reason to deliver — but only one
   * of them is a reason to give up on a plan. Defaults to `true`: a caller
   * that does not know is a test with a hand-built pulse, where the pulse IS
   * the whole world and is complete by construction.
   */
  complete?: boolean;

  /**
   * The pulse the scan just landed — every plan's phase AND the merge state of
   * every branch, which is the whole input this decision takes.
   *
   * Read from the pulse rather than from plan files, and that is the same
   * choice `allSlicesMerged` documents for merge state, extended to the phase.
   * The scan has just walked the estate; re-reading 150 plan files to learn what
   * it already reported would put this actor on a different clock from the
   * measurement it acts on, and the two could then disagree about which plans
   * exist. `PlanSchema.phase` is `plot-plan-meta.sh`'s own normalization,
   * so it is the same parser's answer either way.
   */
  pulse: FleetReading | null;
  /** Slugs a delivery has already been started for and not yet confirmed. */
  inFlight: Set<string>;
  /**
   * The failed deliveries recorded per slug. A plan whose record holds it back
   * ({@link retryVerdict}) is not named. Absent means no failure is recorded.
   */
  failures?: Readonly<Record<string, DeliveryFailure>>;
  /** Epoch milliseconds, for the retry delay. Read only where `failures` names the plan. */
  now?: number;
}

/**
 * The consecutive failed deliveries of one plan.
 *
 * `reading` is {@link deliveryReading} of the plan when the last attempt
 * started. A record whose reading differs from the plan's current one no
 * longer applies: the plan changed, so its count starts again.
 */
export interface DeliveryFailure {
  /** Consecutive failed attempts, at least 1. */
  count: number;
  /** Epoch milliseconds of the last failure. */
  lastAt: number;
  /** The plan's reading when the attempt started. */
  reading: string;
}

/** How many consecutive failed deliveries stop the automatic retry of a plan. */
export const AUTO_DELIVER_MAX_FAILURES = 3;

/** The wait after the first failed delivery. Each further failure doubles it. */
export const AUTO_DELIVER_RETRY_BASE_MS = 60_000;

/**
 * How long to wait after the `count`-th consecutive failure before the next
 * attempt: 60 s after the first, 120 s after the second.
 *
 * @param count - the consecutive failures so far, at least 1.
 * @returns the delay in milliseconds.
 */
export const retryDelayMs = (count: number): number => AUTO_DELIVER_RETRY_BASE_MS * 2 ** (count - 1);

/**
 * What a plan's failure record allows now.
 *
 * - `ready` — no record applies, or the delay after the last failure has passed.
 * - `waiting` — the delay after the last failure has not passed yet.
 * - `stopped` — {@link AUTO_DELIVER_MAX_FAILURES} consecutive failures under
 *   the same reading. Only a person, or a change to the plan's reading, starts
 *   the next attempt.
 */
export type RetryVerdict = 'ready' | 'waiting' | 'stopped';

/**
 * Decides whether a plan with a failure record may be delivered again.
 *
 * @param failure - the recorded failures, or `undefined` for none.
 * @param reading - the plan's current {@link deliveryReading}.
 * @param now - epoch milliseconds.
 * @returns the verdict.
 */
export const retryVerdict = (
  failure: DeliveryFailure | undefined,
  reading: string,
  now: number,
): RetryVerdict => {
  if (failure === undefined || failure.reading !== reading) return 'ready';
  if (failure.count >= AUTO_DELIVER_MAX_FAILURES) return 'stopped';
  return now - failure.lastAt >= retryDelayMs(failure.count) ? 'ready' : 'waiting';
};

/**
 * Records one more failed delivery.
 *
 * The count continues only when `previous` carries the same reading; a
 * changed reading starts the count at 1.
 *
 * @param previous - the record before this failure, or `undefined`.
 * @param reading - the plan's reading when the failed attempt started.
 * @param at - epoch milliseconds of the failure.
 * @returns the new record.
 */
export const recordDeliveryFailure = (
  previous: DeliveryFailure | undefined,
  reading: string,
  at: number,
): DeliveryFailure => ({
  count: previous !== undefined && previous.reading === reading ? previous.count + 1 : 1,
  lastAt: at,
  reading,
});

/**
 * A plan's reading for the failure count: every branch with its state, sorted.
 *
 * A new merge, a new branch or a reopened branch changes it, and a changed
 * reading resets the count.
 *
 * @param plan - the plan as the pulse reports it.
 * @returns a stable string.
 */
export const deliveryReading = (plan: FleetReading['plans'][number]): string =>
  plan.slices
    .flatMap((slice) => slice.branches.map((b) => `${b.branch}=${b.state}`))
    .sort()
    .join(',');

/**
 * The reading of every plan in a pulse, by slug.
 *
 * @param pulse - the pulse, or `null`.
 * @returns slug to {@link deliveryReading}; empty for a `null` pulse.
 */
export const deliveryReadings = (pulse: FleetReading | null): Map<string, string> =>
  new Map((pulse?.plans ?? []).map((plan) => [planSlug(plan.file), deliveryReading(plan)]));

/**
 * Drops the failure records that no longer apply.
 *
 * A record stays while its plan still reads `approved` with the same reading.
 * A plan that left `approved`, left the pulse, or changed its reading loses
 * its record. A `null` pulse says nothing, so every record stays.
 *
 * @param failures - the records on disk.
 * @param pulse - the pulse the scan just wrote.
 * @returns the records that still apply, as a new object.
 */
export const pruneFailures = (
  failures: Readonly<Record<string, DeliveryFailure>>,
  pulse: FleetReading | null,
): Record<string, DeliveryFailure> => {
  if (!pulse) return { ...failures };
  const out: Record<string, DeliveryFailure> = {};
  for (const plan of pulse.plans) {
    const slug = planSlug(plan.file);
    const failure = failures[slug];
    if (failure === undefined) continue;
    if (plan.phase.toLowerCase() !== 'approved') continue;
    if (failure.reading !== deliveryReading(plan)) continue;
    out[slug] = failure;
  }
  return out;
};

/**
 * The join key `allSlicesMerged` takes, built from a pulse plan.
 *
 * `allSlicesMerged` finds its plan by `path.basename(meta.file)`, and a pulse
 * plan's `file` is ALREADY that basename — so this is the identity mapping plus
 * the fields the signature requires. Building it here rather than reading the
 * plan file again is what keeps this actor on the pulse's clock: the function is
 * called with the scan's own answer, not with a second opinion about it.
 */
export const joinKey = (file: string): PlanFile => ({ file }) as PlanFile;

/**
 * How many of a plan's branches the scan saw MERGE.
 *
 * Deliberately not `allSlicesMerged`'s arithmetic: that rule answers *is this
 * plan finished*, which an all-deferred plan legitimately is. This answers
 * *did anything land here*, which is what separates a delivery a person
 * decided from one this actor would perform unattended.
 *
 * Read from the pulse, never from the plan file. The plan file carries no
 * merge record, and inventing one would answer a different question than the
 * scan does — the same rule the docstring above states for merge state.
 *
 * @param plan - the plan as the pulse reports it.
 * @returns the count of branches in the `merged` state, across every slice.
 */
export const landedBranches = (plan: FleetReading['plans'][number]): number =>
  plan.slices.reduce(
    (n, slice) => n + slice.branches.filter((b) => b.state === 'merged').length,
    0,
  );


/**
 * Which plans this pulse has FINISHED — the whole decision, and pure.
 *
 * Separated from the act for the reason `auto-dispatch.ts` separates its own:
 * every refusal below is a property worth asserting directly, and asserting it
 * through a spawn would test the stub rather than the rule.
 *
 * Five things must hold, and each is a `Done when` item that exists because a
 * naive implementation would pass without it:
 *
 *  - **The phase is `approved`.** A `draft` plan has not been approved and a
 *    `delivered` one is already answered; `plot-deliver.sh` refuses both, and
 *    spawning it to be refused would put a failure in a log every five seconds.
 *
 *  - **Every non-deferred branch has merged** — `allSlicesMerged`, CALLED and not
 *    reimplemented. This is the gate `/plot-deliver` applies by hand, and an
 *    auto-deliverer that skips it ships the exact refusal Plot exists to
 *    enforce. Calling the shared function rather than re-deriving it is also
 *    what lets a fix to the gate reach this actor without anyone remembering to
 *    copy it.
 *
 *  - **At least one branch actually merged**, and since 2026-09-23 this actor
 *    MEASURES IT rather than inheriting it. Shelved is not finished: delivering
 *    it would record a completion nobody decided, and that call stays with a
 *    person.
 *
 *    This property was always the contract and was enforced by borrowing
 *    `allSlicesMerged`'s `merged > 0` guard. That guard answered a different
 *    question — *does this plan name any work at all* — and could not separate
 *    a plan whose branches were given up from a plan nobody built, so a plan
 *    of only deferred slices was undeliverable BY HAND for the same reason it
 *    was undelivered here. `the-rule-counts-what-was-given-up` fixed the
 *    manual path; this gate keeps the automatic one where it was.
 *
 *    The asymmetry is deliberate. A person delivering an all-deferred plan is
 *    deciding; this path runs on the scan's clock with no switch and no cap,
 *    and chains delivery to a reap and then to `plot-release-refs.sh --yes`,
 *    which deletes refs. Measured 2026-09-22: widening the rule alone would
 *    have auto-delivered two approved plans on the next tick, one of them
 *    carrying three corrections its delivery panel owed to a person.
 *
 *  - **No failure record holds it back** ({@link retryVerdict}): after a
 *    failed delivery the plan waits {@link retryDelayMs}, and after
 *    {@link AUTO_DELIVER_MAX_FAILURES} failures under one reading it stops.
 *
 *  - **No delivery is already in flight for it.** The scan fires every few
 *    seconds and `plot-deliver.sh` pushes to the default branch; without this,
 *    a plan would be delivered a dozen times over while the first run was still
 *    working. Idempotence makes that harmless, not free.
 *
 * Note what is NOT re-derived: merge state comes from the pulse, never from the
 * plan file, because the plan file carries no merge record and inventing one
 * here would answer a different question than the scan does.
 */
export const planAutoDeliver = (input: PlanAutoDeliverInput): AutoDeliverPlan[] => {
  const { pulse, inFlight, complete = true, failures = {}, now = 0 } = input;
  if (!pulse) return [];
  const out: AutoDeliverPlan[] = [];
  for (const plan of pulse.plans) {
    if (plan.phase.toLowerCase() !== 'approved') continue;
    const slug = planSlug(plan.file);
    if (inFlight.has(slug)) continue;
    // The measurement. It answers `not-merged` for a plan the pulse does not
    // know and for any unmerged non-deferred branch.
    //
    // THE WORD, not truthiness: since #491 this returns
    // 'merged' | 'not-merged' | 'unknown', and 'unknown' means the scan could
    // not answer. Auto-delivery acts only on a definite yes — delivering on an
    // unanswered question is the defect #491 removes, one layer up.
    //
    // `allSlicesConfirmed` RATHER THAN `allSlicesMerged`, so a landing only a
    // merge subject proves reads `unknown` here and no tick starts a delivery.
    // THAT IS WHAT KEEPS THIS PATH FROM STICKING: without it, a subject-proven
    // plan reads merged during a throttle, the first tick starts
    // `plot-deliver.sh`, which asks the host and refuses, and
    // `pruneDelivering` keeps the slug in `inFlight` while the plan still
    // reads approved and merged — so no later tick delivers until the board
    // restarts. With it, nothing enters `inFlight` and the first tick after
    // the host confirms the merge delivers.
    if (allSlicesConfirmed(joinKey(plan.file), pulse, complete) !== 'merged') continue;

    // AND AT LEAST ONE BRANCH MUST HAVE LANDED HERE. This gate is narrower
    // than the rule above on purpose, and the asymmetry is the whole point.
    //
    // A plan whose every slice is deferred IS deliverable — that is what
    // `allSlicesMerged` now says, and it is right for the board's Deliver
    // control and for `/plot-deliver`, where a person is deciding. It is not
    // right for THIS path, which runs unattended on the scan's clock with no
    // switch and no cap, and chains delivery to a reap and then to
    // `plot-release-refs.sh --yes` — a ref deletion that cannot be undone.
    //
    // Measured 2026-09-22, before this gate existed: widening the rule alone
    // would have auto-delivered two approved plans on the next tick, one of
    // them `a-failed-tick-must-not-end-the-daemon`, whose delivery panel
    // refuted it and left three corrections owed to a person. An automatic
    // path must not resolve a question a person has been asked.
    //
    // A deferred branch is work NOT DONE HERE, so nothing about it was
    // verified on this machine. `landedBranches > 0` is the measurement that
    // something was: a PR merged, and the scan saw it.
    if (landedBranches(plan) === 0) continue;

    // A FAILED DELIVERY WAITS, AND STOPS AFTER THE BOUND. A delivery that
    // always fails would otherwise restart on every pass.
    if (retryVerdict(failures[slug], deliveryReading(plan), now) !== 'ready') continue;

    out.push({ slug, file: plan.file });
  }
  return out;
};

/**
 * Retire the slugs whose delivery has landed, so the set does not grow forever.
 *
 * A plan still reading `approved` with every slice merged is one whose delivery
 * has not taken effect yet — it stays in flight. Anything else is confirmed:
 * either the phase moved (the delivery worked) or the plan stopped being
 * deliverable (a branch reopened, and the next pulse will decide afresh).
 *
 * Returned whole rather than mutated, the cache's one-directional rule.
 */
export const pruneDelivering = (
  inFlight: Set<string>,
  pulse: FleetReading | null,
  complete = true,
): Set<string> => {
  if (inFlight.size === 0) return inFlight;
  // A pulse the scan could not land says nothing about whether anything
  // finished, and "nothing said" is not "confirmed". Holding the set unchanged
  // keeps a delivery from being started twice across a failed scan.
  if (!pulse) return inFlight;
  const stillPending = new Set<string>();
  for (const plan of pulse.plans) {
    const slug = planSlug(plan.file);
    if (!inFlight.has(slug)) continue;
    if (plan.phase.toLowerCase() !== 'approved') continue; // moved on — confirmed
    // Same rule, and the distinction matters here: only a definite answer
    // confirms anything. 'unknown' confirms nothing, so the plan stays in
    // flight rather than being pruned on silence.
    if (allSlicesMerged(joinKey(plan.file), pulse, complete) !== 'merged') continue;
    stillPending.add(slug);
  }
  return stillPending;
};
