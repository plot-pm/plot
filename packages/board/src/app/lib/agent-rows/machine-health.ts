import type { FleetMachine, MachineBudget } from '../../../contract/schema.js';
import { HOST_ANSWER_HINT, type HostAnswer } from './host-notes.js';

/** The dot's colour; `grey` is an unmeasured machine. */
export type MachineDot = 'green' | 'amber' | 'red' | 'grey';

/** One resource that limits the fleet: what it is, where it stands, and what that does. */
export interface MachineRow {
  resource: string;
  now: string;
  effect: string;
}

/** The Machine section's fact: a dot, the word that names it, one header line and the limiting resources. */
export interface MachineHealth {
  dot: MachineDot;
  /** The dot's state as text; also the dot's accessible name. */
  word: string;
  /** The header text after the word: load and the host figure. Empty where neither is known. */
  line: string;
  /** Empty for a healthy or unmeasured machine. */
  rows: readonly MachineRow[];
}

const DOT_AND_WORD = {
  clear: { dot: 'green', word: 'healthy' },
  tight: { dot: 'amber', word: 'tight' },
  starved: { dot: 'red', word: 'starved' },
  unmeasured: { dot: 'grey', word: 'not measured' },
} as const;

/** A budget bucket spent to this share of its limit or less is limiting. */
const LOW_BUDGET_SHARE = 0.1;

const HOST_NAMES: Readonly<Record<string, string>> = { github: 'GitHub', bitbucket: 'Bitbucket' };

const count = (n: number): string => n.toLocaleString('en-US');

/**
 * The host's display name: the connector's own word, capitalised where this board knows how.
 *
 * @param connector - the connector's backend word.
 */
export const hostName = (connector: string): string => HOST_NAMES[connector] ?? connector;

const clock = (epochMs: number): string => {
  const at = new Date(epochMs);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/**
 * The bucket the header names: the one with the least remaining, so a spent pool is never hidden behind a full one.
 *
 * @param buckets - the buckets the record read.
 * @returns the bucket with a reading and the lowest remaining count, or null where none has one.
 */
const tightestBucket = (buckets: readonly MachineBudget[]): MachineBudget | null =>
  buckets.reduce<MachineBudget | null>((tight, b) => {
    if (b.remaining === null || b.limit === null) return tight;
    return tight === null || b.remaining < (tight.remaining ?? Infinity) ? b : tight;
  }, null);

const limiting = (b: MachineBudget): boolean =>
  b.remaining !== null && b.limit !== null && b.remaining <= b.limit * LOW_BUDGET_SHARE;

const hostFigure = (machine: FleetMachine | null, answer: HostAnswer): string | null => {
  if (answer !== 'answered') return `host ${HOST_ANSWER_HINT[answer]}`;
  const host = machine?.host ?? null;
  if (host === null) return null;
  const name = hostName(host.connector);
  const bucket = tightestBucket(host.buckets);
  if (bucket === null || bucket.remaining === null || bucket.limit === null) return `${name} budget not reported`;
  return `${name} ${count(bucket.remaining)} / ${count(bucket.limit)} left`;
};

const loadFigure = (machine: FleetMachine | null): string | null => {
  if (machine === null || machine.load1 === null) return null;
  const load = machine.load1.toFixed(1);
  return machine.cores === null ? `load ${load}` : `load ${load} of ${machine.cores} cores`;
};

const budgetRow = (host: string, b: MachineBudget): MachineRow => {
  const name = b.bucket === '' ? host : `${host} ${b.bucket}`;
  const spent = b.remaining === 0;
  const reset = b.resetAt === null ? '' : `, resets ${clock(b.resetAt)}`;
  return {
    resource: name,
    now: `${count(b.remaining ?? 0)} / ${count(b.limit ?? 0)}${reset}`,
    effect: spent ? 'calls wait for the reset' : 'calls may be refused before the reset',
  };
};

const strainRows = (machine: FleetMachine): readonly MachineRow[] => {
  const spawn: MachineRow[] = machine.headroom === 'starved'
    ? [{ resource: 'Machine', now: 'starved', effect: 'dispatch waits' }]
    : machine.headroom === 'tight'
      ? [{ resource: 'Machine', now: 'tight', effect: 'dispatch runs, with little room left' }]
      : [];
  const host = machine.host === null ? [] : machine.host.buckets.filter(limiting).map((b) => budgetRow(hostName(machine.host!.connector), b));
  return [...spawn, ...host];
};

/**
 * The Machine section's fact, derived from the payload's machine reading and the host's answer state.
 *
 * The dot and word come from `headroom` alone: load is context in the header and never the verdict, because five
 * workers ran fine at load 10 on one occasion and starved the machine at load 8 on another. A `clear` or
 * `unmeasured` machine has no body; a `tight` or `starved` one lists the machine and each host bucket at or under a
 * tenth of its limit, and no other resource. A host that has not answered reads as not asked or as an outage, never as
 * `0 left`.
 *
 * @param machine - the payload's reading, or null where the board has not measured.
 * @param answer - `hostAnswer` of the fleet's PR age and PR error.
 */
export const machineHealth = (machine: FleetMachine | null, answer: HostAnswer = 'answered'): MachineHealth => {
  const { dot, word } = DOT_AND_WORD[machine?.headroom ?? 'unmeasured'];
  const line = [loadFigure(machine), hostFigure(machine, answer)].filter((part): part is string => part !== null).join(' · ');
  const strained = machine !== null && (machine.headroom === 'tight' || machine.headroom === 'starved');
  return { dot, word, line, rows: strained ? strainRows(machine) : [] };
};
