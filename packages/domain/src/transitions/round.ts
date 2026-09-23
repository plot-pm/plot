/**
 * Recording that a plan was interrogated.
 *
 * `Rounds:` is parsed by `plot-plan-meta.sh`, rendered by the board's plan
 * card, and written by prose in two skills. Until this file, no rule in the
 * domain knew what a round was — so there was nothing for a controller to call
 * and nothing a gate could check.
 *
 * **IT INCREMENTS AND NEVER SETS.** A plan can face a panel twice, and both
 * are rounds. Reading the current value and adding one is also why
 * {@link RefusalReason} carries `count-unparseable`: a field that cannot be
 * read is a defect to report, and overwriting it destroys the evidence.
 *
 * **IT REACHES NO FILESYSTEM.** The moderation's existence arrives as a
 * {@link Precondition} reading, the way `transitions/plan.ts` takes a PR
 * check. A path is not an existence check, and a rule handed one could only
 * pretend to verify it.
 */

/** A fact this transition needs and cannot measure — supplied by its caller. */
export interface Precondition {
  /** What was read, named for the refusal it produces. */
  name: string;
  /** Whether the reading permits the transition. */
  met: boolean;
  /** What the source said, surfaced in the refusal. */
  detail?: string;
}

/**
 * Why recording a round refused.
 *
 * Its own list rather than `transitions/plan.ts`'s, the way
 * `transitions/sprint.ts` declares its own: the gates differ, and a shared
 * union would name reasons neither transition can produce.
 */
export type RefusalReason =
  | 'not-a-plan'
  | 'count-unparseable'
  | 'phase-terminal'
  | 'zero-rounds'
  | 'precondition-unmet';

/** A refused recording, naming which gate fired. */
export interface Refusal {
  readonly outcome: 'refused';
  /** Which gate fired — branched on rather than matched as prose. */
  readonly reason: RefusalReason;
  /** The plan the refusal is about. */
  readonly slug: string;
  /** Why this gate fired here, for a reader. */
  readonly detail: string;
}

/** A round that should be recorded, and the value to write. */
export interface Decision {
  readonly outcome: 'decided';
  /** The plan to write to. */
  readonly slug: string;
  /** The `## Status` field. */
  readonly field: 'Rounds';
  /** The count to write — the current value plus one, never a set. */
  readonly rounds: number;
  /** What the plan carried before, or null where it carried nothing. */
  readonly previous: number | null;
}

/** What this transition answers: the write, or the gate that stopped it. */
export type TransitionResult = Decision | Refusal;

/**
 * Narrows a result to a held transition.
 *
 * @param result - the result to test.
 * @returns true when the round should be recorded.
 */
export const isDecision = (result: TransitionResult): result is Decision =>
  result.outcome === 'decided';

/**
 * Narrows a result to a refusal.
 *
 * @param result - the result to test.
 * @returns true when a gate stopped the recording.
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
 * The phases past Development, where a round may no longer be added.
 *
 * **IT GOVERNS WHAT MAY BE ADDED, NEVER WHAT IS RECORDED.** Measured
 * 2026-09-22 over the 112 plans carrying the field: 96 Released, 8 Rejected,
 * 4 Delivered, 2 Superseded, 1 Approved. Rounds are recorded on Draft plans
 * and travel with them, so almost every field on the estate sits on a plan
 * this set names. A refusal that removed them would delete the record.
 *
 * `Rejected` and `Superseded` are here for the reason `Released` is: the
 * interrogation is history. An earlier draft of this rule named only
 * `Released` while the plan carved out "a rejected plan keeps its round
 * beside its rejection" — which is true of a round already written, and says
 * nothing about adding one.
 */
const TERMINAL = new Set(['delivered', 'released', 'rejected', 'superseded']);

/** What was read of the plan, and of the interrogation that just finished. */
export interface RecordRoundInput {
  /** The plan's slug, for the refusal to name. */
  slug: string;
  /**
   * The plan's declared phase, lowercased, or `''` where none parsed.
   *
   * `''` IS `not-a-plan`, not a missing field. `docs/plans/` holds decision
   * logs and worker reports, and the estate's own rule — stated twice, in
   * `plot-reconcile-scan.sh` and `plot-fleet-scan.sh` — is that a file with no
   * `State:` is not a plan.
   */
  phase: string;
  /**
   * The `Rounds:` value the plan carries, exactly as the field spelled it.
   *
   * `null` MEANS ABSENT, AND ABSENT IS NOT ZERO. A plan nobody has
   * interrogated and a plan interrogated to no effect want opposite reactions
   * from a reader, which is why the template omits the line rather than
   * writing `0`.
   */
  current: string | null;
  /** Facts the caller measured that this rule cannot. */
  preconditions?: readonly Precondition[];
}

/**
 * Whether a plan may record another round, and the count to write.
 *
 * @param input - what was read of the plan and its interrogation.
 * @returns the write, or the gate that stopped it.
 */
export const recordRound = (input: RecordRoundInput): TransitionResult => {
  const { slug, phase, current } = input;

  if (phase === '') {
    return refuse(
      slug,
      'not-a-plan',
      `\`${slug}\` declares no phase — a file with no \`State:\` is a decision log or a note, not a plan`,
    );
  }

  if (TERMINAL.has(phase.toLowerCase())) {
    return refuse(
      slug,
      'phase-terminal',
      `\`${slug}\` is ${phase} — the interrogation is history, and a round may no longer be added. Rounds already recorded stay`,
    );
  }

  // THE PRECONDITIONS ARE ASKED BEFORE THE COUNT IS PARSED, because a caller
  // that reports no moderation is refused whatever the field says. Parsing
  // first would report `count-unparseable` for a plan whose round never
  // completed, which names the wrong defect.
  for (const p of input.preconditions ?? []) {
    if (!p.met) {
      return refuse(
        slug,
        'precondition-unmet',
        `\`${slug}\`: ${p.name}${p.detail === undefined ? '' : ` — ${p.detail}`}`,
      );
    }
  }

  if (current === null) {
    return { outcome: 'decided', slug, field: 'Rounds', rounds: 1, previous: null };
  }

  const trimmed = current.trim();
  if (!/^\d+$/.test(trimmed)) {
    return refuse(
      slug,
      'count-unparseable',
      `\`${slug}\` carries \`Rounds: ${current}\`, which is not a number — that is a defect to report, and overwriting it would destroy the evidence`,
    );
  }

  const previous = Number(trimmed);
  if (previous === 0) {
    return refuse(
      slug,
      'zero-rounds',
      `\`${slug}\` carries \`Rounds: 0\`, which means questioned to no effect — the template leaves the line out instead, and incrementing it would invent a first round`,
    );
  }

  return { outcome: 'decided', slug, field: 'Rounds', rounds: previous + 1, previous };
};
