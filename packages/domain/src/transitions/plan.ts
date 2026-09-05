// From `entities/version.js` rather than `entities/release.js`, which re-exports
// it. The `Release` entity's schemas import `zod` at module scope, and this is a
// VALUE import — a bundle taking one transition took `zod` with it, at 324 KB
// for four lines of string handling. See `entities/version.ts`.
import { normalizeVersion } from '../entities/version.js';

/**
 * A plan's state as the parser normalizes it.
 *
 * A plan has a state; the development workflow has phases. The two are
 * different concepts and {@link ../rules/phase.js#Phase} names the other one:
 * a `delivered` plan is in the `Testing` phase.
 *
 * `none` is the parser's answer for a plan whose state could not be read, and
 * is distinct from every real state: it means unmeasured, not early.
 */
export type PlanState =
  | 'draft'
  | 'design'
  | 'approved'
  | 'delivered'
  | 'released'
  | 'rejected'
  | 'superseded'
  | 'none';

/**
 * The review channel a plan declares.
 *
 * `none` is a plan that recorded no answer, which the workflow reads as `pr`.
 * An unrecognised string is representable, because refusing one is a gate.
 */
export type ReviewChannel = 'pr' | 'in-session' | 'ballot' | 'none' | (string & {});

/**
 * What a transition needs to read from a plan.
 *
 * Structurally typed, so a caller holding a richer plan record passes it
 * unchanged. The three record fields carry the transition lines as written, or
 * `''` where the plan has none.
 */
export interface TransitionPlan {
  /** The plan's slug, carried onto the decision. */
  slug: string;
  /** The state as the parser normalized it. The wire key stays `phase`. */
  phase: PlanState;
  /** The declared review channel. */
  review: ReviewChannel;
  /** The `Approved:` line as written, or `''`. */
  approvedRecord: string;
  /** The `Delivered:` line as written, or `''`. */
  deliveredRecord: string;
  /** The `Released:` line as written, or `''`. */
  releasedRecord: string;
}

/**
 * A fact a transition needs but cannot measure — supplied by an adapter.
 *
 * The PR check is the motivating case: it needs a host, so the domain takes it
 * as a reading rather than performing it.
 */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/** Why a transition refused, as a value a caller can branch on. */
export type RefusalReason =
  | 'state-terminal'
  | 'state-too-early'
  | 'state-wrong'
  | 'state-unreadable'
  | 'review-human'
  | 'review-unrecognised'
  | 'version-missing'
  | 'precondition-unmet';

/**
 * A refused transition, naming which gate fired.
 *
 * @see RefusalReason for the gates.
 */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The plan the refusal is about. */
  readonly slug: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/**
 * A transition that should happen: a state and the record that dates it.
 *
 * The two travel together because they came apart in practice — a state flip
 * written without its record made a delivered plan invisible to the scan. Both
 * fields are required, so a decision missing either does not typecheck.
 */
export interface Decision {
  readonly outcome: 'decided';
  /** The plan to write to. */
  readonly slug: string;
  /** The state to write. The field is named `phase` because the wire key is. */
  readonly phase: Extract<PlanState, 'approved' | 'delivered' | 'released'>;
  /** The `## Status` field the record belongs on. */
  readonly field: 'Approved' | 'Delivered' | 'Released';
  /** The record's value, without its `- **Field:** ` prefix. */
  readonly record: string;
  /** Whether the plan already carries this state and record, leaving nothing to write. */
  readonly alreadyRecorded: boolean;
}

/** What a transition answers: the write it decided on, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a decided transition.
 *
 * @param result - the result to test.
 * @returns true when the transition decided on a write.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the transition.
 */
export const isRefusal = (result: TransitionResult): result is Refusal =>
  result.outcome === 'refused';

const refuse = (slug: string, reason: RefusalReason, detail: string): Refusal => ({
  outcome: 'refused',
  reason,
  slug,
  detail,
});

/**
 * The first supplied reading that refuses, as a refusal.
 *
 * @param slug - the plan the readings are about.
 * @param preconditions - the readings an adapter supplied.
 * @returns a refusal naming the first unmet reading, or null when all are met.
 */
const unmet = (slug: string, preconditions: readonly Precondition[]): Refusal | null => {
  const failing = preconditions.find((p) => !p.met);
  if (!failing) return null;
  return refuse(
    slug,
    'precondition-unmet',
    failing.detail
      ? `the reading '${failing.name}' refused: ${failing.detail}`
      : `the reading '${failing.name}' is not met`,
  );
};

/** What `approve` needs beyond the plan. */
export interface ApproveInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** The name to record as approver. */
  who: string;
  /** How the approval happened, e.g. `plan-PR #42 merged`. */
  channel: string;
  /** Readings an adapter measured, such as the plan PR's state. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a plan is in a state where Approve should be offered.
 *
 * Callable alone, because a board must know whether to offer the action before
 * anyone takes it. It is not a permission: {@link approve} re-checks, because a
 * caller that asked is indistinguishable from one that did not.
 *
 * @param plan - the plan to test.
 * @returns true when the mechanical gates would pass.
 */
export const approvable = (plan: TransitionPlan): boolean =>
  !isRefusal(approve(plan, { on: '', who: '', channel: '' }));

/**
 * Decides the write that approving a plan calls for.
 *
 * Carries the mechanical refusals only — the state and the review channel. A
 * host-dependent check, such as whether the plan PR merged, is supplied as a
 * precondition reading rather than performed here.
 *
 * `approved` is not refused: it is the idempotent case, where a missing record
 * is still repairable.
 *
 * @param plan - the plan to approve.
 * @param input - the date, approver and channel to record, plus any readings.
 * @returns a decision carrying `approved` and its record, or a refusal naming
 *   the gate that fired: `state-terminal`, `state-unreadable`, `state-wrong`,
 *   `review-human`, `review-unrecognised` or `precondition-unmet`.
 */
export const approve = (plan: TransitionPlan, input: ApproveInput): TransitionResult => {
  switch (plan.phase) {
    case 'draft':
    case 'design':
    case 'approved':
      break;
    case 'delivered':
    case 'released':
      return refuse(
        plan.slug,
        'state-terminal',
        `plan '${plan.slug}' is already ${plan.phase} — nothing to approve.`,
      );
    case 'none':
      return refuse(
        plan.slug,
        'state-unreadable',
        `cannot read the state of '${plan.slug}' — refusing rather than guessing.`,
      );
    default:
      return refuse(
        plan.slug,
        'state-wrong',
        `plan '${plan.slug}' is in state '${plan.phase}' — only a Draft or Design plan can be approved.`,
      );
  }

  switch (plan.review) {
    case 'pr':
    case 'none':
      break;
    case 'in-session':
    case 'ballot':
      return refuse(
        plan.slug,
        'review-human',
        `plan '${plan.slug}' declares 'Review: ${plan.review}' — the approval needs a human.`,
      );
    default:
      return refuse(
        plan.slug,
        'review-unrecognised',
        `plan '${plan.slug}' records an unrecognised 'Review:' answer ('${plan.review}'). Refusing rather than treating it as 'pr'.`,
      );
  }

  const blocked = unmet(plan.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  const written = plan.approvedRecord.trim();
  return {
    outcome: 'decided',
    slug: plan.slug,
    phase: 'approved',
    field: 'Approved',
    record: written === '' ? `${input.on}, ${input.who}, ${input.channel}` : written,
    alreadyRecorded: plan.phase === 'approved' && written !== '',
  };
};

/** What `deliver` needs beyond the plan. */
export interface DeliverInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** Readings an adapter measured, such as whether every branch merged. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a plan is in a state where Deliver should be offered.
 *
 * Callable alone; {@link deliver} re-checks regardless.
 *
 * @param plan - the plan to test.
 * @returns true when the mechanical gates would pass.
 */
export const deliverable = (plan: TransitionPlan): boolean => !isRefusal(deliver(plan, { on: '' }));

/**
 * Decides the write that delivering a plan calls for.
 *
 * Whether the plan's branches have merged is a reading an adapter supplies:
 * merge state is resolved against a remote, which the domain cannot reach.
 *
 * `delivered` is not refused: it is the idempotent case.
 *
 * @param plan - the plan to deliver.
 * @param input - the date to record, plus any readings.
 * @returns a decision carrying `delivered` and its record, or a refusal naming
 *   the gate that fired: `state-terminal`, `state-too-early`,
 *   `state-unreadable`, `state-wrong` or `precondition-unmet`.
 */
export const deliver = (plan: TransitionPlan, input: DeliverInput): TransitionResult => {
  switch (plan.phase) {
    case 'approved':
    case 'delivered':
      break;
    case 'released':
      return refuse(
        plan.slug,
        'state-terminal',
        `plan '${plan.slug}' is already released — nothing to deliver.`,
      );
    case 'draft':
    case 'design':
      return refuse(
        plan.slug,
        'state-too-early',
        `plan '${plan.slug}' is still '${plan.phase}' — approve it first.`,
      );
    case 'none':
      return refuse(
        plan.slug,
        'state-unreadable',
        `cannot read the state of '${plan.slug}' — refusing rather than guessing.`,
      );
    default:
      return refuse(
        plan.slug,
        'state-wrong',
        `plan '${plan.slug}' is in state '${plan.phase}' — only an Approved plan can be delivered.`,
      );
  }

  const blocked = unmet(plan.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  const written = plan.deliveredRecord.trim();
  return {
    outcome: 'decided',
    slug: plan.slug,
    phase: 'delivered',
    field: 'Delivered',
    record: written === '' ? input.on : written,
    alreadyRecorded: plan.phase === 'delivered' && written !== '',
  };
};

/** What `release` needs beyond the plan. */
export interface ReleaseInput {
  /** The date to record, ISO-8601. */
  on: string;
  /** The version to record; normalized to the canonical `vN.N.N` spelling. */
  version: string;
  /** Readings an adapter measured, such as the sprint's Must items. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a plan is in a state where Release should be offered.
 *
 * Callable alone; {@link release} re-checks regardless. Tested with a
 * placeholder version, so it answers about the state rather than the input.
 *
 * @param plan - the plan to test.
 * @returns true when the mechanical gates would pass.
 */
export const releasable = (plan: TransitionPlan): boolean =>
  !isRefusal(release(plan, { on: '', version: 'v0.0.0' }));

/**
 * Decides the write that releasing a plan calls for.
 *
 * The version is normalized through {@link normalizeVersion}, because both
 * spellings appear across the estate while every git tag carries the prefix.
 *
 * `released` is not refused: it is the idempotent case.
 *
 * @param plan - the plan to release.
 * @param input - the date and version to record, plus any readings.
 * @returns a decision carrying `released` and its record, or a refusal naming
 *   the gate that fired: `state-too-early`, `state-unreadable`, `state-wrong`,
 *   `version-missing` or `precondition-unmet`.
 */
export const release = (plan: TransitionPlan, input: ReleaseInput): TransitionResult => {
  switch (plan.phase) {
    case 'delivered':
    case 'released':
      break;
    case 'draft':
    case 'design':
    case 'approved':
      return refuse(
        plan.slug,
        'state-too-early',
        `plan '${plan.slug}' is still '${plan.phase}' — deliver it first.`,
      );
    case 'none':
      return refuse(
        plan.slug,
        'state-unreadable',
        `cannot read the state of '${plan.slug}' — refusing rather than guessing.`,
      );
    default:
      return refuse(
        plan.slug,
        'state-wrong',
        `plan '${plan.slug}' is in state '${plan.phase}' — only a Delivered plan can be released.`,
      );
  }

  const written = plan.releasedRecord.trim();
  const version = normalizeVersion(input.version);
  // Asked only where a record would be written: a plan that already carries one
  // is being repaired, and its version was recorded when it released.
  if (written === '' && version === '') {
    return refuse(
      plan.slug,
      'version-missing',
      `plan '${plan.slug}' cannot be released without a version — a state with no version is a record nobody can resolve.`,
    );
  }

  const blocked = unmet(plan.slug, input.preconditions ?? []);
  if (blocked) return blocked;

  return {
    outcome: 'decided',
    slug: plan.slug,
    phase: 'released',
    field: 'Released',
    record: written === '' ? `${input.on}, ${version}` : written,
    alreadyRecorded: plan.phase === 'released' && written !== '',
  };
};
