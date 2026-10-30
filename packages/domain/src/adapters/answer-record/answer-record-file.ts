import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { AnswerRecord, AnswerRecordStore } from '../../ports/answer-record.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would make a later tick
 * read a fixture's answer as this estate's own.
 */
export const ANSWER_RECORD_HOME_ENV = 'PLOT_ANSWER_RECORD_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'answers.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface AnswerRecordFileOptions {
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

/**
 * One row, tab-separated: worktree, askedAt, question, answer, author, outcome.
 *
 * **A FIELD NEVER CARRIES A TAB OR A NEWLINE, SO NONE IS ESCAPED, EXCEPT
 * WHAT A PERSON TYPES.** A worktree path, an ISO timestamp and an author
 * handle cannot hold either; the question is a marker's first line, already
 * free of newlines by construction. The answer is free text, so a tab or
 * newline within it is replaced with a space before encoding — the row stays
 * one line and no field boundary shifts.
 */
const sanitize = (field: string): string => field.replace(/[\t\n\r]+/g, ' ');

const encodeRow = (record: AnswerRecord): string =>
  [record.worktree, record.askedAt, record.question, record.answer, record.author, record.outcome]
    .map(sanitize)
    .join('\t');

/**
 * Parses one line into an {@link AnswerRecord}, or `null` where it does not
 * have the shape this file ever writes.
 *
 * **A TORN OR FOREIGN LINE CONTRIBUTES NOTHING**, the same choice every other
 * `.plot/state/` reader makes. A line that does not split into exactly six
 * fields is skipped rather than read as a row with empty trailing fields.
 *
 * @param line - one line of the file, without its newline.
 * @returns the row, or null where the line does not parse.
 */
export const decodeAnswerRow = (line: string): AnswerRecord | null => {
  const fields = line.split('\t');
  if (fields.length !== 6) return null;
  const [worktree, askedAt, question, answer, author, outcome] = fields;
  if (worktree === '' || askedAt === '' || author === '' || outcome === '') return null;
  return { worktree, askedAt, question: question ?? '', answer: answer ?? '', author, outcome };
};

/**
 * Reads and appends `.plot/state/answers.tsv` for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, the same reason
 * `freshAgentRecordFile` resolves there and not from `--show-toplevel`: a
 * desk is a linked worktree `plot-reap.sh` removes, and a record written to
 * one is destroyed by the reap that measured it.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns an {@link AnswerRecordStore} backed by one file per repository.
 */
export const answerRecordFile = (options: AnswerRecordFileOptions = {}): AnswerRecordStore => {
  const env = options.env ?? process.env;

  /** The record's directory, from the COMMON git dir — cached per instance. */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[ANSWER_RECORD_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    if (run.code !== 0 || out === '') {
      cached = null;
      return cached;
    }
    cached = join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state');
    return cached;
  };

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILE);
  };

  return {
    rowsFor: async (worktree: string, askedAt: string): Promise<PortResult<readonly AnswerRecord[]>> => {
      const path = await pathOf();
      if (path === null) return answered([]);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // A MISSING FILE IS AN EMPTY RECORD — the state of every repository
        // that has not yet answered a question. Absence must never read as
        // "this question already started."
        if (isMissing(error)) return answered([]);
        return failed<readonly AnswerRecord[]>();
      }
      const rows = text
        .split('\n')
        .filter((line) => line !== '')
        .map(decodeAnswerRow)
        .filter((row): row is AnswerRecord => row !== null)
        .filter((row) => row.worktree === worktree && row.askedAt === askedAt);
      return answered(rows);
    },

    append: async (record: AnswerRecord): Promise<PortResult<void>> => {
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
