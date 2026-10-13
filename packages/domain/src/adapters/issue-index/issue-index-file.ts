import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeIssueIndex, encodeIssueIndex, type IssueIndex } from '../../entities/issue-index.js';
import type { IssueIndexStore } from '../../ports/issue-index.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the store's directory, for tests.
 *
 * A suite that wrote to the operator's own store would put fixture issues
 * into the file a live board reads, and the board would serve them.
 */
export const ISSUE_INDEX_HOME_ENV = 'PLOT_ISSUE_INDEX_HOME';

/** The store's subdirectory under the common git dir's `.plot/state/`. */
const SUBDIR = 'index';

/** The store's filename — one file, since a repository names one tracker. */
const FILENAME = 'issues.json';

/** The seams a test needs so a suite never touches the operator's own store. */
export interface IssueIndexFileOptions {
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
 * Keeps one repository's issue store, one file for the whole repository.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, for the reason `pr-index-file.ts`
 * measured: `--show-toplevel` answers a dispatch worktree's own desk, and
 * `plot-reap.sh` removes exactly those, taking a store written there with it.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns an `IssueIndexStore` backed by one file per repository.
 */
export const issueIndexFile = (options: IssueIndexFileOptions = {}): IssueIndexStore => {
  const env = options.env ?? process.env;

  /**
   * The store's directory, from the COMMON git dir.
   *
   * Cached per adapter instance: the answer cannot change while a process
   * runs, and the read path would otherwise fork `git` on every pass.
   */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[ISSUE_INDEX_HOME_ENV];
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

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILENAME);
  };

  return {
    location: async (): Promise<PortResult<string>> => {
      const path = await pathOf();
      return path === null ? failed<string>() : answered(path);
    },

    read: async (): Promise<PortResult<IssueIndex | null>> => {
      const path = await pathOf();
      if (path === null) return failed<IssueIndex | null>();
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // NO FILE IS NOTHING TO START FROM, which is an answer — the state of
        // every checkout no pass has written yet. Every other read error is a
        // failure, so an unreadable store is never read as an absent one.
        if (isMissing(error)) return answered(null);
        return failed<IssueIndex | null>();
      }
      // A FILE THIS PLOT CANNOT PARSE IS NOTHING TO START FROM, NOT A FAILURE —
      // the same contract `prIndexFile.read` keeps.
      return answered(decodeIssueIndex(text));
    },

    write: async (index: IssueIndex): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      // WRITTEN WHOLE OR NOT AT ALL — the rename is atomic within a directory,
      // and the temp file is a sibling so it never crosses a filesystem
      // boundary.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeIssueIndex(index), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
