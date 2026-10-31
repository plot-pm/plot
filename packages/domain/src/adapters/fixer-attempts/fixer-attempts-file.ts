import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeFixerAttempts,
  encodeFixerAttempts,
  FIXER_ATTEMPTS_VERSION,
  type FixerAttempt,
  type FixerAttemptsRecord,
  type FixerInFlight,
} from '../../entities/fixer-attempts.js';
import type { FixerAttemptsStore } from '../../ports/fixer-attempts.js';

/** The subdirectory under `.plot/state/` holding one file per PR. */
const SUBDIR = 'fixer-attempts';

/** Where one PR's record lives under a repository root. */
export const fixerAttemptsPath = (repoRoot: string, pr: number): string =>
  join(repoRoot, '.plot', 'state', SUBDIR, `${pr}.json`);

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps one repository's fixer attempts, one JSON file per PR under
 * `.plot/state/fixer-attempts/`.
 *
 * **MACHINE-LOCAL, LIKE THE REST OF `.plot/state/`.** The file lives beside
 * `default-branch.json` and the PR index, under the same gitignored tree.
 *
 * @param repoRoot - the repository the records belong to.
 * @returns a `FixerAttemptsStore` backed by one file per PR.
 */
export const fixerAttemptsFile = (repoRoot: string): FixerAttemptsStore => {
  const pathFor = (pr: number): string => fixerAttemptsPath(repoRoot, pr);

  // ONE RENAME PER WRITE, so a reader sees the old record or the new one, never a torn file.
  const write = async (pr: number, record: FixerAttemptsRecord): Promise<PortResult<void>> => {
    const path = pathFor(pr);
    const temp = `${path}.${process.pid}.tmp`;
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(temp, encodeFixerAttempts(record), { encoding: 'utf8' });
      await rename(temp, path);
      return answered(undefined);
    } catch {
      return failed<void>();
    }
  };

  return {
    read: async (pr: number): Promise<PortResult<FixerAttemptsRecord | 'none' | 'unreadable'>> => {
      let text: string;
      try {
        text = await readFile(pathFor(pr), 'utf8');
      } catch (error) {
        // No file is no record, which is an answer; any other error is a failure.
        if (isMissing(error)) return answered('none');
        return failed<FixerAttemptsRecord | 'none' | 'unreadable'>();
      }
      return answered(decodeFixerAttempts(text));
    },

    markInFlight: async (pr: number, index: number, mark: FixerInFlight | null): Promise<PortResult<void>> => {
      let existing: FixerAttemptsRecord | 'none' | 'unreadable';
      try {
        existing = decodeFixerAttempts(await readFile(pathFor(pr), 'utf8'));
      } catch {
        return failed<void>();
      }
      if (existing === 'none' || existing === 'unreadable') return failed<void>();
      const target = existing.attempts[index];
      if (target === undefined) return failed<void>();
      const kept: FixerAttempt = { headSha: target.headSha, finding: target.finding };
      const changed: FixerAttempt = mark === null ? kept : { ...kept, inFlight: mark };
      const attempts = existing.attempts.map((attempt, at) => (at === index ? changed : attempt));
      return write(pr, { ...existing, attempts });
    },

    append: async (pr: number, attempt: FixerAttempt): Promise<PortResult<void>> => {
      const path = pathFor(pr);
      let existing: FixerAttemptsRecord | 'none' | 'unreadable';
      try {
        const text = await readFile(path, 'utf8');
        existing = decodeFixerAttempts(text);
      } catch (error) {
        if (!isMissing(error)) return failed<void>();
        existing = 'none';
      }
      // AN UNREADABLE RECORD IS NEVER APPENDED TO. Writing a fresh record over
      // one this build cannot parse would silently discard whatever a newer
      // or older Plot wrote there, and the caller that asked for this attempt
      // to be recorded would read success while the budget it depends on
      // still holds whatever the unreadable file held.
      if (existing === 'unreadable') return failed<void>();
      const attempts = existing === 'none' ? [] : existing.attempts;
      return write(pr, { v: FIXER_ATTEMPTS_VERSION, pr, attempts: [...attempts, attempt] });
    },
  };
};
