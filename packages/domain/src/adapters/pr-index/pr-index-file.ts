import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodePrIndex, encodePrIndex, type PrIndex } from '../../entities/pr-index.js';
import type { PrIndexStore } from '../../ports/pr-index.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the store's directory, for tests.
 *
 * A suite that wrote to the operator's own store would put fixture PRs into the
 * file a live board reads, and the board would serve them.
 */
export const PR_INDEX_HOME_ENV = 'PLOT_PR_INDEX_HOME';

/** The store's subdirectory under the common git dir's `.plot/state/`. */
const SUBDIR = 'index';

/**
 * Reduces a connector's name to something safe to put in a path.
 *
 * The name reaches this from `## Plot Config`, which an adopting repository
 * writes by hand. A value carrying `/` or `..` would place the store outside
 * the directory that was chosen for it, so every character outside the
 * recognised set becomes `-` and an empty result becomes `unknown` — a
 * connector nobody named still writes somewhere readable rather than nowhere.
 *
 * @param connector - the connector's name as configured.
 * @returns a single path segment.
 */
export const connectorFile = (connector: string): string => {
  const safe = connector.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[.-]+/, '');
  return `${safe === '' ? 'unknown' : safe}.json`;
};

/** The seams a test needs so a suite never touches the operator's own store. */
export interface PrIndexFileOptions {
  /** The repository to resolve the store for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit store directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps one repository's PR store, one file per connector.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, for the reason
 * `slice-spend-file.ts` measured on 2026-09-15:
 *
 * ```
 * --show-toplevel   → …/.worktrees/feature-one-monitor-watches-the-slice   ← the DESK
 * --git-common-dir  → …/plot/.git                                          ← shared
 * ```
 *
 * `plot-reap.sh` runs `git worktree remove --force` over the desks, so a store
 * written to one is destroyed by the reaper — with every gate green, because a
 * test in the main checkout cannot see the difference.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `PrIndexStore` backed by one file per connector per repository.
 */
export const prIndexFile = (options: PrIndexFileOptions = {}): PrIndexStore => {
  const env = options.env ?? process.env;

  /**
   * The store's directory, from the COMMON git dir.
   *
   * Cached per adapter instance: the answer cannot change while a process runs,
   * and the read path would otherwise fork `git` on every refresh.
   */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[PR_INDEX_HOME_ENV];
    if (override !== undefined && override !== '') return override;
    if (cached !== undefined) return cached;
    const run = await runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: options.cwd });
    const out = run.stdout.trim();
    if (run.code !== 0 || out === '') {
      cached = null;
      return cached;
    }
    // `--git-common-dir` answers relatively in the checkout it is run from, so
    // it is resolved against the cwd rather than trusted as absolute.
    cached = join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state', SUBDIR);
    return cached;
  };

  const pathOf = async (connector: string): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, connectorFile(connector));
  };

  return {
    location: async (connector: string): Promise<PortResult<string>> => {
      const path = await pathOf(connector);
      return path === null ? failed<string>() : answered(path);
    },

    read: async (connector: string): Promise<PortResult<PrIndex | null>> => {
      const path = await pathOf(connector);
      if (path === null) return failed<PrIndex | null>();
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // NO FILE IS NOTHING TO START FROM, which is an answer — the state of
        // every checkout that has not refreshed yet. Every other read error is
        // a failure, so an unreadable store is never read as an absent one.
        if (isMissing(error)) return answered(null);
        return failed<PrIndex | null>();
      }
      // A FILE THIS PLOT CANNOT PARSE IS NOTHING TO START FROM, NOT A FAILURE.
      // An unrecognised `v`, a row whose shape changed and a torn tail all mean
      // the same thing to the caller: ask the host for everything, exactly as a
      // cold store does. Reporting `failed` would make the next schema change
      // surface to the operator as a broken board rather than as one full read.
      return answered(decodePrIndex(text));
    },

    write: async (connector: string, index: PrIndex): Promise<PortResult<void>> => {
      const path = await pathOf(connector);
      if (path === null) return failed<void>();
      // WRITTEN WHOLE OR NOT AT ALL. A board killed mid-write would otherwise
      // leave a truncated file — which parses as nothing to start from, so it
      // costs one full read rather than a wrong answer, but it also costs the
      // store every refresh until something rewrites it. The rename is atomic
      // within a directory, and the temp file is a sibling so it never crosses
      // a filesystem boundary.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodePrIndex(index), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
