import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { RefusedSliceRecord } from '../../ports/refused-slices.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would hold a real slice in
 * the operator's queue.
 */
export const REFUSED_SLICES_HOME_ENV = 'PLOT_REFUSED_SLICES_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'refused-slices.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface RefusedSlicesFileOptions {
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

/** The branches a record's text holds, trimmed, blank lines dropped. */
const branchesIn = (text: string): readonly string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * Reads and appends `.plot/state/refused-slices.tsv` for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, resolved against `cwd`, so a
 * desk and the main checkout name the same file. See {@link RefusedSliceRecord}.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link RefusedSliceRecord} backed by one file per repository.
 */
export const refusedSlicesFile = (options: RefusedSlicesFileOptions = {}): RefusedSliceRecord => {
  const env = options.env ?? process.env;

  /** The record's directory, from the COMMON git dir — cached per instance. */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[REFUSED_SLICES_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    if (run.code !== 0 || out === '') {
      cached = null;
      return cached;
    }
    // `--git-common-dir` answers relatively in the checkout it is run from.
    cached = join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state');
    return cached;
  };

  /** The record's text; `''` for a missing file, `null` for any other read error. */
  const textOf = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      return isMissing(error) ? '' : null;
    }
  };

  return {
    has: async (branch: string): Promise<PortResult<boolean>> => {
      const dir = await dirOf();
      if (dir === null) return answered(false);
      const text = await textOf(join(dir, FILE));
      if (text === null) return failed<boolean>();
      return answered(branchesIn(text).includes(branch));
    },

    record: async (branch: string): Promise<PortResult<void>> => {
      if (branch === '') return answered(undefined);
      const dir = await dirOf();
      if (dir === null) return failed<void>();
      const path = join(dir, FILE);
      const text = await textOf(path);
      if (text === null) return failed<void>();
      if (branchesIn(text).includes(branch)) return answered(undefined);
      try {
        await mkdir(dirname(path), { recursive: true });
        // A file whose last line has no newline gets one first, so the
        // appended branch never joins the previous line.
        const lead = text === '' || text.endsWith('\n') ? '' : '\n';
        await appendFile(path, `${lead}${branch}\n`, { encoding: 'utf8' });
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
