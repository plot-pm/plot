import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import type { PinnedTips } from '../../ports/pinned-tips.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable naming the record's directory, for tests.
 *
 * A suite that wrote to the operator's own record would pin a tip in the
 * operator's own repository.
 */
export const PINNED_TIPS_HOME_ENV = 'PLOT_PINNED_TIPS_HOME';

/** The record's filename, under the common git dir's `.plot/state/`. */
const FILE = 'reaped.tsv';

/** The seams the adapter needs so a test never touches the operator's own file. */
export interface PinnedTipsFileOptions {
  /** The checkout to resolve the record for, and to run `git update-ref` in; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit record directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/** One row: the ref, its sha, and the ISO time it was pinned. */
interface Row {
  ref: string;
  sha: string;
  at: string;
}

/** The rows a record's text holds, blank lines dropped. */
const rowsIn = (text: string): readonly Row[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => {
      const [ref = '', sha = '', at = ''] = line.split('\t');
      return { ref, sha, at };
    });

const serialize = (rows: readonly Row[]): string => rows.map((r) => `${r.ref}\t${r.sha}\t${r.at}`).join('\n');

/**
 * Pins tips to `refs/plot/reaped/<branch>/<sha>` and `.plot/state/reaped.tsv`,
 * for ONE repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, resolved against `cwd`, so a
 * desk and the main checkout name the same file — the same placement
 * {@link refusedSlicesFile} uses. See {@link PinnedTips}.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a {@link PinnedTips} backed by one ref namespace and one file per
 *   repository.
 */
export const pinnedTipsFile = (options: PinnedTipsFileOptions = {}): PinnedTips => {
  const env = options.env ?? process.env;

  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[PINNED_TIPS_HOME_ENV];
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

  const textOf = async (path: string): Promise<string | null> => {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      return isMissing(error) ? '' : null;
    }
  };

  return {
    pin: async (branch: string, sha: string): Promise<PortResult<string>> => {
      if (branch === '' || sha === '') return failed<string>();
      const ref = `refs/plot/reaped/${branch}/${sha}`;
      const write = await runProcess('git', ['update-ref', ref, sha], { cwd: options.cwd });
      if (write.code !== 0) return failed<string>();

      const dir = await dirOf();
      if (dir === null) return failed<string>();
      const path = join(dir, FILE);
      const text = await textOf(path);
      if (text === null) return failed<string>();
      try {
        await mkdir(dirname(path), { recursive: true });
        const lead = text === '' || text.endsWith('\n') ? '' : '\n';
        const at = new Date().toISOString();
        await appendFile(path, `${lead}${ref}\t${sha}\t${at}\n`, { encoding: 'utf8' });
        return answered(ref);
      } catch {
        return failed<string>();
      }
    },

    prune: async (maxAgeMs: number, now: Date): Promise<PortResult<readonly string[]>> => {
      const dir = await dirOf();
      if (dir === null) return answered([]);
      const path = join(dir, FILE);
      const text = await textOf(path);
      if (text === null) return failed<readonly string[]>();
      const rows = rowsIn(text);
      const stale: Row[] = [];
      const kept: Row[] = [];
      for (const row of rows) {
        const at = Date.parse(row.at);
        if (row.ref !== '' && !Number.isNaN(at) && now.getTime() - at >= maxAgeMs) stale.push(row);
        else kept.push(row);
      }
      if (stale.length === 0) return answered([]);

      const removed: string[] = [];
      for (const row of stale) {
        const del = await runProcess('git', ['update-ref', '-d', row.ref], { cwd: options.cwd });
        if (del.code === 0) removed.push(row.ref);
      }

      try {
        await mkdir(dirname(path), { recursive: true });
        const rest = serialize(kept);
        await writeFile(path, rest === '' ? '' : `${rest}\n`, { encoding: 'utf8' });
      } catch {
        return failed<readonly string[]>();
      }
      return answered(removed);
    },
  };
};
