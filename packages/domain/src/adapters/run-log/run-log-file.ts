import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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
 * Creates one directory whose parent must already exist.
 *
 * @param dir - the directory to create.
 * @returns once the directory exists; rejects with `ENOENT` where its parent does not.
 */
const mkdirOne = async (dir: string): Promise<void> => {
  try {
    await mkdir(dir);
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
  }
};

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

  /** The common git dir, resolved once per instance; `null` outside a repository. */
  let cachedCommon: string | null | undefined;
  const commonDirOf = async (): Promise<string | null> => {
    if (cachedCommon !== undefined) return cachedCommon;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    cachedCommon = run.code !== 0 || out === '' ? null : resolve(options.cwd ?? process.cwd(), out);
    return cachedCommon;
  };

  /** An explicit directory from the options or the environment, or `null` to use the git lookup. */
  const explicitDir = (): string | null => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[RUN_LOG_HOME_ENV];
    return override !== undefined && override !== '' ? override : null;
  };

  /** The log's directory: the explicit one, or `.plot/state` under the COMMON git dir. */
  const dirOf = async (): Promise<string | null> => {
    const explicit = explicitDir();
    if (explicit !== null) return explicit;
    const common = await commonDirOf();
    return common === null ? null : join(common, '.plot', 'state');
  };

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILE);
  };

  /**
   * Creates the log's directory.
   *
   * An explicit directory is created with every missing parent. Under the
   * common git dir only `.plot` and `.plot/state` are created, one level at a
   * time, so an append never recreates a git dir that no longer exists: the
   * first `mkdir` fails with `ENOENT` instead.
   */
  const ensureDir = async (): Promise<boolean> => {
    const explicit = explicitDir();
    if (explicit !== null) {
      await mkdir(explicit, { recursive: true });
      return true;
    }
    const common = await commonDirOf();
    if (common === null) return false;
    await mkdirOne(join(common, '.plot'));
    await mkdirOne(join(common, '.plot', 'state'));
    return true;
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
        if (!(await ensureDir())) return failed<void>();
        await appendFile(path, `${encodeLine(line)}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
