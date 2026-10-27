import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import { decodeFleetdStart, encodeFleetdStart, type FleetdStart } from '../../entities/fleetd-start.js';
import type { FleetdStartStore } from '../../ports/fleetd-start.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the record's directory, for tests.
 *
 * A suite writing to the operator's own record would hand a live board
 * fixture a start it never had.
 */
export const FLEETD_START_HOME_ENV = 'PLOT_FLEETD_START_HOME';

/** The file the daemon replaces once per process life, under the common git dir's `.plot/state/`. */
const FILE = 'fleetd-start.json';

/** The seams a test needs so a suite never touches the operator's own record. */
export interface FleetdStartFileOptions {
  /** The repository to resolve the record for; the process's cwd when omitted. */
  cwd?: string;
  /** An explicit directory, bypassing the git lookup. */
  home?: string;
  /** Reads the environment; defaults to `process.env`. */
  env?: Record<string, string | undefined>;
}

/** Whether a failure was the file simply not being there. */
const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';

/**
 * Keeps one repository's fleetd-start record as one file.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, the same reason
 * `supervision-report-file.ts` resolves there: the daemon and a reader run in
 * different processes with different working directories, and resolving from
 * the common dir is what makes them meet at one file rather than at two.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `FleetdStartStore` backed by one file per repository.
 */
export const fleetdStartFile = (options: FleetdStartFileOptions = {}): FleetdStartStore => {
  const env = options.env ?? process.env;

  /**
   * The record's directory, from the COMMON git dir.
   *
   * Cached per adapter instance: the answer cannot change while a process
   * runs, and the read path would otherwise fork `git` on every refresh.
   */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[FLEETD_START_HOME_ENV];
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
    cached = join(resolve(options.cwd ?? process.cwd(), out), '.plot', 'state');
    return cached;
  };

  const pathOf = async (): Promise<string | null> => {
    const dir = await dirOf();
    return dir === null ? null : join(dir, FILE);
  };

  return {
    location: async (): Promise<PortResult<string>> => {
      const path = await pathOf();
      return path === null ? failed<string>() : answered(path);
    },

    read: async (): Promise<PortResult<FleetdStart | null>> => {
      const path = await pathOf();
      if (path === null) return failed<FleetdStart | null>();
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // NO FILE IS *NO FLEETD START RECORDED*, which is an answer — the state
        // of every machine where the supervisor has never run.
        if (isMissing(error)) return answered(null);
        return failed<FleetdStart | null>();
      }
      return answered(decodeFleetdStart(text));
    },

    write: async (record: FleetdStart): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      // WRITTEN WHOLE OR NOT AT ALL, the same rename-based atomicity
      // `supervision-report-file.ts` uses.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeFleetdStart(record), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
