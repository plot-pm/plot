import type { FixerAttemptsRecord } from '../entities/fixer-attempts.js';
import { FIXER_BOUND_SECONDS } from './fixer-attempts.js';
import { slotRefusal, type SlotRefusal, type SlotRefusalInput } from './fleet-run.js';

/** How many fixers may run at once across all pull requests. */
export const FIXER_MAX_RUNNING = 1;

/** Why a fixer start waits: another fixer runs, or the machine has no slot. */
export type FixerHold = 'fixer-busy' | SlotRefusal;

/** What {@link fixerAdmission} reads: the running fixers and the machine's slot readings. */
export interface FixerAdmissionInput extends SlotRefusalInput {
  /** How many fixers run now on pull requests other than the one asking. */
  readonly running: number;
}

/** Whether a fixer may start, and the reason it may not. */
export type FixerAdmission = { readonly admit: true } | { readonly admit: false; readonly why: FixerHold };

/**
 * Decides whether one fixer start may go ahead.
 *
 * Refuses `fixer-busy` while {@link FIXER_MAX_RUNNING} fixers run, then applies
 * the machine slot rule that verification and design runs read
 * (`queue-unread`, `no-free-agent`, `starved`).
 *
 * @param input - the readings.
 * @returns the admission, or the hold that names why not.
 */
export const fixerAdmission = (input: FixerAdmissionInput): FixerAdmission => {
  if (input.running >= FIXER_MAX_RUNNING) return { admit: false, why: 'fixer-busy' };
  const slot = slotRefusal(input);
  return slot === null ? { admit: true } : { admit: false, why: slot };
};

/**
 * How many fixers run on one pull request, given which in-flight marks name
 * an ended process.
 *
 * An unreadable record counts as one running fixer: an unread mark does not
 * show that nothing runs.
 *
 * @param record - the decoded record, or `'none'`/`'unreadable'`.
 * @param ended - the positions of the attempts whose process has ended.
 * @returns the count of attempts with a live in-flight mark.
 */
export const runningFixers = (record: FixerAttemptsRecord | 'none' | 'unreadable', ended: readonly number[]): number => {
  if (record === 'none') return 0;
  if (record === 'unreadable') return 1;
  return record.attempts.filter((attempt, index) => attempt.inFlight !== undefined && !ended.includes(index)).length;
};

/**
 * Whether a fixer that started at `startedAt` has run for at least
 * {@link FIXER_BOUND_SECONDS} by `now`.
 *
 * @param startedAt - the in-flight mark's ISO start time.
 * @param now - epoch milliseconds.
 * @returns `false` where `startedAt` does not parse.
 */
export const fixerRanToBound = (startedAt: string, now: number): boolean => {
  const started = Date.parse(startedAt);
  return Number.isFinite(started) && now - started >= FIXER_BOUND_SECONDS * 1000;
};
