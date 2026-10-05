import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { FreshAgentRecord, FreshAgentRecordStore } from '../../ports/fresh-agent-record.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would make a later tick
 * read a fixture's fresh session as this estate's own.
 */
export const FRESH_AGENT_RECORD_HOME_ENV = 'PLOT_FRESH_AGENT_RECORD_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'fresh-agents.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface FreshAgentRecordFileOptions {
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
 * One row, tab-separated: branch, worktree, when, the failing run's URL.
 *
 * **A FIELD NEVER CARRIES A TAB OR A NEWLINE, SO NONE IS ESCAPED.** A branch
 * name, an absolute path and an ISO timestamp cannot hold either; a run URL
 * is a single token with no whitespace of its own. A row that somehow did
 * carry one would corrupt itself on the next read either way, so this is a
 * property of the inputs rather than a guard this function adds.
 */
const encodeRow = (record: FreshAgentRecord): string =>
  [record.branch, record.worktree, record.at, record.runUrl].join('\t');

/**
 * Parses one line into a {@link FreshAgentRecord}, or `null` where it does
 * not have the shape this file ever writes.
 *
 * **A TORN OR FOREIGN LINE CONTRIBUTES NOTHING, THE SAME CHOICE EVERY OTHER
 * `.plot/state/` READER MAKES.** A line that does not split into exactly four
 * fields is skipped rather than read as a row with empty trailing fields,
 * because a corrupted branch name reading as "a session already ran" is the
 * one misreading this record must never produce.
 *
 * @param line - one line of the file, without its newline.
 * @returns the row, or null where the line does not parse.
 */
export const decodeRow = (line: string): FreshAgentRecord | null => {
  const fields = line.split('\t');
  if (fields.length !== 4) return null;
  const [branch, worktree, at, runUrl] = fields;
  if (branch === '' || worktree === '' || at === '') return null;
  return { branch, worktree, at, runUrl: runUrl ?? '' };
};

/**
 * Reads and appends `.plot/state/fresh-agents.tsv` for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, the same reason
 * {@link sliceSpendFile} resolves there and not from `--show-toplevel`: a
 * desk is a linked worktree `plot-reap.sh` removes, and a record written to
 * one is destroyed by the reap that measured it.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link FreshAgentRecordStore} backed by one file per repository.
 */
export const freshAgentRecordFile = (
  options: FreshAgentRecordFileOptions = {},
): FreshAgentRecordStore => {
  const env = options.env ?? process.env;

  /** The record's directory, from the COMMON git dir — cached per instance. */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[FRESH_AGENT_RECORD_HOME_ENV];
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
    rowsFor: async (branch: string): Promise<PortResult<readonly FreshAgentRecord[]>> => {
      const path = await pathOf();
      if (path === null) return answered([]);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // A MISSING FILE IS AN EMPTY RECORD — the state of every repository
        // that has not yet started a fresh session. The plan's own contract:
        // absence must never read as "a session already ran."
        if (isMissing(error)) return answered([]);
        return failed<readonly FreshAgentRecord[]>();
      }
      const rows = text
        .split('\n')
        .filter((line) => line !== '')
        .map(decodeRow)
        .filter((row): row is FreshAgentRecord => row !== null)
        .filter((row) => row.branch === branch);
      return answered(rows);
    },

    append: async (record: FreshAgentRecord): Promise<PortResult<void>> => {
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
