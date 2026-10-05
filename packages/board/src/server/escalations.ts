import fs from 'node:fs';
import path from 'node:path';
import type { Rung } from '@plot-pm/domain/rules/question-escalation';

/**
 * `.plot/state/escalations.tsv` — THE ONE RECORD OF A RUNG ALREADY SENT.
 *
 * **ONE RECORD, BECAUSE A NOTIFICATION SENT TWICE IS THE FAILURE.** The
 * registry tick is stateless for every other decision — `registryd.ts` reads
 * the registry and the desks fresh every minute and consults nothing from the
 * tick before. This file is the one exception: a rung this tick already
 * reached must not fire the adapter again next minute just because nothing
 * else remembers it fired.
 *
 * **APPEND-ONLY, MACHINE-LOCAL, AND A MISSING OR UNREADABLE FILE READS AS "NO
 * RUNG REACHED".** `.plot/state/` is gitignored and per-machine, the same as
 * `fleet-controls.json` and `auto-in-flight.json` beside it. The two
 * directions of a wrong read cost differently here: reading "no rung
 * recorded" when one WAS recorded sends one extra notification, which the
 * once-per-rung record then catches on the next tick; reading "a rung was
 * recorded" when it WAS NOT swallows a notification nobody will ever retry
 * silently. So corruption reads as the first kind of wrong, never the second —
 * an unparseable line is skipped rather than trusted.
 */

/** The file's path, relative to `.plot/state/` like every other machine-local record. */
export function escalationsPath(repoRoot: string): string {
  return path.join(repoRoot, '.plot', 'state', 'escalations.tsv');
}

/** One rung this tick (or an earlier one) already recorded reaching. */
export interface EscalationRecord {
  /** The desk's worktree path, absolute. */
  worktree: string;
  /** The marker's modification time, ISO-8601 — the key alongside `worktree`. */
  askedAt: string;
  /** The rung reached. */
  rung: Rung;
  /** When this line was written, ISO-8601. */
  at: string;
  /** `sent`, `unaskable`, or `failed <code>`. */
  status: string;
}

/**
 * Encodes one record as a TSV line, tab-separated, newline-terminated.
 *
 * @param record - the record to encode.
 * @returns the line, ending in `\n`.
 */
export function encodeEscalation(record: EscalationRecord): string {
  return [record.worktree, record.askedAt, record.rung, record.at, record.status].join('\t') + '\n';
}

/**
 * Parses one TSV line into a record, or `null` where it does not parse.
 *
 * **AN UNPARSEABLE LINE IS IGNORED, NEVER THROWN.** A truncated append — the
 * one this file's lock-free append can leave behind — must read as "this rung
 * is not recorded" rather than crash the tick that is trying to read every
 * other desk's rungs too.
 *
 * @param line - one line, without its trailing newline.
 * @returns the record, or `null`.
 */
export function parseEscalationLine(line: string): EscalationRecord | null {
  const parts = line.split('\t');
  if (parts.length !== 5) return null;
  const [worktree, askedAt, rung, at, status] = parts;
  if (worktree === '' || askedAt === '' || rung === '' || at === '' || status === '') return null;
  return { worktree, askedAt, rung: rung as Rung, at, status };
}

/**
 * Every record the file holds, or empty where it is missing, empty, or
 * unreadable.
 *
 * **ABSENT IS NOT FALSE, AND A MISSING FILE IS NOT AN ERROR.** The ordinary
 * first state — no rung has ever been reached on this machine — reads
 * identically to a file this process cannot open: both answer no records, and
 * {@link questionEscalation} given no recorded rungs answers exactly as it
 * would on a brand-new desk. Reading a file this empty-by-construction as a
 * failure would be inventing a distinction nothing downstream can use.
 *
 * @param repoRoot - the repository root.
 * @returns every parseable record, in file order.
 */
export function readEscalations(repoRoot: string): readonly EscalationRecord[] {
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
}

/**
 * Every rung already recorded for one desk's exact marker — `worktree` AND
 * `askedAt` together, never `worktree` alone.
 *
 * **KEYED ON BOTH, so a new marker's modification time starts again at
 * `listed`.** A desk that was answered and asked again carries a new
 * `askedAt`; if this keyed on the worktree alone, the old marker's recorded
 * `notified-2` would suppress the new marker's `notified-1` for hours it has
 * not yet earned.
 *
 * @param records - every record the file holds.
 * @param worktree - the desk's worktree path.
 * @param askedAt - the marker's modification time, ISO-8601.
 * @returns the rungs recorded for exactly this desk and this marker.
 */
export function recordedRungsFor(
  records: readonly EscalationRecord[],
  worktree: string,
  askedAt: string,
): ReadonlySet<Rung> {
  const rungs = new Set<Rung>();
  for (const record of records) {
    if (record.worktree === worktree && record.askedAt === askedAt) rungs.add(record.rung);
  }
  return rungs;
}

/**
 * Appends one record.
 *
 * **BEST-EFFORT, LOCK-FREE, LIKE `budgetFile`'s `append`.** A line under the
 * platform's atomic-append limit lands whole beside a concurrent writer's; this
 * file has exactly one writer (the registry tick, one instance per machine), so
 * even that guarantee is more than the contract needs. A write that throws is
 * swallowed: a tick that cannot record a sent rung must not fail the whole tick
 * over it, and the cost of a failed append is one possible repeat
 * notification — the direction this file already tolerates.
 *
 * @param repoRoot - the repository root.
 * @param record - the record to append.
 */
export function appendEscalation(repoRoot: string, record: EscalationRecord): void {
  const file = escalationsPath(repoRoot);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, encodeEscalation(record), 'utf8');
  } catch {
    // Swallowed. See the doc comment above: a missed append costs one possible
    // repeat notification, never a swallowed one.
  }
}
