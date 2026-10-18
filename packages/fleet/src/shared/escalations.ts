import fs from 'node:fs';
import path from 'node:path';
import type { Rung } from '@plot-pm/domain/rules/question-escalation';

/**
 * `.plot/state/escalations.tsv`: one line per question-escalation rung the
 * registry tick has reached, keyed on the desk's worktree and the marker's
 * modification time.
 *
 * The file is append-only and machine-local. A missing or unreadable file
 * reads as no records, and an unparseable line is skipped.
 */

/** The file's path under the repository root. */
export const escalationsPath = (repoRoot: string): string => {
  return path.join(repoRoot, '.plot', 'state', 'escalations.tsv');
};

/** One rung the tick recorded reaching. */
export interface EscalationRecord {
  /** The desk's worktree path, absolute. */
  worktree: string;
  /** The marker's modification time, ISO-8601. */
  askedAt: string;
  /** The rung reached. */
  rung: Rung;
  /** When this line was written, ISO-8601. */
  at: string;
  /** `sent`, `unaskable`, or `failed <code>`. */
  status: string;
}

/**
 * Encodes one record as a tab-separated line.
 *
 * @param record - the record to encode.
 * @returns the line, ending in `\n`.
 */
export const encodeEscalation = (record: EscalationRecord): string => {
  return [record.worktree, record.askedAt, record.rung, record.at, record.status].join('\t') + '\n';
};

/**
 * Parses one TSV line into a record.
 *
 * @param line - one line, without its trailing newline.
 * @returns the record, or `null` where the line does not hold five non-empty
 *   tab-separated columns.
 */
export const parseEscalationLine = (line: string): EscalationRecord | null => {
  const parts = line.split('\t');
  if (parts.length !== 5) return null;
  const [worktree, askedAt, rung, at, status] = parts;
  if (worktree === '' || askedAt === '' || rung === '' || at === '' || status === '') return null;
  return { worktree, askedAt, rung: rung as Rung, at, status };
};

/**
 * Every record the file holds.
 *
 * @param repoRoot - the repository root.
 * @returns every parseable record, in file order; empty where the file is
 *   missing, empty or unreadable. Never throws.
 */
export const readEscalations = (repoRoot: string): readonly EscalationRecord[] => {
  let text: string;
  try {
    text = fs.readFileSync(escalationsPath(repoRoot), 'utf8');
  } catch {
    return [];
  }
  const records: EscalationRecord[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const record = parseEscalationLine(line);
    if (record) records.push(record);
  }
  return records;
};

/**
 * Every rung recorded for one desk's marker, matched on `worktree` and
 * `askedAt` together.
 *
 * @param records - the records to search.
 * @param worktree - the desk's worktree path.
 * @param askedAt - the marker's modification time, ISO-8601.
 * @returns the rungs recorded for exactly this desk and this marker.
 */
export const recordedRungsFor = (
  records: readonly EscalationRecord[],
  worktree: string,
  askedAt: string,
): ReadonlySet<Rung> => {
  const rungs = new Set<Rung>();
  for (const record of records) {
    if (record.worktree === worktree && record.askedAt === askedAt) rungs.add(record.rung);
  }
  return rungs;
};

/**
 * Appends one record, creating `.plot/state/` where it is missing.
 *
 * @param repoRoot - the repository root.
 * @param record - the record to append.
 * @returns `true` where the line was written, `false` where the write threw.
 *   Never throws.
 */
export const appendEscalation = (repoRoot: string, record: EscalationRecord): boolean => {
  const file = escalationsPath(repoRoot);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, encodeEscalation(record), 'utf8');
    return true;
  } catch {
    return false;
  }
};

/**
 * The rungs one daemon process applied, held in memory for its lifetime.
 * The tick reads them beside the file's records, so a rung whose append
 * failed is not sent again while the daemon runs.
 */
export interface EscalationMemory {
  /** Every record this process applied, whether or not its append succeeded. */
  readonly records: EscalationRecord[];
  /** Whether a failed append has already been reported. */
  appendFailureReported: boolean;
}

/**
 * An empty {@link EscalationMemory}.
 *
 * @returns a memory holding no records, with no failure reported.
 */
export const escalationMemory = (): EscalationMemory => ({ records: [], appendFailureReported: false });

/**
 * How many records {@link rememberEscalation} keeps.
 *
 * `memory.records` exists only to cover a failed append — `readEscalations`
 * re-reads the TSV file itself on every lookup, so the file is always the
 * durable copy. A long-lived daemon notifying many desks over days would
 * otherwise grow this array for the life of the process; this bounds it to
 * comfortably more rungs than one tick can produce (`DESKS_PER_TICK` desks,
 * {@link Rung} has few values) while still covering a run of failed appends.
 */
export const ESCALATION_MEMORY_LIMIT = 500;

/**
 * Adds one record to `memory`, dropping the oldest once the list would grow
 * past {@link ESCALATION_MEMORY_LIMIT}.
 *
 * @param memory - the memory to add to.
 * @param record - the record to add.
 */
export const rememberEscalation = (memory: EscalationMemory, record: EscalationRecord): void => {
  memory.records.push(record);
  if (memory.records.length > ESCALATION_MEMORY_LIMIT) memory.records.shift();
};
