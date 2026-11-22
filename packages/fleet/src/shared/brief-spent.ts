/**
 * The spent record of one branch's brief ask: the file fleetd writes when the
 * branch's brief runs ended `BRIEF_ASK_RETRIES + 1` times without a brief.
 *
 * One file per branch at `.plot/state/brief-spent/<branch slug>.json`, holding
 * `{ branch, slug, ends, log }`. fleetd writes it when a branch turns `spent`,
 * removes it when the branch's end count is dropped, and reads every file at
 * start. The board's implement route removes it before it starts a brief, and
 * the board reads it to show the hold.
 */
import fs from 'node:fs';
import path from 'node:path';

/** What one spent file holds. */
export interface BriefSpentRecord {
  /** The branch whose brief is missing. */
  readonly branch: string;
  /** The plan slug the branch belongs to. */
  readonly slug: string;
  /** How many brief runs ended without a brief. */
  readonly ends: number;
  /** The log of the last brief run. */
  readonly log: string;
}

/**
 * The directory that holds every spent file.
 *
 * @param repoRoot - absolute path to the repository root.
 * @returns the directory's absolute path.
 */
export const briefSpentDir = (repoRoot: string): string => path.join(repoRoot, '.plot', 'state', 'brief-spent');

/**
 * The spent file of one branch. The branch slug is the branch's last path
 * segment, the same segment `briefPath` names the brief with.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch, such as `bug/a-refused-brief-is-asked-again`.
 * @returns the file's absolute path.
 */
export const briefSpentPath = (repoRoot: string, branch: string): string =>
  path.join(briefSpentDir(repoRoot), `${branch.split('/').pop() ?? branch}.json`);

const parseRecord = (text: string): BriefSpentRecord | null => {
  try {
    const value = JSON.parse(text) as Partial<BriefSpentRecord> | null;
    if (
      value === null ||
      typeof value.branch !== 'string' ||
      typeof value.slug !== 'string' ||
      typeof value.ends !== 'number' ||
      typeof value.log !== 'string'
    ) return null;
    return { branch: value.branch, slug: value.slug, ends: value.ends, log: value.log };
  } catch {
    return null;
  }
};

/**
 * Writes one branch's spent file through a temporary file and a rename, so a
 * reader never sees half a record. A write that fails is logged and not thrown.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param record - the record to write.
 * @returns `true` when the file was written, `false` otherwise.
 */
export const writeBriefSpent = (repoRoot: string, record: BriefSpentRecord): boolean => {
  const file = briefSpentPath(repoRoot, record.branch);
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temp, `${JSON.stringify(record)}\n`, 'utf8');
    fs.renameSync(temp, file);
    return true;
  } catch (err) {
    console.log(`auto-dispatch: could not write ${file}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
};

/**
 * Removes one branch's spent file. A missing file is not an error.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch whose file to remove.
 */
export const removeBriefSpent = (repoRoot: string, branch: string): void => {
  fs.rmSync(briefSpentPath(repoRoot, branch), { force: true });
};

/**
 * Reads one branch's spent file.
 *
 * @param repoRoot - absolute path to the repository root.
 * @param branch - the branch whose file to read.
 * @returns the record, or `null` where the file is missing, unreadable or
 *   names a different branch.
 */
export const readBriefSpent = (repoRoot: string, branch: string): BriefSpentRecord | null => {
  let text: string;
  try {
    text = fs.readFileSync(briefSpentPath(repoRoot, branch), 'utf8');
  } catch {
    return null;
  }
  const record = parseRecord(text);
  return record !== null && record.branch === branch ? record : null;
};

/**
 * Reads every spent file in the directory.
 *
 * @param repoRoot - absolute path to the repository root.
 * @returns each readable record. A missing directory gives an empty list, and
 *   an unreadable file is skipped.
 */
export const readAllBriefSpent = (repoRoot: string): BriefSpentRecord[] => {
  let names: string[];
  try {
    names = fs.readdirSync(briefSpentDir(repoRoot));
  } catch {
    return [];
  }
  return names
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return parseRecord(fs.readFileSync(path.join(briefSpentDir(repoRoot), name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((record): record is BriefSpentRecord => record !== null);
};
