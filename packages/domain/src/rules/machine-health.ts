import { refusalKind } from './refusal.js';

/**
 * How far the host answered the board's PR read.
 *
 * `answered` once any PR data landed, however old. `unasked` where no call has
 * been made. `unreachable` where the first call failed for a reason that names
 * no limit. `rate-limited` where the first call was refused on a spent quota or
 * a burst: the host was reached, so it does not read `unreachable`.
 */
export type HostAnswer = 'answered' | 'unasked' | 'unreachable' | 'rate-limited';

/** What the host figure says for each answer state but `answered`. */
export const HOST_ANSWER_HINT: Readonly<Record<Exclude<HostAnswer, 'answered'>, string>> = {
  unasked: 'not checked yet',
  unreachable: 'could not reach the host',
  'rate-limited': 'rate-limited',
};

/** The two PR fields `hostAnswer` reads. */
export interface HostAnswerReading {
  /** Seconds since PR data last landed, or null where none ever did. */
  prAgeSeconds: number | null;
  /** The last PR read's error, or null. */
  prError: string | null;
}

/**
 * Reads the host's answer state from the PR age and the PR error.
 *
 * The error is classified by {@link refusalKind}: a spent quota or a burst is
 * `rate-limited`, every other error `unreachable`.
 *
 * @param reading - the PR age and the PR error.
 * @returns the answer state.
 */
export const hostAnswer = (reading: HostAnswerReading): HostAnswer => {
  if (reading.prAgeSeconds !== null) return 'answered';
  const kind = refusalKind(reading.prError);
  if (kind === null) return 'unasked';
  return kind === 'quota' || kind === 'secondary' ? 'rate-limited' : 'unreachable';
};

/** The machine's headroom verdict, as the payload carries it. */
export type MachineHeadroom = 'clear' | 'tight' | 'starved' | 'unmeasured';

/** One bucket of the host's budget as the record last read it. */
export interface MachineBudget {
  /** The bucket's name (`graphql`, `core`), or `''` for a host with one pool. */
  bucket: string;
  limit: number | null;
  remaining: number | null;
  /** When the bucket refills, epoch milliseconds, or null where unknown. */
  resetAt: number | null;
}

/** What the Machine line reads: the headroom verdict, its context, and the host budget. */
export interface MachineReading {
  headroom: MachineHeadroom;
  /** The 1-minute load average, or null where unmeasured. */
  load1: number | null;
  cores: number | null;
  /** The connector's backend word and the buckets its record holds, or null where unread. */
  host: { connector: string; buckets: readonly MachineBudget[] } | null;
}

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
  /** The limiting resources; empty where nothing limits the fleet. */
  rows: readonly MachineRow[];
}

const DOT_AND_WORD: Readonly<Record<MachineHeadroom, { dot: MachineDot; word: string }>> = {
  clear: { dot: 'green', word: 'healthy' },
  tight: { dot: 'amber', word: 'tight' },
  starved: { dot: 'red', word: 'starved' },
  unmeasured: { dot: 'grey', word: 'not measured' },
};

/** The dot and word of a machine whose own headroom is clear but whose host budget limits the fleet. */
const STRAINED = { dot: 'amber', word: 'strained' } as const;

/** A budget bucket at or under this share of its limit limits the fleet. */
export const LOW_BUDGET_SHARE = 0.1;

/** The two buckets of a host that meters GraphQL and REST apart, in the order the line names them, with their reader-facing names. */
export const SPLIT_BUCKETS: ReadonlyArray<readonly [string, string]> = [
  ['graphql', 'GraphQL'],
  ['core', 'REST'],
];

/** What a spent bucket stops, by bucket name. */
const SPENT_EFFECT: Readonly<Record<string, string>> = {
  graphql: 'PR listings wait for the reset',
  core: 'REST calls wait for the reset',
};

const count = (n: number): string => n.toLocaleString('en-US');

const clock = (epochMs: number): string => {
  const at = new Date(epochMs);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
};

/** Names a connector for the reader, from its backend word. */
export type HostNamer = (connector: string) => string;

/** A bucket's reader-facing name: `GraphQL` and `REST` for the split buckets, the record's word otherwise, nothing for `''`. */
export const bucketLabel = (bucket: string): string => SPLIT_BUCKETS.find(([word]) => word === bucket)?.[1] ?? bucket;

/** A bucket with both a limit and a remaining count. */
type ReadBucket = MachineBudget & { limit: number; remaining: number };

const isRead = (b: MachineBudget): b is ReadBucket => b.remaining !== null && b.limit !== null;

const limiting = (b: ReadBucket): boolean => b.remaining <= b.limit * LOW_BUDGET_SHARE;

/** GraphQL first, then REST, then any other bucket in record order. */
const ordered = (buckets: readonly ReadBucket[]): ReadBucket[] => {
  const rank = (b: ReadBucket): number => {
    const at = SPLIT_BUCKETS.findIndex(([word]) => word === b.bucket);
    return at === -1 ? SPLIT_BUCKETS.length : at;
  };
  return [...buckets].sort((a, b) => rank(a) - rank(b));
};

/**
 * The host's budget as the line names it: each read bucket's remaining count,
 * and, where the record holds one of the split buckets, each split bucket it
 * holds no reading for.
 *
 * The record holds a bucket only where a call in its window spent it, so a
 * bucket it does not hold is named `not recorded` rather than asked for.
 */
const budgetFigure = (host: NonNullable<MachineReading['host']>, name: string): string => {
  const read = ordered(host.buckets.filter(isRead));
  if (read.length === 0) return `${name} budget not reported`;
  const parts = read.map((b) => {
    const label = bucketLabel(b.bucket);
    return `${label === '' ? '' : `${label} `}${count(b.remaining)} / ${count(b.limit)} left`;
  });
  const split = read.some((b) => SPLIT_BUCKETS.some(([word]) => word === b.bucket));
  const missing = split
    ? SPLIT_BUCKETS.filter(([word]) => !read.some((b) => b.bucket === word)).map(([, label]) => `${label} not recorded`)
    : [];
  return `${name} ${[...parts, ...missing].join(' · ')}`;
};

const hostFigure = (machine: MachineReading | null, answer: HostAnswer, nameOf: HostNamer): string | null => {
  if (answer === 'unasked' || answer === 'unreachable') return `host ${HOST_ANSWER_HINT[answer]}`;
  const host = machine?.host ?? null;
  if (host === null) return answer === 'rate-limited' ? `host ${HOST_ANSWER_HINT[answer]}` : null;
  return budgetFigure(host, nameOf(host.connector));
};

const loadFigure = (machine: MachineReading | null): string | null => {
  if (machine === null || machine.load1 === null) return null;
  const load = machine.load1.toFixed(1);
  return machine.cores === null ? `load ${load}` : `load ${load} of ${machine.cores} cores`;
};

const budgetRow = (name: string, b: ReadBucket): MachineRow => {
  const label = bucketLabel(b.bucket);
  const reset = b.resetAt === null ? '' : `, resets ${clock(b.resetAt)}`;
  const spent = b.remaining === 0;
  return {
    resource: label === '' ? name : `${name} ${label}`,
    now: `${count(b.remaining)} / ${count(b.limit)}${reset}`,
    effect: spent ? (SPENT_EFFECT[b.bucket] ?? 'calls wait for the reset') : 'calls may be refused before the reset',
  };
};

const machineRows = (machine: MachineReading | null): MachineRow[] => {
  if (machine?.headroom === 'starved') return [{ resource: 'Machine', now: 'starved', effect: 'dispatch waits' }];
  if (machine?.headroom === 'tight') return [{ resource: 'Machine', now: 'tight', effect: 'dispatch runs, with little room left' }];
  return [];
};

const hostRows = (machine: MachineReading | null, answer: HostAnswer, nameOf: HostNamer): MachineRow[] => {
  const host = machine?.host ?? null;
  if (host === null || answer === 'unasked' || answer === 'unreachable') return [];
  return ordered(host.buckets.filter(isRead)).filter(limiting).map((b) => budgetRow(nameOf(host.connector), b));
};

/**
 * The Machine section's fact, from the payload's machine reading and the host's answer state.
 *
 * The line names load against cores and the host figure: the budget of each
 * bucket the record holds, `not checked yet` for an unasked host, and `could not
 * reach the host` for an outage. The body lists the machine where its headroom
 * is `tight` or `starved`, and each host bucket at or under
 * {@link LOW_BUDGET_SHARE} of its limit. The dot and word come from headroom; a
 * `clear` or `unmeasured` machine with a limiting bucket reads amber `strained`.
 * An unasked or unreachable host lists no bucket, so it never reads `0 left`.
 *
 * @param reading - the payload's reading, or null or undefined where the board has not measured.
 * @param answer - {@link hostAnswer} of the fleet's PR age and PR error.
 * @param nameOf - names the connector for the reader; the backend word itself by default.
 * @returns the Machine section's fact.
 */
export const machineHealth = (
  reading: MachineReading | null | undefined,
  answer: HostAnswer = 'answered',
  nameOf: HostNamer = (connector) => connector,
): MachineHealth => {
  const machine = reading ?? null;
  const headroom = machine?.headroom ?? 'unmeasured';
  const line = [loadFigure(machine), hostFigure(machine, answer, nameOf)].filter((part): part is string => part !== null).join(' · ');
  const rows = [...machineRows(machine), ...hostRows(machine, answer, nameOf)];
  const { dot, word } = (headroom === 'clear' || headroom === 'unmeasured') && rows.length > 0 ? STRAINED : DOT_AND_WORD[headroom];
  return { dot, word, line, rows };
};
