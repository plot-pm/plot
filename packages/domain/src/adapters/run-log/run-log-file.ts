import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { RunLogStepSchema, type RunLog, type RunLogLine } from '../../ports/run-log.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the log's directory, for tests.
 *
 * A suite that wrote to the operator's own log would make a later tick read a
 * fixture's action as this estate's own.
 */
export const RUN_LOG_HOME_ENV = 'PLOT_RUN_LOG_HOME';

/** The log's filename, under the common git dir's `.plot/state/`. */
const FILE = 'run-log.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface RunLogFileOptions {
  /** The repository to resolve the log for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit log directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Escapes a tab or a newline out of a field, so a free-text `outcome` can
 * never shift a later column or split into a second line.
 *
 * @param value - the raw field.
 * @returns the field with `\t` and `\n` replaced by their two-character escapes.
 */
const escapeField = (value: string): string => value.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n');

/**
 * Reverses {@link escapeField}.
 *
 * @param value - the escaped field, as read from the file.
 * @returns the original field.
 */
const unescapeField = (value: string): string =>
  value.replace(/\\(.)/g, (_, c: string) => (c === 't' ? '\t' : c === 'n' ? '\n' : c));

/** One line, tab-separated: plan, branch, pr, head, step, outcome, at. Every field is escaped. */
const encodeLine = (line: RunLogLine): string =>
  [line.plan, line.branch, line.pr, line.head, line.step, line.outcome, line.at].map(escapeField).join('\t');

/**
 * Parses one line into a {@link RunLogLine}, or `null` where it does not have
 * the shape this file ever writes.
 *
 * **A TORN OR FOREIGN LINE CONTRIBUTES NOTHING**, the same choice every other
 * `.plot/state/` reader makes: a line that does not split into exactly seven
 * fields, or whose `step`/`outcome` is not one this file's enums declare, is
 * skipped rather than read as a guess.
 *
 * @param rawLine - one line of the file, without its newline.
 * @returns the line, or null where it does not parse.
 */
export const decodeRunLogLine = (rawLine: string): RunLogLine | null => {
  const fields = rawLine.split('\t').map(unescapeField);
  if (fields.length !== 7) return null;
  const [plan, branch, pr, head, step, outcome, at] = fields;
  if (plan === '' || at === '') return null;
  const parsedStep = RunLogStepSchema.safeParse(step);
  if (!parsedStep.success) return null;
  return { plan, branch, pr, head, step: parsedStep.data, outcome, at };
};

/**
 * Reads and appends `.plot/state/run-log.tsv` for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, the same reason
 * {@link freshAgentRecordFile} resolves there and not from `--show-toplevel`:
 * a desk is a linked worktree `plot-reap.sh` removes, and a line written to
 * one is destroyed by the reap that measured it.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link RunLog} backed by one file per repository.
 */
export const runLogFile = (options: RunLogFileOptions = {}): RunLog => {
  const env = options.env ?? process.env;

  /** The log's directory, from the COMMON git dir — cached per instance. */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[RUN_LOG_HOME_ENV];
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
    read: async (): Promise<PortResult<readonly RunLogLine[]>> => {
      const path = await pathOf();
      if (path === null) return answered([]);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // A MISSING FILE IS AN EMPTY LOG — the state of every repository that
        // has not yet taken a loop action. Absence must never read as
        // "unreadable."
        if (isMissing(error)) return answered([]);
        return failed<readonly RunLogLine[]>();
      }
      const lines = text
        .split('\n')
        .filter((rawLine) => rawLine !== '')
        .map(decodeRunLogLine)
        .filter((line): line is RunLogLine => line !== null);
      return answered(lines);
    },

    append: async (line: RunLogLine): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      try {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, `${encodeLine(line)}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
