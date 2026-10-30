import type { RepairState } from '../entities/repair-record.js';
import { RepairStateSchema } from '../entities/repair-record.js';

/**
 * Which states each state may become.
 *
 * `idle -> rerun -> repairing -> reverting -> done | exhausted`. `done` and
 * `exhausted` are terminal: a settled episode starts a new record rather than
 * reopening this one, and `redMainStep` answers `none` once no record names an
 * open episode.
 *
 * `idle -> done` and `rerun -> done` are both legal: a re-run can turn the
 * first red SHA green before `start-repair` ever fires, and `close-prs` can
 * fire with no fix or revert PR open at all. `repairing -> done` and
 * `reverting -> done` cover main settling green with a PR still open, which
 * `close-prs` then closes.
 */
const NEXT: Readonly<Record<RepairState, readonly RepairState[]>> = {
  idle: ['rerun', 'done', 'exhausted'],
  rerun: ['repairing', 'done', 'exhausted'],
  repairing: ['reverting', 'done', 'exhausted'],
  reverting: ['done', 'exhausted'],
  done: [],
  exhausted: [],
};

/** Why a repair-record transition refused, as a value a caller can branch on. */
export type RepairTransitionRefusalReason = 'state-unrecognised' | 'state-unchanged' | 'state-terminal' | 'state-unreachable';

/** A refused transition, naming which gate fired. */
export interface RepairTransitionRefusal {
  readonly outcome: 'refused';
  readonly reason: RepairTransitionRefusalReason;
  readonly detail: string;
}

/** A transition that holds. */
export interface RepairTransitionDecision {
  readonly outcome: 'decided';
  readonly from: RepairState;
  readonly to: RepairState;
}

/** What a repair-record transition answers: the verdict, or the gate that stopped it. */
export type RepairTransitionResult = RepairTransitionDecision | RepairTransitionRefusal;

const refuse = (reason: RepairTransitionRefusalReason, detail: string): RepairTransitionRefusal => ({
  outcome: 'refused',
  reason,
  detail,
});

const known = (state: string): state is RepairState =>
  (RepairStateSchema.options as readonly string[]).includes(state);

/**
 * Judges a move of a repair record's lifecycle state.
 *
 * @param from - the state the record holds.
 * @param to - the state a caller wants to move it to.
 * @returns a decision carrying the move, or a refusal naming the gate that
 *   fired: `state-unrecognised`, `state-unchanged`, `state-terminal` or
 *   `state-unreachable`.
 */
export const moveRepairState = (from: RepairState, to: string): RepairTransitionResult => {
  if (!known(to)) {
    return refuse('state-unrecognised', `'${to}' is not a repair-record state — the six are ${RepairStateSchema.options.join(', ')}.`);
  }

  if (from === to) {
    return refuse('state-unchanged', `the record is already '${to}' — nothing moved.`);
  }

  if (NEXT[from].length === 0) {
    return refuse('state-terminal', `the record is '${from}' — the episode is over, and a new episode starts a new record rather than reopening this one.`);
  }

  if (!NEXT[from].includes(to)) {
    return refuse('state-unreachable', `the record cannot go '${from}' -> '${to}' — from '${from}' it may become ${NEXT[from].join(' or ')}.`);
  }

  return { outcome: 'decided', from, to };
};
