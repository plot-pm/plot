import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { EndingAskRecord, EndingAskRecordStore } from '../../ports/ending-ask-record.js';
import { runProcess } from '../run-script.js';

/** The environment variable naming the record's directory, for tests. */
export const ENDING_ASK_RECORD_HOME_ENV = 'PLOT_ENDING_ASK_RECORD_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'ending-asks.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface EndingAskRecordFileOptions {
  /** The repository to resolve the record for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit record directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** One row, tab-separated: plan, branch, ending time, ask time. No field carries a tab or a newline. */
const encodeRow = (record: EndingAskRecord): string =>
  [record.plan, record.branch, record.endingAt, record.at].join('\t');

/**
 * Parses one line into an {@link EndingAskRecord}, or `null` where it does
 * not have the four fields this file writes, or names no branch or ending time.
 *
 * @param line - one line of the file, without its newline.
 * @returns the row, or null where the line does not parse.
 */
export const decodeEndingAskRow = (line: string): EndingAskRecord | null => {
  const fields = line.split('\t');
  if (fields.length !== 4) return null;
  const [plan, branch, endingAt, at] = fields as [string, string, string, string];
  if (branch === '' || endingAt === '') return null;
  return { plan, branch, endingAt, at };
};

/**
 * Reads and appends `.plot/state/ending-asks.tsv` for one repository, under
 * the directory `git rev-parse --git-common-dir` names.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns an {@link EndingAskRecordStore} backed by one file per repository.
 */
export const endingAskRecordFile = (options: EndingAskRecordFileOptions = {}): EndingAskRecordStore => {
  const env = options.env ?? process.env;

  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[ENDING_ASK_RECORD_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    cached = run.code !== 0 || out === '' ? null : join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state');
    return cached;
  };

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILE);
  };

  return {
    asked: async (plan, branch, endingAt): Promise<PortResult<boolean>> => {
      const path = await pathOf();
      if (path === null) return failed<boolean>();
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        return isMissing(error) ? answered(false) : failed<boolean>();
      }
      return answered(
        text
          .split('\n')
          .map(decodeEndingAskRow)
          .some((row) => row !== null && row.plan === plan && row.branch === branch && row.endingAt === endingAt),
      );
    },

    append: async (record): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${encodeRow(record)}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
