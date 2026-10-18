import type { PlanStatePhase, PlanStateWrite } from '../ports/tracker.js';

/**
 * The status words a repository configured, one per finishing phase.
 *
 * `''` means that phase writes nothing. It is not a status to write.
 */
export interface IssueStatusWords {
  /** The word an `Approved` plan writes; `''` where the phase writes nothing. */
  readonly approved: string;
  /** The word a `Delivered` plan writes; `''` where the phase writes nothing. */
  readonly delivered: string;
  /** The word a `Released` plan writes; `''` where the phase writes nothing. */
  readonly released: string;
}

/** What a finished plan is read as, for the status it owes. */
export interface IssueStatusReading {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, in the order the plan names them. */
  readonly issues: readonly string[];
  /** The configured status words. */
  readonly words: IssueStatusWords;
}

/** One status a tracker is owed: the issue and the word to write to it. */
export interface IssueStatusWrite {
  /** The issue's identifier, verbatim — a number on one tracker, a key on another. */
  readonly issue: string;
  /** The status word, verbatim from configuration. */
  readonly status: string;
}

/**
 * Decides which status writes a plan owes its tracker.
 *
 * Only `approved`, `delivered` and `released` owe a write, each through its
 * own word. A `draft` plan owes none: it has no status word. A phase whose word
 * is empty owes nothing: one key never stands in for another.
 *
 * @param reading - the plan's phase, its issues and the configured words.
 * @returns one write per issue; empty where the phase owes none, the plan names
 *   no issue, or that phase's word is empty.
 */
export const issueStatusWrites = (reading: IssueStatusReading): readonly IssueStatusWrite[] => {
  const status =
    reading.phase === 'approved'
      ? reading.words.approved
      : reading.phase === 'delivered'
        ? reading.words.delivered
        : reading.phase === 'released'
          ? reading.words.released
          : '';
  if (status === '') return [];
  return reading.issues.filter((issue) => issue !== '').map((issue) => ({ issue, status }));
};

const PLAN_STATE_PHASES: readonly PlanStatePhase[] = ['draft', 'approved', 'delivered', 'released'];

/** Whether `phase` is one of the four {@link PlanStatePhase} values. */
const isPlanStatePhase = (phase: string): phase is PlanStatePhase => (PLAN_STATE_PHASES as readonly string[]).includes(phase);

/** What a plan's phase owes a {@link import('../ports/tracker.js').Tracker.planStateWrite}. */
export interface PlanStateReading {
  /** The plan's phase, lowercased as `plot-plan-meta.sh` reports it. */
  readonly phase: string;
  /** The issues the plan answers, in the order the plan names them. */
  readonly issues: readonly string[];
  /** The plan's address at this phase — the caller resolves where it lives. */
  readonly planLink: string;
  /** The release version; read for `released` and ignored otherwise. */
  readonly version?: string;
}

/**
 * Decides which plan-state writes a plan owes its tracker.
 *
 * Unlike {@link issueStatusWrites}, every one of the four phases owes a write —
 * `draft` included, because the label is the phase name itself and needs no
 * configured word. A phase outside the four (e.g. `design`) owes nothing.
 *
 * @param reading - the plan's phase, its issues, its link and, at release, the version.
 * @returns one write per issue; empty where the phase is not one of the four, or
 *   the plan names no issue.
 */
export const planStateWrites = (reading: PlanStateReading): readonly PlanStateWrite[] => {
  if (!isPlanStatePhase(reading.phase)) return [];
  const phase = reading.phase;
  return reading.issues
    .filter((issue) => issue !== '')
    .map((issue) => ({ issue, phase, planLink: reading.planLink, ...(reading.version === undefined ? {} : { version: reading.version }) }));
};
