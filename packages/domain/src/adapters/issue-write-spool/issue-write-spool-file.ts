import { appendFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeIssueWrite, encodeIssueWrite, type IssueWrite } from '../../entities/issue-write.js';
import type { IssueIndexStore } from '../../ports/issue-index.js';
import type { IssueWriteSpool } from '../../ports/issue-write-spool.js';
import { issueIndexFile, type IssueIndexFileOptions } from '../issue-index/issue-index-file.js';

/** The spool's filename, beside `issues.json`. */
const FILENAME = 'issue-writes.jsonl';

/**
 * The most bytes the spool holds. An append past it fails, so a stopped fleetd
 * costs a few writes' latency and not disk.
 */
export const ISSUE_WRITE_SPOOL_BYTES = 262_144;

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps the spool as one file beside the issue index.
 *
 * **BOUND: SPENT.** `drain` renames the file to a sibling named for the draining
 * process, reads it and removes it, so a file never outlives the drain that took
 * it; an undrained spool stops growing at {@link ISSUE_WRITE_SPOOL_BYTES}. A
 * drain that dies between the rename and the fold loses its writes, which costs
 * latency only: the next full read answers every row.
 *
 * @param store - the issue index store whose directory holds the spool.
 * @returns an `IssueWriteSpool` backed by one file.
 */
export const issueWriteSpoolOver = (store: IssueIndexStore): IssueWriteSpool => {
  const pathOf = async (): Promise<string | null> => {
    const at = await store.location();
    return at.ok ? join(dirname(at.value), FILENAME) : null;
  };

  return {
    append: async (write: IssueWrite): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      try {
        await mkdir(dirname(path), { recursive: true });
        try {
          if ((await stat(path)).size >= ISSUE_WRITE_SPOOL_BYTES) return failed<void>();
        } catch (error) {
          if (!isMissing(error)) return failed<void>();
        }
        // ONE LINE PER APPEND, with `O_APPEND`: concurrent entries never tear a line.
        await appendFile(path, encodeIssueWrite(write), { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },

    drain: async (): Promise<PortResult<IssueWrite[]>> => {
      const path = await pathOf();
      if (path === null) return failed<IssueWrite[]>();
      const taken = `${path}.${process.pid}.draining`;
      try {
        await rename(path, taken);
      } catch (error) {
        return isMissing(error) ? answered<IssueWrite[]>([]) : failed<IssueWrite[]>();
      }
      try {
        const text = await readFile(taken, 'utf8');
        return answered(
          text.split('\n').flatMap((line) => {
            const write = decodeIssueWrite(line);
            return write === null ? [] : [write];
          }),
        );
      } catch {
        return failed<IssueWrite[]>();
      } finally {
        await unlink(taken).catch(() => undefined);
      }
    },
  };
};

/**
 * Keeps the spool of the repository `options` names.
 *
 * @param options - explicit paths or environment, as {@link issueIndexFile} takes.
 * @returns the spool beside that repository's issue index.
 */
export const issueWriteSpoolFile = (options: IssueIndexFileOptions = {}): IssueWriteSpool =>
  issueWriteSpoolOver(issueIndexFile(options));
