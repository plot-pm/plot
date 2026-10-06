/**
 * How a board route records one finished board-role run: the code its state
 * file holds, and the line it appends to the run's log.
 *
 * A board role hands back one of two schemas. `approve`, `deliver` and
 * `auto-deliver` hand back `{ outcome, summary }`; every other board role
 * hands back `{ written, summary }`. A `command` run hands back nothing, so
 * its clean exit is the success it was before the port existed. An `sdk` run
 * that names no file, names a file outside its tree, names a file that does
 * not exist, or hands back the other schema is a failed run with that reason.
 *
 * @concept board-run-end
 */
import type { AgentRunEnd } from '../ports/agent-run.js';
import { writtenPathResolution } from './written-path.js';

/** Which hand-back a board role ends with. */
export type BoardHandBackKind = 'written' | 'outcome';

/** The board roles that hand back `{ outcome, summary }`. */
const OUTCOME_ROLES: ReadonlySet<string> = new Set(['approve', 'deliver', 'auto-deliver']);

/**
 * The hand-back one board role ends with.
 *
 * @param role - the role, such as `idea` or `approve`.
 * @returns `outcome` for `approve`, `deliver` and `auto-deliver`; `written` for every other role.
 */
export const boardHandBackKind = (role: string): BoardHandBackKind =>
  OUTCOME_ROLES.has(role) ? 'outcome' : 'written';

/** The state-file code a run ended on its time bound records, as `timeout(1)` exits. */
export const BOUND_CODE = 124;

/** What {@link boardRunEnd} reads. */
export interface BoardRunEndReading {
  /** The role that ran. */
  readonly role: string;
  /** The runner it ran on. */
  readonly runner: 'command' | 'sdk';
  /** The tree the role ran in, absolute; a `written` path resolves against it. */
  readonly tree: string;
  /** Why the run ended, as the port answered it. */
  readonly end: AgentRunEnd;
  /** Whether an absolute path names an existing file. */
  readonly exists: (absolutePath: string) => boolean;
}

/** How a route records one finished run. */
export interface BoardRunRecord {
  /** The state file's code: `0` for success, non-zero otherwise. */
  readonly code: number;
  /** The line the route appends to the run's log; `''` for none. */
  readonly line: string;
  /** The outcome an `outcome` role handed back; `null` where none was handed back. */
  readonly outcome: 'done' | 'refused' | null;
  /** The absolute path a `written` role handed back and that exists; `null` otherwise. */
  readonly written: string | null;
}

const failure = (line: string, code = 1): BoardRunRecord => ({ code, line, outcome: null, written: null });

/**
 * Reads one finished board-role run into the code and line its route records.
 *
 * An `outcome: refused` hand-back records code `1` with the summary, so the
 * card reports the refusal and never reads it as done.
 *
 * @param reading - the role, its runner and tree, the port's end, and a file check.
 * @returns the code, the log line, and the outcome or written path where one was handed back.
 */
export const boardRunEnd = (reading: BoardRunEndReading): BoardRunRecord => {
  const { role, end } = reading;
  if (end.answer === 'ran') return ranRecord(reading, end.handBack);
  switch (end.answer) {
    case 'unstarted':
      return failure(`the ${role} run did not start: ${end.detail}`);
    case 'wait':
      return failure(
        `the ${role} run stopped at the account's usage limit, which resets at ${new Date(end.resetEpoch * 1000).toISOString()}`,
      );
    case 'end-limited':
      return failure(`the ${role} run stopped at the account's usage limit (${end.cause})`);
    case 'bound':
      return failure(`the ${role} run was ended at its time bound`, BOUND_CODE);
    case 'turn-limit':
      return failure(`the ${role} run reached its turn limit`);
    case 'spend-limit':
      return failure(`the ${role} run reached its spend limit`);
    case 'dropped':
      return failure(`the ${role} run ended with its background work dropped: ${end.line}`);
  }
};

/** Reads a run that ended with a hand-back, or with none. */
const ranRecord = (
  reading: BoardRunEndReading,
  handBack: Extract<AgentRunEnd, { answer: 'ran' }>['handBack'],
): BoardRunRecord => {
  const { role } = reading;
  if (handBack === null) {
    return reading.runner === 'command'
      ? { code: 0, line: '', outcome: null, written: null }
      : failure(`the ${role} run ended with no hand-back`);
  }
  const kind = boardHandBackKind(role);
  if (kind === 'outcome') {
    if (!('outcome' in handBack)) return failure(`the ${role} run ended with no outcome hand-back`);
    return handBack.outcome === 'done'
      ? { code: 0, line: handBack.summary, outcome: 'done', written: null }
      : { code: 1, line: `the ${role} run refused: ${handBack.summary}`, outcome: 'refused', written: null };
  }
  if (!('written' in handBack)) return failure(`the ${role} run ended with no written hand-back`);
  const resolution = writtenPathResolution(handBack.written, reading.tree);
  if (!resolution.inside) return failure(`the ${role} run's written path was refused: ${resolution.reason}`);
  if (!reading.exists(resolution.resolved)) {
    return failure(`the ${role} run's written path does not exist: '${handBack.written}'`);
  }
  return { code: 0, line: handBack.summary, outcome: null, written: resolution.resolved };
};
