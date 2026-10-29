import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { ReapRecord, ReapRecordRow, ReapRecordRowKind, ReapRecordSnapshot } from '../../ports/reap-record.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would overwrite the
 * operator's own dry run.
 */
export const REAP_RECORD_HOME_ENV = 'PLOT_REAP_RECORD_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'reap-dry-run.json';

const ROW_KINDS: readonly ReapRecordRowKind[] = ['worktree', 'branch', 'claim'];

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface ReapRecordFileOptions {
  /** The checkout to resolve the record for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit record directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

const isRow = (value: unknown): value is ReapRecordRow => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kind === 'string' &&
    (ROW_KINDS as readonly string[]).includes(v.kind) &&
    typeof v.identity === 'string' &&
    typeof v.tipSha === 'string' &&
    typeof v.reason === 'string'
  );
};

/**
 * Parses a snapshot's text, rejecting a parse that isn't one.
 *
 * @param text - the record file's content.
 * @returns the snapshot, or `null` when the text does not hold one.
 */
const snapshotIn = (text: string): ReapRecordSnapshot | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const v = parsed as Record<string, unknown>;
  if (
    typeof v.repoIdentity !== 'string' ||
    typeof v.defaultBranch !== 'string' ||
    typeof v.defaultBranchSha !== 'string' ||
    typeof v.at !== 'string' ||
    !Array.isArray(v.rows) ||
    !v.rows.every(isRow)
  ) {
    return null;
  }
  return {
    repoIdentity: v.repoIdentity,
    defaultBranch: v.defaultBranch,
    defaultBranchSha: v.defaultBranchSha,
    at: v.at,
    rows: v.rows,
  };
};

/**
 * Stores one `--dry-run` snapshot at `.plot/state/reap-dry-run.json`, for ONE
 * repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, resolved against `cwd`, the same
 * placement {@link pinnedTipsFile} uses — a desk and the main checkout must
 * read the same file.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link ReapRecord} backed by one JSON file per repository.
 */
export const reapRecordFile = (options: ReapRecordFileOptions = {}): ReapRecord => {
  const env = options.env ?? process.env;

  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[REAP_RECORD_HOME_ENV];
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

  return {
    write: async (snapshot: ReapRecordSnapshot): Promise<PortResult<undefined>> => {
      const dir = await dirOf();
      if (dir === null) return failed<undefined>();
      const path = join(dir, FILE);
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<undefined>();
      }
    },

    read: async (): Promise<PortResult<ReapRecordSnapshot | null>> => {
      const dir = await dirOf();
      if (dir === null) return answered(null);
      const path = join(dir, FILE);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        return isMissing(error) ? answered(null) : failed<ReapRecordSnapshot | null>();
      }
      const snapshot = snapshotIn(text);
      return snapshot === null ? failed<ReapRecordSnapshot | null>() : answered(snapshot);
    },
  };
};
