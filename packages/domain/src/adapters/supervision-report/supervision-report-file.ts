import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { answered, failed, type PortResult } from '../../port-result.js';
import {
  decodeSupervisionReport,
  encodeSupervisionReport,
  type SupervisionReport,
} from '../../entities/supervision-report.js';
import type { SupervisionReportStore } from '../../ports/supervision-report.js';
import { runProcess } from '../run-script.js';

/**
 * The environment variable that names the report's directory, for tests.
 *
 * A suite writing to the operator's own report would hand a live board fixture
 * causes, and the board would render them.
 */
export const SUPERVISION_REPORT_HOME_ENV = 'PLOT_SUPERVISION_REPORT_HOME';

/** The file the daemon replaces each tick, under the common git dir's `.plot/state/`. */
const FILE = 'supervision.json';

/** The seams a test needs so a suite never touches the operator's own report. */
export interface SupervisionReportFileOptions {
  /** The repository to resolve the report for; the process's cwd when omitted. */
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
 * Keeps one repository's supervision report as one file.
 *
 * **THE PATH COMES FROM `--git-common-dir`**, the reading `pr-index-file.ts`
 * measured on 2026-09-15:
 *
 * ```
 * --show-toplevel   → …/.worktrees/free-83d3325b   ← the DESK
 * --git-common-dir  → …/plot/.git                  ← shared
 * ```
 *
 * It matters twice here. The reaper destroys a report written to a desk, and the
 * daemon and the board run in different processes with different working
 * directories — resolving from the common dir is what makes them meet at one
 * file rather than at two.
 *
 * @param options - explicit paths or environment, for tests.
 * @returns a `SupervisionReportStore` backed by one file per repository.
 */
export const supervisionReportFile = (
  options: SupervisionReportFileOptions = {},
): SupervisionReportStore => {
  const env = options.env ?? process.env;

  /**
   * The report's directory, from the COMMON git dir.
   *
   * Cached per adapter instance: the answer cannot change while a process runs,
   * and the read path would otherwise fork `git` on every refresh.
   */
  let cached: string | null | undefined;
  const dirOf = async (): Promise<string | null> => {
    if (options.home !== undefined && options.home !== '') return options.home;
    const override = env[SUPERVISION_REPORT_HOME_ENV];
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

    read: async (): Promise<PortResult<SupervisionReport | null>> => {
      const path = await pathOf();
      if (path === null) return failed<SupervisionReport | null>();
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        // NO FILE IS *NO TICK JUDGED ANYTHING*, which is an answer — the state
        // of every machine where the supervisor has never run. Every other read
        // error is a failure, so an unreadable report is never an absent one.
        if (isMissing(error)) return answered(null);
        return failed<SupervisionReport | null>();
      }
      // A FILE THIS PLOT CANNOT PARSE IS NOTHING TO START FROM, NOT A FAILURE.
      // An unrecognised `v`, a changed shape and a torn tail all mean the same
      // thing to the board: carry no cause. Reporting `failed` would surface the
      // next format change as a broken board rather than as an absent field.
      return answered(decodeSupervisionReport(text));
    },

    write: async (report: SupervisionReport): Promise<PortResult<void>> => {
      const path = await pathOf();
      if (path === null) return failed<void>();
      // WRITTEN WHOLE OR NOT AT ALL. A daemon killed mid-write would otherwise
      // leave a truncated file; that parses as nothing to start from, so it
      // costs the board one field rather than a wrong answer, but it would also
      // cost it that field until the next tick. The rename is atomic within a
      // directory, and the temp file is a sibling so it never crosses a
      // filesystem boundary.
      const temp = `${path}.${process.pid}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temp, encodeSupervisionReport(report), { encoding: 'utf8' });
        await rename(temp, path);
        return answered(undefined);
      } catch {
        return failed<void>();
      }
    },
  };
};
